// Web Worker: baixa elevação e dados do OSM e monta a malha sem travar a tela.
import urlWasm from 'manifold-3d/manifold.wasm?url';
import type { DadosCamadas } from '../core/camadas.ts';
import { amostrarElevacao, type GradeElevacao } from '../core/elevacao.ts';
import type { Parametros } from '../core/estado.ts';
import { areaM2, type Forma } from '../core/geo.ts';
import { LIMITE_CONFIRMACAO, camadaUrbanaAtiva } from '../core/limites.ts';
import { carregarManifold } from '../core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../core/modelo.ts';
import { extrairAgua, extrairPredios, extrairVias, filtrarPorArea, type GrupoOSM } from '../core/osm.ts';
import type { Malha } from '../core/malha.ts';
import { escreverStl, lerStl } from '../core/stl.ts';
import { verificarMalha } from '../core/verificacao.ts';
import { baixarOSM } from '../navegador/osm-cliente.ts';
import { FONTES_TILES, gradeCopernicus } from '../navegador/tiles.ts';
import { Cancelado } from '../core/blocos.ts';
import type { BlocosFaltando, Contagem, MensagemDoWorker, MensagemParaWorker, ResultadoGeracao } from './protocolo.ts';

/** Verifica a malha como ela fica no arquivo (STL não guarda topologia: vértices são soldados pela posição). */
const verificarComoStl = (m: Malha) => verificarMalha(lerStl(escreverStl(m)));

const enviar = (m: MensagemDoWorker, transferir: Transferable[] = []) => postMessage(m, { transfer: transferir });

// a última grade fica guardada: mudar só exagero/base/estilo não baixa nada de novo
let ultimaGrade: { chave: string; grade: GradeElevacao & { aviso?: string } } | null = null;

const NOMES: Record<GrupoOSM, string> = { predios: 'prédios', vias: 'ruas', agua: 'água' };

const cancelamentos = new Map<number, AbortController>();

