import './estilo.css';
import { FONTES } from './core/elevacao.ts';
import {
  aplicarPreset, estadoParaUrl, lerFaixas, parametrosPadrao, urlParaEstado, validarParametro,
  type Estado, type NomeParametro, type NomePreset, type Parametros, type Valor,
} from './core/estado.ts';
import { areaM2, caixaDaForma, dimensoesMetros, formatarCoordenadas, poligonoSeCruza, type Forma } from './core/geo.ts';
import {
  AREA_GRANDE_KM2, AREA_LIVRE_KM2, AREA_MAXIMA_KM2, LARGURA_MINIMA_MM, LARGURA_RUA_LOCAL_M,
  camadaUrbanaAtiva, classificarArea, ladoMaximoSemEngrossarM, larguraImpressa,
} from './core/limites.ts';
import { escreverStl } from './core/stl.ts';
import { montarAbaCamadas } from './navegador/aba-camadas.ts';
import { montarAbaModelo } from './navegador/aba-modelo.ts';
import { criarDesenho, type Ferramenta } from './navegador/desenho.ts';
import { GeracaoCancelada, criarGerador } from './navegador/gerador.ts';
import { criarMapa, enquadrar, mostrarFaltando } from './navegador/mapa.ts';
import type { Contexto } from './navegador/painel.ts';
import { criarPrevia } from './navegador/previa.ts';
import { area as fmtArea, decimal, distancia, inteiro, medidaModelo, type Sistema } from './navegador/unidades.ts';
import type { Contagem, ResultadoGeracao } from './trabalhador/protocolo.ts';
import { TIPOS_SO_PRINCIPAIS, escreverTiposDesligados } from './core/vias.ts';

const MESA_IMPRESSORA_MM = 270; // volume útil da Snapmaker U1
const FILAMENTOS = 4; // Snapmaker U1
/** parâmetros que só mudam a exibição (não precisam gerar de novo) */
const SO_EXIBICAO = new Set<NomeParametro>(['unidades', 'aguaOpacidade', 'prediosArestas']);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const botao = (id: string) => $<HTMLButtonElement>(id);

// ---------- estado (vem da URL) ----------
const estado: Estado = urlParaEstado(location.hash);
let resultado: ResultadoGeracao | null = null;
let modeloDesatualizado = false;

const sistema = () => estado.params.unidades as Sistema;
const contexto = (): Contexto => {
  const f = estado.forma;
  let mmPorMetro: number | null = null;
  if (f) {
    const { largura, altura } = dimensoesMetros(caixaDaForma(f));
    mmPorMetro = estado.params.tamanhoMm / Math.max(largura, altura);
  }
  return {
    params: estado.params,
    info: resultado?.info ?? null,
    partes: resultado?.partes ?? null,
    km2: f ? areaM2(f) / 1e6 : null,
    mmPorMetro,
  };
};

const previa = criarPrevia($('previa'));
const gerador = criarGerador();
const mapa = criarMapa($('mapa'));
const desenho = criarDesenho(mapa, {
  aoMudar(forma, final) {
    estado.forma = forma;
    atualizarArea();
    if (final) atualizarPainel();
    if (final) {
      salvarNaUrl();
      if (resultado) agendarGeracao(400);
    }
  },
  aoMudarFerramenta: mostrarFerramenta,
});

if (estado.forma) {
  desenho.definirForma(estado.forma);
  enquadrar(mapa, caixaDaForma(estado.forma), false);
}

// ---------- painel ----------
const abaModelo = montarAbaModelo($('aba-modelo'), mudarParametro);
const abaCamadas = montarAbaCamadas($('aba-camadas'), {
  aoMudar: mudarParametro,
  aoOcultar: (id, oculta) => previa.definirOculta(id, oculta),
});

function mudarParametro(nome: NomeParametro, bruto: Valor) {
  const novo = validarParametro(nome, bruto);
  if (novo === estado.params[nome]) {
    atualizarPainel(); // devolve ao campo o valor efetivo (ex.: limitado à faixa)
    return;
  }
  (estado.params as Record<NomeParametro, Valor>)[nome] = novo;
  aposMudarParametros(SO_EXIBICAO.has(nome) ? [] : [nome]);
}

function aposMudarParametros(mudaramGeometria: NomeParametro[]) {
  atualizarPainel();
  atualizarArea();
  salvarNaUrl();
  if (resultado && mudaramGeometria.length) agendarGeracao(mudaramGeometria.includes('resolucao') ? 500 : 150);
  if (resultado && !mudaramGeometria.length) {
    mostrarCaixaInfo();
    mostrarPrevia(false);
  }
}

