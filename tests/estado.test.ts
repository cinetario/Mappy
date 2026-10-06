import { describe, expect, it } from 'vitest';
import {
  PARAMETROS, PRESETS, aplicarPreset, escreverFaixas, estadoParaUrl, lerFaixas, parametrosPadrao, urlParaEstado,
  type Estado,
} from '../src/core/estado.ts';
import type { Forma } from '../src/core/geo.ts';

const formas: Forma[] = [
  { tipo: 'retangulo', oeste: -43.19, sul: -22.968, leste: -43.14, norte: -22.935 },
  { tipo: 'circulo', centro: [-46.633308, -23.55052], raioM: 1234.5 },
  { tipo: 'hexagono', centro: [7.65, 45.97], raioM: 2500, rotacaoGraus: -30 },
  { tipo: 'poligono', pontos: [[-43.18, -22.96], [-43.14, -22.96], [-43.16, -22.93]] },
];

describe('estado na URL', () => {
  for (const forma of formas) {
    it(`ida e volta sem perder nada (${forma.tipo})`, () => {
      const e: Estado = {
        forma,
        nome: 'São Paulo & cia',
        params: {
          ...parametrosPadrao(),
          tamanhoMm: 180, exagero: 2.5, achatarMar: false, resolucao: 400,
          modo: 'real', fonte: 'copernicus', estilo: 'faixas', zoom: 13,
          corTerreno: '#123abc', faixas: '30:00ff00,100:ffffff', travarAltura: true, alturaTotalMm: 25.4,
        },
      };
      const hash = estadoParaUrl(e);
      expect(urlParaEstado(`#${hash}`)).toEqual(e);
    });
  }

  it('omite valores padrão e mantém o link curto', () => {
    const e: Estado = { forma: formas[1], nome: '', params: parametrosPadrao() };
    expect(estadoParaUrl(e)).toBe('a=c:-46.633308,-23.55052,1234.5');
    expect(estadoParaUrl({ forma: null, nome: '', params: parametrosPadrao() })).toBe('');
  });

  it('URL vazia → estado padrão', () => {
    expect(urlParaEstado('')).toEqual({ forma: null, nome: '', params: parametrosPadrao() });
  });

  it('padrões da especificação', () => {
    const p = parametrosPadrao();
    expect(p).toMatchObject({ tamanhoMm: 220, exagero: 1, baseMm: 2, alturaTotalMm: 17, alturaCamadaMm: 0.2, fonte: 'mapterhorn' });
    expect(lerFaixas(p.faixas)!.map((f) => f.ate)).toEqual([40, 75, 100]);
  });

  it('ignora valores inválidos e limita os fora da faixa', () => {
    const e = urlParaEstado('#a=x:1,2&t=abc&e=99&b=-5&r=333.7&m=talvez&f=google&ct=zzz&fx=bobagem');
    expect(e.forma).toBeNull();
    expect(e.params.tamanhoMm).toBe(220); // padrão
    expect(e.params.exagero).toBe(10); // máximo
    expect(e.params.baseMm).toBe(0.2); // mínimo
    expect(e.params.resolucao).toBe(334); // inteiro
    expect(e.params.achatarMar).toBe(true); // padrão
    expect(e.params.fonte).toBe('mapterhorn'); // opção desconhecida
    expect(e.params.corTerreno).toBe('#c9b98f'); // cor inválida
    expect(e.params.faixas).toBe(parametrosPadrao().faixas);
  });

  it('recusa formas impossíveis', () => {
    expect(urlParaEstado('#a=r:10,10,5,5').forma).toBeNull(); // leste < oeste
    expect(urlParaEstado('#a=c:200,0,100').forma).toBeNull(); // longitude fora
    expect(urlParaEstado('#a=p:1,1;2,2').forma).toBeNull(); // só 2 pontos
    expect(urlParaEstado('#a=c:0,0,-5').forma).toBeNull(); // raio negativo
  });
});

describe('chaves da URL', () => {
  it('são únicas e não colidem com a área (a) nem com o nome (n)', () => {
    const chaves = Object.values(PARAMETROS).map((d) => d.url);
    const repetidas = chaves.filter((c, i) => chaves.indexOf(c) !== i);
    expect(repetidas).toEqual([]);
    expect(chaves).not.toContain('a');
    expect(chaves).not.toContain('n');
  });
});

describe('faixas de altitude', () => {
  it('ordena, força a última em 100% e normaliza as cores', () => {
    expect(lerFaixas('75:888888, 40:4F8A3C, 90:FFFFFF')).toEqual([
      { ate: 40, cor: '#4f8a3c' },
      { ate: 75, cor: '#888888' },
      { ate: 100, cor: '#ffffff' },
    ]);
  });

  it('recusa entradas inválidas', () => {
    expect(lerFaixas('')).toBeNull();
    expect(lerFaixas('40:verde')).toBeNull();
    expect(lerFaixas('0:ffffff')).toBeNull();
    expect(lerFaixas('50:ffffff,50:000000')).toBeNull();
    expect(lerFaixas(Array.from({ length: 9 }, (_, k) => `${k + 1}:ffffff`).join(','))).toBeNull();
  });

  it('escreve no formato da URL', () => {
    expect(escreverFaixas([{ ate: 40, cor: '#4f8a3c' }, { ate: 100, cor: '#ffffff' }])).toBe('40:4f8a3c,100:ffffff');
  });
});

describe('presets', () => {
  it('aplicam só os próprios parâmetros', () => {
    const base = { ...parametrosPadrao(), resolucao: 450, fonte: 'terrarium' as const };
    const p = aplicarPreset(base, 'impressao3d');
    expect(p).toMatchObject(PRESETS.impressao3d.params);
    expect(p.resolucao).toBe(450);
    expect(p.fonte).toBe('terrarium');
    expect(aplicarPreset(base, 'topografico').estilo).toBe('faixas');
  });
});
