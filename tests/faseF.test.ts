// Fase F: fontes de prédios (Overture, prefeitura, automático), telhados e building:part com min_height.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import proj4 from 'proj4';
import { afterAll, describe, expect, it } from 'vitest';
import { conjuntosQueCobrem, consultarExtras, copiarExtras, gravarConjunto, listarConjuntos } from '../server/extras.ts';
import { criarTabelas } from '../server/indice-osm.ts';
import { elementoOverture, origemOverture } from '../server/overture.ts';
import { camposDoArquivo, elementoPrefeitura, lerArquivoPredios, sugerirCampos } from '../server/prefeitura.ts';
import { caixaLimite } from '../src/core/malha.ts';
import { carregarManifold } from '../src/core/manifold.ts';
import { gerarModelo } from '../src/core/modelo.ts';
import { extrairPredios, minAlturaPredio, telhadoPredio, type ElementoOSM, type Predio } from '../src/core/osm.ts';
import { combinarPredios } from '../src/core/predios-fontes.ts';
import { escreverStl, lerStl } from '../src/core/stl.ts';
import { menorRetangulo, solidoTelhado } from '../src/core/telhados.ts';
import { verificarMalha } from '../src/core/verificacao.ts';
import { dados, forma, geo, grade, params, quadrado } from './dados-sinteticos.ts';

const pasta = mkdtempSync(path.join(tmpdir(), 'relevo3d-faseF-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('tags de telhado e min_height', () => {
  it('roof:shape vira as formas do app; altura de roof:height ou roof:levels', () => {
    expect(telhadoPredio({ 'roof:shape': 'gabled', 'roof:height': '4 m' })).toEqual({ forma: 'duas-aguas', alturaM: 4 });
    expect(telhadoPredio({ 'roof:shape': 'hipped', 'roof:levels': '1' })).toEqual({ forma: 'quatro-aguas', alturaM: 3 });
    expect(telhadoPredio({ 'roof:shape': 'pyramidal' })).toEqual({ forma: 'piramidal', alturaM: null });
    expect(telhadoPredio({ 'roof:shape': 'dome' })?.forma).toBe('cupula');
    expect(telhadoPredio({ 'roof:shape': 'flat' })).toEqual({ forma: 'plano', alturaM: 0 });
    expect(telhadoPredio({})).toBeNull();
  });
  it('min_height e building:min_level', () => {
    expect(minAlturaPredio({ min_height: '12' })).toBe(12);
    expect(minAlturaPredio({ 'building:min_level': '2' })).toBe(6);
    expect(minAlturaPredio({})).toBe(0);
  });
  it('com andares, roof:height fica em cima dos andares; com height, já está incluído', () => {
    const [a, b] = extrairPredios([
      { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '4', 'roof:shape': 'gabled', 'roof:height': '3' }, geometry: geo(quadrado(0, 0, 20)) },
      { type: 'way', id: 2, tags: { building: 'yes', height: '15', 'roof:shape': 'gabled', 'roof:height': '3' }, geometry: geo(quadrado(50, 0, 20)) },
    ], false, 10);
    expect(a.alturaM).toBe(15);
    expect(b.alturaM).toBe(15);
    expect(a.fonte).toBe('osm');
  });
});

describe('telhados (geometria)', async () => {
  const wasm = await carregarManifold();
  it('menor retângulo de um retângulo girado', () => {
    const ang = (25 * Math.PI) / 180;
    const pts: [number, number][] = [[-10, -4], [10, -4], [10, 4], [-10, 4]].map(([x, y]) => [x * Math.cos(ang) - y * Math.sin(ang) + 5, x * Math.sin(ang) + y * Math.cos(ang) - 3]);
    const r = menorRetangulo(pts);
    expect(r.comprimento).toBeCloseTo(20, 6);
    expect(r.largura).toBeCloseTo(8, 6);
    expect(((r.angulo % 180) + 180) % 180).toBeCloseTo(25, 4);
    expect(r.centro[0]).toBeCloseTo(5, 6);
    expect(r.centro[1]).toBeCloseTo(-3, 6);
  });
  it('cada forma: sólido fechado, base em z0 e topo em z0 + h; volumes certos', () => {
    const pts: [number, number][] = [[0, 0], [20, 0], [20, 8], [0, 8]];
    const pegada = new wasm.CrossSection([pts], 'NonZero');
    const r = menorRetangulo(pts);
    const esperado = { 'duas-aguas': (20 * 8 * 3) / 2, piramidal: (20 * 8 * 3) / 3, 'quatro-aguas': null, cupula: null } as const;
    for (const forma of ['duas-aguas', 'quatro-aguas', 'piramidal', 'cupula'] as const) {
      const s = solidoTelhado(wasm, pegada, r, forma, 10, 3)!;
      expect(s.status(), forma).toBe('NoError');
      const b = s.boundingBox();
      expect(b.min[2]).toBeCloseTo(10, 6);
      expect(b.max[2]).toBeCloseTo(13, 2);
      expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(20 + 1e-6);
      const v = esperado[forma];
      if (v) expect(s.volume()).toBeCloseTo(v, 3);
      // quatro águas tem menos volume que duas águas e mais que a pirâmide
      if (forma === 'quatro-aguas') {
        expect(s.volume()).toBeGreaterThan(160);
        expect(s.volume()).toBeLessThan(240);
      }
      s.delete();
    }
    pegada.delete();
  });
});

