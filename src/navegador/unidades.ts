// Formatação de medidas para exibição (métrico ou imperial).
// Os arquivos exportados são sempre em mm (ou m no modo 1:1).
export type Sistema = 'metrico' | 'imperial';

const num = (v: number, casas: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Medida do modelo impresso (entrada em mm). */
export function medidaModelo(mm: number, s: Sistema, casas = 1): string {
  return s === 'imperial' ? `${num(mm / 25.4, casas + 1)} pol` : `${num(mm, casas)} mm`;
}

/** Distância no mundo real (entrada em metros). */
export function distancia(m: number, s: Sistema): string {
  if (s === 'imperial') {
    const pes = m / 0.3048;
    return pes >= 5280 ? `${num(pes / 5280, 2)} mi` : `${num(Math.round(pes), 0)} pés`;
  }
  return m >= 1000 ? `${num(m / 1000, 2)} km` : `${num(Math.round(m), 0)} m`;
}

export function altitude(m: number, s: Sistema): string {
  return s === 'imperial' ? `${num(Math.round(m / 0.3048), 0)} pés` : `${num(Math.round(m), 0)} m`;
}

export function area(km2: number, s: Sistema): string {
  const v = s === 'imperial' ? km2 / 2.589988 : km2;
  const u = s === 'imperial' ? 'mi²' : 'km²';
  return `${v < 10 ? num(v, 2) : num(Math.round(v), 0)} ${u}`;
}

export function inteiro(v: number): string {
  return num(Math.round(v), 0);
}

export function decimal(v: number, casas = 1): string {
  return num(v, casas);
}

/** Tamanho de arquivo legível. */
export function bytes(b: number): string {
  if (b < 1024 * 1024) return `${num(b / 1024, 0)} KB`;
  return `${num(b / 1024 / 1024, 1)} MB`;
}
