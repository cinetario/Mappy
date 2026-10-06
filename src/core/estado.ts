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
interface DefOpcao<T extends string = string> {
  tipo: 'opcao';
  url: string;
  padrao: T;
  opcoes: readonly T[];
}
interface DefTexto {
  tipo: 'texto';
  url: string;
  padrao: string;
  /** devolve o texto normalizado, ou null se for inválido */
  validar: (v: string) => string | null;
}
type Def = DefNumero | DefBooleano | DefOpcao | DefTexto;

const cor = (padrao: string): DefTexto & { cor: true } => ({ tipo: 'texto', url: '', padrao, validar: validarCor, cor: true });
const opcao = <T extends string>(url: string, opcoes: readonly T[], padrao: T): DefOpcao<T> => ({ tipo: 'opcao', url, padrao, opcoes });

export const PARAMETROS = {
  // ----- Dimensões -----
  modo: opcao('mo', ['impressao', 'real'] as const, 'impressao'),
  tamanhoMm: { tipo: 'numero', url: 't', padrao: 220, min: 20, max: 400 },
  travarAltura: { tipo: 'booleano', url: 'ta', padrao: false },
  alturaTotalMm: { tipo: 'numero', url: 'at', padrao: 17, min: 2, max: 250 },
  unidades: opcao('u', ['metrico', 'imperial'] as const, 'metrico'),
  // ----- Terreno -----
  exagero: { tipo: 'numero', url: 'e', padrao: 1, min: 0.5, max: 10 },
  fonte: opcao('f', ['mapterhorn', 'copernicus', 'terrarium'] as const, 'mapterhorn'),
  /** 0 = automático */
  zoom: { tipo: 'numero', url: 'z', padrao: 0, min: 0, max: 17, inteiro: true },
  resolucao: { tipo: 'numero', url: 'r', padrao: 300, min: 50, max: 800, inteiro: true },
  /** erro máximo da triangulação adaptativa, em mm; 0 = grade uniforme */
  simplificacaoMm: { tipo: 'numero', url: 'si', padrao: 0.05, min: 0, max: 0.5 },
  achatarMar: { tipo: 'booleano', url: 'm', padrao: true },
  // ----- Estilo do terreno -----
  estilo: opcao('es', ['solido', 'faixas'] as const, 'solido'),
  corTerreno: { ...cor('#c9b98f'), url: 'ct' },
  faixas: { tipo: 'texto', url: 'fx', padrao: '40:4f8a3c,75:8c8c8c,100:ffffff', validar: validarFaixasTexto },
  // ----- Base e laterais -----
  baseMm: { tipo: 'numero', url: 'b', padrao: 2, min: 0.2, max: 30 },
  corLaterais: { ...cor('#c9b98f'), url: 'cl' },
  // ----- Impressão -----
  alturaCamadaMm: { tipo: 'numero', url: 'hc', padrao: 0.2, min: 0.04, max: 0.6 },
  primeiraCamadaMm: { tipo: 'numero', url: 'h1', padrao: 0.2, min: 0.04, max: 0.8 },
} as const satisfies Record<string, Def>;

export type NomeParametro = keyof typeof PARAMETROS;
type ValorDe<D> = D extends DefBooleano ? boolean : D extends DefNumero ? number : D extends DefOpcao<infer T> ? T : string;
export type Parametros = { -readonly [K in NomeParametro]: ValorDe<(typeof PARAMETROS)[K]> };
export type Valor = number | boolean | string;

export interface Estado {
  forma: Forma | null;
  /** nome do lugar (para o nome do arquivo) */
  nome: string;
  params: Parametros;
}

export function parametrosPadrao(): Parametros {
  const p = {} as Record<string, Valor>;
  for (const [nome, def] of Object.entries(PARAMETROS)) p[nome] = def.padrao;
  return p as Parametros;
}