describe('telhados e partes no modelo', async () => {
  const wasm = await carregarManifold();
  const els: ElementoOSM[] = [
    { type: 'way', id: 101, tags: { building: 'yes', height: '40', 'roof:shape': 'gabled', 'roof:height': '15' }, geometry: geo(quadrado(-300, 200, 80)) },
    { type: 'way', id: 102, tags: { building: 'yes', height: '30', 'roof:shape': 'dome' }, geometry: geo(quadrado(250, 250, 100)) },
    // passarela: parte que começa a 20 m
    { type: 'way', id: 103, tags: { 'building:part': 'yes', height: '35', min_height: '20' }, geometry: geo(quadrado(-100, 200, 60)) },
  ];
  const d = { ...dados(), predios: extrairPredios(els, true, 10) };

  it('telhados desenhados; prédios continuam manifold', () => {
    const r = gerarModelo(wasm, grade(forma, 120), forma, params({ ruas: 'nao', agua: false, prediosDetalhados: true }), d);
    const p = r.partes.find((x) => x.id === 'predios')!;
    expect(verificarMalha(lerStl(escreverStl(p.malha))).erros).toEqual([]);
    expect(r.camadas!.estatisticas.predios!.telhados).toBe(2);
    expect(r.camadas!.estatisticas.predios!.comVao).toBe(0); // padrão: preencher embaixo
    const semTelhado = gerarModelo(wasm, grade(forma, 120), forma, params({ ruas: 'nao', agua: false, prediosDetalhados: true, prediosTelhados: false }), d);
    const v = (m: typeof p.malha) => verificarMalha(m).volumeMm3;
    // telhado inclinado tira volume (o topo deixa de ser plano)
    expect(v(p.malha)).toBeLessThan(v(semTelhado.partes.find((x) => x.id === 'predios')!.malha));
    expect(caixaLimite(p.malha).max[2]).toBeCloseTo(caixaLimite(semTelhado.partes.find((x) => x.id === 'predios')!.malha).max[2], 1);
  });

  it('min_height com "deixar o vão": a parte fica no ar e a malha continua válida', () => {
    const r = gerarModelo(wasm, grade(forma, 120), forma, params({ ruas: 'nao', agua: false, prediosDetalhados: true, prediosPartesAcima: 'vao' }), d);
    expect(r.camadas!.estatisticas.predios!.comVao).toBe(1);
    const p = r.partes.find((x) => x.id === 'predios')!;
    expect(verificarMalha(lerStl(escreverStl(p.malha))).erros).toEqual([]);
  });
});

// ---------- fontes ----------
const predio = (id: string, aneis: [number, number][][], o: Partial<Predio> = {}): Predio => ({
  id, tags: {}, aneis, alturaM: 10, alturaInformada: false, fonte: 'osm', minAlturaM: 0, telhado: null, ...o,
});
const ret = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const D = 0.0001; // ~11 m

