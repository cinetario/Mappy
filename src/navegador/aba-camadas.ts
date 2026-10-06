// Aba "Camadas": prédios, ruas e água.
import { alinharEspessura } from '../core/camadas-impressao.ts';
import type { NomeParametro, Valor } from '../core/estado.ts';
import { AREA_GRANDE_KM2, AREA_LIVRE_KM2, LARGURA_MINIMA_MM, camadaUrbanaAtiva } from '../core/limites.ts';
import {
  LISTA_TIPOS_VIA, TIPOS_SO_PRINCIPAIS, TIPOS_VIA, escreverTiposDesligados, lerTiposDesligados, type TipoVia,
} from '../core/vias.ts';
import {
  booleano, camada, cor, informacao, numero, opcoes, subsecao,
  type AoMudar, type Contexto, type Controle,
} from './painel.ts';
import { decimal, distancia, inteiro, medidaModelo, type Sistema } from './unidades.ts';
import { LISTA_COBERTURA, TIPOS_COBERTURA, type TipoCobertura } from '../core/categorias-osm.ts';
import { coberturaPadrao, escreverCobertura, lerCobertura } from '../core/cobertura.ts';

export interface AcoesCamadas {
  aoMudar: AoMudar;
  aoOcultar: (id: string, oculta: boolean) => void;
}

/** O que está importado para cada fonte de prédios, e como importar. */
function dicaFontePredios(c: Contexto): string {
  const conj = c.osmLocal?.conjuntos ?? [];
  const lista = (fonte: 'overture' | 'prefeitura') => conj.filter((x) => x.fonte === fonte)
    .map((x) => `${x.nome} (${inteiro(x.quantidade)})`).join(', ');
  switch (c.params.prediosFonte) {
    case 'overture':
    case 'automatico': {
      const l = lista('overture');
      const base = c.params.prediosFonte === 'automatico'
        ? 'OSM onde houver; o Overture completa alturas e prédios que faltam, sem duplicar. '
        : 'Inclui prédios do OSM, Google Open Buildings, Microsoft e Esri. ';
      return base + (l ? `Importado: ${l}.` : '<span class="aviso-leve">Nada importado ainda: rode <code>npm run importar-overture -- df</code> (ou uma caixa oeste,sul,leste,norte).</span>');
    }
    case 'prefeitura': {
      const l = lista('prefeitura');
      return l ? `Importado: ${l}.` : '<span class="aviso-leve">Nenhum arquivo importado: rode <code>npm run importar-predios -- arquivo.zip</code> (veja o README).</span>';
    }
    default:
      return '';
  }
}

/** mm impressos → metros reais (com a escala prevista). */
const emMetros = (c: Contexto, mm: number) => (c.mmPorMetro ? mm / c.mmPorMetro : null);

