// Alinhamento de alturas às camadas de impressão.
// O fatiador corta em alturas absolutas: 1ª camada em h1, depois h1 + h, h1 + 2h…
// Uma troca de cor (ou o topo plano de um prédio) só fica limpa se cair
// exatamente numa dessas alturas.

export interface GradeCamadas {
  /** altura de cada camada, em mm */
  h: number;
  /** altura da primeira camada, em mm */
  h1: number;
}

/** Altura válida mais próxima de `z` (nunca abaixo da primeira camada). */
export function alinharZ(z: number, g: GradeCamadas): number {
  if (z <= g.h1) return g.h1;
  // o 1e-9 faz empates (ex.: 1,0 entre 0,9 e 1,1) sempre subirem, apesar do erro de ponto flutuante
  const k = Math.round((z - g.h1) / g.h + 1e-9);
  return arredondar(g.h1 + k * g.h);
}

/** Espessura (não posição) arredondada para múltiplo da camada, mínimo 1 camada. */
export function alinharEspessura(e: number, g: GradeCamadas): number {
  return arredondar(Math.max(1, Math.round(e / g.h)) * g.h);
}

export function estaAlinhado(z: number, g: GradeCamadas, tolerancia = 1e-4): boolean {
  if (Math.abs(z - g.h1) < tolerancia) return true;
  const k = (z - g.h1) / g.h;
  return k > 0 && Math.abs(k - Math.round(k)) * g.h < tolerancia;
}

// evita 0.6000000000000001 nos números exibidos e nas comparações
const arredondar = (v: number) => Math.round(v * 1e6) / 1e6;
