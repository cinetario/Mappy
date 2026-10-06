// Prédios do Overture Maps (tema buildings, GeoParquet público na AWS).
// Lê só os pedaços (row groups) dos arquivos que tocam a região: cada arquivo
// tem ~500 MB, mas os grupos trazem a caixa (bbox) mínima/máxima, então dá
// para pular quase tudo. Sem conta e sem chave.
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects, type FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { USER_AGENT } from './fontes.ts';

const STAC = 'https://stac.overturemaps.org';

export type Caixa = [number, number, number, number]; // oeste, sul, leste, norte

const toca = (a: Caixa, b: Caixa) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return (await r.json()) as T;
}

/** Release mais recente e os arquivos de prédios que tocam a região. */
export async function arquivosDaRegiao(caixa: Caixa): Promise<{ versao: string; urls: string[] }> {
  const catalogo = await json<{ latest: string }>(`${STAC}/catalog.json`);
  const versao = catalogo.latest;
  const colecao = await json<{ extent: { spatial: { bbox: Caixa[] } }; links: { rel: string; href: string }[] }>(
    `${STAC}/${versao}/buildings/building/collection.json`,
  );
  // bbox[0] é o mundo todo; depois vem um por arquivo, na ordem dos itens
  const caixas = colecao.extent.spatial.bbox.slice(1);
  const itens = colecao.links.filter((l) => l.rel === 'item').map((l) => l.href);
  const urls: string[] = [];
  for (const [k, c] of caixas.entries()) {
    if (!toca(c, caixa) || !itens[k]) continue;
    const item = await json<{ assets: { aws: { href: string } } }>(itens[k]);
    urls.push(item.assets.aws.href);
  }
  return { versao, urls };
}

interface LinhaOverture {
  id: string;
  sources: { property: string | null; dataset: string; license: string | null }[] | null;
  height: number | null;
  num_floors: number | null;
  min_height: number | null;
  roof_shape: string | null;
  roof_height: number | null;
  is_underground: boolean | null;
  geometry: { type: string; coordinates: number[][][] | number[][][][] } | null;
  bbox: { xmin: number; xmax: number; ymin: number; ymax: number };
}

const COLUNAS = ['id', 'sources', 'height', 'num_floors', 'min_height', 'roof_shape', 'roof_height', 'is_underground', 'geometry', 'bbox'];

const ponto = ([lon, lat]: number[]) => ({ lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 });

/** Base original do prédio (OSM, Google, Microsoft, Esri…) e a licença dela. */
export function origemOverture(l: Pick<LinhaOverture, 'sources'>): { dataset: string; licenca: string | null } {
  const s = (l.sources ?? []).find((x) => !x.property) ?? l.sources?.[0];
  return { dataset: s?.dataset ?? 'Overture', licenca: s?.license ?? null };
}

/**
 * Prédio do Overture → elemento no formato do Overpass ("out geom"), com tags
 * do OSM (height, building:levels, min_height, roof:shape, roof:height), para o
 * app tratar todas as fontes igual. null se não servir (subterrâneo, sem polígono).
 */
export function elementoOverture(l: LinhaOverture, idNumerico: number): { elemento: object; caixa: Caixa } | null {
  if (l.is_underground || !l.geometry) return null;
  const poligonos = l.geometry.type === 'Polygon'
    ? [l.geometry.coordinates as number[][][]]
    : l.geometry.type === 'MultiPolygon' ? (l.geometry.coordinates as number[][][][]) : [];
  if (!poligonos.length) return null;
  const { dataset, licenca } = origemOverture(l);
  const tags: Record<string, string> = { building: 'yes', 'relevo3d:fonte': 'overture', 'relevo3d:origem': dataset };
  if (licenca) tags['relevo3d:licenca'] = licenca;
  if (l.height != null && l.height > 0) tags.height = String(Math.round(l.height * 100) / 100);
  if (l.num_floors != null && l.num_floors > 0) tags['building:levels'] = String(l.num_floors);
  if (l.min_height != null && l.min_height > 0) tags.min_height = String(l.min_height);
  if (l.roof_shape) tags['roof:shape'] = l.roof_shape;
  if (l.roof_height != null && l.roof_height > 0) tags['roof:height'] = String(l.roof_height);
  const caixa: Caixa = [l.bbox.xmin, l.bbox.ymin, l.bbox.xmax, l.bbox.ymax];
  if (poligonos.length === 1 && poligonos[0].length === 1) {
    return { elemento: { type: 'way', id: idNumerico, tags, geometry: poligonos[0][0].map(ponto) }, caixa };
  }
  // com pátio ou várias partes: relação multipolígono
  const members = poligonos.flatMap((anel) => anel.map((r, k) => ({ type: 'way', ref: 0, role: k === 0 ? 'outer' : 'inner', geometry: r.map(ponto) })));
  return { elemento: { type: 'relation', id: idNumerico, tags, members }, caixa };
}

