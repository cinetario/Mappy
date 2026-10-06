// Fase C: prédios, ruas e água sobre o terreno.
import { describe, expect, it } from 'vitest';
import { estaAlinhado } from '../src/core/camadas-impressao.ts';
import { engrossarLinha } from '../src/core/camadas.ts';
import type { Parametros } from '../src/core/estado.ts';
import type { Forma, LonLat } from '../src/core/geo.ts';
import { caixaLimite } from '../src/core/malha.ts';
import { carregarManifold, malhaParaSolido, validarComManifold } from '../src/core/manifold.ts';
import { escreverStl, lerStl } from '../src/core/stl.ts';
import { gerarModelo } from '../src/core/modelo.ts';
import { alturaPredio, juntarAneis, lerMedidaM } from '../src/core/osm.ts';
import { verificarMalha } from '../src/core/verificacao.ts';
import { classificarVia } from '../src/core/vias.ts';
import { centro, dados, forma, grade, params } from './dados-sinteticos.ts';
import { fracaoSobreposta } from './util-malha.ts';

describe('leitura do OSM', () => {
  it('altura dos prédios', () => {
    expect(lerMedidaM('12')).toBe(12);
    expect(lerMedidaM('12,5 m')).toBe(12.5);
    expect(lerMedidaM("40'")).toBeCloseTo(12.19, 2);
    expect(lerMedidaM('alto')).toBeNull();
    expect(alturaPredio({ 'building:levels': '4', 'roof:levels': '1' }, 10)).toEqual({ alturaM: 15, informada: true });
    expect(alturaPredio({}, 10)).toEqual({ alturaM: 10, informada: false });
  });

  it('junta membros de multipolígono em anéis', () => {
    const a: LonLat[] = [[0, 0], [1, 0], [1, 1]];
    const b: LonLat[] = [[0, 0], [0, 1], [1, 1]]; // sentido oposto
    const aneis = juntarAneis([a, b]);
    expect(aneis).toHaveLength(1);
    expect(aneis[0]).toHaveLength(4);
  });

  it('classifica vias', () => {
    expect(classificarVia({ highway: 'motorway' })).toBe('rodovias');
    expect(classificarVia({ highway: 'residential', bridge: 'yes' })).toBe('pontes');
    expect(classificarVia({ highway: 'residential', tunnel: 'yes' })).toBe('tuneis');
    expect(classificarVia({ highway: 'footway', footway: 'crossing' })).toBe('faixasPedestre');
    expect(classificarVia({ railway: 'rail' })).toBe('ferrovias');
    expect(classificarVia({ highway: 'proposed' })).toBeNull();
  });

  it('extrai prédios (com pátio), vias e água', () => {
    const d = dados();
    expect(d.predios).toHaveLength(3);
    expect(d.predios!.find((p) => p.id === 'r3')!.aneis).toHaveLength(2);
    expect(d.vias!.map((v) => v.tipo).sort()).toEqual(['calcadas', 'locais', 'principais', 'tuneis']);
    expect(d.agua!.poligonos).toHaveLength(1);
    expect(d.agua!.rios).toHaveLength(1);
    expect(d.agua!.costa).toHaveLength(1);
  });

  it('linha engrossada tem a largura pedida', async () => {
    const wasm = await carregarManifold();
    const pols: [number, number][][] = [];
    engrossarLinha([[0, 0], [10, 0], [10, 10]], 2, pols);
    const cs = new wasm.CrossSection(pols, 'NonZero');
    // 2 trechos de 10 × 2 + juntas arredondadas: um pouco mais que 40, sem buracos
    expect(cs.area()).toBeGreaterThan(40);
    expect(cs.area()).toBeLessThan(46);
    expect(cs.decompose()).toHaveLength(1);
    cs.delete();
  });
});

