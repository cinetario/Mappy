// Regras que dependem do tamanho da área e da escala de impressão.

/** Largura mínima imprimível: 2 linhas de extrusão com bico de 0,4 mm. */
export const LARGURA_MINIMA_MM = 0.8;
/** Largura real usada para "rua local" (residencial / de bairro). */
export const LARGURA_RUA_LOCAL_M = 4;

/** Até aqui: tudo liberado. */
export const AREA_LIVRE_KM2 = 25;
/** Até aqui: funciona, mas lento e com detalhes urbanos finos demais. */
export const AREA_GRANDE_KM2 = 100;
/** Acima disso a projeção local distorce demais. */
export const AREA_MAXIMA_KM2 = 250_000;

export type FaixaArea = 'livre' | 'grande' | 'muito-grande';

export function classificarArea(km2: number): FaixaArea {
  if (km2 <= AREA_LIVRE_KM2) return 'livre';
  if (km2 <= AREA_GRANDE_KM2) return 'grande';
  return 'muito-grande';
}

/** Prédios e ruas vêm ligados por padrão? (o usuário pode ligar manualmente) */
export function camadasUrbanasPorPadrao(km2: number): boolean {
  return classificarArea(km2) !== 'muito-grande';
}

export interface LarguraImpressa {
  /** largura na escala real, em mm */
  realMm: number;
  /** largura que vai para o modelo (nunca abaixo do mínimo imprimível) */
  impressaMm: number;
  /** quantos metros reais a largura impressa representa */
  impressaEmMetros: number;
  engrossada: boolean;
}

export function larguraImpressa(larguraRealM: number, mmPorMetro: number, escalaLargura = 1): LarguraImpressa {
  const realMm = larguraRealM * escalaLargura * mmPorMetro;
  const impressaMm = Math.max(realMm, LARGURA_MINIMA_MM);
  return { realMm, impressaMm, impressaEmMetros: impressaMm / mmPorMetro, engrossada: realMm < LARGURA_MINIMA_MM };
}

/** Lado maior (m) até o qual uma via de `larguraRealM` fica imprimível sem engrossar. */
export function ladoMaximoSemEngrossarM(larguraRealM: number, tamanhoMm: number): number {
  return (larguraRealM * tamanhoMm) / LARGURA_MINIMA_MM;
}