self.onmessage = async (ev: MessageEvent<MensagemParaWorker>) => {
  if (ev.data.tipo === 'cancelar') {
    cancelamentos.get(ev.data.id)?.abort();
    return;
  }
  const { id, forma, params, confirmado } = ev.data;
  const controle = new AbortController();
  cancelamentos.set(id, controle);
  const sinal = controle.signal;
  const progresso = (etapa: string, fracao: number) => enviar({ tipo: 'progresso', id, etapa, fracao });
  try {
    progresso('Preparando', 0);
    const wasm = await carregarManifold(urlWasm);
    const plano = planejarAmostragem(forma, params.resolucao);
    const grade = await obterGrade(forma, params, (f) => progresso('Baixando elevação', f * 0.35));

    // ---- camadas do OpenStreetMap ----
    const km2 = areaM2(forma) / 1e6;
    const grupos: GrupoOSM[] = [];
    if (camadaUrbanaAtiva(params.predios, km2)) grupos.push('predios');
    if (camadaUrbanaAtiva(params.ruas, km2)) grupos.push('vias');
    if (params.agua) grupos.push('agua');
    const dados: DadosCamadas = { predios: null, vias: null, agua: null };
    const faltando: BlocosFaltando[] = [];
    for (const [k, grupo] of grupos.entries()) {
      const base = 0.35 + (k / grupos.length) * 0.35;
      const { elementos: baixados, faltando: semDados } = await baixarOSM(grupo, plano.caixaGrade, ({ feitos, total, mensagem }) =>
        progresso(
          `Baixando ${NOMES[grupo]} do OpenStreetMap (bloco ${Math.min(feitos + 1, total)} de ${total})${mensagem ? ` · ${mensagem}` : ''}`,
          base + (feitos / total) * (0.35 / grupos.length),
        ), sinal);
      if (semDados.length) faltando.push({ grupo, nome: NOMES[grupo], blocos: semDados });
      // só o que toca a área; a costa vem inteira (o mar é montado seguindo as linhas até a borda)
      const costa = baixados.filter((e) => e.tags?.natural === 'coastline');
      const elementos = [...filtrarPorArea(baixados.filter((e) => e.tags?.natural !== 'coastline'), plano.caixaGrade), ...costa];
      if (grupo === 'predios') dados.predios = extrairPredios(elementos, params.prediosDetalhados, params.prediosAlturaPadraoM);
      if (grupo === 'vias') dados.vias = extrairVias(elementos);
      if (grupo === 'agua') dados.agua = extrairAgua(elementos);
    }
    const contagem: Contagem = {
      predios: dados.predios?.length ?? null,
      vias: dados.vias?.length ?? null,
      agua: dados.agua ? dados.agua.poligonos.length + dados.agua.rios.length : null,
      cobertura: null,
    };
    const demais = (contagem.predios ?? 0) > LIMITE_CONFIRMACAO.predios
      || (contagem.vias ?? 0) > LIMITE_CONFIRMACAO.vias
      || (contagem.agua ?? 0) > LIMITE_CONFIRMACAO.agua;
    if (demais && !confirmado) {
      enviar({ tipo: 'confirmar', id, contagem });
      return;
    }

    if (sinal.aborted) throw new Cancelado();
    progresso('Montando a malha', 0.75);
    const r = gerarModelo(wasm, grade, forma, params, dados);
    progresso('Verificando as peças', 0.95);

    const transferir: Transferable[] = [];
    const resultado: ResultadoGeracao = {
      partes: r.partes.map((p) => {
        transferir.push(p.malha.posicoes.buffer, p.malha.indices.buffer);
        return {
          id: p.id, nome: p.nome, cor: p.cor, zMin: p.zMin, zMax: p.zMax,
          posicoes: p.malha.posicoes, indices: p.malha.indices,
          verificacao: verificarComoStl(p.malha),
        };
      }),
      unica: r.malhaUnica,
      verificacao: verificarComoStl(r.malhaUnica),
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
        contagem,
        estatisticasCamadas: r.camadas?.estatisticas ?? null,
        avisosCamadas: [...faltando.map(textoFaltando), ...(r.camadas?.avisos ?? [])],
        faltando,
      },
    };
    transferir.push(r.malhaUnica.posicoes.buffer, r.malhaUnica.indices.buffer);
    enviar({ tipo: 'pronto', id, resultado }, transferir);
  } catch (erro) {
    const cancelado = erro instanceof Cancelado || sinal.aborted;
    enviar({ tipo: 'erro', id, cancelado, mensagem: cancelado ? 'Cancelado' : erro instanceof Error ? erro.message : String(erro) });
  } finally {
    cancelamentos.delete(id);
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

/** "Prédios: 2 pedaços da área ficaram sem dados (18,90°S 41,94°O; …)" */
function textoFaltando(f: BlocosFaltando): string {
  const grau = (v: number) => Math.abs(v).toFixed(2).replace('.', ',');
  const lugar = (b: { s: number; w: number; n: number; e: number }) => {
    const lat = (b.s + b.n) / 2;
    const lon = (b.w + b.e) / 2;
    return `${grau(lat)}°${lat < 0 ? 'S' : 'N'} ${grau(lon)}°${lon < 0 ? 'O' : 'L'}`;
  };
  const n = f.blocos.length;
  const nome = f.nome[0].toUpperCase() + f.nome.slice(1);
  const pedacos = n === 1 ? '1 pedaço da área ficou' : `${n} pedaços da área ficaram`;
  const lista = f.blocos.slice(0, 4).map(lugar).join('; ') + (n > 4 ? '…' : '');
  return `${nome}: ${pedacos} sem dados porque o OpenStreetMap não respondeu (marcados em vermelho no mapa: ${lista}). `
    + 'Gere de novo mais tarde: o que já veio fica guardado no cache.';
}
