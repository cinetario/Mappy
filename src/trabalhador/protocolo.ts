// Mensagens trocadas entre a página e o Web Worker de geração.
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import type { ResultadoVerificacao } from '../core/verificacao.ts';

export interface PedidoGeracao {
  id: number;
  forma: Forma;
  params: Parametros;
}

export interface ResultadoGeracao {
  posicoes: Float32Array;
  indices: Uint32Array;
  larguraMm: number;
  profundidadeMm: number;
  alturaMaxMm: number;
  mmPorMetro: number;
  zoom: number;
  verificacao: ResultadoVerificacao;
}

export type MensagemDoWorker =
  | { tipo: 'progresso'; id: number; etapa: string; fracao: number }
  | { tipo: 'pronto'; id: number; resultado: ResultadoGeracao }
  | { tipo: 'erro'; id: number; mensagem: string };
