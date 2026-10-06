// Lado da página que conversa com o Web Worker de geração.
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import type { MensagemDoWorker, ResultadoGeracao } from '../trabalhador/protocolo.ts';

export function criarGerador() {
  const worker = new Worker(new URL('../trabalhador/gerador.worker.ts', import.meta.url), { type: 'module' });
  let proximoId = 1;
  const pendentes = new Map<number, {
    resolver: (r: ResultadoGeracao) => void;
    rejeitar: (e: Error) => void;
    aoProgredir: (etapa: string, fracao: number) => void;
  }>();

  worker.onmessage = (ev: MessageEvent<MensagemDoWorker>) => {
    const m = ev.data;
    const p = pendentes.get(m.id);
    if (!p) return;
    if (m.tipo === 'progresso') p.aoProgredir(m.etapa, m.fracao);
    else {
      pendentes.delete(m.id);
      if (m.tipo === 'pronto') p.resolver(m.resultado);
      else p.rejeitar(new Error(m.mensagem));
    }
  };
  worker.onerror = (ev) => {
    for (const p of pendentes.values()) p.rejeitar(new Error(ev.message || 'Falha no processamento'));
    pendentes.clear();
  };

  return {
    gerar(forma: Forma, params: Parametros, aoProgredir: (etapa: string, fracao: number) => void) {
      const id = proximoId++;
      return new Promise<ResultadoGeracao>((resolver, rejeitar) => {
        pendentes.set(id, { resolver, rejeitar, aoProgredir });
        worker.postMessage({ id, forma, params });
      });
    },
  };
}
