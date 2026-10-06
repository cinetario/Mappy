// Quais elementos do OpenStreetMap o app usa, e em que grupo cada um entra.
// Usado pelo importador do arquivo local (.osm.pbf), pelo servidor e pelo app.

export type GrupoOSM = 'predios' | 'vias' | 'agua' | 'cobertura' | 'arvores';
export const GRUPOS_OSM: GrupoOSM[] = ['predios', 'vias', 'agua', 'cobertura', 'arvores'];

type Tags = Record<string, string | undefined>;

// ---------- cobertura do solo ----------
export const TIPOS_COBERTURA = {
  floresta: { nome: 'Floresta', cor: '#3d6b35' },
  grama: { nome: 'Grama', cor: '#8cb369' },
  lavoura: { nome: 'Lavoura', cor: '#c9b458' },
  umida: { nome: 'Área úmida', cor: '#6b9a8a' },
  areia: { nome: 'Areia', cor: '#e3d3a4' },
  gelo: { nome: 'Gelo', cor: '#eef4f7' },
  rocha: { nome: 'Rocha', cor: '#9a948b' },
  urbano: { nome: 'Urbano', cor: '#b9aea3' },
} as const;
export type TipoCobertura = keyof typeof TIPOS_COBERTURA;
export const LISTA_COBERTURA = Object.keys(TIPOS_COBERTURA) as TipoCobertura[];

const COBERTURA_LANDUSE: Record<string, TipoCobertura> = {
  forest: 'floresta',
  grass: 'grama', meadow: 'grama', village_green: 'grama', recreation_ground: 'grama', cemetery: 'grama',
  farmland: 'lavoura', orchard: 'lavoura', vineyard: 'lavoura', farmyard: 'lavoura', plant_nursery: 'lavoura',
  allotments: 'lavoura', greenhouse_horticulture: 'lavoura',
  residential: 'urbano', commercial: 'urbano', industrial: 'urbano', retail: 'urbano', construction: 'urbano', railway: 'urbano',
};
const COBERTURA_NATURAL: Record<string, TipoCobertura> = {
  wood: 'floresta',
  grassland: 'grama', scrub: 'grama', heath: 'grama',
  wetland: 'umida',
  sand: 'areia', beach: 'areia', dune: 'areia',
  glacier: 'gelo',
  bare_rock: 'rocha', scree: 'rocha', shingle: 'rocha', rock: 'rocha', stone: 'rocha',
};
const COBERTURA_LEISURE: Record<string, TipoCobertura> = { park: 'grama', garden: 'grama', golf_course: 'grama' };

export function classificarCobertura(t: Tags): TipoCobertura | null {
  return (t.landuse && COBERTURA_LANDUSE[t.landuse])
    || (t.natural && COBERTURA_NATURAL[t.natural])
    || (t.leisure && COBERTURA_LEISURE[t.leisure])
    || null;
}

// ---------- grupos ----------
const NAO_PREDIO = new Set(['no', 'roof', 'construction', 'ruins', 'collapsed', 'demolished']);
const FERROVIAS = /^(rail|light_rail|tram|subway|narrow_gauge|monorail|funicular)$/;
const AGUA_WATERWAY = /^(riverbank|dock|river|stream|canal)$/;

/** Grupo de um caminho (way) ou relação pelas tags; null = o app não usa. */
export function grupoDoElemento(t: Tags): GrupoOSM | null {
  if ((t.building && !NAO_PREDIO.has(t.building)) || (t['building:part'] && t['building:part'] !== 'no')) return 'predios';
  if (t.natural === 'water' || t.natural === 'coastline' || (t.waterway && AGUA_WATERWAY.test(t.waterway))
    || t.landuse === 'reservoir' || t.landuse === 'basin') return 'agua';
  if (t.highway || (t.railway && FERROVIAS.test(t.railway)) || t.route === 'ferry') return 'vias';
  if (t.natural === 'tree_row') return 'arvores';
  if (classificarCobertura(t)) return 'cobertura';
  return null;
}

/** Grupo de um nó (ponto): só árvores mapeadas uma a uma. */
export function grupoDoNo(t: Tags): GrupoOSM | null {
  return t.natural === 'tree' ? 'arvores' : null;
}

/** Chaves que podem colocar um elemento em algum grupo (filtro rápido no importador). */
export const CHAVES_RELEVANTES = new Set(['building', 'building:part', 'natural', 'waterway', 'landuse', 'highway', 'railway', 'route', 'leisure']);
