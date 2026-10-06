// Mensagens trocadas entre a página e o Web Worker de geração.
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import type { ResultadoVerificacao } from '../core/verificacao.ts';

export interface PedidoGeracao {
  id: number;
  forma: Forma;
  params: Parametros;
}

export interface ParteGerada {
  id: string;
  nome: string;
  cor: string;
  posicoes: Float32Array;
  indices: Uint32Array;
  zMin: number;
  zMax: number;
  verificacao: ResultadoVerificacao;
}

export interface InfoModelo {
  unidade: 'mm' | 'm';
  largura: number;
  profundidade: number;
  alturaMax: number;
  porMetro: number;
  escala: number;
  exageroEfetivo: number;
  zBase: number;
  altitudeMin: number;
  altitudeMax: number;
  triangulosGrade: number;
  triangulosSuperficie: number;
  /** zoom dos tiles pedido e efetivamente usado (-1 = fonte sem tiles) */
  zoom: number;
  zoomEfetivo: number;
  resolucaoM: number;
  aviso?: string;
}

export interface ResultadoGeracao {
  partes: ParteGerada[];
  /** todas as peças fundidas (STL único) */
  unica: { posicoes: Float32Array; indices: Uint32Array };
  verificacao: ResultadoVerificacao;
  info: InfoModelo;
}

export type MensagemDoWorker =
  | { tipo: 'progresso'; id: number; etapa: string; fracao: number }
  | { tipo: 'pronto'; id: number; resultado: ResultadoGeracao }
  | { tipo: 'erro'; id: number; mensagem: string };
