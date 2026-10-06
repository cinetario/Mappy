// Web Worker: baixa elevação e dados do OSM e monta a malha sem travar a tela.
import urlWasm from 'manifold-3d/manifold.wasm?url';
import urlAnton from '../fontes/Anton-Regular.ttf?url';
import urlArchivo from '../fontes/ArchivoBlack-Regular.ttf?url';
import urlBebas from '../fontes/BebasNeue-Regular.ttf?url';
import type { DadosCamadas } from '../core/camadas.ts';
import { amostrarElevacao, type GradeElevacao } from '../core/elevacao.ts';
import type { Parametros } from '../core/estado.ts';
import { areaM2, type Forma } from '../core/geo.ts';
import { LIMITE_CONFIRMACAO, camadaUrbanaAtiva } from '../core/limites.ts';
import { carregarManifold } from '../core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../core/modelo.ts';
import { extrairAgua, extrairArvores, extrairCobertura, extrairPredios, extrairVias, filtrarPorArea, type ElementoOSM, type GrupoOSM } from '../core/osm.ts';
import type { Malha } from '../core/malha.ts';
import { escreverStl, lerStl } from '../core/stl.ts';
import { carregarFonte, type NomeFonteTexto } from '../core/texto.ts';
import { verificarMalha } from '../core/verificacao.ts';
import { baixarOSM, baixarPrediosExtras, indiceCobre, obterInfoIndiceLocal, type ConjuntoPredios } from '../navegador/osm-cliente.ts';
import { combinarPredios } from '../core/predios-fontes.ts';
import { FONTES_TILES, gradeCopernicus } from '../navegador/tiles.ts';
import { Cancelado } from '../core/blocos.ts';
import type { BlocoGerado, BlocosFaltando, Contagem, InfoPredios, MensagemDoWorker, MensagemParaWorker, ParteGerada, ResultadoGeracao } from './protocolo.ts';

/** Verifica a malha como ela fica no arquivo (STL não guarda topologia: vértices são soldados pela posição). */
const verificarComoStl = (m: Malha) => verificarMalha(lerStl(escreverStl(m)));

const enviar = (m: MensagemDoWorker, transferir: Transferable[] = []) => postMessage(m, { transfer: transferir });

// a última grade fica guardada: mudar só exagero/base/estilo não baixa nada de novo
let ultimaGrade: { chave: string; grade: GradeElevacao & { aviso?: string } } | null = null;

const NOMES: Record<GrupoOSM, string> = { predios: 'prédios', vias: 'ruas', agua: 'água', cobertura: 'cobertura do solo', arvores: 'árvores' };

const cancelamentos = new Map<number, AbortController>();

const URL_FONTES: Record<NomeFonteTexto, string> = { archivo: urlArchivo, bebas: urlBebas, anton: urlAnton };

