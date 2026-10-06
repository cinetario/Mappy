// Importação de arquivos .osm.pbf para o índice local (SQLite + R*Tree).
// Só entra o que o app usa: prédios (e building:part), ruas, água, linha de
// costa, cobertura do solo (landuse/natural/leisure) e árvores.
//
// O arquivo é lido em 4 passadas, porque no .pbf os nós (pontos) vêm antes
// dos caminhos e os caminhos antes das relações:
//   1. catálogo dos blocos + relações (multipolígonos) que interessam
//   2. caminhos: quais nós são necessários
//   3. nós: coordenadas só dos necessários (e árvores)
//   4. caminhos de novo: geometria → índice; depois as relações
import { closeSync, openSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAVES_RELEVANTES, GRUPOS_OSM, grupoDoElemento, grupoDoNo, type GrupoOSM } from '../src/core/categorias-osm.ts';
import { VERSAO_INDICE, abrirCelula, chaveCelula, criarTabelas, montarCelula } from './indice-osm.ts';
import {
  etiquetas, lerBlob, lerBloco, lerCabecalho, lerCaminhos, lerDensos, lerNos, lerRelacoes, listarBlobs, tiposDoBloco,
  type Bloco, type InfoBlob, type Membro,
} from './pbf.ts';

interface Relatorio {
  log: (s: string) => void;
  progresso: (s: string) => void;
  inicio: number;
}

const tempo = (r: Relatorio) => `${((Date.now() - r.inicio) / 1000).toFixed(0)} s`;

// ---------- lista crescente de números (ids de nós) sem estourar a memória do JS ----------
class ListaNumeros {
  private pedacos: Float64Array[] = [];
  private atual = new Float64Array(1 << 20);
  private n = 0;
  total = 0;
  add(v: number) {
    if (this.n === this.atual.length) {
      this.pedacos.push(this.atual);
      this.atual = new Float64Array(1 << 20);
      this.n = 0;
    }
    this.atual[this.n++] = v;
    this.total++;
  }
  /** ordena e remove repetidos */
  ordenadaSemRepetir(): Float64Array {
    const tudo = new Float64Array(this.total);
    let p = 0;
    for (const c of this.pedacos) {
      tudo.set(c, p);
      p += c.length;
    }
    tudo.set(this.atual.subarray(0, this.n), p);
    tudo.sort();
    let u = 0;
    for (let i = 0; i < tudo.length; i++) if (i === 0 || tudo[i] !== tudo[u - 1]) tudo[u++] = tudo[i];
    return tudo.slice(0, u);
  }
}

function buscar(ids: Float64Array, id: number): number {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const v = ids[m];
    if (v === id) return m;
    if (v < id) lo = m + 1;
    else hi = m - 1;
  }
  return -1;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Índices da tabela de textos que são chaves relevantes (filtro rápido sem montar objetos). */
function chavesRelevantes(b: Bloco): Set<number> {
  const s = new Set<number>();
  b.textos.forEach((t, i) => {
    if (CHAVES_RELEVANTES.has(t)) s.add(i);
  });
  return s;
}

function medidor(r: Relatorio, rotulo: string) {
  let ultimo = -1;
  return (feito: number, total: number) => {
    const pct = Math.floor((feito / total) * 100);
    if (pct >= ultimo + 5 || feito === total) {
      ultimo = pct;
      r.progresso(`\r  ${rotulo}: ${pct}% (${tempo(r)})   `);
      if (feito === total) r.progresso('\n');
    }
  };
}

// ---------- saída (banco novo) ----------
interface Saida {
  db: DatabaseSync;
  inserir: (grupo: GrupoOSM, osm: string, dados: string, caixa: [number, number, number, number]) => void;
  contagens: Record<GrupoOSM, number>;
  /** blocos da grade de 0,04° que têm pelo menos um nó */
  celulas: Set<number>;
  finalizar: () => void;
}

