import { describe, expect, it } from 'vitest';
import type { GradeElevacao } from '../src/core/elevacao.ts';
import { areaM2, caixaDaForma, contornoLonLat, dimensoesMetros, poligonoSeCruza, type Forma } from '../src/core/geo.ts';
import { carregarManifold, validarComManifold } from '../src/core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../src/core/modelo.ts';
import { verificarMalha } from '../src/core/verificacao.ts';
import { aplicarArraste } from '../src/navegador/desenho.ts';

const centro: [number, number] = [-43.16, -22.95];

const FORMAS: Record<string, Forma> = {
  retangulo: { tipo: 'retangulo', oeste: -43.18, sul: -22.96, leste: -43.14, norte: -22.94 },
  circulo: { tipo: 'circulo', centro, raioM: 1500 },
  hexagono: { tipo: 'hexagono', centro, raioM: 1500, rotacaoGraus: 17 },
  'polígono convexo': { tipo: 'poligono', pontos: [[-43.18, -22.96], [-43.15, -22.965], [-43.14, -22.94], [-43.17, -22.935]] },
  // forma de "L": tem um canto côncavo
  'polígono côncavo (L)': {
    tipo: 'poligono',
    pontos: [[-43.18, -22.96], [-43.14, -22.96], [-43.14, -22.95], [-43.16, -22.95], [-43.16, -22.93], [-43.18, -22.93]],
  },
  // mesmo L desenhado no sentido horário: o código deve corrigir a orientação
  'polígono horário': {
    tipo: 'poligono',
    pontos: [[-43.18, -22.93], [-43.16, -22.93], [-43.16, -22.95], [-43.14, -22.95], [-43.14, -22.96], [-43.18, -22.96]],
  },
};

/** Grade sintética que cobre a área pedida, com morros (sem baixar nada). */
function gradeFalsa(forma: Forma, resolucao: number, f: (x: number, y: number) => number): GradeElevacao {
  const plano = planejarAmostragem(forma, resolucao);
  const { largura, altura } = dimensoesMetros(plano.caixaGrade);
  const esp = Math.max(largura, altura) / (plano.amostras - 1);
  const nx = Math.round(largura / esp) + 1;
  const ny = Math.round(altura / esp) + 1;
  const elev = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) elev[j * nx + i] = f(i / (nx - 1), j / (ny - 1));
  return { nx, ny, elev, larguraM: largura, alturaM: altura, zoom: 14 };
}

const params = { tamanhoMm: 150, exagero: 2, baseMm: 3, achatarMar: true };
const morros = (x: number, y: number) => 200 + 150 * Math.sin(x * 11) * Math.cos(y * 8);

describe('modelo recortado no formato da área', async () => {
  const wasm = await carregarManifold();

  for (const [nome, forma] of Object.entries(FORMAS)) {
    it(`é um sólido fechado e válido (${nome})`, async () => {
      const r = gerarModelo(wasm, gradeFalsa(forma, 150, morros), forma, params);
      const v = verificarMalha(r.malha);
      expect(v.erros).toEqual([]);
      const m = await validarComManifold(r.malha);
      expect(m.status).toBe('NoError');
      expect(m.genero).toBe(0);
      // o lado maior do modelo tem o tamanho pedido
      expect(Math.max(r.larguraMm, r.profundidadeMm)).toBeCloseTo(150, 0);
      // fundo plano em z = 0
      let zMin = Infinity;
      for (let k = 2; k < r.malha.posicoes.length; k += 3) zMin = Math.min(zMin, r.malha.posicoes[k]);
      expect(zMin).toBeCloseTo(0, 5);
    });
  }

  it('o volume bate com a área do contorno × altura (terreno plano)', () => {
    const plano = () => 50;
    for (const forma of [FORMAS.circulo, FORMAS.hexagono, FORMAS['polígono côncavo (L)']]) {
      const r = gerarModelo(wasm, gradeFalsa(forma, 120, plano), forma, params);
      const { largura, altura } = dimensoesMetros(caixaDaForma(forma));
      const mmPorMetro = 150 / Math.max(largura, altura);
      const areaMm2 = areaM2(forma) * mmPorMetro ** 2;
      expect(verificarMalha(r.malha).volumeMm3).toBeCloseTo(areaMm2 * params.baseMm, -1);
    }
  });

  it('círculo sai redondo: largura = profundidade', () => {
    const r = gerarModelo(wasm, gradeFalsa(FORMAS.circulo, 120, morros), FORMAS.circulo, params);
    expect(r.larguraMm).toBeCloseTo(r.profundidadeMm, 0);
  });

  it('recusa uma área vazia', () => {
    const vazia: Forma = { tipo: 'poligono', pontos: [[-43.1, -22.9], [-43.1, -22.9], [-43.1, -22.9]] };
    expect(() => gerarModelo(wasm, gradeFalsa(FORMAS.circulo, 50, morros), vazia, params)).toThrow();
  });
});

describe('geometria das formas', () => {
  it('hexágono tem 6 vértices, círculo 96', () => {
    expect(contornoLonLat(FORMAS.hexagono)).toHaveLength(6);
    expect(contornoLonLat(FORMAS.circulo)).toHaveLength(96);
  });

  it('área do círculo ≈ π r²', () => {
    expect(areaM2(FORMAS.circulo) / (Math.PI * 1500 ** 2)).toBeCloseTo(1, 2);
  });

  it('detecta polígono que cruza a si mesmo', () => {
    expect(poligonoSeCruza([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
    expect(poligonoSeCruza((FORMAS['polígono côncavo (L)'] as { pontos: [number, number][] }).pontos)).toBe(false);
  });

  it('alças: arrastar canto, centro, raio e vértice', () => {
    const ret = FORMAS.retangulo as Extract<Forma, { tipo: 'retangulo' }>;
    // arrasta o canto nordeste (índice 2) para mais longe
    const r2 = aplicarArraste(ret, { papel: 'vertice', idx: 2 }, [ret.leste, ret.norte], [-43.1, -22.9]);
    expect(r2).toMatchObject({ oeste: ret.oeste, sul: ret.sul, leste: -43.1, norte: -22.9 });

    const hex = FORMAS.hexagono as Extract<Forma, { tipo: 'hexagono' }>;
    const movido = aplicarArraste(hex, { papel: 'centro', idx: 0 }, hex.centro, [-43.0, -22.0]);
    expect(movido).toMatchObject({ centro: [-43.0, -22.0], raioM: 1500 });

    const girado = aplicarArraste(hex, { papel: 'raio', idx: 0 }, contornoLonLat(hex)[0], [hex.centro[0], -22.94]);
    if (girado.tipo !== 'hexagono') throw new Error();
    expect(girado.rotacaoGraus).toBeCloseTo(90, 0); // alça movida para o norte do centro

    const pol = FORMAS['polígono convexo'] as Extract<Forma, { tipo: 'poligono' }>;
    const p2 = aplicarArraste(pol, { papel: 'vertice', idx: 1 }, pol.pontos[1], [-43.15, -22.97]);
    expect(p2.tipo === 'poligono' && p2.pontos[1]).toEqual([-43.15, -22.97]);
  });
});
