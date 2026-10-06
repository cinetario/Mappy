// Construtores dos controles do painel lateral. Cada controle conhece o
// parâmetro que edita (definido em core/estado.ts) e se atualiza sozinho
// quando o estado muda (preset, URL colada, "Redefinir"…).
import { PARAMETROS, escreverFaixas, lerFaixas, MAX_FAIXAS, type NomeParametro, type Parametros, type Valor } from '../core/estado.ts';
import type { InfoModelo, ParteGerada } from '../trabalhador/protocolo.ts';
import type { InfoIndiceLocal } from './osm-cliente.ts';

export interface Contexto {
  params: Parametros;
  info: InfoModelo | null;
  partes: ParteGerada[] | null;
  /** área escolhida em km² (null sem área) */
  km2: number | null;
  /** escala de impressão prevista (mm por metro real), mesmo antes de gerar */
  mmPorMetro: number | null;
  /** índice local do OSM (null = ainda não consultado) */
  osmLocal: InfoIndiceLocal | null;
}

export type AoMudar = (nome: NomeParametro, valor: Valor) => void;

export interface Controle {
  el: HTMLElement;
  atualizar(c: Contexto): void;
}

interface Comum {
  visivel?: (c: Contexto) => boolean;
  /** texto pequeno abaixo do controle */
  dica?: string | ((c: Contexto) => string);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...filhos: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...filhos);
  return el;
}

function comComum(el: HTMLElement, o: Comum, extra?: (c: Contexto) => void): Controle {
  const dica = h('div', { class: 'dica' });
  if (o.dica) el.append(dica);
  return {
    el,
    atualizar(c) {
      el.hidden = o.visivel ? !o.visivel(c) : false;
      if (o.dica) {
        const t = typeof o.dica === 'function' ? o.dica(c) : o.dica;
        dica.innerHTML = t;
        dica.hidden = !t;
      }
      extra?.(c);
    },
  };
}

// ---------- número (campo ou controle deslizante) ----------
export function numero(
  nome: NomeParametro,
  rotulo: string,
  aoMudar: AoMudar,
  o: Comum & {
    unidade?: string;
    deslizante?: boolean;
    passo: number;
    casas?: number;
    /** valor mostrado ao lado do rótulo (padrão: o próprio valor) */
    exibir?: (c: Contexto) => string;
    /** se devolver texto, o controle fica desativado com essa explicação */
    desativado?: (c: Contexto) => string | false;
  },
): Controle {
  const def = PARAMETROS[nome];
  if (def.tipo !== 'numero') throw new Error(`${nome} não é numérico`);
  const valor = h('strong');
  const entrada = h('input', {
    type: o.deslizante ? 'range' : 'number',
    min: String(def.min), max: String(def.max), step: String(o.passo),
  }) as HTMLInputElement;
  const unidade = o.unidade && !o.deslizante ? h('span', { class: 'unidade' }, o.unidade) : '';
  const linhaEntrada = o.deslizante ? entrada : h('div', { class: 'com-unidade' }, entrada, unidade);
  const label = h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, `${rotulo} `, valor), linhaEntrada);

  const aplicar = () => aoMudar(nome, entrada.value);
  entrada.addEventListener('input', () => {
    if (!o.deslizante && (entrada.value === '' || !entrada.checkValidity())) return; // digitando
    aplicar();
  });
  entrada.addEventListener('change', aplicar);

  return comComum(label, o, (c) => {
    const v = c.params[nome] as number;
    if (document.activeElement !== entrada) entrada.value = String(v);
    const motivo = o.desativado?.(c);
    entrada.disabled = !!motivo;
    label.title = motivo || '';
    valor.textContent = o.exibir ? o.exibir(c) : o.deslizante ? `${v.toFixed(o.casas ?? 0)}${o.unidade ? ` ${o.unidade}` : ''}` : '';
  });
}