function abrirSaida(arquivo: string): Saida {
  const db = new DatabaseSync(arquivo);
  criarTabelas(db);
  const insFeicao = db.prepare('INSERT OR IGNORE INTO feicoes (grupo, osm, dados) VALUES (?, ?, ?)');
  const insCaixa = Object.fromEntries(GRUPOS_OSM.map((g) =>
    [g, db.prepare(`INSERT INTO caixa_${g} (id, x0, x1, y0, y1) VALUES (?, ?, ?, ?, ?)`)]));
  const contagens: Record<GrupoOSM, number> = { predios: 0, vias: 0, agua: 0, cobertura: 0, arvores: 0 };
  let pendentes = 0;
  db.exec('BEGIN');
  return {
    db,
    contagens,
    celulas: new Set<number>(),
    inserir(grupo, osm, dados, [x0, y0, x1, y1]) {
      const r = insFeicao.run(grupo, osm, dados);
      if (r.changes === 0) return; // já veio de outro arquivo
      insCaixa[grupo].run(r.lastInsertRowid, x0, x1, y0, y1);
      contagens[grupo]++;
      if (++pendentes >= 50_000) {
        db.exec('COMMIT');
        db.exec('BEGIN');
        pendentes = 0;
      }
    },
    finalizar() {
      db.exec('COMMIT');
    },
  };
}

interface Relacao {
  id: number;
  tags: Record<string, string>;
  grupo: GrupoOSM;
  membros: Membro[];
}

export interface InfoArquivo {
  nome: string;
  caixa: [number, number, number, number] | null;
  dataDados: string | null;
}