function atualizarPainel() {
  const c = contexto();
  abaModelo.atualizar(c);
  abaCamadas.atualizar(c);
  atualizarCores();
  atualizarCreditos();
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#abas [data-aba]')) {
  b.addEventListener('click', () => {
    for (const outro of document.querySelectorAll<HTMLButtonElement>('#abas [data-aba]')) {
      const ativo = outro === b;
      outro.setAttribute('aria-selected', String(ativo));
      $(`aba-${outro.dataset.aba}`).hidden = !ativo;
    }
  });
}

// ---------- presets ----------
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  b.addEventListener('click', () => trocarParametros(aplicarPreset(estado.params, b.dataset.preset as NomePreset)));
}
botao('btn-redefinir').addEventListener('click', () => trocarParametros(parametrosPadrao()));

function trocarParametros(novos: Parametros) {
  const mudaram = (Object.keys(novos) as NomeParametro[]).filter((k) => novos[k] !== estado.params[k]);
  estado.params = novos;
  aposMudarParametros(mudaram.filter((k) => !SO_EXIBICAO.has(k)));
}

// ---------- URL ----------
function salvarNaUrl() {
  const hash = estadoParaUrl(estado);
  if (hash !== location.hash.replace(/^#/, '')) history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
}
window.addEventListener('hashchange', () => {
  // o usuário colou outro link na mesma aba
  Object.assign(estado, urlParaEstado(location.hash));
  desenho.definirForma(estado.forma);
  if (estado.forma) enquadrar(mapa, caixaDaForma(estado.forma));
  atualizarPainel();
  atualizarArea();
  if (estado.forma) agendarGeracao(0);
});

// ---------- ferramentas de desenho ----------
const DICAS: Record<Ferramenta, string> = {
  retangulo: 'Clique e arraste para desenhar o retângulo. Esc cancela.',
  circulo: 'Clique no centro e arraste para definir o raio. Esc cancela.',
  hexagono: 'Clique no centro e arraste para definir o tamanho. Depois, gire pela alça do vértice. Esc cancela.',
  poligono: 'Clique ponto a ponto. Para fechar: clique no primeiro ponto, dê duplo clique ou aperte Enter. Backspace desfaz o último ponto. Esc cancela.',
};

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ferramenta]')) {
  b.addEventListener('click', () => desenho.iniciar(b.dataset.ferramenta as Ferramenta));
}
botao('btn-cancelar').addEventListener('click', () => desenho.cancelar());

function mostrarFerramenta(f: Ferramenta | null) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ferramenta]')) {
    b.classList.toggle('ativo', b.dataset.ferramenta === f);
  }
  botao('btn-cancelar').hidden = !f;
  const dica = $('dica-ferramenta');
  dica.hidden = !f;
  if (f) dica.textContent = DICAS[f];
}

// ---------- busca ----------
$('form-busca').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('busca').value.trim();
  const lista = $('resultados');
  if (!q) return;
  lista.innerHTML = '<li>Buscando…</li>';
  try {
    const resp = await fetch(`/api/busca?q=${encodeURIComponent(q)}`);
    if (!resp.ok) throw new Error(await resp.text());
    const itens = (await resp.json()) as { display_name: string; name?: string; boundingbox: string[] }[];
    lista.innerHTML = '';
    if (itens.length === 0) lista.innerHTML = '<li>Nada encontrado.</li>';
    for (const item of itens) {
      const li = document.createElement('li');
      li.textContent = item.display_name;
      li.addEventListener('click', () => {
        estado.nome = item.name || item.display_name.split(',')[0];
        salvarNaUrl();
        const [sul, norte, oeste, leste] = item.boundingbox.map(Number);
        enquadrar(mapa, { oeste, sul, leste, norte });
        lista.innerHTML = '';
      });
      lista.appendChild(li);
    }
  } catch (erro) {
    lista.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'erro';
    li.textContent = `Erro na busca: ${erro instanceof Error ? erro.message : erro}`;
    lista.appendChild(li);
  }
});

