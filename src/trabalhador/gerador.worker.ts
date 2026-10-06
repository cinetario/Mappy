// Web Worker: baixa a elevação e monta a malha sem travar a tela.
import urlWasm from 'manifold-3d/manifold.wasm?url';
import { amostrarElevacao, type GradeElevacao } from '../core/elevacao.ts';
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import { carregarManifold } from '../core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../core/modelo.ts';
import { verificarMalha } from '../core/verificacao.ts';
import { FONTES_TILES, gradeCopernicus } from '../navegador/tiles.ts';
import type { MensagemDoWorker, PedidoGeracao, ResultadoGeracao } from './protocolo.ts';

const enviar = (m: MensagemDoWorker, transferir: Transferable[] = []) => postMessage(m, { transfer: transferir });

// a última grade fica guardada: mudar só exagero/base/estilo não baixa nada de novo
let ultimaGrade: { chave: string; grade: GradeElevacao & { aviso?: string } } | null = null;

self.onmessage = async (ev: MessageEvent<PedidoGeracao>) => {
  const { id, forma, params } = ev.data;
  const progresso = (etapa: string, fracao: number) => enviar({ tipo: 'progresso', id, etapa, fracao });
  try {
    progresso('Preparando', 0);
    const wasm = await carregarManifold(urlWasm);
    const grade = await obterGrade(forma, params, (f) => progresso('Baixando elevação', f * 0.6));
    progresso('Montando a malha', 0.65);
    const r = gerarModelo(wasm, grade, forma, params);
    progresso('Verificando as peças', 0.9);

    const transferir: Transferable[] = [];
    const resultado: ResultadoGeracao = {
      partes: r.partes.map((p) => {
        transferir.push(p.malha.posicoes.buffer, p.malha.indices.buffer);
        return {
          id: p.id, nome: p.nome, cor: p.cor, zMin: p.zMin, zMax: p.zMax,
          posicoes: p.malha.posicoes, indices: p.malha.indices,
          verificacao: verificarMalha(p.malha),
        };
      }),
      unica: r.malhaUnica,
      verificacao: verificarMalha(r.malhaUnica),
      info: {
        unidade: r.unidade,
        largura: r.largura,
        profundidade: r.profundidade,
        alturaMax: r.alturaMax,
        porMetro: r.porMetro,
        escala: r.escala,
        exageroEfetivo: r.exageroEfetivo,
        zBase: r.zBase,
        altitudeMin: r.altitudeMin,
        altitudeMax: r.altitudeMax,
        triangulosGrade: r.triangulosGrade,
        triangulosSuperficie: r.triangulosSuperficie,
        zoom: grade.zoom,
        zoomEfetivo: grade.zoomEfetivo ?? grade.zoom,
        resolucaoM: grade.resolucaoM ?? 30,
        aviso: grade.aviso,
      },
    };
    transferir.push(r.malhaUnica.posicoes.buffer, r.malhaUnica.indices.buffer);
    enviar({ tipo: 'pronto', id, resultado }, transferir);
  } catch (erro) {
    enviar({ tipo: 'erro', id, mensagem: erro instanceof Error ? erro.message : String(erro) });
  }
};

async function obterGrade(forma: Forma, params: Parametros, aoProgredir: (f: number) => void) {
  const plano = planejarAmostragem(forma, params.resolucao);
  const chave = JSON.stringify([plano.caixaGrade, plano.amostras, params.fonte, params.zoom]);
  if (ultimaGrade?.chave !== chave) {
    const grade = params.fonte === 'copernicus'
      ? await gradeCopernicus(plano.caixaGrade, plano.amostras)
      : await amostrarElevacao(plano.caixaGrade, plano.amostras, FONTES_TILES[params.fonte], {
        zoom: params.zoom || undefined,
        aoProgredir: (a, b) => aoProgredir(a / b),
      });
    ultimaGrade = { chave, grade };
  }
  return ultimaGrade.grade;
}