export function montarAbaCamadas(container: HTMLElement, a: AcoesCamadas) {
  const { aoMudar } = a;
  const sis = (c: Contexto) => c.params.unidades as Sistema;
  const equivalente = (c: Contexto, mm: number) => {
    const m = emMetros(c, mm);
    return m === null ? '' : `≈ ${distancia(m, sis(c))} reais`;
  };
  const automatico = (valor: 'auto' | 'sim' | 'nao', c: Contexto) => {
    if (valor !== 'auto') return 'manual';
    return c.km2 !== null && c.km2 > AREA_GRANDE_KM2 ? `automático: desligado acima de ${AREA_GRANDE_KM2} km²` : 'automático';
  };
  const avisoGrande = (nome: NomeParametro) => (c: Contexto) =>
    c.params[nome] === 'sim' && c.km2 !== null && c.km2 > AREA_GRANDE_KM2
      ? `<div class="aviso">Ligado manualmente numa área de ${inteiro(c.km2)} km²: o download fica lento e os detalhes saem finos demais para imprimir.</div>`
      : '';
  const voltarAuto = (nome: NomeParametro): Controle => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secundario pequeno';
    b.textContent = 'Voltar ao automático';
    b.addEventListener('click', () => aoMudar(nome, 'auto'));
    return { el: b, atualizar: (c) => { b.hidden = c.params[nome] === 'auto'; } };
  };

  // ================= PRÉDIOS =================
  const predios = camada({
    id: 'predios',
    titulo: 'Prédios',
    ligada: (c) => camadaUrbanaAtiva(c.params.predios, c.km2 ?? 0),
    observacao: (c) => automatico(c.params.predios, c),
    aoLigar: (v) => aoMudar('predios', v ? 'sim' : 'nao'),
    contagem: (c) => (c.info?.contagem.predios != null ? inteiro(c.info.contagem.predios) : ''),
    aoOcultar: (o) => a.aoOcultar('predios', o),
    icone: 'predios', cor: (c) => c.params.prediosCor,
  }, [
    informacao(avisoGrande('predios'), { visivel: (c) => !!avisoGrande('predios')(c) }),
    voltarAuto('predios'),
    opcoes('prediosFonte', 'Fonte dos prédios', [
      ['osm', 'OpenStreetMap'],
      ['overture', 'Overture Maps'],
      ['automatico', 'Automático (OSM + Overture)'],
      ['prefeitura', 'Arquivo da prefeitura'],
    ], aoMudar, { lista: true, dica: dicaFontePredios }),
    informacao((c) => {
      const s = c.info?.estatisticasCamadas?.predios;
      if (!s) return 'Altura vinda de <strong>height</strong> e <strong>building:levels</strong> (3 m por andar).';
      const u = sis(c);
      const nomes: Record<string, string> = { osm: 'OpenStreetMap', overture: 'Overture', prefeitura: 'prefeitura' };
      const porFonte = Object.entries(s.porFonte).map(([f, q]) => `${nomes[f] ?? f}: <strong>${inteiro(q ?? 0)}</strong>`).join(' · ');
      const origensOverture = s.porFonte.overture
        ? `<br><span class="dica">Overture por base: ${Object.entries(s.origens).filter(([o]) => o !== 'OpenStreetMap' || !s.porFonte.osm)
          .sort((x, y) => y[1] - x[1]).map(([o, q]) => `${o} ${inteiro(q)}`).join(' · ')}</span>`
        : '';
      const p = c.info?.predios;
      const auto = p?.fonte === 'automatico'
        ? `<br>Automático: ${inteiro(p.alturasCompletadas)} do OSM ganharam altura do Overture; ${inteiro(p.descartados)} do Overture eram o mesmo prédio do OSM (descartados).`
        : '';
      return `<strong>${inteiro(s.quantidade)}</strong> prédios · ${porFonte}${origensOverture}<br>
        Sem altura (usam o padrão de ${inteiro(c.params.prediosAlturaPadraoM)} m): <strong>${inteiro(s.semAltura)}</strong>${s.alturaDeOutraFonte ? ` · altura vinda de outra fonte: ${inteiro(s.alturaDeOutraFonte)}` : ''}${auto}<br>
        ${s.telhados ? `Telhados desenhados: ${inteiro(s.telhados)}<br>` : ''}${s.comVao ? `Partes com vão embaixo: ${inteiro(s.comVao)}<br>` : ''}
        Mais baixo: <strong>${medidaModelo(s.menorMm, u, 1)}</strong> (${distancia(s.menorM, u)} reais)<br>
        Mais alto: <strong>${medidaModelo(s.maiorMm, u, 1)}</strong> (${distancia(s.maiorM, u)} reais)`;
    }),
    booleano('prediosDetalhados', 'Prédios detalhados (usa building:part quando existir)', aoMudar),
    opcoes('prediosPartesAcima', 'Partes que começam no alto (min_height)', [['preencher', 'Preencher embaixo'], ['vao', 'Deixar o vão']], aoMudar, {
      visivel: (c) => c.params.prediosDetalhados,
      dica: (c) => (c.params.prediosPartesAcima === 'vao' ? '<span class="aviso-leve">O vão fica no ar: a impressão precisa de suporte.</span>' : 'Passarelas e marquises viram blocos cheios: imprime sem suporte.'),
    }),
    booleano('prediosTelhados', 'Telhados (roof:shape do OSM)', aoMudar, {
      dica: 'Duas águas, quatro águas, piramidal e cúpula, onde o OSM informa o formato. Em escala de cidade ficam com décimos de mm; aparecem bem em bairros.',
    }),
    numero('prediosAlturaPadraoM', 'Altura padrão sem informação', aoMudar, { unidade: 'm', passo: 1 }),
    numero('prediosExagero', 'Exagero de altura', aoMudar, { deslizante: true, passo: 0.05, exibir: (c) => `${decimal(c.params.prediosExagero, 2)}x` }),
    numero('prediosAleatorio', 'Aleatoriedade de altura', aoMudar, {
      deslizante: true, passo: 1, exibir: (c) => (c.params.prediosAleatorio ? `±${c.params.prediosAleatorio}%` : 'nenhuma'),
      dica: 'Variação natural, sempre igual para o mesmo prédio.',
    }),
    opcoes('prediosIntegracao', 'Integração com o terreno', [['elevado', 'Elevado'], ['rebaixado', 'Rebaixado (em sulco)']], aoMudar),
    numero('prediosProfundidadeMm', 'Profundidade do sulco', aoMudar, {
      unidade: 'mm', passo: 0.2, visivel: (c) => c.params.prediosIntegracao === 'rebaixado',
    }),
    numero('prediosDeslocamentoMm', 'Deslocamento vertical', aoMudar, { unidade: 'mm', passo: 0.2, dica: 'Sobe ou desce todos os telhados.' }),
    cor('prediosCor', 'Cor dos prédios', aoMudar),
    booleano('prediosArestas', 'Mostrar arestas (só na visualização)', aoMudar),
  ]);

  // ================= RUAS =================
  const tabelaVias = tabelaTiposVia(aoMudar);
  const ruas = camada({
    id: 'ruas',
    titulo: 'Ruas',
    ligada: (c) => camadaUrbanaAtiva(c.params.ruas, c.km2 ?? 0),
    observacao: (c) => automatico(c.params.ruas, c),
    aoLigar: (v) => aoMudar('ruas', v ? 'sim' : 'nao'),
    contagem: (c) => (c.info?.contagem.vias != null ? inteiro(c.info.contagem.vias) : ''),
    aoOcultar: (o) => a.aoOcultar('ruas', o),
    icone: 'ruas', cor: (c) => c.params.ruasCor,
  }, [
    informacao(avisoGrande('ruas'), { visivel: (c) => !!avisoGrande('ruas')(c) }),
    voltarAuto('ruas'),
    atalhoPrincipais(aoMudar),
    opcoes('ruasModo', 'Modo', [['superficie', 'Superfície (pintada)'], ['extrudada', 'Extrudada']], aoMudar, {
      dica: (c) => (c.params.ruasModo === 'superficie'
        ? `Embutida no terreno, rente à superfície (${decimal(espessuraFina(c), 2)} mm de espessura): só a cor muda.`
        : ''),
    }),
    opcoes('ruasIntegracao', 'Integração', [['elevada', 'Elevada'], ['rebaixada', 'Rebaixada']], aoMudar, {
      visivel: (c) => c.params.ruasModo === 'extrudada',
    }),
    numero('ruasAlturaMm', 'Altura da extrusão', aoMudar, {
      unidade: 'mm', passo: 0.2,
      visivel: (c) => c.params.ruasModo === 'extrudada' && c.params.ruasIntegracao === 'elevada',
      dica: (c) => `Usada: ${decimal(alinharEspessura(c.params.ruasAlturaMm, camadas(c)), 2)} mm ${equivalente(c, alinharEspessura(c.params.ruasAlturaMm, camadas(c)))}`,
    }),
    numero('ruasProfundidadeMm', 'Profundidade', aoMudar, {
      unidade: 'mm', passo: 0.2,
      visivel: (c) => c.params.ruasModo === 'extrudada' && c.params.ruasIntegracao === 'rebaixada',
      dica: (c) => equivalente(c, c.params.ruasProfundidadeMm),
    }),
    numero('ruasDeslocamentoMm', 'Deslocamento vertical', aoMudar, { unidade: 'mm', passo: 0.2 }),
    cor('ruasCor', 'Cor das ruas', aoMudar),
    numero('ruasEscalaLargura', 'Escala de largura', aoMudar, { deslizante: true, passo: 0.05, exibir: (c) => `${decimal(c.params.ruasEscalaLargura, 2)}x` }),
    subsecao('Tipos de via e larguras (avançado)', [tabelaVias]),
    informacao((c) => {
      const s = c.info?.estatisticasCamadas?.ruas;
      return s ? `<strong>${inteiro(s.quantidade)}</strong> vias no modelo.` : '';
    }),
  ]);

  // ================= ÁGUA =================
  const agua = camada({
    id: 'agua',
    titulo: 'Água',
    ligada: (c) => c.params.agua,
    aoLigar: (v) => aoMudar('agua', v),
    contagem: (c) => (c.info?.contagem.agua != null ? inteiro(c.info.contagem.agua) : ''),
    aoOcultar: (o) => a.aoOcultar('agua', o),
    icone: 'agua', cor: (c) => c.params.aguaCor,
  }, [
    opcoes('aguaModo', 'Modo', [['superficie', 'Superfície (pintada)'], ['extrudada', 'Extrudada']], aoMudar),
    opcoes('aguaIntegracao', 'Integração', [['elevada', 'Elevada'], ['rebaixada', 'Rebaixada (sulco)']], aoMudar, {
      visivel: (c) => c.params.aguaModo === 'extrudada',
      dica: 'Lagos e mar ficam com a superfície plana, numa altura de camada. Rios em declive acompanham o terreno.',
    }),
    numero('aguaAlturaMm', 'Altura', aoMudar, {
      unidade: 'mm', passo: 0.2,
      visivel: (c) => c.params.aguaModo === 'extrudada' && c.params.aguaIntegracao === 'elevada',
    }),
    numero('aguaProfundidadeMm', 'Profundidade do rebaixo', aoMudar, {
      unidade: 'mm', passo: 0.2,
      visivel: (c) => c.params.aguaModo === 'extrudada' && c.params.aguaIntegracao === 'rebaixada',
      dica: (c) => {
        // fundo da água = terreno − profundidade − espessura; precisa sobrar 0,2 mm de base
        const base = c.info?.zBase ?? c.params.baseMm;
        const max = base - 0.2 - espessuraFina(c);
        return c.params.aguaProfundidadeMm > max + 1e-9
          ? `<span class="erro">Nos pontos mais baixos, o rebaixo vai ser limitado a ${decimal(Math.max(0, max), 1)} mm para não furar a base. Aumente a base.</span>`
          : `Máximo sem furar a base: ${decimal(Math.max(0, max), 1)} mm (deixa 0,2 mm de base).`;
      },
    }),
    numero('aguaOpacidade', 'Opacidade (visualização)', aoMudar, { deslizante: true, passo: 0.05, exibir: (c) => `${Math.round(c.params.aguaOpacidade * 100)}%` }),
    cor('aguaCor', 'Cor da água', aoMudar),
    booleano('aguaRios', 'Rios e córregos (linhas do mapa)', aoMudar),
    subsecao('Avançado', [
      booleano('aguaOcultarPequenos', 'Ocultar corpos d\'água pequenos', aoMudar),
      numero('aguaLarguraMinMm', 'Largura mínima', aoMudar, {
        unidade: 'mm', passo: 0.1, visivel: (c) => c.params.aguaOcultarPequenos, dica: (c) => equivalente(c, c.params.aguaLarguraMinMm),
      }),
      numero('aguaAreaMinMm2', 'Área mínima', aoMudar, {
        unidade: 'mm²', passo: 1, visivel: (c) => c.params.aguaOcultarPequenos,
        dica: (c) => {
          const m = emMetros(c, 1);
          return m === null ? '' : `≈ ${inteiro(c.params.aguaAreaMinMm2 * m * m)} m² reais`;
        },
      }),
    ]),
    informacao((c) => {
      const s = c.info?.estatisticasCamadas?.agua;
      if (!s) return '';
      return `${inteiro(s.poligonos)} lagos/rios em área, ${inteiro(s.rios)} rios em linha${s.temMar ? ', mar' : ''}`
        + `${s.planos ? ` · ${s.planos} superfícies planas` : ''}${s.removidosPequenos ? ` · ${s.removidosPequenos} pequenos ocultados` : ''}.`;
    }),
  ]);

  // ================= COBERTURA DO SOLO =================
  const cobertura = camada({
    id: 'cobertura',
    titulo: 'Cobertura do solo',
    ligada: (c) => c.params.cobertura,
    aoLigar: (v) => aoMudar('cobertura', v),
    contagem: (c) => (c.info?.contagem.cobertura != null ? inteiro(c.info.contagem.cobertura) : ''),
    aoOcultar: (o) => a.aoOcultar('cobertura', o),
    icone: 'cobertura', cor: () => '#6f9a45',
  }, [
    informacao(() => 'Florestas, gramados, lavouras, áreas úmidas, areia, gelo, rocha e áreas urbanas (landuse/natural do OSM). Cada categoria vira uma peça com a própria cor.'),
    opcoes('coberturaModo', 'Modo', [['superficie', 'Superfície (pintada)'], ['extrudada', 'Extrudada']], aoMudar),
    numero('coberturaDeslocamentoMm', 'Deslocamento vertical', aoMudar, { unidade: 'mm', passo: 0.2 }),
    numero('coberturaOpacidade', 'Opacidade (visualização)', aoMudar, { deslizante: true, passo: 0.05, exibir: (c) => `${Math.round(c.params.coberturaOpacidade * 100)}%` }),
    subsecao('Categorias (avançado)', [tabelaCobertura(aoMudar)]),
    numero('coberturaAreaMinMm2', 'Área mínima', aoMudar, {
      unidade: 'mm²', passo: 1,
      dica: (c) => {
        const m = emMetros(c, 1);
        return `Áreas menores somem (ficariam só pontinhos de cor). ${m === null ? '' : `≈ ${inteiro(c.params.coberturaAreaMinMm2 * m * m)} m² reais.`}`;
      },
    }),
    informacao((c) => {
      const s = c.info?.estatisticasCamadas?.cobertura;
      if (!s) return '';
      const partes = Object.entries(s.porTipo).map(([t, n]) => `${TIPOS_COBERTURA[t as TipoCobertura].nome}: ${n}`);
      return `${partes.join(' · ') || 'Nenhuma área nesta região.'}${s.removidasPequenas ? ` · ${s.removidasPequenas} pequenas ocultadas` : ''}`;
    }),
  ]);

  // ================= ÁRVORES =================
  const arvores = camada({
    id: 'arvores',
    titulo: 'Árvores',
    ligada: (c) => c.params.arvores,
    aoLigar: (v) => aoMudar('arvores', v),
    contagem: (c) => (c.info?.estatisticasCamadas?.arvores ? inteiro(c.info.estatisticasCamadas.arvores.quantidade) : ''),
    aoOcultar: (o) => a.aoOcultar('arvores', o),
    icone: 'arvores', cor: (c) => c.params.arvoresCor,
  }, [
    booleano('arvoresOsm', 'Árvores mapeadas no OSM (natural=tree)', aoMudar),
    booleano('arvoresFlorestas', 'Preencher áreas de floresta com árvores geradas', aoMudar),
    opcoes('arvoresEstilo', 'Estilo', [
      ['copa', 'Só copa (impressão 3D)'], ['copaLowpoly', 'Só copa low-poly'],
      ['classica', 'Clássica (tronco + copa)'], ['classicaLowpoly', 'Clássica low-poly'],
    ], aoMudar, {
      lista: true,
      dica: (c) => (c.params.arvoresEstilo.startsWith('classica') ? 'O tronco é fino: pode não sair bem com bico de 0,4 mm. Para imprimir, prefira "Só copa".' : ''),
    }),
    numero('arvoresDensidade', 'Densidade nas florestas', aoMudar, {
      deslizante: true, passo: 0.1,
      exibir: (c) => `${decimal(c.params.arvoresDensidade, 1)} por cm²`,
      dica: (c) => {
        const s = c.info?.estatisticasCamadas?.arvores;
        return s ? `<strong>${inteiro(s.quantidade)}</strong> árvores no modelo${s.removidasPorDistancia ? ` (${inteiro(s.removidasPorDistancia)} removidas por estarem perto de ruas, prédios ou água)` : ''}.` : '';
      },
    }),
    numero('arvoresAlturaMm', 'Tamanho (altura)', aoMudar, {
      unidade: 'mm', passo: 0.2,
      dica: (c) => {
        const h = c.params.arvoresAlturaMm;
        const d = Math.max(0.7 * h, LARGURA_MINIMA_MM);
        return `Altura ${decimal(h, 1)} mm ${equivalente(c, h)} · copa ${decimal(d, 1)} mm ${equivalente(c, d)}.`;
      },
    }),
    numero('arvoresDistanciaMm', 'Distância de segurança', aoMudar, {
      unidade: 'mm', passo: 0.1, dica: 'Afasta as copas de ruas, prédios e água. As árvores maiores saem primeiro.',
    }),
    numero('arvoresMaximo', 'Máximo de árvores', aoMudar, { unidade: '', passo: 100, dica: 'Muitas árvores deixam a geração lenta e o arquivo pesado.' }),
    cor('arvoresCor', 'Cor da folhagem', aoMudar),
  ]);

  // ================= CURVAS DE NÍVEL =================
  const curvas = camada({
    id: 'curvas',
    titulo: 'Curvas de nível',
    ligada: (c) => c.params.curvas,
    aoLigar: (v) => aoMudar('curvas', v),
    contagem: (c) => (c.info?.estatisticasCamadas?.curvas ? inteiro(c.info.estatisticasCamadas.curvas.linhas) : ''),
    aoOcultar: (o) => a.aoOcultar('curvas', o),
    icone: 'curvas', cor: (c) => c.params.curvasCor,
  }, [
    informacao((c) => {
      const i = c.info?.curvas;
      const u = sis(c);
      if (!i) return 'Linhas de mesma altitude, calculadas do relevo.';
      return `Altitudes: <strong>${altitudeTexto(i.minM, u)} → ${altitudeTexto(i.maxM, u)}</strong> · intervalo de ${altitudeTexto(i.intervaloM, u)} · ${i.niveis} níveis`;
    }),
    numero('curvasIntervaloM', 'Intervalo', aoMudar, {
      unidade: 'm', passo: 5,
      exibir: (c) => (c.params.curvasIntervaloM === 0 ? 'automático' : ''),
      dica: 'Use 0 para automático (cerca de 15 linhas entre o ponto mais baixo e o mais alto).',
    }),
    booleano('curvasImprimir', 'Imprimir como linhas em relevo baixo', aoMudar, {
      dica: (c) => (c.params.curvasImprimir ? '' : 'Só aparecem na visualização (não vão para o arquivo).'),
    }),
    numero('curvasAlturaMm', 'Altura das linhas', aoMudar, { unidade: 'mm', passo: 0.2, visivel: (c) => c.params.curvasImprimir }),
    numero('curvasLarguraMm', 'Largura das linhas', aoMudar, {
      unidade: 'mm', passo: 0.1, visivel: (c) => c.params.curvasImprimir,
      dica: (c) => (c.params.curvasLarguraMm < LARGURA_MINIMA_MM ? `Abaixo de ${decimal(LARGURA_MINIMA_MM, 1)} mm: será engrossada para imprimir.` : ''),
    }),
    cor('curvasCor', 'Cor das curvas', aoMudar),
  ]);

  const avisos = informacao((c) => (c.info?.avisosCamadas ?? []).map((t) => `<div class="aviso">${t}</div>`).join(''), {
    visivel: (c) => !!c.info?.avisosCamadas?.length,
  });
  const intro = informacao((c) => {
    if (c.km2 === null) return 'Desenhe uma área para ver as camadas.';
    if (c.km2 > AREA_GRANDE_KM2) return `Área de ${inteiro(c.km2)} km²: prédios e ruas ficam desligados no automático. Água continua.`;
    if (c.km2 > AREA_LIVRE_KM2) return `Área de ${inteiro(c.km2)} km²: o download do OpenStreetMap é feito em blocos e pode demorar.`;
    return 'Dados do OpenStreetMap, baixados uma vez e guardados em cache.';
  });

  const fonte = opcoes('fonteOsm', 'Fonte dos dados OSM', [['local', 'Arquivo local'], ['overpass', 'Overpass (online)']], aoMudar);
  const infoFonte = informacao((c) => textoFonteOsm(c));

  const controles = [fonte, infoFonte, intro, avisos, predios, ruas, agua, cobertura, arvores, curvas];
  for (const c of controles) container.append(c.el);
  return {
    atualizar(c: Contexto) {
      for (const ctl of controles) ctl.atualizar(c);
      tabelaVias.atualizar(c);
    },
  };
}

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : 'data desconhecida');
const milhoes = (n: number | undefined) => (n === undefined ? '0' : n >= 1e6 ? `${decimal(n / 1e6, 1)} mi` : inteiro(n));