describe('Automático: OSM + Overture sem duplicar', () => {
  const osm = [
    predio('o1', [ret(0, 0, 3 * D, 3 * D)]), // sem altura
    predio('o2', [ret(10 * D, 0, 12 * D, 2 * D)], { alturaM: 30, alturaInformada: true }),
    predio('o3', [ret(20 * D, 0, 21 * D, D)]), // pequeno, dentro de um grande do Overture
  ];
  const ov = (id: string, aneis: [number, number][][], o: Partial<Predio> = {}) => predio(id, aneis, { fonte: 'overture', origem: 'Google Open Buildings', ...o });
  const overture = [
    ov('v1', [ret(0.2 * D, 0.1 * D, 3.1 * D, 2.9 * D)], { alturaM: 22, alturaInformada: true }), // = o1, com altura
    ov('v2', [ret(10 * D, 0, 12 * D, 2 * D)], { alturaM: 5, alturaInformada: true }), // = o2 (que já tem altura)
    ov('v3', [ret(30 * D, 0, 32 * D, 2 * D)], { alturaM: 9, alturaInformada: true }), // só no Overture
    ov('v4', [ret(19 * D, -1 * D, 24 * D, 4 * D)]), // engloba o3
    ov('v5', [ret(0, 0, 3 * D, 3 * D)], { origem: 'OpenStreetMap', alturaM: 99, alturaInformada: true }), // cópia do OSM
  ];
  const r = combinarPredios(osm, overture);
  it('prédio do OSM sem altura ganha a do Overture; o que tem altura fica com a dele', () => {
    expect(r.predios.find((p) => p.id === 'o1')).toMatchObject({ alturaM: 22, alturaInformada: true, alturaDe: 'overture', fonte: 'osm' });
    expect(r.predios.find((p) => p.id === 'o2')!.alturaM).toBe(30);
    expect(r.alturasCompletadas).toBe(1);
  });
  it('só entram do Overture os prédios que não existem no OSM', () => {
    expect(r.predios.map((p) => p.id).sort()).toEqual(['o1', 'o2', 'o3', 'v3']);
    expect(r.descartados).toBe(3); // v1, v2, v4
    expect(r.copiasDoOsm).toBe(1); // v5
  });
});

describe('Overture → formato do app', () => {
  const base = {
    id: 'x', sources: [{ property: '', dataset: 'Google Open Buildings', license: null }], height: 12.345, num_floors: 4,
    min_height: null, roof_shape: 'gabled', roof_height: 3, is_underground: false,
    bbox: { xmin: 0, xmax: 1e-4, ymin: 0, ymax: 1e-4 },
  };
  it('polígono simples vira way com as tags do OSM', () => {
    const r = elementoOverture({ ...base, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1e-4, 0], [1e-4, 1e-4], [0, 1e-4], [0, 0]]] } }, 7)!;
    const [p] = extrairPredios([r.elemento as ElementoOSM], false, 10);
    expect(p).toMatchObject({ fonte: 'overture', origem: 'Google Open Buildings', alturaM: 12.35, alturaInformada: true, telhado: { forma: 'duas-aguas', alturaM: 3 } });
    expect(origemOverture(base)).toEqual({ dataset: 'Google Open Buildings', licenca: null });
  });
  it('multipolígono com pátio vira relação; subterrâneo é ignorado', () => {
    const anel = (a: number) => [[-a, -a], [a, -a], [a, a], [-a, a], [-a, -a]];
    const r = elementoOverture({ ...base, geometry: { type: 'MultiPolygon', coordinates: [[anel(1e-4), anel(5e-5)], [anel(2e-5).map(([x, y]) => [x + 1e-3, y])]] } }, 8)!;
    const ps = extrairPredios([r.elemento as ElementoOSM], false, 10);
    expect((r.elemento as { type: string }).type).toBe('relation');
    expect(ps).toHaveLength(1);
    expect(ps[0].aneis).toHaveLength(3);
    expect(elementoOverture({ ...base, is_underground: true, geometry: { type: 'Polygon', coordinates: [anel(1e-4)] } }, 9)).toBeNull();
  });
});

// ---------- prefeitura ----------
const UTM23S = '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const paraUtm = proj4('WGS84', UTM23S);
const BRASILIA: [number, number] = [-47.8825, -15.7942];
const quadradoUtm = (lon: number, lat: number, lado: number) => {
  const [x, y] = paraUtm.forward([lon, lat]);
  const h = lado / 2;
  return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]];
};

