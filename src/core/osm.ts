// Leitura dos dados do OpenStreetMap (resposta do Overpass com "out geom")
// e organização em prédios, vias e água.
import type { LonLat } from './geo.ts';
import { classificarVia, type TipoVia } from './vias.ts';
import { classificarCobertura, type TipoCobertura } from './categorias-osm.ts';

type Ponto = { lat: number; lon: number } | null;

export interface ElementoOSM {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: Ponto[];
  members?: { type: string; ref: number; role: string; geometry?: Ponto[] }[];
}

/** Polígono com furos: todos os anéis juntos, preenchidos pela regra par-ímpar. */
export interface PoligonoOSM {
  id: string;
  tags: Record<string, string>;
  aneis: LonLat[][];
}

export interface LinhaOSM {
  id: string;
  tags: Record<string, string>;
  pontos: LonLat[];
}

export type FontePredio = 'osm' | 'overture' | 'prefeitura';
export type FormaTelhado = 'plano' | 'duas-aguas' | 'quatro-aguas' | 'piramidal' | 'cupula';

export interface Predio extends PoligonoOSM {
  /** altura total (do chão ao topo do telhado) */
  alturaM: number;
  /** a altura veio de height/levels (e não do padrão) */
  alturaInformada: boolean;
  /** de onde veio o prédio */
  fonte: FontePredio;
  /** base original (Overture: OpenStreetMap, Google Open Buildings…; prefeitura: atribuição) */
  origem?: string;
  /** de onde veio a altura, quando não é da própria fonte (ex.: OSM sem altura completado pelo Overture) */
  alturaDe?: FontePredio;
  /** parte que começa acima do chão (building:part com min_height) */
  minAlturaM: number;
  /** telhado (forma e altura; altura null = calculada pela largura) */
  telhado: { forma: FormaTelhado; alturaM: number | null } | null;
}

export interface Via extends LinhaOSM {
  tipo: TipoVia;
}

export type { GrupoOSM } from './categorias-osm.ts';

// ---------- conversões ----------
const paraLonLat = (g: Ponto[] | undefined): LonLat[] =>
  (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => [p.lon, p.lat]);

const iguais = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

/** Junta trechos de linha (ex.: membros de um multipolígono) em anéis fechados. */
export function juntarAneis(trechos: LonLat[][]): LonLat[][] {
  const abertos = trechos.filter((t) => t.length >= 2).map((t) => t.slice());
  const aneis: LonLat[][] = [];
  while (abertos.length) {
    let atual = abertos.pop()!;
    let mudou = true;
    while (!iguais(atual[0], atual[atual.length - 1]) && mudou) {
      mudou = false;
      for (let k = 0; k < abertos.length; k++) {
        const t = abertos[k];
        const fim = atual[atual.length - 1];
        if (iguais(fim, t[0])) atual = atual.concat(t.slice(1));
        else if (iguais(fim, t[t.length - 1])) atual = atual.concat(t.slice(0, -1).reverse());
        else if (iguais(atual[0], t[t.length - 1])) atual = t.slice(0, -1).concat(atual);
        else if (iguais(atual[0], t[0])) atual = t.slice(1).reverse().concat(atual);
        else continue;
        abertos.splice(k, 1);
        mudou = true;
        break;
      }
    }
    if (iguais(atual[0], atual[atual.length - 1]) && atual.length >= 4) aneis.push(atual.slice(0, -1));
  }
  return aneis;
}

/** Junta trechos abertos em cadeias (sem exigir que fechem), mantendo o sentido. */
export function juntarCadeias(trechos: LonLat[][]): LonLat[][] {
  const restantes = trechos.filter((t) => t.length >= 2).map((t) => t.slice());
  const cadeias: LonLat[][] = [];
  while (restantes.length) {
    let atual = restantes.pop()!;
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (let k = 0; k < restantes.length; k++) {
        const t = restantes[k];
        if (iguais(atual[atual.length - 1], t[0])) atual = atual.concat(t.slice(1));
        else if (iguais(t[t.length - 1], atual[0])) atual = t.slice(0, -1).concat(atual);
        else continue;
        restantes.splice(k, 1);
        mudou = true;
        break;
      }
    }
    cadeias.push(atual);
  }
  return cadeias;
}

/** Polígono de um way fechado ou de uma relação multipolígono; null se não fechar. */
export function poligonoDe(e: ElementoOSM): PoligonoOSM | null {
  const tags = e.tags ?? {};
  if (e.type === 'way') {
    const pts = paraLonLat(e.geometry);
    if (pts.length < 4 || !iguais(pts[0], pts[pts.length - 1])) return null;
    return { id: `w${e.id}`, tags, aneis: [pts.slice(0, -1)] };
  }
  if (e.type === 'relation') {
    const trechos = (e.members ?? [])
      .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === 'inner' || m.role === ''))
      .map((m) => paraLonLat(m.geometry));
    const aneis = juntarAneis(trechos);
    return aneis.length ? { id: `r${e.id}`, tags, aneis } : null;
  }
  return null;
}

