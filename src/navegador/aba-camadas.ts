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

export interface AcoesCamadas {
  aoMudar: AoMudar;
  aoOcultar: (id: 'predios' | 'ruas' | 'agua', oculta: boolean) => void;
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
  }, [
    informacao(avisoGrande('predios'), { visivel: (c) => !!avisoGrande('predios')(c) }),
    voltarAuto('predios'),
    informacao((c) => {
      const s = c.info?.estatisticasCamadas?.predios;
      if (!s) return 'Altura vinda das tags <strong>height</strong> e <strong>building:levels</strong> do OpenStreetMap (3 m por andar).';
      const u = sis(c);
      return `<strong>${inteiro(s.quantidade)}</strong> prédios${s.semAltura ? ` (${inteiro(s.semAltura)} sem altura no OSM: usam a altura padrão)` : ''}<br>
        Mais baixo: <strong>${medidaModelo(s.menorMm, u, 1)}</strong> (${distancia(s.menorM, u)} reais)<br>
        Mais alto: <strong>${medidaModelo(s.maiorMm, u, 1)}</strong> (${distancia(s.maiorM, u)} reais)`;
    }),
    booleano('prediosDetalhados', 'Prédios detalhados (usa building:part quando existir)', aoMudar),
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

  const avisos = informacao((c) => (c.info?.avisosCamadas ?? []).map((t) => `<div class="aviso">${t}</div>`).join(''), {
    visivel: (c) => !!c.info?.avisosCamadas?.length,
  });
  const intro = informacao((c) => {
    if (c.km2 === null) return 'Desenhe uma área para ver as camadas.';
    if (c.km2 > AREA_GRANDE_KM2) return `Área de ${inteiro(c.km2)} km²: prédios e ruas ficam desligados no automático. Água continua.`;
    if (c.km2 > AREA_LIVRE_KM2) return `Área de ${inteiro(c.km2)} km²: o download do OpenStreetMap é feito em blocos e pode demorar.`;
    return 'Dados do OpenStreetMap, baixados uma vez e guardados em cache.';
  });

  const controles = [intro, avisos, predios, ruas, agua];
  for (const c of controles) container.append(c.el);
  return {
    atualizar(c: Contexto) {
      for (const ctl of controles) ctl.atualizar(c);
      tabelaVias.atualizar(c);
    },
  };
}

const camadas = (c: Contexto) => ({ h: c.params.alturaCamadaMm, h1: c.params.primeiraCamadaMm });
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