describe('arquivo da prefeitura', () => {
  it('GeoJSON em SIRGAS 2000 / UTM 23S: converte para graus, acha os campos e lê a altura', async () => {
    const fc = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::31983' } },
      features: [
        { type: 'Feature', properties: { ALTURA: '12,5', PAVIMENTOS: 4, NOME: 'Bloco A' }, geometry: { type: 'Polygon', coordinates: [quadradoUtm(...BRASILIA, 20)] } },
        { type: 'Feature', properties: { ALTURA: 30, PAVIMENTOS: 10, NOME: 'Bloco B' }, geometry: { type: 'Polygon', coordinates: [quadradoUtm(BRASILIA[0] + 0.001, BRASILIA[1], 20)] } },
      ],
    };
    const arq = path.join(pasta, 'lotes.geojson');
    writeFileSync(arq, JSON.stringify(fc));
    const { colecao, crs } = await lerArquivoPredios(arq);
    expect(crs).toContain('31983');
    const [lon, lat] = (colecao.features[0].geometry!.coordinates as number[][][])[0][0];
    expect(lon).toBeCloseTo(BRASILIA[0] - 0.0000934, 3);
    expect(lat).toBeCloseTo(BRASILIA[1] - 0.0000904, 3);
    const s = sugerirCampos(camposDoArquivo(colecao));
    expect(s.altura).toEqual(['ALTURA']);
    expect(s.andares).toEqual(['PAVIMENTOS']);
    const r = elementoPrefeitura(colecao.features[0], 1, { campoAltura: 'ALTURA', nome: 'GDF' })!;
    const [p] = extrairPredios([r.elemento as ElementoOSM], false, 10);
    expect(p).toMatchObject({ fonte: 'prefeitura', origem: 'GDF', alturaM: 12.5, alturaInformada: true });
  });

  it('sem sistema de coordenadas e em metros: pede --epsg; com --epsg funciona', async () => {
    const arq = path.join(pasta, 'sem-crs.geojson');
    writeFileSync(arq, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [quadradoUtm(...BRASILIA, 20)] } }] }));
    await expect(lerArquivoPredios(arq)).rejects.toThrow(/--epsg/);
    const { colecao } = await lerArquivoPredios(arq, 31983);
    expect((colecao.features[0].geometry!.coordinates as number[][][])[0][0][0]).toBeCloseTo(BRASILIA[0], 3);
  });

  it('shapefile (.shp + .dbf + .prj)', async () => {
    const base = path.join(pasta, 'edificacoes');
    escreverShapefile(base, [quadradoUtm(...BRASILIA, 30), quadradoUtm(BRASILIA[0], BRASILIA[1] + 0.001, 30)], [{ ALT: 21.5 }, { ALT: 9 }]);
    const { colecao } = await lerArquivoPredios(`${base}.shp`);
    expect(colecao.features).toHaveLength(2);
    const [lon, lat] = (colecao.features[0].geometry!.coordinates as number[][][])[0][0];
    expect(Math.abs(lon - BRASILIA[0])).toBeLessThan(0.001);
    expect(Math.abs(lat - BRASILIA[1])).toBeLessThan(0.001);
    expect(colecao.features.map((f) => Number(f.properties!.ALT))).toEqual([21.5, 9]);
  });
});

// ---------- índice ----------
describe('prédios extras no índice local', () => {
  it('grava, consulta por área, informa cobertura e sobrevive à reimportação do OSM', () => {
    const arq = path.join(pasta, 'indice.sqlite');
    const g = gravarConjunto('overture', 'teste', arq);
    g.inserir({ type: 'way', id: 1, tags: { building: 'yes' }, geometry: [] }, [-47.9, -15.8, -47.89, -15.79]);
    g.inserir({ type: 'way', id: 2, tags: { building: 'yes' }, geometry: [] }, [-47.5, -15.5, -47.49, -15.49]);
    g.concluir({ fonte: 'overture', nome: 'teste', caixa: [-48, -16, -47, -15], versao: 'r1', origens: { OpenStreetMap: 2 }, atribuicao: 'x', licenca: 'ODbL 1.0' });
    const r = JSON.parse(consultarExtras('overture', -15.81, -47.91, -15.78, -47.88, arq)) as { elements: unknown[] };
    expect(r.elements).toHaveLength(1);
    expect(JSON.parse(consultarExtras('prefeitura', -16, -48, -15, -47, arq)).elements).toHaveLength(0);
    expect(conjuntosQueCobrem('overture', -47.9, -15.8, -47.8, -15.7, arq)).toHaveLength(1);
    expect(conjuntosQueCobrem('overture', -49, -15.8, -47.8, -15.7, arq)).toHaveLength(0);
    // reimportar o mesmo conjunto substitui
    const g2 = gravarConjunto('overture', 'teste', arq);
    g2.inserir({ type: 'way', id: 3, tags: {}, geometry: [] }, [-47.9, -15.8, -47.89, -15.79]);
    g2.concluir({ fonte: 'overture', nome: 'teste', caixa: [-48, -16, -47, -15], versao: 'r2', origens: {}, atribuicao: 'x', licenca: 'ODbL 1.0' });
    expect(listarConjuntos(arq)).toMatchObject([{ id: 'overture:teste', quantidade: 1, versao: 'r2' }]);
    // índice novo do OSM copia os extras do antigo
    const novo = new DatabaseSync(path.join(pasta, 'novo.sqlite'));
    criarTabelas(novo);
    expect(copiarExtras(novo, arq)).toBe(1);
    novo.close();
    expect(listarConjuntos(path.join(pasta, 'novo.sqlite'))).toHaveLength(1);
    expect(JSON.parse(consultarExtras('overture', -16, -48, -15, -47, path.join(pasta, 'novo.sqlite'))).elements).toHaveLength(1);
  });
});