// ---------- prédios ----------
/** Converte "12", "12 m", "12.5m", "40'", "40 ft" para metros. */
export function lerMedidaM(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(m|ft|'|feet)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] && /ft|'|feet/i.test(m[2]) ? n * 0.3048 : n;
}

const METROS_POR_ANDAR = 3;

export function alturaPredio(tags: Record<string, string>, padraoM: number): { alturaM: number; informada: boolean } {
  const h = lerMedidaM(tags.height) ?? lerMedidaM(tags['building:height']);
  if (h) return { alturaM: Math.min(h, 1000), informada: true };
  const andares = Number(String(tags['building:levels'] ?? '').split(/[;,]/)[0]);
  if (Number.isFinite(andares) && andares > 0) {
    const telhado = Number(tags['roof:levels']) || 0;
    return { alturaM: (andares + telhado) * METROS_POR_ANDAR, informada: true };
  }
  return { alturaM: padraoM, informada: false };
}

/** roof:shape do OSM (e roof_shape do Overture) → formas que o app desenha */
const FORMAS_TELHADO: Record<string, FormaTelhado> = {
  flat: 'plano',
  gabled: 'duas-aguas', gambrel: 'duas-aguas', saltbox: 'duas-aguas', skillion: 'duas-aguas',
  hipped: 'quatro-aguas', 'half-hipped': 'quatro-aguas', mansard: 'quatro-aguas', side_hipped: 'quatro-aguas',
  pyramidal: 'piramidal', cone: 'piramidal',
  dome: 'cupula', onion: 'cupula', round: 'cupula',
};

/** Telhado pelas tags roof:shape / roof:height / roof:levels (null = sem roof:shape). */
export function telhadoPredio(tags: Record<string, string>): Predio['telhado'] {
  const forma = FORMAS_TELHADO[(tags['roof:shape'] ?? '').trim().toLowerCase()];
  if (!forma) return null;
  if (forma === 'plano') return { forma, alturaM: 0 };
  const h = lerMedidaM(tags['roof:height']);
  const niveis = Number(tags['roof:levels']);
  return { forma, alturaM: h ?? (Number.isFinite(niveis) && niveis > 0 ? niveis * METROS_POR_ANDAR : null) };
}

/** Altura onde a parte começa (min_height, ou building:min_level × 3 m). */
export function minAlturaPredio(tags: Record<string, string>): number {
  const h = lerMedidaM(tags.min_height);
  if (h) return Math.min(h, 1000);
  const nivel = Number(tags['building:min_level']);
  return Number.isFinite(nivel) && nivel > 0 ? nivel * METROS_POR_ANDAR : 0;
}

const NAO_PREDIO = new Set(['no', 'roof', 'construction', 'ruins', 'collapsed', 'demolished']);

export function extrairPredios(elementos: ElementoOSM[], detalhados: boolean, alturaPadraoM: number): Predio[] {
  const contornos: Predio[] = [];
  const partes: Predio[] = [];
  for (const e of elementos) {
    const tags = e.tags ?? {};
    const ehParte = !!tags['building:part'] && tags['building:part'] !== 'no';
    const ehPredio = !!tags.building && !NAO_PREDIO.has(tags.building);
    if (!ehParte && !ehPredio) continue;
    const pol = poligonoDe(e);
    if (!pol) continue;
    const { alturaM, informada } = alturaPredio(tags, alturaPadraoM);
    const fonte: FontePredio = tags['relevo3d:fonte'] === 'overture' || tags['relevo3d:fonte'] === 'prefeitura' ? tags['relevo3d:fonte'] : 'osm';
    const telhado = telhadoPredio(tags);
    let total = alturaM;
    // com andares (sem height), o telhado de roof:height fica em cima dos andares
    if (!lerMedidaM(tags.height) && !lerMedidaM(tags['building:height']) && telhado?.alturaM && !tags['roof:levels'] && informada) total += telhado.alturaM;
    const minAlturaM = Math.min(minAlturaPredio(tags), total * 0.95);
    const p: Predio = {
      ...pol, alturaM: total, alturaInformada: informada, fonte, minAlturaM, telhado,
      ...(tags['relevo3d:origem'] ? { origem: tags['relevo3d:origem'] } : fonte === 'osm' ? { origem: 'OpenStreetMap' } : {}),
    };
    if (ehParte && !ehPredio) partes.push(p);
    else contornos.push(p);
  }
  if (!detalhados || partes.length === 0) return contornos;

  // prédios com partes (building:part) são trocados pelas partes
  const centros = partes.map((p) => centroide(p.aneis[0]));
  const usados = contornos.filter((c) => {
    const [x0, y0, x1, y1] = caixa(c.aneis[0]);
    const temParte = centros.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && dentro([x, y], c.aneis));
    return !temParte;
  });
  return [...usados, ...partes];
}

// ---------- vias ----------
export function extrairVias(elementos: ElementoOSM[]): Via[] {
  const vias: Via[] = [];
  for (const e of elementos) {
    if (e.type !== 'way') continue;
    const tipo = classificarVia(e.tags ?? {});
    if (!tipo) continue;
    const pontos = paraLonLat(e.geometry);
    if (pontos.length >= 2) vias.push({ id: `w${e.id}`, tags: e.tags ?? {}, pontos, tipo });
  }
  return vias;
}

