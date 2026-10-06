// Mensagens trocadas entre a página e o Web Worker de geração.
import type { EstatisticasCamadas } from '../core/camadas.ts';
import type { GrupoOSM } from '../core/categorias-osm.ts';
import type { InfoCurvas } from '../core/modelo.ts';
import type { Parametros } from '../core/estado.ts';
import type { Forma } from '../core/geo.ts';
import type { ResultadoVerificacao } from '../core/verificacao.ts';

export interface PedidoGeracao {
  tipo: 'gerar';
  id: number;
  forma: Forma;
  params: Parametros;
  /** o usuário já confirmou que quer gerar mesmo com muitos elementos */
  confirmado?: boolean;
}

export type MensagemParaWorker = PedidoGeracao | { tipo: 'cancelar'; id: number };

/** Pedaços da área cujo download do OSM falhou (o modelo foi gerado sem eles). */
export interface BlocosFaltando {
  grupo: GrupoOSM;
  nome: string;
  blocos: { s: number; w: number; n: number; e: number }[];
}

/** Quantos elementos do OSM entram em cada camada (null = camada desligada). */
export interface Contagem {
  predios: number | null;
  vias: number | null;
  agua: number | null;
  cobertura: number | null;
  arvores: number | null;
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
  contagem: Contagem;
  estatisticasCamadas: EstatisticasCamadas | null;
  avisosCamadas: string[];
  faltando: BlocosFaltando[];
  /** de onde vieram os dados do OSM (null = nenhuma camada do OSM ligada) */
  fonteOsm: 'local' | 'overpass' | null;
  /** curvas de nível: intervalo, quantos níveis e faixa de altitudes */
  curvas: InfoCurvas | null;
}

export interface ResultadoGeracao {
  partes: ParteGerada[];
  /** todas as peças fundidas (STL único) */
  unica: { posicoes: Float32Array; indices: Uint32Array };
  verificacao: ResultadoVerificacao;
  info: InfoModelo;
  /** curvas de nível só para a visualização (x, y, z, …) */
  linhasPrevia: Float32Array[];
}

export type MensagemDoWorker =
  | { tipo: 'progresso'; id: number; etapa: string; fracao: number }
  | { tipo: 'pronto'; id: number; resultado: ResultadoGeracao }
  | { tipo: 'confirmar'; id: number; contagem: Contagem }
  | { tipo: 'erro'; id: number; mensagem: string; cancelado?: boolean };
