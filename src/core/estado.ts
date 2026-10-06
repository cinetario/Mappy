// Estado completo do app (área + parâmetros) e sua representação na URL.
// Cada parâmetro é definido UMA vez aqui: padrão, limites e chave na URL.
// O painel, a URL, os presets e o "Redefinir" partem desta definição.
import type { Forma, LonLat } from './geo.ts';

interface DefNumero {
  tipo: 'numero';
  url: string;
  padrao: number;
  min: number;
  max: number;
  inteiro?: boolean;
}
interface DefBooleano {
  tipo: 'booleano';
  url: string;
  padrao: boolean;
}
type Def = DefNumero | DefBooleano;

export const PARAMETROS = {
  tamanhoMm: { tipo: 'numero', url: 't', padrao: 150, min: 20, max: 400 },
  exagero: { tipo: 'numero', url: 'e', padrao: 1.5, min: 1, max: 5 },
  baseMm: { tipo: 'numero', url: 'b', padrao: 3, min: 0.6, max: 30 },
  resolucao: { tipo: 'numero', url: 'r', padrao: 300, min: 50, max: 600, inteiro: true },
  achatarMar: { tipo: 'booleano', url: 'm', padrao: true },
} as const satisfies Record<string, Def>;

export type NomeParametro = keyof typeof PARAMETROS;
export type Parametros = {
  [K in NomeParametro]: (typeof PARAMETROS)[K] extends DefBooleano ? boolean : number;
};

export interface Estado {
  forma: Forma | null;
  /** nome do lugar (para o nome do arquivo) */
  nome: string;
  params: Parametros;
}

export function parametrosPadrao(): Parametros {
  const p = {} as Record<string, number | boolean>;
  for (const [nome, def] of Object.entries(PARAMETROS)) p[nome] = def.padrao;
  return p as Parametros;
}

/** Garante que o valor respeita os limites; valores inválidos voltam ao padrão. */
export function validarParametro(nome: NomeParametro, valor: unknown): number | boolean {
  const def: Def = PARAMETROS[nome];
  if (def.tipo === 'booleano') {
    if (typeof valor === 'boolean') return valor;
    if (valor === '1' || valor === 'true') return true;
    if (valor === '0' || valor === 'false') return false;
    return def.padrao;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (typeof valor === 'string' && valor.trim() === '') return def.padrao;
  if (!Number.isFinite(n)) return def.padrao;
  const limitado = Math.min(def.max, Math.max(def.min, n));
  return def.inteiro ? Math.round(limitado) : limitado;
}

// ---------- formas ----------
const fmt = (n: number, casas: number) => String(Number(n.toFixed(casas)));
const coord = (p: LonLat) => `${fmt(p[0], 6)},${fmt(p[1], 6)}`;

export function formaParaTexto(f: Forma): string {
  switch (f.tipo) {
    case 'retangulo':
      return `r:${fmt(f.oeste, 6)},${fmt(f.sul, 6)},${fmt(f.leste, 6)},${fmt(f.norte, 6)}`;
    case 'circulo':
      return `c:${coord(f.centro)},${fmt(f.raioM, 1)}`;
    case 'hexagono':
      return `h:${coord(f.centro)},${fmt(f.raioM, 1)},${fmt(f.rotacaoGraus, 1)}`;
    case 'poligono':
      return `p:${f.pontos.map(coord).join(';')}`;
  }
}

const lonValida = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;
const latValida = (n: number) => Number.isFinite(n) && n >= -85 && n <= 85;

export function textoParaForma(texto: string): Forma | null {
  const [tipo, resto] = [texto.slice(0, 1), texto.slice(2)];
  if (texto[1] !== ':') return null;
  const nums = resto.split(',').map(Number);
  switch (tipo) {
    case 'r': {
      const [oeste, sul, leste, norte] = nums;
      if (nums.length !== 4 || ![oeste, leste].every(lonValida) || ![sul, norte].every(latValida)) return null;
      if (!(leste > oeste && norte > sul)) return null;
      return { tipo: 'retangulo', oeste, sul, leste, norte };
    }
    case 'c':
    case 'h': {
      const [lon, lat, raioM, rot = 0] = nums;
      if (nums.length !== (tipo === 'c' ? 3 : 4) || !lonValida(lon) || !latValida(lat)) return null;
      if (!(raioM > 0 && raioM < 2_000_000) || !Number.isFinite(rot)) return null;
      return tipo === 'c'
        ? { tipo: 'circulo', centro: [lon, lat], raioM }
        : { tipo: 'hexagono', centro: [lon, lat], raioM, rotacaoGraus: rot };
    }
    case 'p': {
      const pontos = resto.split(';').map((s) => s.split(',').map(Number) as LonLat);
      if (pontos.length < 3 || pontos.some((p) => p.length !== 2 || !lonValida(p[0]) || !latValida(p[1]))) return null;
      return { tipo: 'poligono', pontos };
    }
  }
  return null;
}

// ---------- URL ----------
const codificar = (v: string) =>
  encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3B/g, ';').replace(/%3A/g, ':');

/** Gera o trecho depois do "#" da URL. Só entram valores diferentes do padrão. */
export function estadoParaUrl(e: Estado): string {
  const partes: string[] = [];
  if (e.forma) partes.push(`a=${codificar(formaParaTexto(e.forma))}`);
  if (e.nome) partes.push(`n=${codificar(e.nome)}`);
  for (const [nome, def] of Object.entries(PARAMETROS) as [NomeParametro, Def][]) {
    const v = e.params[nome];
    if (v === def.padrao) continue;
    partes.push(`${def.url}=${typeof v === 'boolean' ? (v ? '1' : '0') : fmt(v, 3)}`);
  }
  return partes.join('&');
}

export function urlParaEstado(hash: string): Estado {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const params = parametrosPadrao() as Record<NomeParametro, number | boolean>;
  for (const [nome, def] of Object.entries(PARAMETROS) as [NomeParametro, Def][]) {
    const v = q.get(def.url);
    if (v !== null) params[nome] = validarParametro(nome, v);
  }
  const a = q.get('a');
  return {
    forma: a ? textoParaForma(a) : null,
    nome: (q.get('n') ?? '').slice(0, 100),
    params: params as Parametros,
  };
}