// ---------- informações da área ----------
function atualizarArea() {
  const info = $('info-area');
  const f = estado.forma;
  botao('btn-gerar').disabled = !f;
  botao('btn-gerar-mapa').disabled = !f;
  $('dica-area').hidden = !!f;
  if (!f) {
    info.hidden = true;
    return;
  }
  const s = sistema();
  const { largura, altura } = dimensoesMetros(caixaDaForma(f));
  const km2 = areaM2(f) / 1e6;
  const tamanho = estado.params.tamanhoMm;
  const real = estado.params.modo === 'real';
  const escala = tamanho / Math.max(largura, altura); // mm por metro (modo impressão)
  const avisos: string[] = [];
  const faixa = classificarArea(km2);
  if (km2 > AREA_MAXIMA_KM2) avisos.push('Área enorme: a projeção fica distorcida. Escolha uma região menor.');
  else if (faixa === 'muito-grande') {
    avisos.push(`Acima de ${AREA_GRANDE_KM2} km²: prédios e ruas ficam desligados por padrão (dá para ligar manualmente). Ficam relevo, água e áreas verdes.`);
  } else if (faixa === 'grande') {
    avisos.push(`Entre ${AREA_LIVRE_KM2} e ${AREA_GRANDE_KM2} km²: o download do OpenStreetMap fica lento, e prédios e ruas locais saem finos demais para imprimir. Sugestão: só vias principais (rodovias e avenidas), água e cobertura do solo.`);
  }
  if (km2 < 0.01) avisos.push('Área muito pequena: o relevo vai sair quase plano.');
  if (!real && tamanho > MESA_IMPRESSORA_MM) avisos.push(`O modelo passa de ${MESA_IMPRESSORA_MM} mm, o limite da mesa da Snapmaker U1.`);
  if (f.tipo === 'poligono' && poligonoSeCruza(f.pontos)) {
    avisos.push('O polígono cruza a si mesmo. Arraste os vértices para desfazer o cruzamento.');
  }

  // largura impressa de uma rua local, para ver na hora se é imprimível
  let linhaRua = '';
  if (!real) {
    const rua = larguraImpressa(LARGURA_RUA_LOCAL_M, escala);
    linhaRua = rua.engrossada
      ? `<div class="aviso-leve">Rua local (${LARGURA_RUA_LOCAL_M} m) sairia com <strong>${medidaModelo(rua.realMm, s, 2)}</strong>,
         abaixo do mínimo de ${medidaModelo(LARGURA_MINIMA_MM, s, 1)}. Será engrossada para ${medidaModelo(LARGURA_MINIMA_MM, s, 1)}
         (≈ ${distancia(rua.impressaEmMetros, s)} reais). Na largura real, só com lado maior até
         ${distancia(ladoMaximoSemEngrossarM(LARGURA_RUA_LOCAL_M, tamanho), s)}.</div>`
      : `<div><span class="ok">✓</span> Rua local (${LARGURA_RUA_LOCAL_M} m): <strong>${medidaModelo(rua.realMm, s, 2)}</strong> impressa, imprimível.</div>`;
  }

  info.innerHTML = `
    <div><strong>${descreverForma(f, largura, altura, s)}</strong> · ${fmtArea(km2, s)}</div>
    <div>${real
      ? 'Modelo em escala 1:1 (metros reais)'
      : `Modelo: ${medidaModelo(largura * escala, s, 0)} × ${medidaModelo(altura * escala, s, 0)} · 1 mm = ${distancia(1 / escala, s)}`}</div>
    ${linhaRua}
    <div class="dica">Centro: ${formatarCoordenadas(caixaDaForma(f))} · arraste as alças brancas para ajustar${f.tipo === 'poligono' ? ' (botão direito apaga um vértice)' : ''}</div>
    ${avisos.map((a) => `<div class="aviso">${a}</div>`).join('')}`;
  info.hidden = false;
}

function descreverForma(f: Forma, largura: number, altura: number, s: Sistema) {
  switch (f.tipo) {
    case 'retangulo':
      return `Retângulo ${distancia(largura, s)} × ${distancia(altura, s)}`;
    case 'circulo':
      return `Círculo com ${distancia(f.raioM * 2, s)} de diâmetro`;
    case 'hexagono':
      return `Hexágono com ${distancia(f.raioM * 2, s)} entre vértices opostos`;
    case 'poligono':
      return `Polígono de ${f.pontos.length} vértices, ${distancia(largura, s)} × ${distancia(altura, s)}`;
  }
}

// ---------- cores (limite de filamentos) e créditos ----------
function coresPrevistas(p: Parametros): string[] {
  const terreno = p.estilo === 'faixas' ? (lerFaixas(p.faixas) ?? []).map((f) => f.cor) : [p.corTerreno];
  const km2 = estado.forma ? areaM2(estado.forma) / 1e6 : 0;
  const camadas = [
    camadaUrbanaAtiva(p.predios, km2) ? p.prediosCor : null,
    camadaUrbanaAtiva(p.ruas, km2) ? p.ruasCor : null,
    p.agua ? p.aguaCor : null,
  ].filter((c): c is string => !!c);
  return [...new Set([p.corLaterais, ...terreno, ...camadas])];
}

