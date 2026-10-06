// Geografia básica: retângulos em longitude/latitude, medidas em metros
// e matemática de tiles (Web Mercator, tiles de 256 px).

export interface Retangulo {
  oeste: number;
  sul: number;
  leste: number;
  norte: number;
}

export const RAIO_TERRA_M = 6378137;
const GRAU = Math.PI / 180;

export function normalizarRetangulo(a: [number, number], b: [number, number]): Retangulo {
  return {
    oeste: Math.min(a[0], b[0]),
    leste: Math.max(a[0], b[0]),
    sul: Math.min(a[1], b[1]),
    norte: Math.max(a[1], b[1]),
  };
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