/** Fonte do texto da moldura (baixada uma vez; só quando há texto). */
async function obterFonte(params: Parametros) {
  if (!params.moldura || !params.texto.trim()) return null;
  const nome = params.textoFonte as NomeFonteTexto;
  const resp = await fetch(URL_FONTES[nome]);
  if (!resp.ok) throw new Error(`Não foi possível carregar a fonte do texto (${resp.status}).`);
  return carregarFonte(nome, await resp.arrayBuffer());
}

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
    const avisosFonte: string[] = [];

    // ---- prédios de outras fontes (Overture, prefeitura), já importados no índice local ----
    const prediosLigados = camadaUrbanaAtiva(params.predios, km2);
    let fontePredios = params.prediosFonte;
    let extras: { elementos: ElementoOSM[]; conjuntos: ConjuntoPredios[] } | null = null;
    if (prediosLigados && fontePredios !== 'osm') {
      const fonteExtra = fontePredios === 'prefeitura' ? 'prefeitura' : 'overture';
      progresso(`Lendo prédios (${fonteExtra === 'overture' ? 'Overture' : 'prefeitura'}) do índice local`, 0.35);
      extras = await baixarPrediosExtras(fonteExtra, plano.caixaGrade, sinal);
      if (fonteExtra === 'overture' && !extras.conjuntos.length) {
        avisosFonte.push('Os prédios do Overture desta área ainda não foram importados: usando só o OSM. '
          + 'Para importar, rode "npm run importar-overture -- oeste,sul,leste,norte" (veja o README).');
        fontePredios = 'osm';
        extras = null;
      } else if (fonteExtra === 'prefeitura' && !extras.elementos.length) {
        avisosFonte.push('Nenhum prédio do arquivo da prefeitura nesta área: usando o OSM. Importe com "npm run importar-predios".');
        fontePredios = 'osm';
        extras = null;
      } else if (fonteExtra === 'prefeitura' && !extras.conjuntos.length) {
        avisosFonte.push('O arquivo da prefeitura não cobre a área inteira: fora dele não há prédios.');
      }
    }
    if (prediosLigados && (fontePredios === 'osm' || fontePredios === 'automatico')) grupos.push('predios');
    if (camadaUrbanaAtiva(params.ruas, km2)) grupos.push('vias');
    if (params.agua) grupos.push('agua');
    // cobertura: para a camada e também para encher florestas de árvores
    if (params.cobertura || (params.arvores && params.arvoresFlorestas)) grupos.push('cobertura');
    if (params.arvores && params.arvoresOsm) grupos.push('arvores');
    const dados: DadosCamadas = { predios: null, vias: null, agua: null, cobertura: null, arvores: null };
    const faltando: BlocosFaltando[] = [];

    // fonte dos dados: arquivo local quando escolhido e quando ele cobre a área
    let fonteOsm: 'local' | 'overpass' | null = null;
    if (grupos.length) {
      fonteOsm = 'overpass';
      if (params.fonteOsm === 'local') {
        const info = await obterInfoIndiceLocal();
        if (await indiceCobre(info, plano.caixaGrade)) fonteOsm = 'local';
        else if (!info?.disponivel) avisosFonte.push('Nenhum arquivo local do OpenStreetMap foi importado: usando o Overpass (online). Veja a aba Camadas.');
        else if (info.desatualizado) avisosFonte.push('O índice local é de uma versão antiga do app: rode "npm run importar-osm" de novo. Usando o Overpass.');
        else avisosFonte.push(`A área fica fora do arquivo local (${info.arquivos.map((a) => a.nome).join(', ')}): usando o Overpass (online).`);
      }
    }
    const origem = fonteOsm === 'local' ? 'do arquivo local' : 'do OpenStreetMap';

    for (const [k, grupo] of grupos.entries()) {
      const base = 0.35 + (k / grupos.length) * 0.35;
      const { elementos: baixados, faltando: semDados } = await baixarOSM(grupo, plano.caixaGrade, ({ feitos, total, mensagem }) =>
        progresso(
          `${fonteOsm === 'local' ? 'Lendo' : 'Baixando'} ${NOMES[grupo]} ${origem} (bloco ${Math.min(feitos + 1, total)} de ${total})${mensagem ? ` · ${mensagem}` : ''}`,
          base + (feitos / total) * (0.35 / grupos.length),
        ), sinal, fonteOsm ?? 'overpass');
      if (semDados.length) faltando.push({ grupo, nome: NOMES[grupo], blocos: semDados });
      // só o que toca a área; a costa vem inteira (o mar é montado seguindo as linhas até a borda)
      const costa = baixados.filter((e) => e.tags?.natural === 'coastline');
      const elementos = [...filtrarPorArea(baixados.filter((e) => e.tags?.natural !== 'coastline'), plano.caixaGrade), ...costa];
      if (grupo === 'predios') dados.predios = extrairPredios(elementos, params.prediosDetalhados, params.prediosAlturaPadraoM);
      if (grupo === 'vias') dados.vias = extrairVias(elementos);
      if (grupo === 'agua') dados.agua = extrairAgua(elementos);
      if (grupo === 'cobertura') dados.cobertura = extrairCobertura(elementos);
      if (grupo === 'arvores') dados.arvores = extrairArvores(elementos);
    }
    // ---- prédios: fonte escolhida ----
    let infoPredios: InfoPredios | null = null;
    if (prediosLigados) {
      const deExtras = extras ? extrairPredios(filtrarPorArea(extras.elementos, plano.caixaGrade), params.prediosDetalhados, params.prediosAlturaPadraoM) : [];
      if (fontePredios === 'automatico' && extras) {
        const c = combinarPredios(dados.predios ?? [], deExtras);
        dados.predios = c.predios;
        infoPredios = { fonte: 'automatico', conjuntos: extras.conjuntos, alturasCompletadas: c.alturasCompletadas, descartados: c.descartados, copiasDoOsm: c.copiasDoOsm };
      } else if (fontePredios === 'overture' || fontePredios === 'prefeitura') {
        dados.predios = deExtras;
        infoPredios = { fonte: fontePredios, conjuntos: extras?.conjuntos ?? [], alturasCompletadas: 0, descartados: 0, copiasDoOsm: 0 };
      } else {
        infoPredios = { fonte: 'osm', conjuntos: [], alturasCompletadas: 0, descartados: 0, copiasDoOsm: 0 };
      }
    }
    const contagem: Contagem = {
      predios: dados.predios?.length ?? null,
      vias: dados.vias?.length ?? null,
      agua: dados.agua ? dados.agua.poligonos.length + dados.agua.rios.length : null,
      cobertura: params.cobertura ? (dados.cobertura?.length ?? 0) : null,
      arvores: dados.arvores ? dados.arvores.pontos.length + dados.arvores.fileiras.length : null,
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
    const fonte = await obterFonte(params);
    const r = gerarModelo(wasm, grade, forma, params, dados, { fonte });
    progresso('Verificando as peças', 0.95);

    const transferir: Transferable[] = [];
    const parte = (p: (typeof r.partes)[number]): ParteGerada => {
      transferir.push(p.malha.posicoes.buffer, p.malha.indices.buffer);
      return {
        id: p.id, nome: p.nome, cor: p.cor, zMin: p.zMin, zMax: p.zMax,
        posicoes: p.malha.posicoes, indices: p.malha.indices,
        verificacao: verificarComoStl(p.malha),
      };
    };
    const blocos: BlocoGerado[] = r.blocos.map((b) => {
      transferir.push(b.malhaUnica.posicoes.buffer, b.malhaUnica.indices.buffer);
      return {
        rotulo: b.rotulo,
        coluna: b.rotulo.charCodeAt(0) - 65,
        linha: Number(b.rotulo.slice(1)) - 1,
        partes: b.partes.map(parte),
        unica: b.malhaUnica,
        verificacao: verificarComoStl(b.malhaUnica),
      };
    });
    const resultado: ResultadoGeracao = {
      partes: r.partes.map(parte),
      blocos,
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
        avisosCamadas: [...avisosFonte, ...faltando.map(textoFaltando), ...(r.camadas?.avisos ?? []), ...r.avisos],
        fonteOsm,
        faltando,
        curvas: r.curvas,
        predios: infoPredios,
      },
      linhasPrevia: r.camadas?.linhasPrevia ?? [],
    };
    transferir.push(r.malhaUnica.posicoes.buffer, r.malhaUnica.indices.buffer);
    for (const l of resultado.linhasPrevia) transferir.push(l.buffer);
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
