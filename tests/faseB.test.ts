// Fase B: triangulação adaptativa, faixas por altitude, altura travada,
// alinhamento às camadas e uso de tiles "pai" quando falta zoom.
import { describe, expect, it } from 'vitest';
import { alinharEspessura, alinharZ, estaAlinhado } from '../src/core/camadas-impressao.ts';
import { amostrarElevacao, type FonteTiles, type GradeElevacao, type ImagemTile } from '../src/core/elevacao.ts';
import { parametrosPadrao, type Parametros } from '../src/core/estado.ts';
import { dimensoesMetros, type Forma } from '../src/core/geo.ts';
import { caixaLimite } from '../src/core/malha.ts';
import { carregarManifold, malhaParaSolido, validarComManifold } from '../src/core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../src/core/modelo.ts';
import { gerarBlocoTerreno } from '../src/core/terreno.ts';
import { verificarMalha } from '../src/core/verificacao.ts';

const hex: Forma = { tipo: 'hexagono', centro: [-43.16, -22.95], raioM: 1500, rotacaoGraus: 10 };

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

const morro = (x: number, y: number) => 100 + 300 * Math.exp(-((x - 0.5) ** 2 + (y - 0.5) ** 2) * 12);
const param = (extra: Partial<Parametros> = {}): Parametros => ({ ...parametrosPadrao(), tamanhoMm: 150, ...extra });

describe('alinhamento às camadas', () => {
  const g = { h: 0.2, h1: 0.2 };
  it('arredonda para a camada mais próxima', () => {
    expect(alinharZ(2.05, g)).toBe(2);
    expect(alinharZ(2.11, g)).toBe(2.2);
    expect(alinharZ(0.05, g)).toBe(0.2); // nunca abaixo da 1ª camada
    expect(alinharZ(1.0, { h: 0.2, h1: 0.3 })).toBe(1.1); // 0,3 + 4 × 0,2
    expect(alinharEspessura(0.5, g)).toBe(0.6);
    expect(alinharEspessura(0.01, g)).toBe(0.2);
    expect(estaAlinhado(1.4, g)).toBe(true);
    expect(estaAlinhado(1.45, g)).toBe(false);
  });
});

describe('triangulação adaptativa (Delatin)', async () => {
  const wasm = await carregarManifold();
  const op = { porMetro: 0.05, porMetroVertical: 0.1, zBase: 2, altitudeMinima: 0, achatarMar: true };

  it('terreno plano vira pouquíssimos triângulos e continua fechado', async () => {
    const grade = gradeFalsa(hex, 300, () => 50);
    const bloco = gerarBlocoTerreno(grade, { ...op, erroMax: 0.05 });
    expect(bloco.indices.length / 3).toBeLessThan(5000);
    expect(bloco.triangulosGrade).toBeGreaterThan(150_000);
    expect(verificarMalha(bloco).erros).toEqual([]);
    expect((await validarComManifold(bloco)).status).toBe('NoError');
  });

  it('relevo real reduz os triângulos sem errar mais que o limite', () => {
    const grade = gradeFalsa(hex, 300, (x, y) => morro(x, y) + 20 * Math.sin(x * 40) * Math.sin(y * 30));
    const cheia = gerarBlocoTerreno(grade, { ...op, erroMax: 0 });
    const adaptativa = gerarBlocoTerreno(grade, { ...op, erroMax: 0.05 });
    expect(adaptativa.indices.length).toBeLessThan(cheia.indices.length * 0.7);
    expect(verificarMalha(adaptativa).valida).toBe(true);
    // volumes quase iguais (erro máximo de 0,05 mm na altura)
    const vC = verificarMalha(cheia).volumeMm3;
    const vA = verificarMalha(adaptativa).volumeMm3;
    expect(Math.abs(vA - vC) / vC).toBeLessThan(0.005);
    const s = malhaParaSolido(wasm, adaptativa);
    expect(s.status()).toBe('NoError');
    s.delete();
  });
});

