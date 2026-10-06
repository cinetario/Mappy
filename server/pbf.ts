// Leitor do formato .osm.pbf (OpenStreetMap em Protocol Buffers).
// Especificação: https://wiki.openstreetmap.org/wiki/PBF_Format
//
// O arquivo é uma sequência de "blobs" comprimidos (zlib). Cada blob de dados
// tem um PrimitiveBlock com uma tabela de textos e grupos homogêneos de nós,
// caminhos (ways) ou relações. Aqui lemos blob a blob, sem carregar o arquivo
// inteiro, para aguentar extratos de quase 1 GB.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';

export type TipoGrupo = 'nos' | 'densos' | 'caminhos' | 'relacoes' | 'outro';

export interface InfoBlob {
  posicao: number;
  tamanho: number;
  tipo: 'OSMHeader' | 'OSMData';
}

export interface Cabecalho {
  /** caixa do extrato em graus: [oeste, sul, leste, norte] */
  caixa: [number, number, number, number] | null;
  /** data dos dados (osmosis_replication_timestamp), em segundos */
  dataDados: number | null;
  recursosObrigatorios: string[];
}

/** Lê só os cabeçalhos dos blobs (posição e tamanho), sem descomprimir. */
export function listarBlobs(caminho: string): InfoBlob[] {
  const fd = openSync(caminho, 'r');
  const total = statSync(caminho).size;
  const blobs: InfoBlob[] = [];
  const buf4 = Buffer.alloc(4);
  try {
    let pos = 0;
    while (pos < total) {
      readSync(fd, buf4, 0, 4, pos);
      const tamCab = buf4.readUInt32BE(0);
      const cab = Buffer.alloc(tamCab);
      readSync(fd, cab, 0, tamCab, pos + 4);
      const h = new PbfReader(cab).readFields((tag, r: { tipo: string; tamanho: number }, p) => {
        if (tag === 1) r.tipo = p.readString();
        else if (tag === 3) r.tamanho = p.readVarint();
      }, { tipo: '', tamanho: 0 });
      blobs.push({ posicao: pos + 4 + tamCab, tamanho: h.tamanho, tipo: h.tipo as InfoBlob['tipo'] });
      pos += 4 + tamCab + h.tamanho;
    }
  } finally {
    closeSync(fd);
  }
  return blobs;
}

/** Lê e descomprime um blob. */
export function lerBlob(fd: number, b: InfoBlob): Uint8Array {
  const bruto = Buffer.alloc(b.tamanho);
  readSync(fd, bruto, 0, b.tamanho, b.posicao);
  let dados: Uint8Array | null = null;
  new PbfReader(bruto).readFields((tag, _r, p) => {
    if (tag === 1) dados = p.readBytes(); // raw
    else if (tag === 3) dados = inflateSync(p.readBytes()); // zlib_data
    else if (tag === 4 || tag === 5 || tag === 6 || tag === 7) throw new Error('Compressão não suportada (só zlib). Baixe o arquivo da Geofabrik.');
  }, null);
  if (!dados) throw new Error('Blob vazio');
  return dados;
}

export function lerCabecalho(dados: Uint8Array): Cabecalho {
  const c: Cabecalho = { caixa: null, dataDados: null, recursosObrigatorios: [] };
  new PbfReader(dados).readFields((tag, r, p) => {
    if (tag === 1) {
      // HeaderBBox em nanograus: left(1) right(2) top(3) bottom(4)
      const bb = p.readMessage((t, x: number[], q) => {
        // nanograus → graus, arredondado na precisão do OSM (1e-7)
        if (t >= 1 && t <= 4) x[t - 1] = Math.round(q.readSVarint() / 100) / 1e7;
      }, [0, 0, 0, 0]);
      r.caixa = [bb[0], bb[3], bb[1], bb[2]];
    } else if (tag === 4) r.recursosObrigatorios.push(p.readString());
    else if (tag === 32) r.dataDados = p.readVarint();
  }, c);
  return c;
}

/** Bloco de dados já com a tabela de textos e os grupos separados (ainda não decodificados). */
export interface Bloco {
  textos: string[];
  granularidade: number;
  latOffset: number;
  lonOffset: number;
  grupos: { tipo: TipoGrupo; inicio: number; fim: number }[];
  pbf: PbfReader;
}

