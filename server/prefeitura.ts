// Prédios de um arquivo fornecido pelo usuário (prefeitura, governo do
// estado…): GeoJSON ou shapefile (.zip, ou .shp com .dbf/.prj ao lado).
// As coordenadas são convertidas para graus (WGS 84) pelo .prj ou pelo
// "crs" do GeoJSON; arquivos sem essa informação aceitam --epsg.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
import getShapefile from 'shpjs';
import { lerMedidaM } from '../src/core/osm.ts';
import type { Caixa } from './overture.ts';

type Geometria = { type: string; coordinates: unknown };
export interface Feicao { type: 'Feature'; geometry: Geometria | null; properties: Record<string, unknown> | null }
export interface Colecao { type: 'FeatureCollection'; features: Feicao[] }

// sistemas comuns em dados brasileiros
const SIRGAS_UTM = (zona: number) => `+proj=utm +zone=${zona} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
const SAD69_UTM = (zona: number) => `+proj=utm +zone=${zona} +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs`;
const DEFINICOES: Record<number, string> = {
  4326: '+proj=longlat +datum=WGS84 +no_defs',
  4674: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs',
  4618: '+proj=longlat +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +no_defs',
  31983: SIRGAS_UTM(23),
};
for (let z = 18; z <= 25; z++) DEFINICOES[31960 + z] = SIRGAS_UTM(z); // 31978–31985
for (let z = 18; z <= 25; z++) DEFINICOES[29170 + z] = SAD69_UTM(z); // 29188–29195 (SAD69 / UTM sul)

/** "EPSG:31983", "urn:ogc:def:crs:EPSG::31983", 31983 → definição proj4 */
export function definicaoCrs(crs: string | number): string | null {
  const m = String(crs).match(/(\d{4,5})\s*$/);
  if (m && DEFINICOES[Number(m[1])]) return DEFINICOES[Number(m[1])];
  if (/CRS84|WGS ?84/i.test(String(crs))) return DEFINICOES[4326];
  return null;
}

/** Aplica fn a todos os pontos de uma geometria (Polygon/MultiPolygon). */
function mapearPontos(g: Geometria, fn: (p: number[]) => number[]): Geometria {
  const fundo = (c: unknown): unknown => (typeof (c as number[])[0] === 'number' ? fn(c as number[]) : (c as unknown[]).map(fundo));
  return { type: g.type, coordinates: fundo(g.coordinates) };
}

function primeiroPonto(c: unknown): number[] | null {
  let x = c;
  while (Array.isArray(x) && Array.isArray(x[0])) x = x[0];
  return Array.isArray(x) && typeof x[0] === 'number' ? (x as number[]) : null;
}

/** As coordenadas parecem graus (lon/lat)? */
export function emGraus(fc: Colecao): boolean {
  const amostra = fc.features.slice(0, 50).map((f) => (f.geometry ? primeiroPonto(f.geometry.coordinates) : null)).filter(Boolean) as number[][];
  return amostra.length > 0 && amostra.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

export function reprojetar(fc: Colecao, definicao: string): Colecao {
  const conv = proj4(definicao, DEFINICOES[4326]);
  return { ...fc, features: fc.features.map((f) => ({ ...f, geometry: f.geometry ? mapearPontos(f.geometry, (p) => conv.forward([p[0], p[1]])) : null })) };
}

/**
 * Lê o arquivo e devolve as feições em graus (WGS 84).
 * `epsg` força o sistema de coordenadas (para arquivos sem .prj/crs).
 */
export async function lerArquivoPredios(caminho: string, epsg?: number): Promise<{ colecao: Colecao; crs: string }> {
  const ext = path.extname(caminho).toLowerCase();
  let fc: Colecao;
  let crs = 'graus (WGS 84)';
  if (ext === '.geojson' || ext === '.json') {
    const bruto = JSON.parse(readFileSync(caminho, 'utf8')) as Colecao & { crs?: { properties?: { name?: string } } };
    fc = bruto;
    const nome = bruto.crs?.properties?.name;
    const def = epsg ? DEFINICOES[epsg] : nome ? definicaoCrs(nome) : null;
    if (nome && !def && !epsg) throw new Error(`Sistema de coordenadas não reconhecido (${nome}). Informe com --epsg (ex.: --epsg 31983).`);
    if (def && def !== DEFINICOES[4326]) {
      fc = reprojetar(fc, def);
      crs = epsg ? `EPSG:${epsg}` : String(nome);
    }
  } else if (ext === '.zip' || ext === '.shp') {
    let bruto: Colecao | Colecao[];
    if (ext === '.zip') {
      bruto = await getShapefile(readFileSync(caminho));
    } else {
      const base = caminho.slice(0, -4);
      const ler = (e: string) => (existsSync(base + e) ? readFileSync(base + e) : existsSync(base + e.toUpperCase()) ? readFileSync(base + e.toUpperCase()) : undefined);
      const dbf = ler('.dbf');
      if (!dbf) throw new Error('Falta o arquivo .dbf ao lado do .shp (é nele que ficam os campos, como a altura).');
      const prj = ler('.prj');
      bruto = await getShapefile({ shp: readFileSync(caminho), dbf, prj: prj?.toString('utf8'), cpg: ler('.cpg')?.toString('utf8') });
      if (prj) crs = `.prj (${prj.toString('utf8').match(/^\w+\["([^"]+)"/)?.[1] ?? 'lido'})`;
    }
    fc = Array.isArray(bruto) ? { type: 'FeatureCollection', features: bruto.flatMap((b) => b.features) } : bruto;
    if (epsg) {
      fc = reprojetar(fc, DEFINICOES[epsg] ?? (() => { throw new Error(`EPSG:${epsg} não está na lista do app.`); })());
      crs = `EPSG:${epsg}`;
    }
  } else {
    throw new Error('Formato não aceito. Use .geojson, .json, .zip (shapefile) ou .shp.');
  }
  if (!emGraus(fc)) {
    throw new Error('As coordenadas não estão em graus e o arquivo não diz o sistema delas. '
      + 'Informe com --epsg (SIRGAS 2000 / UTM 23S, usado no DF, é --epsg 31983; 22S é 31982; 24S é 31984).');
  }
  return { colecao: fc, crs };
}