export interface ProgressoOverture {
  arquivo: number;
  arquivos: number;
  grupo: number;
  grupos: number;
  bytes: number;
  predios: number;
}

/**
 * Lê os prédios da região, grupo por grupo, chamando `aoLer` para cada um.
 * Devolve quantos prédios vieram de cada base original.
 */
export async function lerPrediosOverture(
  urls: string[],
  caixa: Caixa,
  aoLer: (r: { elemento: object; caixa: Caixa }) => void,
  aoProgredir: (p: ProgressoOverture) => void,
): Promise<Record<string, { quantidade: number; licenca: string | null }>> {
  const origens: Record<string, { quantidade: number; licenca: string | null }> = {};
  let predios = 0;
  let bytes = 0;
  let proximoId = 1;
  for (const [a, url] of urls.entries()) {
    const file = await asyncBufferFromUrl({ url, requestInit: { headers: { 'User-Agent': USER_AGENT } } });
    const metadata: FileMetaData = await parquetMetadataAsync(file);
    // grupos cuja caixa toca a região (estatísticas min/max das colunas bbox.*)
    const grupos: { inicio: number; fim: number; tamanho: number }[] = [];
    let inicio = 0;
    for (const g of metadata.row_groups) {
      const n = Number(g.num_rows);
      const est: Record<string, [number, number]> = {};
      for (const c of g.columns) {
        const caminho = c.meta_data?.path_in_schema ?? [];
        const st = c.meta_data?.statistics;
        if (caminho[0] === 'bbox' && st) est[caminho[1]] = [Number(st.min_value), Number(st.max_value)];
      }
      const cg: Caixa = [est.xmin?.[0] ?? -180, est.ymin?.[0] ?? -90, est.xmax?.[1] ?? 180, est.ymax?.[1] ?? 90];
      // tamanho baixado (compactado) do grupo
      const tamanho = Number(g.total_compressed_size ?? g.columns.reduce((s, c) => s + Number(c.meta_data?.total_compressed_size ?? 0), 0));
      if (toca(cg, caixa)) grupos.push({ inicio, fim: inicio + n, tamanho });
      inicio += n;
    }
    for (const [k, g] of grupos.entries()) {
      aoProgredir({ arquivo: a + 1, arquivos: urls.length, grupo: k + 1, grupos: grupos.length, bytes, predios });
      const linhas = await comTentativas(() => parquetReadObjects({
        file, metadata, compressors, columns: COLUNAS, rowStart: g.inicio, rowEnd: g.fim,
      })) as unknown as LinhaOverture[];
      bytes += g.tamanho;
      for (const l of linhas) {
        if (!toca([l.bbox.xmin, l.bbox.ymin, l.bbox.xmax, l.bbox.ymax], caixa)) continue;
        const r = elementoOverture(l, proximoId);
        if (!r) continue;
        proximoId++;
        predios++;
        const { dataset, licenca } = origemOverture(l);
        const o = (origens[dataset] ??= { quantidade: 0, licenca });
        o.quantidade++;
        aoLer(r);
      }
    }
    aoProgredir({ arquivo: a + 1, arquivos: urls.length, grupo: grupos.length, grupos: grupos.length, bytes, predios });
  }
  return origens;
}

async function comTentativas<T>(fn: () => Promise<T>, tentativas = 4): Promise<T> {
  for (let t = 1; ; t++) {
    try {
      return await fn();
    } catch (erro) {
      if (t >= tentativas) throw erro;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (t - 1)));
    }
  }
}
