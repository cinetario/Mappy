// Importador do .osm.pbf: monta um arquivo PBF sintético (com o formato real:
// blobs zlib, nós densos com deltas, tabela de textos, caminhos e relações),
// importa e confere o que o servidor devolve.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { PbfWriter } from 'pbf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extrairAgua, extrairPredios, extrairVias, type ElementoOSM } from '../src/core/osm.ts';

let pasta: string;
let consultar: (g: 'predios' | 'vias' | 'agua' | 'cobertura' | 'arvores', s: number, w: number, n: number, e: number) => ElementoOSM[];
let info: () => { disponivel: boolean; arquivos: { nome: string; caixa: number[] | null; dataDados: string | null }[]; contagens: Record<string, number> };

// ---------- escritor mínimo de .osm.pbf ----------
function blob(tipo: 'OSMHeader' | 'OSMData', dados: Uint8Array): Buffer {
  const corpo = new PbfWriter();
  corpo.writeVarintField(2, dados.length); // raw_size
  corpo.writeBytesField(3, deflateSync(dados)); // zlib_data
  const b = corpo.finish();
  const cab = new PbfWriter();
  cab.writeStringField(1, tipo);
  cab.writeVarintField(3, b.length);
  const c = cab.finish();
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(c.length);
  return Buffer.concat([tam, c, b]);
}

const deltas = (v: number[]) => v.map((x, i) => x - (i ? v[i - 1] : 0));

/** PrimitiveBlock com uma tabela de textos e um grupo escrito por `grupo`. */
function bloco(textos: string[], grupo: (w: PbfWriter, s: (t: string) => number) => void): Uint8Array {
  const idx = (t: string) => {
    const i = textos.indexOf(t);
    if (i < 0) throw new Error(`texto ausente: ${t}`);
    return i;
  };
  const w = new PbfWriter();
  w.writeMessage(1, (_o, p) => {
    for (const t of textos) p.writeBytesField(1, new TextEncoder().encode(t));
  }, null);
  w.writeMessage(2, (_o, p) => grupo(p, idx), null);
  w.writeVarintField(17, 100); // granularidade
  return w.finish();
}

// nós: id → [lat, lon]
const NOS: Record<number, [number, number]> = {
  1: [-22.951, -43.161], 2: [-22.951, -43.160], 3: [-22.950, -43.160], 4: [-22.950, -43.161], // prédio 1
  5: [-22.955, -43.165], 6: [-22.955, -43.150], // rua
  7: [-22.960, -43.170], 8: [-22.960, -43.140], // costa
  10: [-22.946, -43.156], 11: [-22.946, -43.150], 12: [-22.940, -43.150], 13: [-22.940, -43.156], // lago (externo)
  14: [-22.944, -43.154], 15: [-22.944, -43.152], 16: [-22.942, -43.152], 17: [-22.942, -43.154], // ilha (interno)
  20: [-22.948, -43.158], // árvore
  30: [-22.947, -43.157], 31: [-22.947, -43.155], // caminho irrelevante
};

