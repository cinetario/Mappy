import { describe, expect, it } from 'vitest';
import { areaAssinada2D, montarTerra, type P } from '../src/core/costa.ts';

const caixa = { x0: 0, y0: 0, x1: 10, y1: 10 };
const areaTerra = (cadeias: P[][]) => {
  const r = montarTerra(cadeias, caixa);
  return { ...r, area: r.terra.reduce((s, a) => s + areaAssinada2D(a), 0) };
};

describe('linha de costa → terra e mar', () => {
  it('costa reta para o norte: terra a oeste (esquerda)', () => {
    const r = areaTerra([[[5, -5], [5, 15]]]);
    expect(r.situacao).toBe('terra-recortada');
    expect(r.area).toBeCloseTo(50);
    // todos os anéis anti-horários
    for (const a of r.terra) expect(areaAssinada2D(a)).toBeGreaterThan(0);
  });

  it('mesma costa para o sul: terra a leste', () => {
    const r = areaTerra([[[5, 15], [5, -5]]]);
    expect(r.area).toBeCloseTo(50);
    expect(Math.max(...r.terra[0].map((p) => p[0]))).toBe(10);
  });

  it('costa que entra pelo sul e sai pelo leste', () => {
    const r = areaTerra([[[5, -5], [5, 5], [15, 5]]]);
    expect(r.area).toBeCloseTo(75);
  });

  it('baía em U aberta para o sul: mar dentro do U', () => {
    const r = areaTerra([[[2, -5], [2, 5], [8, 5], [8, -5]]]);
    expect(r.area).toBeCloseTo(70);
  });

  it('costa que cruza o canto (0,0) ao fechar', () => {
    // entra pelo norte e sai pelo sul indo para baixo; terra a leste
    const r = areaTerra([[[3, 15], [3, -5]]]);
    expect(r.area).toBeCloseTo(70);
  });

  it('duas costas separadas (estreito com mar no meio)', () => {
    // costa em x=3 descendo (esquerda = leste) e em x=7 subindo (esquerda = oeste):
    // terra entre 3 e 7, mar nas duas laterais

    const r = areaTerra([[[3, 15], [3, -5]], [[7, -5], [7, 15]]]);
    expect(r.area).toBeCloseTo(40);
  });

  it('ilha inteira dentro da caixa: o resto é mar', () => {
    const r = areaTerra([[[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]]);
    expect(r.situacao).toBe('ilhas');
    expect(r.area).toBeCloseTo(4);
  });

  it('sem costa: sem mar', () => {
    expect(montarTerra([], caixa).situacao).toBe('sem-costa');
  });

  it('costa que termina dentro da caixa é marcada como incompleta', () => {
    const r = montarTerra([[[5, -5], [5, 5]]], caixa);
    expect(r.incompleta).toBe(true);
  });
});