/** Situação da fonte local e como instalar/atualizar. */
function textoFonteOsm(c: Contexto): string {
  const info = c.osmLocal;
  const comando = '<code>npm run importar-osm</code>';
  const pasta = info ? `<code>${info.pasta}\\</code>` : 'a pasta <code>dados-osm</code> do projeto';
  const usado = c.info?.fonteOsm
    ? `<br>Último modelo: dados ${c.info.fonteOsm === 'local' ? '<strong>do arquivo local</strong>' : 'do <strong>Overpass</strong>'}.`
    : '';
  if (info?.disponivel && !info.desatualizado) {
    const arquivos = info.arquivos.map((a) => `<strong>${a.nome}</strong> (dados de ${data(a.dataDados)})`).join(', ');
    const k = info.contagens;
    return `Arquivo local: ${arquivos}, importado em ${data(info.dataImportacao)}.
      <br>${milhoes(k.predios)} prédios · ${milhoes(k.vias)} vias · ${milhoes(k.agua)} água · ${milhoes(k.cobertura)} cobertura · ${milhoes(k.arvores)} árvores.${usado}
      <br><strong>Para atualizar:</strong> baixe o arquivo novo da Geofabrik (mesmo nome) para ${pasta} e rode ${comando} (≈ 5 min para a Sudeste). Depois, aperte F5.
      Áreas fora do arquivo usam o Overpass.`;
  }
  const passos = `<br><strong>Para usar sem internet:</strong>
    <br>1. Baixe o extrato da sua região, por exemplo <code>sudeste-latest.osm.pbf</code> em download.geofabrik.de/south-america/brazil.html
    <br>2. Salve em ${pasta}
    <br>3. No PowerShell, na pasta do projeto: ${comando} (≈ 5 min)
    <br>4. Aperte F5.`;
  if (info?.desatualizado) return `O índice local é de uma versão antiga do app: rode ${comando} de novo.${usado}`;
  return `Nenhum arquivo local importado: o app usa o Overpass (online).${passos}${usado}`;
}