function arquivoSintetico(): Buffer {
  const textos = ['', 'building', 'yes', 'height', '12', 'highway', 'residential', 'natural', 'coastline', 'water', 'type',
    'multipolygon', 'outer', 'inner', 'tree', 'amenity', 'bench', 'leaf_type', 'broadleaved', 'name', 'Lagoa'];
  const cabecalho = new PbfWriter();
  cabecalho.writeMessage(1, (_o, p) => {
    p.writeSVarintField(1, -43.2e9); // left
    p.writeSVarintField(2, -43.1e9); // right
    p.writeSVarintField(3, -22.9e9); // top
    p.writeSVarintField(4, -23.0e9); // bottom
  }, null);
  cabecalho.writeStringField(4, 'OsmSchema-V0.6');
  cabecalho.writeStringField(4, 'DenseNodes');
  cabecalho.writeVarintField(32, Date.UTC(2026, 9, 4) / 1000);

  const ids = Object.keys(NOS).map(Number).sort((a, b) => a - b);
  const nos = bloco(textos, (g, s) => {
    g.writeMessage(2, (_o, d) => {
      d.writePackedSVarint(1, deltas(ids));
      d.writePackedSVarint(8, deltas(ids.map((i) => Math.round(NOS[i][0] * 1e7))));
      d.writePackedSVarint(9, deltas(ids.map((i) => Math.round(NOS[i][1] * 1e7))));
      // tags: só o nó 20 (árvore)
      const kv: number[] = [];
      for (const i of ids) {
        if (i === 20) kv.push(s('natural'), s('tree'), s('leaf_type'), s('broadleaved'));
        kv.push(0);
      }
      d.writePackedVarint(10, kv);
    }, null);
  });

  const caminho = (g: PbfWriter, id: number, tags: [number, number][], refs: number[]) => {
    g.writeMessage(3, (_o, w) => {
      w.writeVarintField(1, id);
      w.writePackedVarint(2, tags.map((t) => t[0]));
      w.writePackedVarint(3, tags.map((t) => t[1]));
      w.writePackedSVarint(8, deltas(refs));
    }, null);
  };
  const caminhos = bloco(textos, (g, s) => {
    caminho(g, 100, [[s('building'), s('yes')], [s('height'), s('12')]], [1, 2, 3, 4, 1]);
    caminho(g, 101, [[s('highway'), s('residential')]], [5, 6]);
    caminho(g, 102, [[s('natural'), s('coastline')]], [7, 8]);
    caminho(g, 103, [], [10, 11, 12, 13, 10]); // membro externo do lago (sem tags)
    caminho(g, 104, [], [14, 15, 16, 17, 14]); // membro interno (ilha)
    caminho(g, 105, [[s('amenity'), s('bench')]], [30, 31]); // não interessa
  });
  const relacoes = bloco(textos, (g, s) => {
    g.writeMessage(4, (_o, r) => {
      r.writeVarintField(1, 200);
      r.writePackedVarint(2, [s('type'), s('natural'), s('name')]);
      r.writePackedVarint(3, [s('multipolygon'), s('water'), s('Lagoa')]);
      r.writePackedVarint(8, [s('outer'), s('inner')]);
      r.writePackedSVarint(9, deltas([103, 104]));
      r.writePackedVarint(10, [1, 1]); // way, way
    }, null);
  });
  return Buffer.concat([blob('OSMHeader', cabecalho.finish()), blob('OSMData', nos), blob('OSMData', caminhos), blob('OSMData', relacoes)]);
}

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'relevo3d-osm-'));
  process.env.RELEVO3D_DADOS_OSM = pasta;
  writeFileSync(path.join(pasta, 'teste.osm.pbf'), arquivoSintetico());
  // importa os módulos depois de definir a pasta (eles leem a variável ao carregar)
  const { importarArquivos } = await import('../server/importador.ts');
  const indice = await import('../server/indice-osm.ts');
  importarArquivos([path.join(pasta, 'teste.osm.pbf')], indice.ARQUIVO_INDICE, true);
  consultar = (g, s, w, n, e) => JSON.parse(indice.consultarIndice(g, s, w, n, e)).elements;
  info = indice.infoIndice as unknown as typeof info;
});

afterAll(() => {
  delete process.env.RELEVO3D_DADOS_OSM;
  rmSync(pasta, { recursive: true, force: true });
});

describe('importação de .osm.pbf', () => {
  it('lê o cabeçalho: caixa e data dos dados', () => {
    const i = info();
    expect(i.disponivel).toBe(true);
    expect(i.arquivos[0].nome).toBe('teste.osm.pbf');
    expect(i.arquivos[0].caixa).toEqual([-43.2, -23, -43.1, -22.9]);
    expect(i.arquivos[0].dataDados).toBe('2026-10-04T00:00:00.000Z');
    expect(i.contagens).toEqual({ predios: 1, vias: 1, agua: 2, cobertura: 0, arvores: 1 });
  });

  it('prédio com coordenadas exatas e altura', () => {
    const els = consultar('predios', -22.96, -43.17, -22.94, -43.15);
    const p = extrairPredios(els, false, 10);
    expect(p).toHaveLength(1);
    expect(p[0].alturaM).toBe(12);
    expect(p[0].aneis[0][0]).toEqual([-43.161, -22.951]);
    expect(p[0].aneis[0]).toHaveLength(4);
  });

  it('rua, costa e lago (multipolígono com ilha) no formato do Overpass', () => {
    expect(extrairVias(consultar('vias', -22.96, -43.17, -22.94, -43.15))).toHaveLength(1);
    const agua = extrairAgua(consultar('agua', -22.97, -43.18, -22.93, -43.13));
    expect(agua.costa).toHaveLength(1);
    expect(agua.poligonos).toHaveLength(1);
    expect(agua.poligonos[0].aneis).toHaveLength(2); // externo + ilha
    expect(agua.poligonos[0].tags.name).toBe('Lagoa');
  });

  it('árvore (nó com tags nos nós densos)', () => {
    const a = consultar('arvores', -22.95, -43.16, -22.94, -43.15);
    expect(a).toEqual([{ type: 'node', id: 20, lat: -22.948, lon: -43.158, tags: { natural: 'tree', leaf_type: 'broadleaved' } }]);
  });

  it('consulta espacial: bloco longe não traz nada; elementos irrelevantes não entram', () => {
    expect(consultar('predios', -22.0, -42.0, -21.9, -41.9)).toEqual([]);
    const tudo = (['predios', 'vias', 'agua', 'cobertura', 'arvores'] as const).flatMap((g) => consultar(g, -23, -43.2, -22.9, -43.1));
    expect(tudo.some((e) => e.id === 105)).toBe(false);
  });
});
