import { describe, expect, it } from 'vitest';
import { intervaloAutomatico, niveis, tracarCurvas } from '../src/core/curvas.ts';

describe('curvas de nível', () => {
  it('intervalo automático "redondo"', () => {
    expect(intervaloAutomatico(1070, 1170)).toBe(10); // 100 m → 10 linhas
    expect(intervaloAutomatico(0, 326)).toBe(25);
    expect(intervaloAutomatico(0, 3000)).toBe(200);
    expect(intervaloAutomatico(5, 7)).toBe(1);
  });

  it('níveis estritamente dentro da faixa', () => {
    expect(niveis(1070, 1170, 10)).toEqual([1080, 1090, 1100, 1110, 1120, 1130, 1140, 1150, 1160]);
    expect(niveis(0, 30, 10)).toEqual([10, 20]);
  });

  it('morro redondo: uma curva fechada por nível, no raio certo', () => {
    const n = 41;
    const v = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = 100 - Math.hypot(i - 20, j - 20) * 5; // cone
    const linhas = tracarCurvas(v, n, n, 50); // raio 10
    expect(linhas).toHaveLength(1);
    const l = linhas[0];
    expect(l[0]).toEqual(l[l.length - 1]); // fechada
    for (const [x, y] of l) expect(Math.hypot(x - 20, y - 20)).toBeCloseTo(10, 0);
  });

  it('rampa: uma linha aberta de borda a borda', () => {
    const nx = 10, ny = 6;
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = i * 10; // sobe para leste
    const linhas = tracarCurvas(v, nx, ny, 45);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toHaveLength(ny);
    for (const [x] of linhas[0]) expect(x).toBeCloseTo(4.5, 6);
  });

  it('dois morros: duas curvas separadas', () => {
    const nx = 40, ny = 20;
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        v[j * nx + i] = Math.max(50 - Math.hypot(i - 10, j - 10) * 8, 50 - Math.hypot(i - 30, j - 10) * 8);
      }
    }
    expect(tracarCurvas(v, nx, ny, 20)).toHaveLength(2);
  });
});
