// Lado da página que conversa com o Web Worker de geração.
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import type { Contagem, MensagemDoWorker, ResultadoGeracao } from '../trabalhador/protocolo.ts';

/** O modelo pronto, ou um pedido de confirmação (área com muitos elementos). */
export type RespostaGeracao = { tipo: 'pronto'; resultado: ResultadoGeracao } | { tipo: 'confirmar'; contagem: Contagem };

export function criarGerador() {
  const worker = new Worker(new URL('../trabalhador/gerador.worker.ts', import.meta.url), { type: 'module' });
  let proximoId = 1;
  const pendentes = new Map<number, {
    resolver: (r: RespostaGeracao) => void;
    rejeitar: (e: Error) => void;
    aoProgredir: (etapa: string, fracao: number) => void;
  }>();

  worker.onmessage = (ev: MessageEvent<MensagemDoWorker>) => {
    const m = ev.data;
    const p = pendentes.get(m.id);
    if (!p) return;
    if (m.tipo === 'progresso') {
      p.aoProgredir(m.etapa, m.fracao);
      return;
    }
    pendentes.delete(m.id);
    if (m.tipo === 'pronto') p.resolver({ tipo: 'pronto', resultado: m.resultado });
    else if (m.tipo === 'confirmar') p.resolver({ tipo: 'confirmar', contagem: m.contagem });
    else p.rejeitar(new Error(m.mensagem));
  };
  worker.onerror = (ev) => {
    for (const p of pendentes.values()) p.rejeitar(new Error(ev.message || 'Falha no processamento'));
    pendentes.clear();
  };

  return {
    gerar(forma: Forma, params: Parametros, confirmado: boolean, aoProgredir: (etapa: string, fracao: number) => void) {
      const id = proximoId++;
      return new Promise<RespostaGeracao>((resolver, rejeitar) => {
        pendentes.set(id, { resolver, rejeitar, aoProgredir });
        worker.postMessage({ id, forma, params, confirmado });
      });
    },
  };
}
