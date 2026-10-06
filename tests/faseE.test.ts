// Fase E: moldura com texto, divisão em blocos e 3MF multicolor.
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { caixaLimite } from '../src/core/malha.ts';
import { carregarManifold, malhaParaSolido } from '../src/core/manifold.ts';
import { gerarModelo } from '../src/core/modelo.ts';
import { escreverStl, lerStl } from '../src/core/stl.ts';
import { carregarFonte, contornosTexto } from '../src/core/texto.ts';
import { distribuirFilamentos, escrever3mf } from '../src/core/tmf.ts';
import { verificarMalha } from '../src/core/verificacao.ts';
import { dados, forma, grade, params } from './dados-sinteticos.ts';
import { fracaoSobreposta } from './util-malha.ts';

const bytes = readFileSync(new URL('../src/fontes/ArchivoBlack-Regular.ttf', import.meta.url));
const fonte = carregarFonte('archivo', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('texto', () => {
  it('maiúsculas com a altura pedida, centradas', () => {
    const t = contornosTexto(fonte, 'URCA', 6);
    expect(t.altura).toBeCloseTo(6, 0);
    expect(t.largura).toBeGreaterThan(15);
    expect(t.aneis.length).toBeGreaterThanOrEqual(5); // U, R (+furo), C, A (+furo)
  });
  it('texto vazio não gera contornos', () => {
    expect(contornosTexto(fonte, '', 6).aneis).toEqual([]);
  });
});

describe('moldura com texto', async () => {
  const wasm = await carregarManifold();
  const g = grade(forma, 120);
  const base = params({ moldura: true, texto: 'URCA · 22,95°S', predios: 'nao', ruas: 'nao', agua: false });

  it('moldura e texto em relevo: peças manifold, sem sobreposição', () => {
    const r = gerarModelo(wasm, g, forma, base, dados(), { fonte });
    const ids = r.partes.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['base', 'terreno', 'moldura', 'texto']));
    for (const p of r.partes) expect(verificarMalha(lerStl(escreverStl(p.malha))).erros, p.id).toEqual([]);
    const moldura = r.partes.find((p) => p.id === 'moldura')!;
    const texto = r.partes.find((p) => p.id === 'texto')!;
    // texto em cima da moldura: começa no topo dela (5 mm) e sobe 0,8 mm
    expect(caixaLimite(texto.malha).min[2]).toBeCloseTo(5, 3);
    expect(caixaLimite(texto.malha).max[2]).toBeCloseTo(5.8, 3);
    expect(caixaLimite(moldura.malha).max[2]).toBeCloseTo(5, 3);
    for (const a of [moldura, texto]) {
      for (const b of r.partes) if (a !== b) expect(fracaoSobreposta(a.malha, b.malha, 2000), `${a.id}×${b.id}`).toBeLessThan(0.01);
    }
    // o modelo cresceu com a moldura (3 mm de cada lado + plaquinha embaixo)
    expect(r.largura).toBeGreaterThan(200 + 5.9);
    expect(verificarMalha(lerStl(escreverStl(r.malhaUnica))).erros).toEqual([]);
  });

  it('texto gravado fica rente ao topo da moldura', () => {
    const r = gerarModelo(wasm, g, forma, params({ ...base, textoModo: 'gravado' }), dados(), { fonte });
    const texto = r.partes.find((p) => p.id === 'texto')!;
    expect(caixaLimite(texto.malha).max[2]).toBeCloseTo(5, 3);
    const moldura = r.partes.find((p) => p.id === 'moldura')!;
    expect(fracaoSobreposta(texto.malha, moldura.malha, 3000)).toBeLessThan(0.01);
  });

  it('moldura fundida à base: uma peça só', () => {
    const r = gerarModelo(wasm, g, forma, params({ ...base, molduraFundir: true }), dados(), { fonte });
    expect(r.partes.some((p) => p.id === 'moldura')).toBe(false);
    const b = r.partes.find((p) => p.id === 'base')!;
    expect(b.nome).toBe('Base e moldura');
    expect(verificarMalha(b.malha).erros).toEqual([]);
  });

  it('funciona em hexágono, com texto na lateral', () => {
    const hex = { tipo: 'hexagono' as const, centro: [-43.16, -22.95] as [number, number], raioM: 900, rotacaoGraus: 0 };
    const r = gerarModelo(wasm, grade(hex, 100), hex, params({ ...base, textoBorda: 'esquerda', molduraEstilo: 'arredondada' }), dados(), { fonte });
    for (const p of r.partes) expect(verificarMalha(lerStl(escreverStl(p.malha))).erros, p.id).toEqual([]);
    expect(r.partes.some((p) => p.id === 'texto')).toBe(true);
  });
});