// ---------- liga/desliga ----------
export function booleano(nome: NomeParametro, rotulo: string, aoMudar: AoMudar, o: Comum = {}): Controle {
  const entrada = h('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const label = h('label', { class: 'campo interruptor' }, entrada, h('span', {}, rotulo));
  entrada.addEventListener('change', () => aoMudar(nome, entrada.checked));
  return comComum(label, o, (c) => {
    entrada.checked = c.params[nome] as boolean;
  });
}

// ---------- opções (botões lado a lado ou lista) ----------
export function opcoes(
  nome: NomeParametro,
  rotulo: string,
  itens: [string, string][],
  aoMudar: AoMudar,
  o: Comum & { lista?: boolean } = {},
): Controle {
  if (o.lista) {
    const sel = h('select') as HTMLSelectElement;
    for (const [v, t] of itens) sel.append(h('option', { value: v }, t));
    sel.addEventListener('change', () => aoMudar(nome, sel.value));
    const label = h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, rotulo), sel);
    return comComum(label, o, (c) => {
      sel.value = String(c.params[nome]);
    });
  }
  const grupo = h('div', { class: 'segmentado', role: 'radiogroup', 'aria-label': rotulo });
  const botoes = itens.map(([v, t]) => {
    const b = h('button', { type: 'button', role: 'radio', 'data-valor': v }, t);
    b.addEventListener('click', () => aoMudar(nome, v));
    grupo.append(b);
    return b;
  });
  const bloco = h('div', { class: 'campo' }, ...(rotulo ? [h('span', { class: 'rotulo' }, rotulo)] : []), grupo);
  return comComum(bloco, o, (c) => {
    for (const b of botoes) {
      const ativo = b.dataset.valor === String(c.params[nome]);
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-checked', String(ativo));
    }
  });
}

// ---------- texto livre ----------
export function textoLivre(nome: NomeParametro, rotulo: string, aoMudar: AoMudar, o: Comum & { maximo?: number; exemplo?: string } = {}): Controle {
  const entrada = h('input', { type: 'text', maxlength: String(o.maximo ?? 60), placeholder: o.exemplo ?? '', spellcheck: 'false' }) as HTMLInputElement;
  const label = h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, rotulo), entrada);
  entrada.addEventListener('input', () => aoMudar(nome, entrada.value));
  return comComum(label, o, (c) => {
    if (document.activeElement !== entrada) entrada.value = String(c.params[nome]);
  });
}

// ---------- cor ----------
export function cor(nome: NomeParametro, rotulo: string, aoMudar: AoMudar, o: Comum = {}): Controle {
  const entrada = h('input', { type: 'color' }) as HTMLInputElement;
  const label = h('label', { class: 'campo cor' }, entrada, h('span', {}, rotulo));
  entrada.addEventListener('input', () => aoMudar(nome, entrada.value));
  return comComum(label, o, (c) => {
    entrada.value = c.params[nome] as string;
  });
}

// ---------- bloco de informação (somente leitura) ----------
export function informacao(conteudo: (c: Contexto) => string, o: Comum = {}): Controle {
  const el = h('div', { class: 'informacao' });
  return comComum(el, o, (c) => {
    el.innerHTML = conteudo(c);
  });
}

// ---------- editor de faixas de altitude ----------
export function editorFaixas(aoMudar: AoMudar, o: Comum = {}): Controle {
  const lista = h('div', { class: 'faixas' });
  const adicionar = h('button', { type: 'button', class: 'secundario pequeno' }, '+ Adicionar faixa');
  const el = h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Faixas (% da altura do relevo : cor)'), lista, adicionar);
  let atual = '';

  const salvar = (faixas: { ate: number; cor: string }[]) => {
    const texto = escreverFaixas(faixas);
    if (lerFaixas(texto)) aoMudar('faixas', texto);
  };
  const ler = () => lerFaixas(atual) ?? [];

  adicionar.addEventListener('click', () => {
    const f = ler();
    if (f.length >= MAX_FAIXAS) return;
    // nova faixa no meio do maior intervalo
    let melhor = 0;
    let inicio = 0;
    let ant = 0;
    f.forEach((x) => {
      if (x.ate - ant > melhor) {
        melhor = x.ate - ant;
        inicio = ant;
      }
      ant = x.ate;
    });
    f.push({ ate: Math.round(inicio + melhor / 2), cor: '#b08850' });
    salvar(f);
  });

  return comComum(el, o, (c) => {
    if (c.params.faixas === atual && lista.contains(document.activeElement)) return;
    atual = c.params.faixas;
    const faixas = ler();
    lista.replaceChildren();
    let anterior = 0;
    faixas.forEach((f, k) => {
      const ultima = k === faixas.length - 1;
      const pct = h('input', { type: 'number', min: String(anterior + 1), max: '99', step: '1', value: String(f.ate), 'aria-label': `Limite da faixa ${k + 1} em %` }) as HTMLInputElement;
      pct.disabled = ultima;
      const corEl = h('input', { type: 'color', value: f.cor, 'aria-label': `Cor da faixa ${k + 1}` }) as HTMLInputElement;
      const remover = h('button', { type: 'button', class: 'icone', title: 'Remover faixa', 'aria-label': `Remover faixa ${k + 1}` }, '×');
      remover.disabled = faixas.length <= 1;
      const de = anterior;
      pct.addEventListener('change', () => {
        const novo = faixas.map((x, i) => (i === k ? { ...x, ate: Number(pct.value) } : x));
        salvar(novo);
      });
      corEl.addEventListener('input', () => salvar(faixas.map((x, i) => (i === k ? { ...x, cor: corEl.value } : x))));
      remover.addEventListener('click', () => salvar(faixas.filter((_, i) => i !== k)));
      lista.append(h('div', { class: 'faixa' }, h('span', { class: 'de' }, `${de}% →`), pct, h('span', {}, '%'), corEl, remover));
      anterior = f.ate;
    });
    adicionar.toggleAttribute('disabled', faixas.length >= MAX_FAIXAS);
  });
}

