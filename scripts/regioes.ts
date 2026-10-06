// Regiões prontas para os comandos (caixa oeste, sul, leste, norte com uma pequena folga).
export const REGIOES: Record<string, { nome: string; caixa: [number, number, number, number] }> = {
  df: { nome: 'Distrito Federal', caixa: [-48.30, -16.07, -47.29, -15.48] },
};

/** "df" ou "oeste,sul,leste,norte" → região; null se não entender. */
export function lerRegiao(arg: string | undefined): { id: string; nome: string; caixa: [number, number, number, number] } | null {
  if (!arg) return null;
  const chave = arg.toLowerCase();
  if (REGIOES[chave]) return { id: chave, ...REGIOES[chave] };
  const v = arg.split(',').map(Number);
  if (v.length !== 4 || v.some((x) => !Number.isFinite(x)) || v[0] >= v[2] || v[1] >= v[3]) return null;
  return { id: v.map((x) => x.toFixed(2)).join('_'), nome: arg, caixa: v as [number, number, number, number] };
}