const camadas = (c: Contexto) => ({ h: c.params.alturaCamadaMm, h1: c.params.primeiraCamadaMm });

/** Tabela das categorias de cobertura: liga, cor, altura e elevada/rebaixada. */
function tabelaCobertura(aoMudar: (n: NomeParametro, v: Valor) => void): Controle {
  const tabela = document.createElement('table');
  tabela.className = 'tabela-vias';
  tabela.innerHTML = '<thead><tr><th></th><th>Categoria</th><th>Cor</th><th>Altura (mm)</th><th></th></tr></thead>';
  const corpo = document.createElement('tbody');
  tabela.append(corpo);
  let atual = coberturaPadrao();
  const salvar = () => aoMudar('coberturaCategorias', escreverCobertura(atual));
  const linhas = LISTA_COBERTURA.map((t) => {
    const tr = document.createElement('tr');
    const chk = Object.assign(document.createElement('input'), { type: 'checkbox' });
    chk.setAttribute('aria-label', TIPOS_COBERTURA[t].nome);
    const corEl = Object.assign(document.createElement('input'), { type: 'color' });
    const alt = Object.assign(document.createElement('input'), { type: 'number', min: '0.04', max: '10', step: '0.2' });
    alt.style.width = '62px';
    const integ = document.createElement('select');
    integ.innerHTML = '<option value="elevada">elevada</option><option value="rebaixada">rebaixada</option>';
    chk.addEventListener('change', () => { atual[t].ligada = chk.checked; salvar(); });
    corEl.addEventListener('input', () => { atual[t].cor = corEl.value; salvar(); });
    alt.addEventListener('change', () => {
      const v = Number(alt.value);
      if (Number.isFinite(v) && v >= 0.04 && v <= 10) { atual[t].alturaMm = v; salvar(); }
    });
    integ.addEventListener('change', () => { atual[t].integracao = integ.value as 'elevada' | 'rebaixada'; salvar(); });
    const td = (el: HTMLElement | string) => {
      const c = document.createElement('td');
      c.append(el);
      return c;
    };
    tr.append(td(chk), td(TIPOS_COBERTURA[t].nome), td(corEl), td(alt), td(integ));
    corpo.append(tr);
    return { t, chk, corEl, alt, integ };
  });
  const el = document.createElement('div');
  el.append(tabela);
  return {
    el,
    atualizar(c) {
      atual = lerCobertura(c.params.coberturaCategorias) ?? coberturaPadrao();
      for (const l of linhas) {
        const x = atual[l.t];
        l.chk.checked = x.ligada;
        l.corEl.value = x.cor;
        if (document.activeElement !== l.alt) l.alt.value = String(x.alturaMm);
        l.integ.value = x.integracao;
        l.integ.disabled = c.params.coberturaModo === 'superficie';
      }
    },
  };
}