// ---------- sub-seção recolhível (ex.: "Avançado") ----------
export function subsecao(titulo: string, controles: Controle[], o: Comum = {}): Controle {
  const el = h('details', { class: 'subsecao' }, h('summary', {}, titulo), h('div', { class: 'conteudo' }, ...controles.map((c) => c.el)));
  return comComum(el, o, (c) => {
    for (const ctl of controles) ctl.atualizar(c);
  });
}

// ---------- camada (cabeçalho com interruptor, contagem e "olho") ----------
export interface OpcoesCamada {
  id: string;
  titulo: string;
  /** estado efetivo (ligada?) */
  ligada: (c: Contexto) => boolean;
  /** texto ao lado do interruptor (ex.: "automático") */
  observacao?: (c: Contexto) => string;
  aoLigar: (ligar: boolean) => void;
  contagem?: (c: Contexto) => string;
  aoOcultar: (oculta: boolean) => void;
}

export function camada(o: OpcoesCamada, controles: Controle[]): Controle {
  const entrada = h('input', { type: 'checkbox', role: 'switch', 'aria-label': `Ligar ${o.titulo}` }) as HTMLInputElement;
  const obs = h('span', { class: 'observacao' });
  const contagem = h('span', { class: 'contagem' });
  const olho = h('button', { type: 'button', class: 'olho', 'aria-pressed': 'false', title: 'Ocultar só na visualização (continua no arquivo)' }, '👁');
  let oculta = false;
  entrada.addEventListener('change', () => o.aoLigar(entrada.checked));
  olho.addEventListener('click', (e) => {
    e.preventDefault();
    oculta = !oculta;
    olho.setAttribute('aria-pressed', String(oculta));
    olho.classList.toggle('oculta', oculta);
    o.aoOcultar(oculta);
  });
  const conteudo = h('div', { class: 'conteudo' }, ...controles.map((c) => c.el));
  const el = h('details', { class: 'secao camada', 'data-camada': o.id },
    h('summary', {}, entrada, h('span', { class: 'titulo' }, o.titulo, obs), contagem, olho),
    conteudo);
  el.addEventListener('toggle', () => {
    if (!(el as HTMLDetailsElement).open) return;
    for (const outra of el.parentElement?.querySelectorAll<HTMLDetailsElement>('details.secao[open]') ?? []) {
      if (outra !== el) outra.open = false;
    }
  });
  return {
    el,
    atualizar(c) {
      const ligada = o.ligada(c);
      entrada.checked = ligada;
      el.classList.toggle('desligada', !ligada);
      obs.textContent = o.observacao?.(c) ?? '';
      contagem.textContent = o.contagem?.(c) ?? '';
      for (const ctl of controles) ctl.atualizar(c);
    },
  };
}

// ---------- seções recolhíveis (uma aberta por vez) ----------
export function secao(id: string, titulo: string, controles: Controle[], resumo?: (c: Contexto) => string): Controle {
  const res = h('span', { class: 'resumo' });
  const el = h('details', { class: 'secao', 'data-secao': id },
    h('summary', {}, h('span', {}, titulo), res),
    h('div', { class: 'conteudo' }, ...controles.map((c) => c.el)));
  el.addEventListener('toggle', () => {
    if (!(el as HTMLDetailsElement).open) return;
    for (const outra of el.parentElement?.querySelectorAll<HTMLDetailsElement>('details.secao[open]') ?? []) {
      if (outra !== el) outra.open = false;
    }
  });
  return {
    el,
    atualizar(c) {
      for (const ctl of controles) ctl.atualizar(c);
      res.textContent = resumo?.(c) ?? '';
    },
  };
}