/** Shapefile mínimo de polígonos (1 anel cada) com um campo numérico, em SIRGAS 2000 / UTM 23S. */
function escreverShapefile(base: string, aneis: number[][][], atributos: Record<string, number>[]) {
  const registros = aneis.map((anel) => {
    const horario = [...anel].reverse(); // shapefile: anel externo no sentido horário
    const conteudo = Buffer.alloc(44 + 4 + 16 * horario.length);
    conteudo.writeInt32LE(5, 0);
    const xs = horario.map((p) => p[0]);
    const ys = horario.map((p) => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => conteudo.writeDoubleLE(v, 4 + 8 * k));
    conteudo.writeInt32LE(1, 36);
    conteudo.writeInt32LE(horario.length, 40);
    conteudo.writeInt32LE(0, 44);
    horario.forEach(([x, y], k) => {
      conteudo.writeDoubleLE(x, 48 + 16 * k);
      conteudo.writeDoubleLE(y, 56 + 16 * k);
    });
    return conteudo;
  });
  const cab = Buffer.alloc(100);
  const total = 100 + registros.reduce((s, r) => s + 8 + r.length, 0);
  cab.writeInt32BE(9994, 0);
  cab.writeInt32BE(total / 2, 24);
  cab.writeInt32LE(1000, 28);
  cab.writeInt32LE(5, 32);
  const todos = aneis.flat();
  [Math.min(...todos.map((p) => p[0])), Math.min(...todos.map((p) => p[1])), Math.max(...todos.map((p) => p[0])), Math.max(...todos.map((p) => p[1]))]
    .forEach((v, k) => cab.writeDoubleLE(v, 36 + 8 * k));
  const partes = [cab];
  registros.forEach((r, k) => {
    const h = Buffer.alloc(8);
    h.writeInt32BE(k + 1, 0);
    h.writeInt32BE(r.length / 2, 4);
    partes.push(h, r);
  });
  writeFileSync(`${base}.shp`, Buffer.concat(partes));
  // .dbf com um campo numérico ALT (8,2)
  const nomes = Object.keys(atributos[0]);
  const tamCampo = 8;
  const tamRegistro = 1 + tamCampo * nomes.length;
  const cabDbf = Buffer.alloc(32 + 32 * nomes.length + 1);
  cabDbf.writeUInt8(3, 0);
  cabDbf.writeUInt8(126, 1); cabDbf.writeUInt8(10, 2); cabDbf.writeUInt8(6, 3);
  cabDbf.writeUInt32LE(atributos.length, 4);
  cabDbf.writeUInt16LE(cabDbf.length, 8);
  cabDbf.writeUInt16LE(tamRegistro, 10);
  nomes.forEach((n, k) => {
    cabDbf.write(n, 32 + 32 * k, 'ascii');
    cabDbf.write('N', 32 + 32 * k + 11, 'ascii');
    cabDbf.writeUInt8(tamCampo, 32 + 32 * k + 16);
    cabDbf.writeUInt8(2, 32 + 32 * k + 17);
  });
  cabDbf.writeUInt8(0x0d, cabDbf.length - 1);
  const linhas = atributos.map((a) => Buffer.from(` ${nomes.map((n) => a[n].toFixed(2).padStart(tamCampo)).join('')}`, 'ascii'));
  writeFileSync(`${base}.dbf`, Buffer.concat([cabDbf, ...linhas, Buffer.from([0x1a])]));
  writeFileSync(`${base}.prj`, 'PROJCS["SIRGAS_2000_UTM_Zone_23S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]');
}