function importarArquivo(caminho: string, saida: Saida, rel: Relatorio): InfoArquivo {
  const nome = path.basename(caminho);
  const mb = (statSync(caminho).size / 1e6).toFixed(0);
  rel.log(`\n▶ ${nome} (${mb} MB)`);
  const blobs = listarBlobs(caminho);
  const fd = openSync(caminho, 'r');
  try {
    const cab = lerCabecalho(lerBlob(fd, blobs.find((b) => b.tipo === 'OSMHeader')!));
    const naoSuportado = cab.recursosObrigatorios.filter((r) => !['OsmSchema-V0.6', 'DenseNodes'].includes(r));
    if (naoSuportado.length) throw new Error(`Recurso do .pbf não suportado: ${naoSuportado.join(', ')}`);
    const dados = blobs.filter((b) => b.tipo === 'OSMData');

    // ---- 1. catálogo + relações ----
    const blobsNos: InfoBlob[] = [];
    const blobsCaminhos: InfoBlob[] = [];
    const relacoes: Relacao[] = [];
    const membrosNecessarios = new Set<number>();
    const p1 = medidor(rel, '1/4 catálogo e relações');
    dados.forEach((info, i) => {
      const bruto = lerBlob(fd, info);
      const tipos = tiposDoBloco(bruto);
      if (tipos.has('densos') || tipos.has('nos')) blobsNos.push(info);
      if (tipos.has('caminhos')) blobsCaminhos.push(info);
      if (tipos.has('relacoes')) {
        const b = lerBloco(bruto);
        const relevantes = chavesRelevantes(b);
        for (const g of b.grupos) {
          if (g.tipo !== 'relacoes') continue;
          lerRelacoes(b, g, (id, k, v, membros) => {
            if (!k.some((x) => relevantes.has(x))) return;
            const tags = etiquetas(b.textos, k, v);
            if (tags.type !== 'multipolygon') return;
            const grupo = grupoDoElemento(tags);
            if (!grupo) return;
            const ms = membros().filter((m) => m.tipo === 'way');
            for (const m of ms) membrosNecessarios.add(m.ref);
            relacoes.push({ id, tags, grupo, membros: ms });
          });
        }
      }
      p1(i + 1, dados.length);
    });
    rel.log(`  ${relacoes.length.toLocaleString('pt-BR')} multipolígonos relevantes`);

    // ---- 2. caminhos: quais nós são necessários ----
    const necessarios = new ListaNumeros();
    const p2 = medidor(rel, '2/4 caminhos (nós necessários)');
    blobsCaminhos.forEach((info, i) => {
      const b = lerBloco(lerBlob(fd, info));
      const relevantes = chavesRelevantes(b);
      for (const g of b.grupos) {
        if (g.tipo !== 'caminhos') continue;
        lerCaminhos(b, g, (id, k, v, refs) => {
          const relevante = k.some((x) => relevantes.has(x)) && grupoDoElemento(etiquetas(b.textos, k, v)) !== null;
          if (relevante || membrosNecessarios.has(id)) for (const r of refs()) necessarios.add(r);
        });
      }
      p2(i + 1, blobsCaminhos.length);
    });
    const ids = necessarios.ordenadaSemRepetir();
    rel.log(`  ${ids.length.toLocaleString('pt-BR')} nós necessários`);

    // ---- 3. nós: coordenadas dos necessários + árvores ----
    const lats = new Float64Array(ids.length).fill(NaN);
    const lons = new Float64Array(ids.length).fill(NaN);
    let ponteiro = 0;
    let ultimoId = -Infinity;
    // caixa real dos dados (alguns extratos não trazem a caixa no cabeçalho)
    const caixaDados: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    let amostra = 0;
    const p3 = medidor(rel, '3/4 nós (coordenadas)');
    blobsNos.forEach((info, i) => {
      const b = lerBloco(lerBlob(fd, info));
      const natural = b.textos.indexOf('natural');
      const tree = b.textos.indexOf('tree');
      const aoNo = (id: number, lat: number, lon: number, kv: number[]) => {
        // os nós costumam vir em ordem crescente de id: avança um ponteiro em vez de buscar
        let pos: number;
        if (id >= ultimoId) {
          while (ponteiro < ids.length && ids[ponteiro] < id) ponteiro++;
          pos = ponteiro < ids.length && ids[ponteiro] === id ? ponteiro : -1;
        } else pos = buscar(ids, id);
        ultimoId = id;
        if (lon < caixaDados[0]) caixaDados[0] = lon;
        if (lat < caixaDados[1]) caixaDados[1] = lat;
        if (lon > caixaDados[2]) caixaDados[2] = lon;
        if (lat > caixaDados[3]) caixaDados[3] = lat;
        if (pos >= 0) {
          lats[pos] = lat;
          lons[pos] = lon;
          // cobertura: blocos da grade com dados que o app usa (não conta pontos soltos
          // de divisas que alguns extratos incluem); 1 em cada 4 nós basta
          if ((amostra++ & 3) === 0) saida.celulas.add(chaveCelula(lat, lon));
        }
        if (kv.length && natural >= 0 && tree >= 0) {
          for (let j = 0; j < kv.length; j += 2) {
            if (kv[j] === natural && kv[j + 1] === tree) {
              const tags: Record<string, string> = {};
              for (let q = 0; q < kv.length; q += 2) tags[b.textos[kv[q]]] = b.textos[kv[q + 1]];
              if (grupoDoNo(tags)) {
                const la = r6(lat);
                const lo = r6(lon);
                saida.inserir('arvores', `n${id}`, JSON.stringify({ type: 'node', id, lat: la, lon: lo, tags }), [lo, la, lo, la]);
              }
              break;
            }
          }
        }
      };
      for (const g of b.grupos) {
        if (g.tipo === 'densos') lerDensos(b, g, aoNo);
        else if (g.tipo === 'nos') lerNos(b, g, aoNo);
      }
      p3(i + 1, blobsNos.length);
    });

    // ---- 4. caminhos com geometria → índice ----
    const geometriaMembros = new Map<number, Float64Array>();
    let incompletos = 0;
    const p4 = medidor(rel, '4/4 caminhos (geometria)');
    blobsCaminhos.forEach((info, i) => {
      const b = lerBloco(lerBlob(fd, info));
      const relevantes = chavesRelevantes(b);
      for (const g of b.grupos) {
        if (g.tipo !== 'caminhos') continue;
        lerCaminhos(b, g, (id, k, v, refs) => {
          const tags = k.some((x) => relevantes.has(x)) ? etiquetas(b.textos, k, v) : null;
          const grupo = tags ? grupoDoElemento(tags) : null;
          const membro = membrosNecessarios.has(id);
          if (!grupo && !membro) return;
          const rs = refs();
          const coords = new Float64Array(rs.length * 2);
          for (let j = 0; j < rs.length; j++) {
            const pos = buscar(ids, rs[j]);
            if (pos < 0 || Number.isNaN(lats[pos])) {
              incompletos++;
              return; // nó fora do extrato
            }
            coords[j * 2] = lons[pos];
            coords[j * 2 + 1] = lats[pos];
          }
          if (membro) geometriaMembros.set(id, coords);
          if (grupo && tags) {
            const { geometria, caixa } = geometriaJSON(coords);
            saida.inserir(grupo, `w${id}`, `{"type":"way","id":${id},"tags":${JSON.stringify(tags)},"geometry":${geometria}}`, caixa);
          }
        });
      }
      p4(i + 1, blobsCaminhos.length);
    });

    // ---- relações (multipolígonos) ----
    let semMembros = 0;
    for (const r of relacoes) {
      const partes: string[] = [];
      const caixa: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const m of r.membros) {
        const c = geometriaMembros.get(m.ref);
        if (!c) continue;
        const { geometria, caixa: cx } = geometriaJSON(c);
        partes.push(`{"type":"way","ref":${m.ref},"role":${JSON.stringify(m.papel)},"geometry":${geometria}}`);
        caixa[0] = Math.min(caixa[0], cx[0]);
        caixa[1] = Math.min(caixa[1], cx[1]);
        caixa[2] = Math.max(caixa[2], cx[2]);
        caixa[3] = Math.max(caixa[3], cx[3]);
      }
      if (!partes.length) {
        semMembros++;
        continue;
      }
      saida.inserir(r.grupo, `r${r.id}`, `{"type":"relation","id":${r.id},"tags":${JSON.stringify(r.tags)},"members":[${partes.join(',')}]}`, caixa);
    }
    if (incompletos || semMembros) {
      rel.log(`  (${incompletos.toLocaleString('pt-BR')} caminhos e ${semMembros} relações ignorados: cruzam a borda do extrato)`);
    }
    const caixaCalculada = Number.isFinite(caixaDados[0])
      ? caixaDados.map((v) => Math.round(v * 1e7) / 1e7) as [number, number, number, number]
      : null;
    return {
      nome,
      caixa: cab.caixa ?? caixaCalculada,
      dataDados: cab.dataDados ? new Date(cab.dataDados * 1000).toISOString() : null,
    };
  } finally {
    closeSync(fd);
  }
}

