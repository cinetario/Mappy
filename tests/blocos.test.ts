import { describe, expect, it } from 'vitest';
import { baixarBlocos, blocosDaArea, dividirEm4, type Bloco } from '../src/core/blocos.ts';

describe('blocos do Overpass', () => {
  it('grade fixa: área pequena cai em 1 a 4 blocos, sempre alinhados', () => {
    const b = blocosDaArea({ oeste: -43.17, sul: -22.96, leste: -43.15, norte: -22.94 });
    expect(b.length).toBeGreaterThanOrEqual(1);
    expect(b.length).toBeLessThanOrEqual(4);
    for (const x of b) {
      expect(Math.abs((x.s / 0.04) - Math.round(x.s / 0.04))).toBeLessThan(1e-6);
      expect(x.n - x.s).toBeCloseTo(0.04);
    }
    // mover um pouco a área reaproveita os mesmos blocos
    const b2 = blocosDaArea({ oeste: -43.169, sul: -22.959, leste: -43.151, norte: -22.941 });
    expect(b2).toEqual(b);
  });

  it('dividir em 4 cobre o bloco sem sobras', () => {
    const f = dividirEm4({ s: 0, w: 0, n: 0.04, e: 0.04 });
    const area = f.reduce((s, x) => s + (x.n - x.s) * (x.e - x.w), 0);
    expect(area).toBeCloseTo(0.0016);
  });

  it('bloco que esgota o tempo é dividido e o progresso chega ao total', async () => {
    const tamanho = (b: Bloco) => b.n - b.s;
    const progresso: [number, number][] = [];
    const r = await baixarBlocos(
      [{ s: 0, w: 0, n: 0.04, e: 0.04 }, { s: 0, w: 0.04, n: 0.04, e: 0.08 }],
      async (b) => (b.w === 0 && tamanho(b) > 0.03 ? 'dividir' : { dados: tamanho(b) }),
      (f, t) => progresso.push([f, t]),
    );
    expect(r.sort()).toEqual([0.02, 0.02, 0.02, 0.02, 0.04]);
    expect(progresso.at(-1)).toEqual([5, 5]);
  });

  it('desiste depois de dividir demais', async () => {
    await expect(baixarBlocos([{ s: 0, w: 0, n: 0.04, e: 0.04 }], async () => 'dividir' as const)).rejects.toThrow(/Reduza a área/);
  });
});