const altitudeTexto = (m: number, s: Sistema) => (s === 'imperial' ? `${inteiro(m / 0.3048)} pés` : `${inteiro(m)} m`);
const espessuraFina = (c: Contexto) => alinharEspessura(0.4, camadas(c));

/** Botão "Só vias principais" (aparece acima de 25 km²) e "Todas as vias". */
function atalhoPrincipais(aoMudar: (n: NomeParametro, v: Valor) => void): Controle {
  const el = document.createElement('div');
  el.className = 'linha';
  const so = document.createElement('button');
  so.type = 'button';
  so.className = 'secundario pequeno';
  so.textContent = 'Só vias principais';
  so.title = 'Mantém rodovias, avenidas, ferrovias, pontes e balsas';
  so.addEventListener('click', () => aoMudar('ruasTiposDesligados', escreverTiposDesligados(TIPOS_SO_PRINCIPAIS)));
  const todas = document.createElement('button');
  todas.type = 'button';
  todas.className = 'secundario pequeno';
  todas.textContent = 'Todas as vias';
  todas.addEventListener('click', () => aoMudar('ruasTiposDesligados', escreverTiposDesligados(['tuneis'])));
  el.append(so, todas);
  return {
    el,
    atualizar(c) {
      el.hidden = !(c.km2 !== null && c.km2 > AREA_LIVRE_KM2);
    },
  };
}