function geometriaJSON(c: Float64Array): { geometria: string; caixa: [number, number, number, number] } {
  const pts: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < c.length; j += 2) {
    const lon = c[j];
    const lat = c[j + 1];
    pts.push(`{"lat":${r6(lat)},"lon":${r6(lon)}}`);
    if (lon < x0) x0 = lon;
    if (lon > x1) x1 = lon;
    if (lat < y0) y0 = lat;
    if (lat > y1) y1 = lat;
  }
  return { geometria: `[${pts.join(',')}]`, caixa: [x0, y0, x1, y1] };
}

/** Acrescenta os blocos vizinhos (até `raio` de distância): cobre o mar e lagos perto da costa. */
function dilatarCelulas(celulas: Set<number>, raio: number): number[] {
  const r = new Set<number>();
  for (const c of celulas) {
    const { i, j } = abrirCelula(c);
    for (let di = -raio; di <= raio; di++) for (let dj = -raio; dj <= raio; dj++) r.add(montarCelula(i + di, j + dj));
  }
  return [...r].sort((a, b) => a - b);
}

// ---------- função pública ----------
export interface ResumoImportacao {
  arquivos: InfoArquivo[];
  contagens: Record<GrupoOSM, number>;
  segundos: number;
}

/**
 * Importa os arquivos .osm.pbf para `arquivoIndice`, substituindo o anterior
 * só no fim (o app continua usando o antigo enquanto isso).
 * `silencioso` desliga as mensagens (usado nos testes).
 */
export function importarArquivos(arquivos: string[], arquivoIndice: string, silencioso = false): ResumoImportacao {
  const rel: Relatorio = {
    inicio: Date.now(),
    log: silencioso ? () => {} : (s) => process.stdout.write(`${s}\n`),
    progresso: silencioso ? () => {} : (s) => process.stdout.write(s),
  };
  const novo = `${arquivoIndice}.novo`;
  rmSync(novo, { force: true });
  const saida = abrirSaida(novo);
  const infos: InfoArquivo[] = [];
  for (const a of arquivos) infos.push(importarArquivo(a, saida, rel));
  saida.finalizar();

  rel.log(`\n▶ Gravando o índice (${tempo(rel)})`);
  const ins = saida.db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?)');
  ins.run('versao', VERSAO_INDICE);
  ins.run('arquivos', JSON.stringify(infos));
  ins.run('dataImportacao', new Date().toISOString());
  ins.run('contagens', JSON.stringify(saida.contagens));
  ins.run('celulas', JSON.stringify(dilatarCelulas(saida.celulas, 2)));
  saida.db.exec('ANALYZE');
  saida.db.close();

  // troca o índice antigo pelo novo (tenta algumas vezes: o app pode estar lendo)
  for (let t = 0; ; t++) {
    try {
      rmSync(arquivoIndice, { force: true });
      renameSync(novo, arquivoIndice);
      break;
    } catch (erro) {
      if (t >= 10) throw erro;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  return { arquivos: infos, contagens: saida.contagens, segundos: (Date.now() - rel.inicio) / 1000 };
}
