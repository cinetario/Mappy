// Fase D: cobertura do solo, árvores e curvas de nível.
import { describe, expect, it } from 'vitest';
import { escreverCobertura, coberturaPadrao, lerCobertura } from '../src/core/cobertura.ts';
import { carregarManifold, malhaParaSolido } from '../src/core/manifold.ts';
import { gerarModelo } from '../src/core/modelo.ts';
import { rasterizar } from '../src/core/raster.ts';
import { simplificarLinha } from '../src/core/camadas.ts';
import { lerStl, escreverStl } from '../src/core/stl.ts';
import { verificarMalha } from '../src/core/verificacao.ts';
import { dadosD, forma, grade, params } from './dados-sinteticos.ts';
import { fracaoSobreposta } from './util-malha.ts';

describe('configuração da cobertura do solo', () => {
  it('ida e volta do texto da URL', () => {
    const c = coberturaPadrao();
    c.floresta.cor = '#123456';
    c.grama.ligada = false;
    c.rocha.integracao = 'rebaixada';
    expect(lerCobertura(escreverCobertura(c))).toEqual(c);
  });
  it('recusa texto inválido', () => {
    expect(lerCobertura('floresta:1:zzzzzz:0.4:e')).toBeNull();
    expect(lerCobertura('marte:1:123456:0.4:e')).toBeNull();
  });
});

describe('simplificação de linhas', () => {
  it('remove vértices quase alinhados e mantém as quinas', () => {
    const linha: [number, number][] = [[0, 0], [1, 0.01], [2, 0], [3, 0.02], [4, 0], [4, 4]];
    expect(simplificarLinha(linha, 0.1)).toEqual([[0, 0], [4, 0], [4, 4]]);
    expect(simplificarLinha(linha, 0.001)).toHaveLength(6);
  });
});

describe('máscara (raster) de polígonos', () => {
  it('quadrado com furo', () => {
    const m = rasterizar([[[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [7, 3], [7, 7], [3, 7]]], 0, 0, 10, 10, 0.5);
    expect(m.dentro(1, 1)).toBe(true);
    expect(m.dentro(5, 5)).toBe(false); // furo
    expect(m.dentro(11, 1)).toBe(false);
    expect(m.marcadas()).toBe(400 - 64);
  });
});

describe('modelo com cobertura, árvores e curvas', async () => {
  const wasm = await carregarManifold();
  const g = grade(forma, 180);
  const todos = params({
    cobertura: true, arvores: true, curvas: true, arvoresDensidade: 0.5, arvoresMaximo: 1500,
  });

  it('gera as peças novas, todas manifold e sem sobreposição', async () => {
    const r = gerarModelo(wasm, g, forma, todos, dadosD());
    const ids = r.partes.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['arvores', 'curvas', 'cobertura-floresta', 'cobertura-grama', 'cobertura-lavoura']));
    for (const p of r.partes) {
      expect(verificarMalha(p.malha).erros, p.id).toEqual([]);
      const s = malhaParaSolido(wasm, p.malha);
      expect(s.status(), p.id).toBe('NoError');
      s.delete();
    }
    // camadas novas não invadem nenhuma outra peça
    const novas = r.partes.filter((p) => ['arvores', 'curvas'].includes(p.id) || p.id.startsWith('cobertura-'));
    for (const a of novas) {
      for (const b of r.partes) {
        if (a !== b) expect(fracaoSobreposta(a.malha, b.malha, 2000), `${a.id} × ${b.id}`).toBeLessThan(0.01);
      }
    }
    // STL único continua válido depois de salvo
    expect(verificarMalha(lerStl(escreverStl(r.malhaUnica))).erros).toEqual([]);
  });

  it('árvores: floresta preenchida, a árvore mapeada em cima da rua é removida', () => {
    const r = gerarModelo(wasm, g, forma, todos, dadosD());
    const s = r.camadas!.estatisticas.arvores!;
    // floresta de 500 m × 500 m; escala 200 mm / 2051 m → ~24 cm² × 0,5 árvore/cm² ≈ 12 (+ a mapeada no gramado)
    const lado = (500 * 200) / 2051 / 10; // cm
    const esperado = lado * lado * 0.5 + 1;
    expect(s.quantidade).toBeGreaterThan(esperado * 0.6);
    expect(s.quantidade).toBeLessThan(esperado * 1.4);
    expect(s.removidasPorDistancia).toBeGreaterThanOrEqual(1);
    expect(s.copaMm).toBeGreaterThanOrEqual(0.8); // copa nunca abaixo do mínimo imprimível
  });

  it('limite de árvores é respeitado e avisado', () => {
    const r = gerarModelo(wasm, g, forma, params({ arvores: true, arvoresDensidade: 5, arvoresMaximo: 100 }), dadosD());
    expect(r.camadas!.estatisticas.arvores!.quantidade).toBe(100);
    expect(r.camadas!.avisos.join(' ')).toMatch(/limite/);
  });

  it('cada estilo de árvore gera um sólido válido', () => {
    for (const estilo of ['classica', 'classicaLowpoly', 'copa', 'copaLowpoly'] as const) {
      const r = gerarModelo(wasm, g, forma, params({ arvores: true, arvoresEstilo: estilo, arvoresDensidade: 0.3, predios: 'nao', ruas: 'nao', agua: false }), dadosD());
      const a = r.partes.find((p) => p.id === 'arvores');
      expect(a, estilo).toBeDefined();
      expect(verificarMalha(a!.malha).erros, estilo).toEqual([]);
    }
  });

  it('curvas de nível: intervalo automático e só na visualização quando não imprimir', () => {
    const r = gerarModelo(wasm, g, forma, params({ curvas: true }), dadosD());
    expect(r.curvas!.intervaloM).toBeGreaterThan(0);
    expect(r.curvas!.niveis).toBeGreaterThan(2);
    expect(r.partes.some((p) => p.id === 'curvas')).toBe(true);

    const so = gerarModelo(wasm, g, forma, params({ curvas: true, curvasImprimir: false }), dadosD());
    expect(so.partes.some((p) => p.id === 'curvas')).toBe(false);
    expect(so.camadas!.linhasPrevia.length).toBeGreaterThan(0);
  });

  it('categoria desligada não gera peça', () => {
    const c = coberturaPadrao();
    c.grama.ligada = false;
    const r = gerarModelo(wasm, g, forma, params({ cobertura: true, coberturaCategorias: escreverCobertura(c) }), dadosD());
    expect(r.partes.some((p) => p.id === 'cobertura-grama')).toBe(false);
    expect(r.partes.some((p) => p.id === 'cobertura-floresta')).toBe(true);
  });
});