const decodificador = new TextDecoder();

export function lerBloco(dados: Uint8Array): Bloco {
  const pbf = new PbfReader(dados);
  const b: Bloco = { textos: [], granularidade: 100, latOffset: 0, lonOffset: 0, grupos: [], pbf };
  pbf.readFields((tag, r, p) => {
    if (tag === 1) {
      // StringTable: repeated bytes s = 1
      const fim = p.readVarint() + p.pos;
      while (p.pos < fim) {
        const t = p.readVarint();
        if (t >> 3 === 1) {
          const n = p.readVarint();
          r.textos.push(decodificador.decode(p.buf.subarray(p.pos, p.pos + n)));
          p.pos += n;
        } else p.skip(t & 7);
      }
    } else if (tag === 2) {
      const n = p.readVarint();
      const inicio = p.pos;
      // o tipo do grupo é o número do primeiro campo
      const primeiro = n > 0 ? p.buf[inicio] >> 3 : 0;
      const tipo: TipoGrupo = primeiro === 1 ? 'nos' : primeiro === 2 ? 'densos' : primeiro === 3 ? 'caminhos' : primeiro === 4 ? 'relacoes' : 'outro';
      r.grupos.push({ tipo, inicio, fim: inicio + n });
      p.pos = inicio + n;
    } else if (tag === 17) r.granularidade = p.readVarint();
    else if (tag === 19) r.latOffset = p.readVarint(true);
    else if (tag === 20) r.lonOffset = p.readVarint(true);
  }, b);
  return b;
}

/** Só os tipos de grupo do bloco (para o catálogo), sem ler os textos. */
export function tiposDoBloco(dados: Uint8Array): Set<TipoGrupo> {
  const tipos = new Set<TipoGrupo>();
  const p = new PbfReader(dados);
  while (p.pos < p.length) {
    const t = p.readVarint();
    if (t >> 3 === 2 && (t & 7) === 2) {
      const n = p.readVarint();
      const primeiro = n > 0 ? p.buf[p.pos] >> 3 : 0;
      tipos.add(primeiro === 1 ? 'nos' : primeiro === 2 ? 'densos' : primeiro === 3 ? 'caminhos' : primeiro === 4 ? 'relacoes' : 'outro');
      p.pos += n;
    } else p.skip(t & 7);
  }
  return tipos;
}

export type Etiquetas = Record<string, string>;

/**
 * Nós densos. `cb(id, lat, lon, chavesValores)`: chavesValores é a lista de
 * índices na tabela de textos [k1, v1, k2, v2…] (vazia quando o nó não tem tags).
 */
export function lerDensos(b: Bloco, g: { inicio: number; fim: number }, cb: (id: number, lat: number, lon: number, kv: number[]) => void) {
  const p = b.pbf;
  p.pos = g.inicio;
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let kv: number[] = [];
  p.readFields((tag, _r, q) => {
    if (tag === 2) {
      const fim = q.readVarint() + q.pos;
      q.readFields((t, _x, s) => {
        if (t === 1) ids = s.readPackedSVarint();
        else if (t === 8) lats = s.readPackedSVarint();
        else if (t === 9) lons = s.readPackedSVarint();
        else if (t === 10) kv = s.readPackedVarint();
      }, null, fim);
    }
  }, null, g.fim);
  const gran = b.granularidade * 1e-9;
  let id = 0, lat = 0, lon = 0, k = 0;
  const sem: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    lat += lats[i];
    lon += lons[i];
    let pares = sem;
    if (kv.length) {
      if (kv[k] === 0) k++;
      else {
        pares = [];
        while (k < kv.length && kv[k] !== 0) pares.push(kv[k++], kv[k++]);
        k++;
      }
    }
    cb(id, b.latOffset * 1e-9 + gran * lat, b.lonOffset * 1e-9 + gran * lon, pares);
  }
}

