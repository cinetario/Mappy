import { describe, expect, it } from 'vitest';
import {
  Cancelado, baixarBlocos, blocosDaArea, dividirEm4,
  type Bloco, type OpcoesDownload, type RespostaBloco,
} from '../src/core/blocos.ts';

const B = (s: number, w: number, lado = 0.04): Bloco => ({ s, w, n: s + lado, e: w + lado });
const lado = (b: Bloco) => Math.round((b.n - b.s) * 1000) / 1000;

/** Opções de teste: espera instantânea, registrando quanto "esperou". */
function opcoes<T>(baixar: OpcoesDownload<T>['baixar'], extra: Partial<OpcoesDownload<T>> = {}) {
  const esperas: number[] = [];
  const mensagens: string[] = [];
  const o: OpcoesDownload<T> = {
    baixar,
    servidores: 3,
    esperar: async (ms) => { esperas.push(ms); },
    aoProgredir: (p) => { if (p.mensagem) mensagens.push(p.mensagem); },
    ...extra,
  };
  return { o, esperas, mensagens };
}

describe('grade de blocos', () => {
  it('área pequena cai em 1 a 4 blocos, sempre alinhados; mover um pouco reaproveita', () => {
    const b = blocosDaArea({ oeste: -43.17, sul: -22.96, leste: -43.15, norte: -22.94 });
    expect(b.length).toBeGreaterThanOrEqual(1);
    expect(b.length).toBeLessThanOrEqual(4);
    for (const x of b) expect(Math.abs(x.s / 0.04 - Math.round(x.s / 0.04))).toBeLessThan(1e-6);
    expect(blocosDaArea({ oeste: -43.169, sul: -22.959, leste: -43.151, norte: -22.941 })).toEqual(b);
  });

  it('dividir em 4 cobre o bloco sem sobras', () => {
    const area = dividirEm4(B(0, 0)).reduce((s, x) => s + (x.n - x.s) * (x.e - x.w), 0);
    expect(area).toBeCloseTo(0.0016);
  });
});

describe('download com novas tentativas', () => {
  it('tudo certo na primeira: nada falta', async () => {
    const { o } = opcoes(async (b) => ({ dados: lado(b) }));
    const r = await baixarBlocos([B(0, 0), B(0, 0.04)], o);
    expect(r.dados).toEqual([0.04, 0.04]);
    expect(r.faltando).toEqual([]);
  });

  it('servidor ocupado: espera crescente, troca de servidor e mostra a contagem regressiva', async () => {
    const servidores: number[] = [];
    let chamadas = 0;
    const { o, esperas, mensagens } = opcoes<number>(async (_b, servidor) => {
      servidores.push(servidor);
      return ++chamadas < 3 ? { erro: 'ocupado', mensagem: 'HTTP 429' } : { dados: 1 };
    }, { esperasS: [5, 10, 20] });
    const r = await baixarBlocos([B(0, 0)], o);
    expect(r.dados).toEqual([1]);
    expect(servidores).toEqual([0, 1, 2]); // alterna entre os servidores
    expect(esperas.length).toBe(5 + 10); // 5 s e depois 10 s, de 1 em 1 s
    expect(mensagens).toContain('Servidor ocupado (HTTP 429). Tentando de novo em 10 s… (tentativa 3 de 3, outro servidor)');
  });

  it('espelho que não responde deixa de ser usado enquanto houver um que responde', async () => {
    const usados: number[] = [];
    // servidor 0 responde; 1 e 2 sempre esgotam o tempo
    const { o } = opcoes<number>(async (_b, servidor) => {
      usados.push(servidor);
      return servidor === 0 ? { dados: 1 } : { erro: 'tempo', mensagem: '60 s' };
    });
    const saude = [0, 0, 0];
    const blocos = Array.from({ length: 8 }, (_, k) => B(0, k * 0.04));
    const r = await baixarBlocos(blocos, { ...o, simultaneos: 1, saudeServidores: saude });
    expect(r.faltando).toEqual([]);
    // cada espelho falha uma vez e sai da fila (o servidor 0 tem menos falhas)
    const depois = usados.slice(usados.lastIndexOf(2) + 1);
    expect(depois.every((s) => s === 0)).toBe(true);
    expect(usados.filter((s) => s !== 0).length).toBeLessThanOrEqual(2);
    expect(saude[1]).toBe(1);
    expect(saude[0]).toBe(0);
  });

  it('bloco que sempre falha é dividido em 4; pedaços que passam são usados', async () => {
    // o bloco grande nunca responde; dos pedaços, um continua falhando
    const { o } = opcoes<number>(async (b) => {
      if (lado(b) === 0.04) return { erro: 'tempo', mensagem: '60 s' };
      return b.s === 0 && b.w === 0 ? { erro: 'tempo', mensagem: '60 s' } : { dados: lado(b) };
    });
    const r = await baixarBlocos([B(0, 0)], o);
    expect(r.dados).toEqual([0.02, 0.02, 0.02]);
    expect(r.faltando).toEqual([{ s: 0, w: 0, n: 0.02, e: 0.02 }]);
  });

  it('bloco pesado é dividido na hora, sem repetir', async () => {
    let tentativasGrande = 0;
    const { o, esperas } = opcoes<number>(async (b) => {
      if (lado(b) === 0.04) {
        tentativasGrande++;
        return { erro: 'pesado', mensagem: 'out of memory' };
      }
      return { dados: lado(b) };
    });
    const r = await baixarBlocos([B(0, 0)], o);
    expect(tentativasGrande).toBe(1);
    expect(esperas).toEqual([]);
    expect(r.dados).toHaveLength(4);
  });

  it('serviço fora do ar: desiste depois de várias falhas seguidas e devolve o que faltou', async () => {
    let chamadas = 0;
    const { o } = opcoes<number>(async () => {
      chamadas++;
      return { erro: 'ocupado', mensagem: 'HTTP 504' };
    }, { falhasParaDesistir: 6 });
    const blocos = [B(0, 0), B(0, 0.04), B(0.04, 0), B(0.04, 0.04)];
    const r = await baixarBlocos(blocos, o);
    expect(r.dados).toEqual([]);
    // a área que falta é a área toda (alguns blocos podem ter sido divididos antes)
    const area = r.faltando.reduce((s, b) => s + (b.n - b.s) * (b.e - b.w), 0);
    expect(area).toBeCloseTo(4 * 0.04 * 0.04);
    expect(chamadas).toBeLessThanOrEqual(7); // não fica tentando para sempre
  });

  it('cancelar interrompe na hora, inclusive durante a espera', async () => {
    const ctrl = new AbortController();
    const o: OpcoesDownload<number> = {
      baixar: async (): Promise<RespostaBloco<number>> => ({ erro: 'ocupado', mensagem: 'HTTP 429' }),
      servidores: 2,
      sinal: ctrl.signal,
      // a primeira espera dispara o cancelamento
      esperar: async (_ms, sinal) => {
        ctrl.abort();
        if (sinal?.aborted) throw new Cancelado();
      },
    };
    await expect(baixarBlocos([B(0, 0)], o)).rejects.toBeInstanceOf(Cancelado);
  });
});