// ---------- água ----------
export interface DadosAgua {
  poligonos: PoligonoOSM[];
  rios: LinhaOSM[];
  /** linhas de costa (terra à esquerda, mar à direita) */
  costa: LonLat[][];
}

const LARGURA_RIO_M: Record<string, number> = { river: 12, canal: 8, stream: 2.5 };

export function larguraRioM(tags: Record<string, string>): number {
  return lerMedidaM(tags.width) ?? LARGURA_RIO_M[tags.waterway] ?? 2;
}

export function extrairAgua(elementos: ElementoOSM[]): DadosAgua {
  const poligonos: PoligonoOSM[] = [];
  const rios: LinhaOSM[] = [];
  const costa: LonLat[][] = [];
  for (const e of elementos) {
    const t = e.tags ?? {};
    if (t.natural === 'coastline' && e.type === 'way') {
      costa.push(paraLonLat(e.geometry));
      continue;
    }
    if (e.type === 'way' && t.waterway && t.waterway in LARGURA_RIO_M && !(t.tunnel && t.tunnel !== 'no')) {
      const pontos = paraLonLat(e.geometry);
      if (pontos.length >= 2) rios.push({ id: `w${e.id}`, tags: t, pontos });
      continue;
    }
    const ehAgua = t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock'
      || t.landuse === 'reservoir' || t.landuse === 'basin';
    if (!ehAgua || t.intermittent === 'yes') continue;
    const pol = poligonoDe(e);
    if (pol) poligonos.push(pol);
  }
  return { poligonos, rios, costa: juntarCadeias(costa) };
}

// ---------- cobertura do solo ----------
export interface AreaCobertura extends PoligonoOSM {
  tipo: TipoCobertura;
}

export function extrairCobertura(elementos: ElementoOSM[]): AreaCobertura[] {
  const r: AreaCobertura[] = [];
  for (const e of elementos) {
    const tipo = classificarCobertura(e.tags ?? {});
    if (!tipo) continue;
    const pol = poligonoDe(e);
    if (pol) r.push({ ...pol, tipo });
  }
  return r;
}

// ---------- árvores ----------
export interface DadosArvores {
  /** árvores mapeadas uma a uma (natural=tree) */
  pontos: { id: string; pos: LonLat }[];
  /** fileiras de árvores (natural=tree_row) */
  fileiras: LinhaOSM[];
}

export function extrairArvores(elementos: ElementoOSM[]): DadosArvores {
  const pontos: DadosArvores['pontos'] = [];
  const fileiras: LinhaOSM[] = [];
  for (const e of elementos) {
    const t = e.tags ?? {};
    if (e.type === 'node' && t.natural === 'tree' && e.lat !== undefined && e.lon !== undefined) {
      pontos.push({ id: `n${e.id}`, pos: [e.lon, e.lat] });
    } else if (e.type === 'way' && t.natural === 'tree_row') {
      const p = paraLonLat(e.geometry);
      if (p.length >= 2) fileiras.push({ id: `w${e.id}`, tags: t, pontos: p });
    }
  }
  return { pontos, fileiras };
}

// ---------- utilidades ----------
export function centroide(anel: LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  for (const p of anel) {
    x += p[0];
    y += p[1];
  }
  return [x / anel.length, y / anel.length];
}

function caixa(anel: LonLat[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of anel) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Ponto dentro de um conjunto de anéis (par-ímpar, respeita furos). */
export function dentro([x, y]: LonLat, aneis: LonLat[][]): boolean {
  let d = false;
  for (const pts of aneis) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
    }
  }
  return d;
}

/** Mantém só os elementos cuja caixa toca a área (os blocos baixados são maiores que ela). */
export function filtrarPorArea(elementos: ElementoOSM[], area: { oeste: number; sul: number; leste: number; norte: number }): ElementoOSM[] {
  return elementos.filter((e) => {
    if (e.type === 'node') {
      return e.lon !== undefined && e.lat !== undefined && e.lon >= area.oeste && e.lon <= area.leste && e.lat >= area.sul && e.lat <= area.norte;
    }
    const pontos = e.geometry ?? e.members?.flatMap((m) => m.geometry ?? []) ?? [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pontos) {
      if (!p) continue;
      x0 = Math.min(x0, p.lon); x1 = Math.max(x1, p.lon); y0 = Math.min(y0, p.lat); y1 = Math.max(y1, p.lat);
    }
    return x1 >= area.oeste && x0 <= area.leste && y1 >= area.sul && y0 <= area.norte;
  });
}

/** Remove duplicatas (o mesmo elemento vem em vários blocos da consulta). */
export function semDuplicatas(listas: ElementoOSM[][]): ElementoOSM[] {
  const vistos = new Set<string>();
  const r: ElementoOSM[] = [];
  for (const l of listas) {
    for (const e of l) {
      const k = `${e.type}/${e.id}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      r.push(e);
    }
  }
  return r;
}