describe('modelo com camadas', async () => {
  const wasm = await carregarManifold();
  const g = grade(forma, 180);

  it('todas as peças são manifold e nenhuma se sobrepõe', async () => {
    const r = gerarModelo(wasm, g, forma, params(), dados());
    const ids = r.partes.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['base', 'terreno', 'predios', 'ruas', 'agua']));
    conferirSemSobreposicao(wasm, r.partes.map((p) => p.malha));
    expect(verificarMalha(r.malhaUnica).erros).toEqual([]);
    expect(r.camadas!.estatisticas.agua!.temMar).toBe(true);
  });

  it('telhados planos alinhados às camadas de impressão', () => {
    const r = gerarModelo(wasm, g, forma, params(), dados());
    const m = r.partes.find((p) => p.id === 'predios')!.malha;
    // telhados = faces horizontais viradas para cima; todas numa altura de camada
    const telhados = new Set<number>();
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
      const p = m.posicoes;
      const nz = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
      const plana = Math.abs(p[a + 2] - p[b + 2]) < 1e-4 && Math.abs(p[a + 2] - p[c + 2]) < 1e-4;
      if (nz > 0 && plana) telhados.add(Math.round(p[a + 2] * 1000) / 1000);
    }
    expect(telhados.size).toBeGreaterThanOrEqual(2);
    for (const z of telhados) expect(estaAlinhado(z, { h: 0.2, h1: 0.2 }, 2e-3)).toBe(true);
    // prédio de 30 m na escala ~1:10000 × exagero 1 ≈ 3 mm acima do chão
    const s = r.camadas!.estatisticas.predios!;
    expect(s.maiorM).toBeCloseTo(30, 0);
    expect(s.semAltura).toBe(1);
  });

  it('ruas: túnel desligado por padrão; ligar aumenta a área', () => {
    const vol = (extra: Partial<Parametros>) => {
      const r = gerarModelo(wasm, g, forma, params(extra), dados());
      return verificarMalha(r.partes.find((p) => p.id === 'ruas')!.malha).volumeMm3;
    };
    expect(vol({ ruasTiposDesligados: '-' })).toBeGreaterThan(vol({}));
  });

  it('ruas rebaixadas cortam o terreno sem sobreposição', () => {
    const r = gerarModelo(wasm, g, forma, params({ ruasIntegracao: 'rebaixada', prediosIntegracao: 'rebaixado' }), dados());
    conferirSemSobreposicao(wasm, r.partes.map((p) => p.malha));
    const ruas = r.partes.find((p) => p.id === 'ruas')!;
    // o topo das ruas fica abaixo da superfície local: z máximo bem menor que o topo do terreno
    expect(caixaLimite(ruas.malha).max[2]).toBeLessThan(r.alturaMax);
  });

  it('camadas rebaixadas ficam visíveis por cima (sem terreno em cima delas)', async () => {
    const casos: [string, Partial<Parametros>][] = [
      ['ruas', { ruasIntegracao: 'rebaixada' }],
      ['ruas', { ruasModo: 'superficie' }],
      ['agua', { aguaIntegracao: 'rebaixada' }],
      ['agua', { aguaModo: 'superficie' }],
      ['predios', { prediosIntegracao: 'rebaixado' }],
    ];
    for (const [id, extra] of casos) {
      const r = gerarModelo(wasm, g, forma, params(extra), dados());
      const peca = malhaParaSolido(wasm, r.partes.find((p) => p.id === id)!.malha);
      // sobe a peça 0,3 mm: se houver terreno logo acima dela, os dois se cruzam
      const acima = peca.translate(0, 0, 0.3);
      for (const t of r.partes.filter((p) => p.id === 'terreno' || p.id === 'base')) {
        const terreno = malhaParaSolido(wasm, t.malha);
        const inter = acima.intersect(terreno);
        expect(inter.volume() / peca.volume(), `${id} ${JSON.stringify(extra)}`).toBeLessThan(0.05);
        for (const o of [terreno, inter]) o.delete();
      }
      for (const o of [peca, acima]) o.delete();
    }
  });

  it('STL único continua manifold depois de salvo (vértices soldados por posição)', async () => {
    for (const extra of [{}, { ruasIntegracao: 'rebaixada' as const, prediosIntegracao: 'rebaixado' as const }]) {
      const r = gerarModelo(wasm, g, forma, params(extra), dados());
      const relida = lerStl(escreverStl(r.malhaUnica));
      const v = verificarMalha(relida);
      expect(v.erros, JSON.stringify(extra)).toEqual([]);
      const m = await validarComManifold(relida);
      expect(m.status).toBe('NoError');
      // cada peça também sobrevive ao STL (para o "STL por camada")
      for (const p of r.partes) expect(verificarMalha(lerStl(escreverStl(p.malha))).erros, p.id).toEqual([]);
    }
  });

  it('o medidor de sobreposição detecta uma sobreposição real', () => {
    const r = gerarModelo(wasm, g, forma, params(), dados());
    const agua = r.partes.find((p) => p.id === 'agua')!.malha;
    const deslocada = { posicoes: agua.posicoes.map((v, k) => (k % 3 === 2 ? v + 0.2 : v)), indices: agua.indices };
    // água com 0,4 mm de espessura deslocada 0,2 mm: metade se sobrepõe
    expect(fracaoSobreposta(agua, deslocada, 3000)).toBeGreaterThan(0.3);
    const base = r.partes.find((p) => p.id === 'base')!.malha;
    const baseAcima = { posicoes: base.posicoes.map((v, k) => (k % 3 === 2 ? v + 0.5 : v)), indices: base.indices };
    expect(fracaoSobreposta(base, baseAcima, 3000)).toBeGreaterThan(0.5);
  });

  it('rebaixo fundo demais é limitado e gera aviso', () => {
    const r = gerarModelo(wasm, g, forma, params({ aguaProfundidadeMm: 8, baseMm: 2 }), dados());
    expect(r.camadas!.avisos.join(' ')).toMatch(/base/i);
    const agua = r.partes.find((p) => p.id === 'agua')!;
    expect(caixaLimite(agua.malha).min[2]).toBeGreaterThanOrEqual(0.2 - 1e-4);
    conferirSemSobreposicao(wasm, r.partes.map((p) => p.malha));
  });

  it('água pequena some com o filtro', () => {
    const com = gerarModelo(wasm, g, forma, params({ aguaOcultarPequenos: false }), dados());
    const sem = gerarModelo(wasm, g, forma, params({ aguaOcultarPequenos: true, aguaAreaMinMm2: 500, aguaLarguraMinMm: 0.5 }), dados());
    expect(sem.camadas!.estatisticas.agua!.removidosPequenos).toBeGreaterThan(com.camadas!.estatisticas.agua!.removidosPequenos);
  });

  it('formas não retangulares e modo 1:1 também funcionam', async () => {
    const hex: Forma = { tipo: 'hexagono', centro, raioM: 900, rotacaoGraus: 0 };
    const r = gerarModelo(wasm, grade(hex, 150), hex, params({ prediosDetalhados: true }), dados(true));
    conferirSemSobreposicao(wasm, r.partes.map((p) => p.malha));
    const real = gerarModelo(wasm, grade(hex, 120), hex, params({ modo: 'real', baseMm: 5 }), dados());
    conferirSemSobreposicao(wasm, real.partes.map((p) => p.malha));
    expect(real.unidade).toBe('m');
  });
});

/**
 * Cada peça é manifold e duas peças não se sobrepõem. A sobreposição é medida
 * por amostragem de pontos (ver util-malha.ts): uma sobreposição real, como
 * uma camada de 0,2 mm a mais numa peça de 0,4 mm, daria ~50% dos pontos.
 */
function conferirSemSobreposicao(wasm: Awaited<ReturnType<typeof carregarManifold>>, pecas: { posicoes: Float32Array; indices: Uint32Array }[]) {
  for (const m of pecas) {
    expect(verificarMalha(m).erros).toEqual([]);
    const s = malhaParaSolido(wasm, m);
    expect(s.status()).toBe('NoError');
    s.delete();
  }
  for (let a = 0; a < pecas.length; a++) {
    for (let b = 0; b < pecas.length; b++) {
      if (a !== b) expect(fracaoSobreposta(pecas[a], pecas[b], 3000)).toBeLessThan(0.01);
    }
  }
}