function atualizarCores() {
  const cores = coresPrevistas(estado.params);
  const amostras = cores.map((c) => `<span class="amostra" style="background:${c}"></span>`).join('');
  const excesso = cores.length > FILAMENTOS;
  $('cores').innerHTML = `Cores: <strong class="${excesso ? 'erro' : ''}">${cores.length}/${FILAMENTOS}</strong> ${amostras}`
    + (excesso
      ? `<div class="aviso">A Snapmaker U1 tem ${FILAMENTOS} filamentos. Use a mesma cor em mais de uma peça (ex.: base igual à primeira faixa, ruas iguais aos prédios) ou reduza faixas e camadas.</div>`
      : '');
}

function atualizarCreditos() {
  const f = FONTES[estado.params.fonte];
  $('creditos').innerHTML = `Dados: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>
    · Mapa: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
    · Elevação: <a href="${f.link}" target="_blank" rel="noopener">${f.atribuicao}</a>`;
}

// ---------- geração ----------
botao('btn-gerar').addEventListener('click', () => gerar());
botao('btn-gerar-mapa').addEventListener('click', () => gerar());

let espera: number | undefined;
function agendarGeracao(ms: number) {
  clearTimeout(espera);
  espera = window.setTimeout(gerar, ms);
}

let gerando = false;
let chaveEnquadrada = '';

async function gerar(confirmado = false) {
  const forma = estado.forma;
  if (!forma) return;
  if (gerando) {
    // já tem uma geração em andamento: gera de novo quando ela terminar
    modeloDesatualizado = true;
    return;
  }
  gerando = true;
  modeloDesatualizado = false;
  const barra = $('linha-progresso');
  barra.hidden = false;
  mostrarFaltando(mapa, []);
  try {
    const params = { ...estado.params };
    const resposta = await gerador.gerar(forma, params, confirmado, (etapa, fracao) => {
      status(etapa.endsWith("…") ? etapa : `${etapa}…`);
      $('progresso-barra').style.width = `${Math.round(fracao * 100)}%`;
    });
    if (resposta.tipo === 'confirmar') {
      pedirConfirmacao(resposta.contagem);
      return;
    }
    const r = resposta.resultado;
    resultado = r;

    // reposiciona a câmera só quando a área, o tamanho ou o modo mudam
    const chave = `${JSON.stringify(forma)}|${params.tamanhoMm}|${params.modo}`;
    mostrarPrevia(chave !== chaveEnquadrada);
    chaveEnquadrada = chave;
    $('previa-vazia').hidden = true;
    botao('btn-aramado').hidden = false;
    mostrarCaixaInfo();

    const ruins = r.partes.filter((p) => !p.verificacao.valida);
    const v = r.verificacao;
    const avisos: string[] = [];
    if (r.info.unidade === 'mm' && r.info.alturaMax > MESA_IMPRESSORA_MM) {
      avisos.push(`Altura de ${inteiro(r.info.alturaMax)} mm passa do limite de ${MESA_IMPRESSORA_MM} mm da impressora. Reduza o exagero ou o tamanho.`);
    }
    if (r.info.aviso) avisos.push(r.info.aviso);
    avisos.push(...r.info.avisosCamadas);
    mostrarFaltando(mapa, r.info.faltando.flatMap((f) => f.blocos));
    status(
      (v.valida && ruins.length === 0
        ? `<span class="ok">✓ Malha fechada e válida</span> · ${r.partes.length} peças, todas manifold`
        : `<span class="erro">✗ Malha com problemas: ${[...v.erros, ...ruins.map((p) => `${p.nome}: ${p.verificacao.erros.join(', ')}`)].join('; ')}</span>`)
      + avisos.map((a) => `<div class="aviso">${a}</div>`).join(''),
    );
    botao('btn-stl').disabled = !v.valida;
    atualizarPainel();
  } catch (erro) {
    if (erro instanceof GeracaoCancelada) {
      modeloDesatualizado = false; // cancelou: não recomeça sozinho
      status('Geração cancelada. O que já foi baixado ficou guardado no cache.');
    } else {
      status(`<span class="erro">Erro: ${erro instanceof Error ? erro.message : erro}</span>`);
    }
  } finally {
    gerando = false;
    barra.hidden = true;
    if (modeloDesatualizado) agendarGeracao(0);
  }
}

botao('btn-cancelar-geracao').addEventListener('click', () => {
  clearTimeout(espera);
  modeloDesatualizado = false;
  status('Cancelando…');
  gerador.cancelar();
});