describe('peças do modelo', async () => {
  const wasm = await carregarManifold();
  const grade = gradeFalsa(hex, 200, morro);

  it('cor sólida: base + terreno, sem sobreposição, somando o volume total', async () => {
    const r = gerarModelo(wasm, grade, hex, param({ estilo: 'solido' }));
    expect(r.partes.map((p) => p.id)).toEqual(['base', 'terreno']);
    await conferirPecas(r.partes.map((p) => p.malha), r.malhaUnica);
  });

  it('faixas: uma peça por faixa, limites alinhados às camadas', async () => {
    const r = gerarModelo(wasm, grade, hex, param({ estilo: 'faixas', faixas: '40:00aa00,75:888888,100:ffffff', exagero: 3 }));
    expect(r.partes.map((p) => p.id)).toEqual(['base', 'faixa-1', 'faixa-2', 'faixa-3']);
    expect(r.partes.map((p) => p.cor)).toEqual(['#c9b98f', '#00aa00', '#888888', '#ffffff']);
    const g = { h: 0.2, h1: 0.2 };
    for (const p of r.partes) {
      const { min, max } = caixaLimite(p.malha);
      // cada corte (exceto o topo do relevo) cai exatamente numa camada
      if (p.id !== 'base') expect(estaAlinhado(min[2], g, 1e-3)).toBe(true);
      if (p.id !== 'faixa-3') expect(estaAlinhado(max[2], g, 1e-3)).toBe(true);
    }
    await conferirPecas(r.partes.map((p) => p.malha), r.malhaUnica);
  });

  it('travar altura total: o ponto mais alto fica na altura pedida', () => {
    const r = gerarModelo(wasm, grade, hex, param({ travarAltura: true, alturaTotalMm: 17, simplificacaoMm: 0 }));
    expect(r.alturaMax).toBeCloseTo(17, 1);
    expect(r.exageroEfetivo).toBeGreaterThan(0);
  });

  it('base alinhada à camada (2,07 mm → 2,0 mm)', () => {
    const r = gerarModelo(wasm, grade, hex, param({ baseMm: 2.07 }));
    expect(r.zBase).toBe(2);
    expect(caixaLimite(r.partes[0].malha).max[2]).toBeCloseTo(2, 5);
  });

  it('escala 1:1 gera em metros reais', () => {
    const r = gerarModelo(wasm, grade, hex, param({ modo: 'real', baseMm: 5, exagero: 1 }));
    expect(r.unidade).toBe('m');
    expect(r.escala).toBe(1);
    // hexágono de raio 1500 m girado 10°: a caixa tem 2 × 1500 × cos(10°) = 2954 m
    expect(Math.max(r.largura, r.profundidade)).toBeCloseTo(3000 * Math.cos((10 * Math.PI) / 180), -1);
    // relevo: ~300 m de morro + 5 m de base
    expect(r.alturaMax).toBeGreaterThan(250);
  });

  it('escala de impressão 1:N', () => {
    const r = gerarModelo(wasm, grade, hex, param());
    // 2954 m (caixa do hexágono girado) em 150 mm → 1:19696
    expect(r.escala).toBeCloseTo((3000 * Math.cos((10 * Math.PI) / 180)) / 0.15, -2);
  });
});

/** Cada peça é manifold, as peças não se sobrepõem e somam o volume do modelo único. */
async function conferirPecas(pecas: { posicoes: Float32Array; indices: Uint32Array }[], unica: { posicoes: Float32Array; indices: Uint32Array }) {
  const wasm = await carregarManifold();
  const solidos = pecas.map((m) => malhaParaSolido(wasm, m));
  for (const s of solidos) expect(s.status()).toBe('NoError');
  for (let a = 0; a < solidos.length; a++) {
    for (let b = a + 1; b < solidos.length; b++) {
      const inter = solidos[a].intersect(solidos[b]);
      expect(inter.volume()).toBeLessThan(1e-3);
      inter.delete();
    }
  }
  const soma = solidos.reduce((s, x) => s + x.volume(), 0);
  expect(soma).toBeCloseTo(verificarMalha(unica).volumeMm3, 0);
  for (const s of solidos) s.delete();
}

describe('tiles ausentes no zoom pedido', () => {
  it('usa o tile "pai" quando o zoom alto não existe (Mapterhorn fora da Europa)', async () => {
    // fonte falsa: só existe o zoom 10; altitude = 1000 m em tudo
    const tile = (): ImagemTile => {
      const data = new Uint8Array(512 * 512 * 4);
      const v = 1000 + 32768;
      for (let k = 0; k < 512 * 512; k++) {
        data[k * 4] = Math.floor(v / 256);
        data[k * 4 + 1] = v % 256;
        data[k * 4 + 3] = 255;
      }
      return { width: 512, height: 512, data };
    };
    const pedidos: number[] = [];
    const fonte: FonteTiles = {
      tamanhoTile: 512,
      zoomMaximo: 17,
      carregar: async (z) => {
        pedidos.push(z);
        return z === 10 ? tile() : null;
      },
    };
    const g = await amostrarElevacao({ oeste: -43.17, sul: -22.96, leste: -43.15, norte: -22.94 }, 100, fonte, { zoom: 13 });
    expect(g.zoom).toBe(13);
    expect(g.zoomEfetivo).toBe(10);
    expect(Math.min(...pedidos)).toBe(10);
    for (const v of g.elev) expect(v).toBeCloseTo(1000, 3);
  });
});
