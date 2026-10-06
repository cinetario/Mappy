// Geografia básica: formas de seleção, medidas em metros, projeção local
// para milímetros e matemática de tiles (Web Mercator).

export type LonLat = [number, number];

export interface Retangulo {
  oeste: number;
  sul: number;
  leste: number;
  norte: number;
}

/** Área escolhida no mapa. O contorno dela vira o contorno do modelo 3D. */
export type Forma =
  | ({ tipo: 'retangulo' } & Retangulo)
  | { tipo: 'circulo'; centro: LonLat; raioM: number }
  | { tipo: 'hexagono'; centro: LonLat; raioM: number; rotacaoGraus: number }
  | { tipo: 'poligono'; pontos: LonLat[] };

export const RAIO_TERRA_M = 6378137;
const GRAU = Math.PI / 180;
const SEGMENTOS_CIRCULO = 96;

export function normalizarRetangulo(a: LonLat, b: LonLat): Retangulo {
  return {
    oeste: Math.min(a[0], b[0]),
    leste: Math.max(a[0], b[0]),
    sul: Math.min(a[1], b[1]),
    norte: Math.max(a[1], b[1]),
  };
}

/** Converte um deslocamento em metros (leste, norte) a partir de `origem` em lon/lat. */
export function deslocar(origem: LonLat, dxM: number, dyM: number): LonLat {
  return [
    origem[0] + dxM / (RAIO_TERRA_M * GRAU * Math.cos(origem[1] * GRAU)),
    origem[1] + dyM / (RAIO_TERRA_M * GRAU),
  ];
}

/** Distância aproximada em metros (projeção local), boa para alguns km. */
export function distanciaM(a: LonLat, b: LonLat): number {
  const latM = ((a[1] + b[1]) / 2) * GRAU;
  return Math.hypot((b[0] - a[0]) * GRAU * RAIO_TERRA_M * Math.cos(latM), (b[1] - a[1]) * GRAU * RAIO_TERRA_M);
}

/** Ângulo (graus, anti-horário a partir do leste) de `b` visto de `a`. */
export function anguloGraus(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * Math.cos(a[1] * GRAU);
  const dy = b[1] - a[1];
  return Math.atan2(dy, dx) / GRAU;
}

/** Contorno da forma em lon/lat, sem repetir o primeiro ponto no fim. */
export function contornoLonLat(f: Forma): LonLat[] {
  switch (f.tipo) {
    case 'retangulo':
      return [[f.oeste, f.sul], [f.leste, f.sul], [f.leste, f.norte], [f.oeste, f.norte]];
    case 'circulo':
    case 'hexagono': {
      const n = f.tipo === 'circulo' ? SEGMENTOS_CIRCULO : 6;
      const rot = f.tipo === 'hexagono' ? f.rotacaoGraus * GRAU : 0;
      const r: LonLat[] = [];
      for (let k = 0; k < n; k++) {
        const a = rot + (2 * Math.PI * k) / n;
        r.push(deslocar(f.centro, f.raioM * Math.cos(a), f.raioM * Math.sin(a)));
      }
      return r;
    }
    case 'poligono':
      return f.pontos.slice();
  }
}

export function caixaDaForma(f: Forma): Retangulo {
  if (f.tipo === 'retangulo') return { oeste: f.oeste, sul: f.sul, leste: f.leste, norte: f.norte };
  const c = contornoLonLat(f);
  const r = { oeste: Infinity, sul: Infinity, leste: -Infinity, norte: -Infinity };
  for (const [lon, lat] of c) {
    r.oeste = Math.min(r.oeste, lon);
    r.leste = Math.max(r.leste, lon);
    r.sul = Math.min(r.sul, lat);
    r.norte = Math.max(r.norte, lat);
  }
  return r;
}

/**
 * Largura (leste-oeste) e altura (norte-sul) do retângulo em metros, usando
 * uma projeção local equirretangular centrada na área. Para áreas de alguns
 * km o erro é desprezível na escala de impressão.
 */
export function dimensoesMetros(r: Retangulo): { largura: number; altura: number } {
  const latCentro = ((r.norte + r.sul) / 2) * GRAU;
  return {
    largura: (r.leste - r.oeste) * GRAU * RAIO_TERRA_M * Math.cos(latCentro),
    altura: (r.norte - r.sul) * GRAU * RAIO_TERRA_M,
  };
}

/**
 * Projeção local: lon/lat → metros com origem no centro da caixa.
 * Todas as partes do modelo usam a mesma projeção, para encaixarem.
 */
export function criarProjecao(caixa: Retangulo) {
  const lon0 = (caixa.oeste + caixa.leste) / 2;
  const lat0 = (caixa.sul + caixa.norte) / 2;
  const kx = GRAU * RAIO_TERRA_M * Math.cos(lat0 * GRAU);
  const ky = GRAU * RAIO_TERRA_M;
  return {
    centro: [lon0, lat0] as LonLat,
    paraMetros: ([lon, lat]: LonLat): [number, number] => [(lon - lon0) * kx, (lat - lat0) * ky],
  };
}

/** Área em m² (fórmula do laço sobre a projeção local). */
export function areaM2(f: Forma): number {
  const proj = criarProjecao(caixaDaForma(f));
  return Math.abs(areaAssinada(contornoLonLat(f).map(proj.paraMetros)));
}

/** Área com sinal: positiva quando os pontos estão em sentido anti-horário. */
export function areaAssinada(pts: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x1, y1] = pts[k];
    const [x2, y2] = pts[(k + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** true se algum par de lados não vizinhos do polígono se cruza. */
export function poligonoSeCruza(pts: readonly LonLat[]): boolean {
  const n = pts.length;
  const cruza = (a: LonLat, b: LonLat, c: LonLat, d: LonLat) => {
    const o = (p: LonLat, q: LonLat, r: LonLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // lados vizinhos (fecham o polígono)
      if (cruza(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Posição em pixels "globais" (tiles de 256 px) no zoom z. */
export function lonLatParaPixel(lon: number, lat: number, z: number): [number, number] {
  const escala = 256 * 2 ** z;
  const latLimitada = Math.max(-85.0511, Math.min(85.0511, lat)) * GRAU;
  const x = ((lon + 180) / 360) * escala;
  const y = ((1 - Math.log(Math.tan(latLimitada) + 1 / Math.cos(latLimitada)) / Math.PI) / 2) * escala;
  return [x, y];
}

/** Metros por pixel no zoom z, na latitude dada. */
export function metrosPorPixel(lat: number, z: number): number {
  return (2 * Math.PI * RAIO_TERRA_M * Math.cos(lat * GRAU)) / (256 * 2 ** z);
}

export function formatarCoordenadas(r: Retangulo): string {
  const lat = (r.norte + r.sul) / 2;
  const lon = (r.leste + r.oeste) / 2;
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'L' : 'O'}`;
}