describe('dividir em blocos', async () => {
  const wasm = await carregarManifold();
  const g = grade(forma, 120);

  it('2 × 2 blocos: cada peça de cada bloco manifold, volumes somam o total', async () => {
    const r = gerarModelo(wasm, g, forma, params({ blocos: true, blocosX: 2, blocosY: 2 }), dados());
    expect(r.blocos.map((b) => b.rotulo).sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
    let soma = 0;
    for (const b of r.blocos) {
      for (const p of b.partes) expect(verificarMalha(lerStl(escreverStl(p.malha))).erros, `${b.rotulo} ${p.id}`).toEqual([]);
      const u = verificarMalha(lerStl(escreverStl(b.malhaUnica)));
      expect(u.erros, b.rotulo).toEqual([]);
      soma += u.volumeMm3;
      // cada bloco tem metade da largura
      const c = caixaLimite(b.malhaUnica);
      expect(c.max[0] - c.min[0]).toBeCloseTo(r.largura / 2, 0);
    }
    const total = verificarMalha(r.malhaUnica).volumeMm3;
    expect(soma / total).toBeCloseTo(1, 2);
    const s = malhaParaSolido(wasm, r.blocos[0].malhaUnica);
    expect(s.status()).toBe('NoError');
    s.delete();
  });

  it('desligado ou 1 × 1: sem blocos', () => {
    expect(gerarModelo(wasm, g, forma, params({ blocos: true, blocosX: 1, blocosY: 1 }), dados()).blocos).toEqual([]);
  });
});

describe('3MF', () => {
  it('estrutura: peças nomeadas, cores, montagem e filamentos para o Orca', async () => {
    const wasm = await carregarManifold();
    const r = gerarModelo(wasm, grade(forma, 100), forma, params(), dados());
    const f = distribuirFilamentos(r.partes.map((p) => ({ nome: p.nome, cor: p.cor, volume: verificarMalha(p.malha).volumeMm3 })));
    const arq = escrever3mf(r.partes.map((p, k) => ({ nome: p.nome, cor: p.cor, malha: p.malha, extrusora: f.porPeca[k] })), { titulo: 'Urca & cia', unidade: 'millimeter' });
    const z = unzipSync(arq);
    expect(Object.keys(z).sort()).toEqual(['3D/3dmodel.model', 'Metadata/model_settings.config', '[Content_Types].xml', '_rels/.rels']);
    const modelo = strFromU8(z['3D/3dmodel.model']);
    expect(modelo).toContain('unit="millimeter"');
    expect(modelo).toContain('Urca &amp; cia'); // texto escapado
    const objetos = [...modelo.matchAll(/<object id="(\d+)"[^>]*name="([^"]*)"/g)];
    expect(objetos.map((o) => o[2])).toEqual([...r.partes.map((p) => p.nome), 'Urca &amp; cia']);
    expect([...modelo.matchAll(/<component objectid=/g)]).toHaveLength(r.partes.length);
    expect([...modelo.matchAll(/<base name=/g)]).toHaveLength(r.partes.length);
    expect(modelo).not.toMatch(/NaN|Infinity/);
    // número de vértices e triângulos de cada peça bate com a malha
    for (const [k, p] of r.partes.entries()) {
      const bloco = modelo.split('<object ')[k + 1];
      expect([...bloco.matchAll(/<vertex /g)]).toHaveLength(p.malha.posicoes.length / 3);
      expect([...bloco.matchAll(/<triangle /g)]).toHaveLength(p.malha.indices.length / 3);
    }
    const config = strFromU8(z['Metadata/model_settings.config']);
    const extrusoras = [...config.matchAll(/<part id="\d+"[\s\S]*?key="extruder" value="(\d)"/g)].map((m) => Number(m[1]));
    expect(extrusoras).toEqual(f.porPeca);
  });

  it('filamentos: até 4; cores a mais vão para a mais parecida', () => {
    const pecas = [
      { nome: 'Terreno', cor: '#c9b98f', volume: 100 },
      { nome: 'Base', cor: '#c9b98f', volume: 50 },
      { nome: 'Prédios', cor: '#e4ded3', volume: 10 },
      { nome: 'Água', cor: '#3f7fc0', volume: 20 },
      { nome: 'Floresta', cor: '#3d6b35', volume: 15 },
      { nome: 'Grama', cor: '#8cb369', volume: 5 }, // 5ª cor: vai para a floresta (verde)
    ];
    const f = distribuirFilamentos(pecas);
    expect(f.agrupadas).toBe(true);
    expect(f.filamentos).toHaveLength(4);
    expect(f.porPeca[0]).toBe(f.porPeca[1]); // mesma cor, mesmo filamento
    expect(f.porPeca[5]).toBe(f.porPeca[4]); // grama → filamento da floresta
    expect(Math.max(...f.porPeca)).toBe(4);
  });
});
