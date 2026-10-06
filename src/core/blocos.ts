// Divisão da área em blocos para consultar o Overpass.
// Os blocos seguem uma grade fixa (0,04° ≈ 4 km), então mover ou ajustar a
// área reaproveita o cache dos blocos já baixados.
import type { Retangulo } from './geo.ts';

export interface Bloco {
  s: number;
  w: number;
  n: number;
  e: number;
}

export const TAMANHO_BLOCO = 0.04;
/** quantas vezes um bloco pode ser dividido em 4 quando o Overpass não dá conta */
export const DIVISOES_MAXIMAS = 3;

const arred = (v: number) => Math.round(v * 1e6) / 1e6;

export function blocosDaArea(r: Retangulo, tamanho = TAMANHO_BLOCO): Bloco[] {
  const blocos: Bloco[] = [];
  const i0 = Math.floor(r.sul / tamanho);
  const i1 = Math.floor(r.norte / tamanho);
  const j0 = Math.floor(r.oeste / tamanho);
  const j1 = Math.floor(r.leste / tamanho);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      blocos.push({ s: arred(i * tamanho), n: arred((i + 1) * tamanho), w: arred(j * tamanho), e: arred((j + 1) * tamanho) });
    }
  }
  return blocos;
}

export function dividirEm4(b: Bloco): Bloco[] {
  const ms = arred((b.s + b.n) / 2);
  const mw = arred((b.w + b.e) / 2);
  return [
    { s: b.s, w: b.w, n: ms, e: mw },
    { s: b.s, w: mw, n: ms, e: b.e },
    { s: ms, w: b.w, n: b.n, e: mw },
    { s: ms, w: mw, n: b.n, e: b.e },
  ];
}

/** Resposta de um bloco: os dados, ou "dividir" quando o Overpass esgotou o tempo. */
export type ResultadoBloco<T> = { dados: T } | 'dividir';

/**
 * Baixa todos os blocos (até `simultaneos` ao mesmo tempo), dividindo em 4 os
 * que o Overpass não consegue responder. `aoProgredir` recebe (feitos, total).
 */
export async function baixarBlocos<T>(
  blocos: Bloco[],
  baixar: (b: Bloco) => Promise<ResultadoBloco<T>>,
  aoProgredir: (feitos: number, total: number) => void = () => {},
  simultaneos = 2,
): Promise<T[]> {
  const fila: { b: Bloco; nivel: number }[] = blocos.map((b) => ({ b, nivel: 0 }));
  const resultados: T[] = [];
  let total = fila.length;
  let feitos = 0;
  aoProgredir(0, total);
  const trabalhador = async () => {
    for (let item = fila.shift(); item; item = fila.shift()) {
      const r = await baixar(item.b);
      if (r === 'dividir') {
        if (item.nivel >= DIVISOES_MAXIMAS) {
          throw new Error('O OpenStreetMap tem dados demais nesta região mesmo em blocos pequenos. Reduza a área ou desligue camadas.');
        }
        const filhos = dividirEm4(item.b).map((b) => ({ b, nivel: item.nivel + 1 }));
        fila.push(...filhos);
        total += filhos.length - 1;
      } else {
        resultados.push(r.dados);
        feitos++;
      }
      aoProgredir(feitos, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneos, fila.length) }, trabalhador));
  return resultados;
}
