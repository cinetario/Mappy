import { describe, expect, it } from 'vitest';
import { amostrarElevacao, decodificarTerrarium, type ImagemTile } from '../src/core/elevacao.ts';
import type { GradeElevacao } from '../src/core/elevacao.ts';
import { validarComManifold } from '../src/core/manifold.ts';
import { lerStl, escreverStl } from '../src/core/stl.ts';
import { gerarTerreno } from '../src/core/terreno.ts';
import { verificarMalha } from '../src/core/verificacao.ts';

function gradeSintetica(nx: number, ny: number, f: (x: number, y: number) => number): GradeElevacao {
  const elev = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) elev[j * nx + i] = f(i / (nx - 1), j / (ny - 1));
  return { nx, ny, elev, larguraM: 3000, alturaM: 2000, zoom: 13 };
}

const parametros = { tamanhoMm: 150, exagero: 2, baseMm: 3, achatarMar: true };

describe('malha do terreno', () => {
  const casos: [string, GradeElevacao][] = [
    ['montanhas', gradeSintetica(120, 80, (x, y) => 500 + 300 * Math.sin(x * 9) * Math.cos(y * 7))],
    ['plano', gradeSintetica(50, 50, () => 10)],
    ['mar e costa', gradeSintetica(60, 40, (x) => (x < 0.5 ? -200 : 80 * x))],
    ['grade mínima 2x2', gradeSintetica(2, 2, (x, y) => x * 100 + y * 50)],
    ['faixa estreita', gradeSintetica(200, 3, (x) => x * 400)],
  ];

  for (const [nome, grade] of casos) {
    it(`é um sólido fechado e bem orientado (${nome})`, async () => {
      const modelo = gerarTerreno(grade, parametros);
      const v = verificarMalha(modelo);
      expect(v.erros).toEqual([]);
      expect(v.valida).toBe(true);

      const m = await validarComManifold(modelo);
      expect(m.status).toBe('NoError');
      expect(m.genero).toBe(0);
      expect(m.volumeMm3).toBeCloseTo(v.volumeMm3, 0);
    });
  }

  it('respeita o tamanho, a base e a centralização', () => {
    const modelo = gerarTerreno(casos[0][1], parametros);
    expect(modelo.larguraMm).toBeCloseTo(150);
    expect(modelo.profundidadeMm).toBeCloseTo(100);
    let zMin = Infinity;
    for (let j = 0; j < 120 * 80; j++) zMin = Math.min(zMin, modelo.posicoes[j * 3 + 2]);
    expect(zMin).toBeCloseTo(3); // ponto mais baixo do relevo = espessura da base
  });

  it('continua válida depois de salvar e ler o STL', async () => {
    const modelo = gerarTerreno(casos[0][1], parametros);
    const relida = lerStl(escreverStl(modelo));
    expect(relida.indices.length).toBe(modelo.indices.length);
    expect(verificarMalha(relida).valida).toBe(true);
    expect((await validarComManifold(relida)).status).toBe('NoError');
  });

  it('detecta uma malha com buraco e uma face invertida', () => {
    const modelo = gerarTerreno(casos[1][1], parametros);
    const comBuraco = { posicoes: modelo.posicoes, indices: modelo.indices.slice(3) };
    expect(verificarMalha(comBuraco).arestasAbertas).toBeGreaterThan(0);

    const invertida = { posicoes: modelo.posicoes, indices: modelo.indices.slice() };
    [invertida.indices[1], invertida.indices[2]] = [invertida.indices[2], invertida.indices[1]];
    expect(verificarMalha(invertida).valida).toBe(false);
  });
});

describe('elevação', () => {
  it('decodifica Terrarium', () => {
    expect(decodificarTerrarium(128, 0, 0)).toBe(0);
    expect(decodificarTerrarium(131, 232, 128)).toBeCloseTo(1000.5);
  });

  it('amostra tiles e interpola', async () => {
    // tile falso: altitude = coluna do pixel (0..255 m)
    const tileFalso = async (): Promise<ImagemTile> => {
      const data = new Uint8Array(256 * 256 * 4);
      for (let k = 0; k < 256 * 256; k++) {
        const alt = (k % 256) + 32768;
        data[k * 4] = Math.floor(alt / 256);
        data[k * 4 + 1] = alt % 256;
        data[k * 4 + 3] = 255;
      }
      return { width: 256, height: 256, data };
    };
    const grade = await amostrarElevacao({ oeste: -46.66, sul: -23.57, leste: -46.63, norte: -23.55 }, 60, { tamanhoTile: 256, zoomMaximo: 15, carregar: tileFalso });
    expect(grade.nx).toBe(60);
    for (const v of grade.elev) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
