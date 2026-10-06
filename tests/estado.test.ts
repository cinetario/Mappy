import { describe, expect, it } from 'vitest';
import { estadoParaUrl, parametrosPadrao, urlParaEstado, type Estado } from '../src/core/estado.ts';
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
        params: { ...parametrosPadrao(), tamanhoMm: 220, exagero: 2.5, achatarMar: false, resolucao: 400 },
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

  it('ignora valores inválidos e limita os fora da faixa', () => {
    const e = urlParaEstado('#a=x:1,2&t=abc&e=99&b=-5&r=333.7&m=talvez');
    expect(e.forma).toBeNull();
    expect(e.params.tamanhoMm).toBe(150); // padrão
    expect(e.params.exagero).toBe(5); // máximo
    expect(e.params.baseMm).toBe(0.6); // mínimo
    expect(e.params.resolucao).toBe(334); // inteiro
    expect(e.params.achatarMar).toBe(true); // padrão
  });

  it('recusa formas impossíveis', () => {
    expect(urlParaEstado('#a=r:10,10,5,5').forma).toBeNull(); // leste < oeste
    expect(urlParaEstado('#a=c:200,0,100').forma).toBeNull(); // longitude fora
    expect(urlParaEstado('#a=p:1,1;2,2').forma).toBeNull(); // só 2 pontos
    expect(urlParaEstado('#a=c:0,0,-5').forma).toBeNull(); // raio negativo
  });
});