let quadradoGrade = 10;

function mostrarPrevia(enquadrar: boolean) {
  if (!resultado) return;
  const p = estado.params;
  quadradoGrade = previa.mostrar(resultado.partes.map((x) => ({
    id: x.id,
    malha: x,
    cor: x.cor,
    opacidade: x.id === 'agua' ? p.aguaOpacidade : 1,
    arestas: x.id === 'predios' && p.prediosArestas,
  })), enquadrar);
}

/** Área com muitos elementos: mostra a contagem e deixa escolher. */
function pedirConfirmacao(c: Contagem) {
  const itens = [
    c.predios != null ? `${inteiro(c.predios)} prédios` : null,
    c.vias != null ? `${inteiro(c.vias)} ruas` : null,
    c.agua != null ? `${inteiro(c.agua)} corpos d'água` : null,
    c.cobertura != null ? `${inteiro(c.cobertura)} áreas de cobertura do solo` : null,
  ].filter(Boolean);
  status(`<div class="aviso"><strong>Esta área tem muitos elementos:</strong> ${itens.join(', ')}.
    Gerar pode levar vários minutos e o arquivo fica pesado. Sugestão: desligue camadas
    ou use "Só vias principais" na aba Camadas.</div>
    <div class="linha" style="margin-top:8px">
      <button type="button" id="conf-gerar" class="principal">Gerar mesmo assim</button>
      ${c.predios != null ? '<button type="button" id="conf-sem-predios" class="secundario">Desligar prédios</button>' : ''}
      ${c.vias != null ? '<button type="button" id="conf-principais" class="secundario">Só vias principais</button>' : ''}
    </div>`);
  $('conf-gerar').addEventListener('click', () => gerar(true));
  document.getElementById('conf-sem-predios')?.addEventListener('click', () => mudarParametro('predios', 'nao'));
  document.getElementById('conf-principais')?.addEventListener('click', () =>
    mudarParametro('ruasTiposDesligados', escreverTiposDesligados(TIPOS_SO_PRINCIPAIS)));
}

function mostrarCaixaInfo() {
  if (!resultado) return;
  const i = resultado.info;
  const s = sistema();
  const caixa = $('caixa-info');
  if (i.unidade === 'm') {
    caixa.innerHTML = `<strong>${distancia(i.largura, s)} × ${distancia(i.profundidade, s)} × ${distancia(i.alturaMax, s)}</strong><br>
      Escala 1:1 (metros reais) · exagero ${decimal(i.exageroEfetivo, 2)}x<br>
      Grade: 1 quadrado = ${distancia(quadradoGrade, s)}`;
  } else {
    caixa.innerHTML = `<strong>${medidaModelo(i.largura, s, 0)} × ${medidaModelo(i.profundidade, s, 0)} × ${medidaModelo(i.alturaMax, s, 1)}</strong><br>
      Escala 1:${inteiro(arredondarEscala(i.escala))} · exagero ${decimal(i.exageroEfetivo, 2)}x<br>
      Grade: 1 quadrado = ${medidaModelo(quadradoGrade, s, quadradoGrade < 1 ? 1 : 0)}<br>
      Altitudes: ${inteiro(i.altitudeMin)} m → ${inteiro(i.altitudeMax)} m`;
  }
  caixa.hidden = false;
}

/** 19696 → 19700: escala com 3 algarismos significativos. */
function arredondarEscala(n: number) {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / p) * p;
}

function status(html: string) {
  const el = $('status');
  el.innerHTML = html;
  el.hidden = false;
}

// ---------- visualização ----------
botao('btn-aramado').addEventListener('click', () => {
  const b = botao('btn-aramado');
  const ligado = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(ligado));
  previa.definirAramado(ligado);
});

// ---------- exportação ----------
botao('btn-stl').addEventListener('click', () => {
  if (!resultado || !estado.forma) return;
  const nome = nomeArquivo(estado.nome || formatarCoordenadas(caixaDaForma(estado.forma)));
  const sufixo = resultado.info.unidade === 'm' ? '1x1-metros' : `${inteiro(estado.params.tamanhoMm)}mm`;
  baixar(new Blob([escreverStl(resultado.unica, `Relevo3D ${nome}`)], { type: 'model/stl' }), `${nome}-${sufixo}.stl`);
});

function nomeArquivo(texto: string) {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'relevo3d'
  );
}

function baixar(blob: Blob, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- início ----------
atualizarPainel();
atualizarArea();
// link com área: gera o modelo ao abrir a página (os dados vêm do cache)
if (estado.forma) agendarGeracao(0);
