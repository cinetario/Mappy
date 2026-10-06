// Tipos de via e larguras reais usadas para desenhar as ruas.

export const TIPOS_VIA = {
  rodovias: { nome: 'Rodovias', larguraM: 10, principal: true },
  principais: { nome: 'Vias principais', larguraM: 6, principal: true },
  locais: { nome: 'Ruas locais', larguraM: 4, principal: false },
  servico: { nome: 'Vielas / serviço', larguraM: 2, principal: false },
  pedestres: { nome: 'Pedestres / ciclovias', larguraM: 1, principal: false },
  ferrovias: { nome: 'Ferrovias', larguraM: 3, principal: true },
  balsas: { nome: 'Balsas', larguraM: 3, principal: true },
  tuneis: { nome: 'Túneis', larguraM: 4, principal: false },
  pontes: { nome: 'Pontes', larguraM: 6, principal: true },
  calcadas: { nome: 'Calçadas', larguraM: 1, principal: false },
  faixasPedestre: { nome: 'Faixas de pedestre', larguraM: 1, principal: false },
  estacionamentos: { nome: 'Estacionamentos', larguraM: 2, principal: false },
} as const;

export type TipoVia = keyof typeof TIPOS_VIA;

export const LISTA_TIPOS_VIA = Object.keys(TIPOS_VIA) as TipoVia[];

/** Desligados por padrão: túneis ficam embaixo da terra. */
export const TIPOS_DESLIGADOS_PADRAO: TipoVia[] = ['tuneis'];

/** Tipos que ficam desligados com o atalho "só vias principais". */
export const TIPOS_SO_PRINCIPAIS: TipoVia[] = LISTA_TIPOS_VIA.filter((t) => !TIPOS_VIA[t].principal);

const RODOVIAS = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link']);
const PRINCIPAIS = new Set(['primary', 'secondary', 'primary_link', 'secondary_link']);
const LOCAIS = new Set(['tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'road', 'busway']);
const SERVICO = new Set(['service', 'track']);
const PEDESTRES = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'bridleway', 'corridor']);
const FERROVIAS = new Set(['rail', 'light_rail', 'tram', 'subway', 'narrow_gauge', 'monorail', 'funicular']);

/** Classifica uma via do OSM pelas tags; null = não é via que nos interessa. */
export function classificarVia(tags: Record<string, string>): TipoVia | null {
  const hw = tags.highway;
  const tunel = tags.tunnel && tags.tunnel !== 'no';
  if (tags.route === 'ferry') return 'balsas';
  if (tags.railway && FERROVIAS.has(tags.railway)) {
    if (tunel || tags.railway === 'subway') return 'tuneis';
    return 'ferrovias';
  }
  if (!hw || hw === 'proposed' || hw === 'construction' || hw === 'platform' || hw === 'elevator') return null;
  if (tags.area === 'yes') return null;
  if (tunel) return 'tuneis';
  if (tags.bridge && tags.bridge !== 'no') return 'pontes';
  if (hw === 'footway' && tags.footway === 'sidewalk') return 'calcadas';
  if (hw === 'footway' && tags.footway === 'crossing') return 'faixasPedestre';
  if (hw === 'service' && tags.service === 'parking_aisle') return 'estacionamentos';
  if (RODOVIAS.has(hw)) return 'rodovias';
  if (PRINCIPAIS.has(hw)) return 'principais';
  if (LOCAIS.has(hw)) return 'locais';
  if (SERVICO.has(hw)) return 'servico';
  if (PEDESTRES.has(hw)) return 'pedestres';
  return null;
}

export function lerTiposDesligados(texto: string): TipoVia[] | null {
  if (texto.trim() === '' || texto === '-') return [];
  const itens = texto.split(',').map((s) => s.trim());
  if (itens.some((i) => !(i in TIPOS_VIA))) return null;
  return LISTA_TIPOS_VIA.filter((t) => itens.includes(t));
}

export function escreverTiposDesligados(t: TipoVia[]): string {
  return t.length ? LISTA_TIPOS_VIA.filter((x) => t.includes(x)).join(',') : '-';
}