/** Nós não densos (raros nos extratos da Geofabrik). */
export function lerNos(b: Bloco, g: { inicio: number; fim: number }, cb: (id: number, lat: number, lon: number, kv: number[]) => void) {
  const p = b.pbf;
  p.pos = g.inicio;
  const gran = b.granularidade * 1e-9;
  p.readFields((tag, _r, q) => {
    if (tag !== 1) return;
    const no = q.readMessage((t, n: { id: number; lat: number; lon: number; k: number[]; v: number[] }, s) => {
      if (t === 1) n.id = s.readSVarint();
      else if (t === 2) n.k = s.readPackedVarint();
      else if (t === 3) n.v = s.readPackedVarint();
      else if (t === 8) n.lat = s.readSVarint();
      else if (t === 9) n.lon = s.readSVarint();
    }, { id: 0, lat: 0, lon: 0, k: [], v: [] });
    const kv: number[] = [];
    no.k.forEach((k, i) => kv.push(k, no.v[i]));
    cb(no.id, b.latOffset * 1e-9 + gran * no.lat, b.lonOffset * 1e-9 + gran * no.lon, kv);
  }, null, g.fim);
}

/** Caminhos (ways): `cb(id, chaves, valores, refs)` com índices na tabela de textos. */
export function lerCaminhos(b: Bloco, g: { inicio: number; fim: number }, cb: (id: number, k: number[], v: number[], refs: () => number[]) => void) {
  const p = b.pbf;
  p.pos = g.inicio;
  p.readFields((tag, _r, q) => {
    if (tag !== 3) return;
    const fim = q.readVarint() + q.pos;
    let id = 0;
    let k: number[] = [];
    let v: number[] = [];
    let iniRefs = -1;
    let fimRefs = -1;
    // lê id e tags; as refs só são decodificadas se quem chamou pedir
    while (q.pos < fim) {
      const t = q.readVarint();
      const campo = t >> 3;
      q.type = t & 7; // a pbf usa o tipo do campo para saber se a lista está "empacotada"
      if (campo === 1) id = q.readVarint();
      else if (campo === 2) k = q.readPackedVarint();
      else if (campo === 3) v = q.readPackedVarint();
      else if (campo === 8) {
        const n = q.readVarint();
        iniRefs = q.pos;
        fimRefs = q.pos + n;
        q.pos = fimRefs;
      } else q.skip(t & 7);
    }
    const refs = () => {
      if (iniRefs < 0) return [];
      const salvo = q.pos;
      q.pos = iniRefs;
      const r: number[] = [];
      let acc = 0;
      while (q.pos < fimRefs) {
        acc += q.readSVarint();
        r.push(acc);
      }
      q.pos = salvo;
      return r;
    };
    cb(id, k, v, refs);
    q.pos = fim;
  }, null, g.fim);
}

export interface Membro {
  tipo: 'node' | 'way' | 'relation';
  ref: number;
  papel: string;
}

/** Relações: `cb(id, chaves, valores, membros)`. */
export function lerRelacoes(b: Bloco, g: { inicio: number; fim: number }, cb: (id: number, k: number[], v: number[], membros: () => Membro[]) => void) {
  const p = b.pbf;
  p.pos = g.inicio;
  p.readFields((tag, _r, q) => {
    if (tag !== 4) return;
    const rel = q.readMessage((t, x: { id: number; k: number[]; v: number[]; papeis: number[]; ids: number[]; tipos: number[] }, s) => {
      if (t === 1) x.id = s.readVarint();
      else if (t === 2) x.k = s.readPackedVarint();
      else if (t === 3) x.v = s.readPackedVarint();
      else if (t === 8) x.papeis = s.readPackedVarint();
      else if (t === 9) x.ids = s.readPackedSVarint();
      else if (t === 10) x.tipos = s.readPackedVarint();
    }, { id: 0, k: [], v: [], papeis: [], ids: [], tipos: [] });
    cb(rel.id, rel.k, rel.v, () => {
      let acc = 0;
      return rel.ids.map((d, i) => {
        acc += d;
        return { tipo: (['node', 'way', 'relation'] as const)[rel.tipos[i]] ?? 'node', ref: acc, papel: b.textos[rel.papeis[i]] ?? '' };
      });
    });
  }, null, g.fim);
}

/** Monta o objeto de tags a partir dos índices. */
export function etiquetas(textos: string[], k: number[], v: number[]): Etiquetas {
  const t: Etiquetas = {};
  for (let i = 0; i < k.length; i++) t[textos[k[i]]] = textos[v[i]];
  return t;
}
