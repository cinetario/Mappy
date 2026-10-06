import { describe, expect, it } from 'vitest';
import { camadasUrbanasPorPadrao, classificarArea, ladoMaximoSemEngrossarM, larguraImpressa } from '../src/core/limites.ts';

describe('limites por tamanho de área', () => {
  it('classifica as faixas nos limites exatos', () => {
    expect(classificarArea(0.5)).toBe('livre');
    expect(classificarArea(25)).toBe('livre');
    expect(classificarArea(25.01)).toBe('grande');
    expect(classificarArea(100)).toBe('grande');
    expect(classificarArea(100.01)).toBe('muito-grande');
  });

  it('prédios e ruas desligados por padrão só acima de 100 km²', () => {
    expect(camadasUrbanasPorPadrao(99)).toBe(true);
    expect(camadasUrbanasPorPadrao(101)).toBe(false);
  });

  it('largura impressa da rua local', () => {
    // 220 mm para 5 km → 0,044 mm/m → rua de 4 m = 0,176 mm, engrossada para 0,8 mm
    const l = larguraImpressa(4, 220 / 5000);
    expect(l.realMm).toBeCloseTo(0.176, 3);
    expect(l.impressaMm).toBe(0.8);
    expect(l.engrossada).toBe(true);
    expect(l.impressaEmMetros).toBeCloseTo(18.18, 1);
    // área pequena: 220 mm para 800 m → 1,1 mm, sem engrossar
    expect(larguraImpressa(4, 220 / 800).engrossada).toBe(false);
  });

  it('lado máximo para uma rua de 4 m sair na largura real com 220 mm', () => {
    expect(ladoMaximoSemEngrossarM(4, 220)).toBe(1100);
  });
});