/** Tabela: liga/desliga cada tipo e mostra a largura real e a impressa. */
function tabelaTiposVia(aoMudar: (n: NomeParametro, v: Valor) => void): Controle {
  const tabela = document.createElement('table');
  tabela.className = 'tabela-vias';
  const linhas = new Map<TipoVia, { chk: HTMLInputElement; real: HTMLElement; impressa: HTMLElement }>();
  tabela.innerHTML = '<thead><tr><th></th><th>Tipo</th><th>Real</th><th>Impressa</th></tr></thead>';
  const corpo = document.createElement('tbody');
  for (const t of LISTA_TIPOS_VIA) {
    const tr = document.createElement('tr');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.setAttribute('aria-label', TIPOS_VIA[t].nome);
    const real = document.createElement('td');
    const impressa = document.createElement('td');
    const c1 = document.createElement('td');
    c1.append(chk);
    const c2 = document.createElement('td');
    c2.textContent = TIPOS_VIA[t].nome;
    tr.append(c1, c2, real, impressa);
    corpo.append(tr);
    linhas.set(t, { chk, real, impressa });
  }
  tabela.append(corpo);
  let atual: TipoVia[] = [];
  for (const [t, l] of linhas) {
    l.chk.addEventListener('change', () => {
      const desligados = l.chk.checked ? atual.filter((x) => x !== t) : [...atual, t];
      aoMudar('ruasTiposDesligados', escreverTiposDesligados(desligados));
    });
  }
  const dica = document.createElement('div');
  dica.className = 'dica';
  const el = document.createElement('div');
  el.append(tabela, dica);
  return {
    el,
    atualizar(c) {
      atual = lerTiposDesligados(c.params.ruasTiposDesligados) ?? [];
      const s = c.params.unidades as Sistema;
      let engrossadas = 0;
      for (const [t, l] of linhas) {
        l.chk.checked = !atual.includes(t);
        const realM = TIPOS_VIA[t].larguraM * c.params.ruasEscalaLargura;
        l.real.textContent = distancia(realM, s);
        if (c.mmPorMetro && c.params.modo === 'impressao') {
          const mm = realM * c.mmPorMetro;
          const engrossada = mm < LARGURA_MINIMA_MM;
          if (engrossada && !atual.includes(t)) engrossadas++;
          l.impressa.innerHTML = engrossada
            ? `<span class="aviso-texto" title="Abaixo do mínimo imprimível: engrossada">${medidaModelo(LARGURA_MINIMA_MM, s, 1)}*</span>`
            : medidaModelo(mm, s, 2);
        } else {
          l.impressa.textContent = '—';
        }
      }
      dica.innerHTML = engrossadas
        ? `* Abaixo de ${medidaModelo(LARGURA_MINIMA_MM, s, 1)} (2 linhas do bico de 0,4 mm): engrossada para o mínimo imprimível.`
        : '';
    },
  };
}