export interface InfoCampo { nome: string; exemplos: string[]; numericos: number; total: number }

/** Campos das feições, com exemplos e quantos valores são números. */
export function camposDoArquivo(fc: Colecao): InfoCampo[] {
  const campos = new Map<string, InfoCampo>();
  for (const f of fc.features.slice(0, 2000)) {
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      const c = campos.get(k) ?? { nome: k, exemplos: [], numericos: 0, total: 0 };
      if (v != null && v !== '') {
        c.total++;
        if (lerNumero(v) != null) c.numericos++;
        if (c.exemplos.length < 4 && !c.exemplos.includes(String(v))) c.exemplos.push(String(v));
      }
      campos.set(k, c);
    }
  }
  return [...campos.values()];
}

/** Campos que parecem altura ou número de andares (pelo nome e por serem números). */
export function sugerirCampos(campos: InfoCampo[]): { altura: string[]; andares: string[] } {
  const num = campos.filter((c) => c.total > 0 && c.numericos / c.total > 0.8);
  return {
    altura: num.filter((c) => /alt|height|gabarito|cota_?topo|elev/i.test(c.nome)).map((c) => c.nome),
    andares: num.filter((c) => /pav|andar|floor|level|pisos/i.test(c.nome)).map((c) => c.nome),
  };
}

function lerNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  // "1.234,5": o ponto só é de milhar quando também há vírgula decimal
  return lerMedidaM(v.includes(',') ? v.replace(/\./g, '') : v);
}

const ponto = ([lon, lat]: number[]) => ({ lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 });

/**
 * Feição → elemento no formato do Overpass, com height / building:levels.
 * null se não for polígono.
 */
export function elementoPrefeitura(
  f: Feicao, id: number, o: { campoAltura?: string; campoAndares?: string; nome: string },
): { elemento: object; caixa: Caixa } | null {
  const g = f.geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
  const poligonos = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][];
  const tags: Record<string, string> = { building: 'yes', 'relevo3d:fonte': 'prefeitura', 'relevo3d:origem': o.nome };
  const altura = o.campoAltura ? lerNumero(f.properties?.[o.campoAltura]) : null;
  if (altura && altura > 0 && altura < 1000) tags.height = String(Math.round(altura * 100) / 100);
  const andares = o.campoAndares ? lerNumero(f.properties?.[o.campoAndares]) : null;
  if (andares && andares > 0 && andares < 300) tags['building:levels'] = String(Math.round(andares));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const anel of poligonos.flat()) {
    for (const [x, y] of anel) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0)) return null;
  const caixa: Caixa = [x0, y0, x1, y1];
  if (poligonos.length === 1 && poligonos[0].length === 1) {
    return { elemento: { type: 'way', id, tags, geometry: poligonos[0][0].map(ponto) }, caixa };
  }
  const members = poligonos.flatMap((anel) => anel.map((r, k) => ({ type: 'way', ref: 0, role: k === 0 ? 'outer' : 'inner', geometry: r.map(ponto) })));
  return { elemento: { type: 'relation', id, tags, members }, caixa };
}
