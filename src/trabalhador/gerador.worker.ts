// Web Worker: baixa a elevação e monta a malha sem travar a tela.
import urlWasm from 'manifold-3d/manifold.wasm?url';
import { amostrarElevacao, type GradeElevacao } from '../core/elevacao.ts';
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import { carregarManifold } from '../core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../core/modelo.ts';
import { verificarMalha } from '../core/verificacao.ts';
import { carregarTileTerreno } from '../navegador/tiles.ts';
import type { MensagemDoWorker, PedidoGeracao } from './protocolo.ts';

const enviar = (m: MensagemDoWorker, transferir: Transferable[] = []) => postMessage(m, { transfer: transferir });

// a última grade fica guardada: mudar só exagero/base não baixa nada de novo
let ultimaGrade: { chave: string; grade: GradeElevacao } | null = null;

self.onmessage = async (ev: MessageEvent<PedidoGeracao>) => {
  const { id, forma, params } = ev.data;
  const progresso = (etapa: string, fracao: number) => enviar({ tipo: 'progresso', id, etapa, fracao });
  try {
    progresso('Preparando', 0);
    const wasm = await carregarManifold(urlWasm);
    const grade = await obterGrade(forma, params, (f) => progresso('Baixando elevação', f * 0.6));
    progresso('Montando a malha', 0.65);
    const r = gerarModelo(wasm, grade, forma, params);
    progresso('Verificando a malha', 0.9);
    const verificacao = verificarMalha(r.malha);
    enviar(
      {
        tipo: 'pronto',
        id,
        resultado: {
          posicoes: r.malha.posicoes,
          indices: r.malha.indices,
          larguraMm: r.larguraMm,
          profundidadeMm: r.profundidadeMm,
          alturaMaxMm: r.alturaMaxMm,
          mmPorMetro: r.mmPorMetro,
          zoom: grade.zoom,
          verificacao,
        },
      },
      [r.malha.posicoes.buffer, r.malha.indices.buffer],
    );
  } catch (erro) {
    enviar({ tipo: 'erro', id, mensagem: erro instanceof Error ? erro.message : String(erro) });
  }
};

async function obterGrade(forma: Forma, params: Parametros, aoProgredir: (f: number) => void) {
  const plano = planejarAmostragem(forma, params.resolucao);
  const chave = JSON.stringify([plano.caixaGrade, plano.amostras]);
  if (ultimaGrade?.chave !== chave) {
    const grade = await amostrarElevacao(plano.caixaGrade, plano.amostras, carregarTileTerreno, (a, b) => aoProgredir(a / b));
    ultimaGrade = { chave, grade };
  }
  return ultimaGrade.grade;
}