/** Garante que o valor respeita os limites; valores inválidos voltam ao padrão. */
export function validarParametro(nome: NomeParametro, valor: unknown): Valor {
  const def: Def = PARAMETROS[nome];
  switch (def.tipo) {
    case 'booleano':
      if (typeof valor === 'boolean') return valor;
      if (valor === '1' || valor === 'true') return true;
      if (valor === '0' || valor === 'false') return false;
      return def.padrao;
    case 'opcao':
      return def.opcoes.includes(valor as string) ? (valor as string) : def.padrao;
    case 'texto':
      return typeof valor === 'string' ? (def.validar(valor) ?? def.padrao) : def.padrao;
    case 'numero': {
      if (typeof valor === 'string' && valor.trim() === '') return def.padrao;
      const n = typeof valor === 'number' ? valor : Number(valor);
      if (!Number.isFinite(n)) return def.padrao;
      const limitado = Math.min(def.max, Math.max(def.min, n));
      return def.inteiro ? Math.round(limitado) : limitado;
    }
  }
}

export function definicao(nome: NomeParametro): Def {
  return PARAMETROS[nome];
}

// ---------- presets ----------
export type NomePreset = 'soTerreno' | 'topografico' | 'impressao3d';

export const PRESETS: Record<NomePreset, { rotulo: string; dica: string; params: Partial<Parametros> }> = {
  soTerreno: {
    rotulo: 'Só terreno',
    dica: 'Relevo em uma cor, exagero leve',
    params: { estilo: 'solido', exagero: 1.5, travarAltura: false },
  },
  topografico: {
    rotulo: 'Topográfico',
    dica: 'Faixas de cor por altitude e relevo mais marcado',
    params: { estilo: 'faixas', exagero: 2, travarAltura: false },
  },
  impressao3d: {
    rotulo: 'Impressão 3D',
    dica: 'Cabe na Snapmaker U1, altura travada em 17 mm, alturas alinhadas às camadas',
    params: { modo: 'impressao', tamanhoMm: 220, travarAltura: true, alturaTotalMm: 17, baseMm: 2, alturaCamadaMm: 0.2, primeiraCamadaMm: 0.2, simplificacaoMm: 0.05 },
  },
};

export function aplicarPreset(atual: Parametros, preset: NomePreset): Parametros {
  return { ...atual, ...PRESETS[preset].params };
}

// ---------- cores e faixas ----------
export function validarCor(v: string): string | null {
  const s = v.trim().replace(/^#/, '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export interface Faixa {
  /** limite superior da faixa, em % da altura do relevo (1–100) */
  ate: number;
  cor: string;
}

export const MAX_FAIXAS = 8;

/** "40:4f8a3c,75:8c8c8c,100:ffffff" → faixas em ordem crescente, a última sempre em 100%. */
export function lerFaixas(texto: string): Faixa[] | null {
  const partes = texto.split(',').map((p) => p.trim()).filter(Boolean);
  if (partes.length === 0 || partes.length > MAX_FAIXAS) return null;
  const faixas: Faixa[] = [];
  for (const p of partes) {
    const [pct, c] = p.split(':');
    const ate = Math.round(Number(pct));
    const corOk = validarCor(c ?? '');
    if (!Number.isFinite(ate) || ate < 1 || ate > 100 || !corOk) return null;
    faixas.push({ ate, cor: corOk });
  }
  faixas.sort((a, b) => a.ate - b.ate);
  for (let k = 1; k < faixas.length; k++) if (faixas[k].ate === faixas[k - 1].ate) return null;
  faixas[faixas.length - 1].ate = 100;
  return faixas;
}

export function escreverFaixas(f: Faixa[]): string {
  return f.map((x) => `${x.ate}:${x.cor.replace('#', '')}`).join(',');
}

function validarFaixasTexto(v: string): string | null {
  const f = lerFaixas(v);
  return f ? escreverFaixas(f) : null;
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
    const texto = typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'number' ? fmt(v, 3) : v.replace(/^#/, '');
    partes.push(`${def.url}=${codificar(texto)}`);
  }
  return partes.join('&');
}

export function urlParaEstado(hash: string): Estado {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const params = parametrosPadrao() as Record<NomeParametro, Valor>;
  for (const [nome, def] of Object.entries(PARAMETROS) as [NomeParametro, Def][]) {
    const v = q.get(def.url);
    if (v !== null) params[nome] = validarParametro(nome, def.tipo === 'texto' && 'cor' in def ? `#${v}` : v);
  }
  const a = q.get('a');
  return {
    forma: a ? textoParaForma(a) : null,
    nome: (q.get('n') ?? '').slice(0, 100),
    params: params as Parametros,
  };
}
