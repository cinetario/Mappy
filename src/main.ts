import './estilo.css';
import {
  PARAMETROS, estadoParaUrl, urlParaEstado, validarParametro,
  type Estado, type NomeParametro,
} from './core/estado.ts';
import { areaM2, caixaDaForma, dimensoesMetros, formatarCoordenadas, poligonoSeCruza, type Forma } from './core/geo.ts';
import type { Malha } from './core/malha.ts';
import { escreverStl } from './core/stl.ts';
import { criarDesenho, type Ferramenta } from './navegador/desenho.ts';
import { criarGerador } from './navegador/gerador.ts';
import { criarMapa, enquadrar } from './navegador/mapa.ts';
import { CORES_CAMADAS, criarPrevia } from './navegador/previa.ts';
import type { ResultadoGeracao } from './trabalhador/protocolo.ts';

import {
  AREA_GRANDE_KM2, AREA_LIVRE_KM2, AREA_MAXIMA_KM2, LARGURA_MINIMA_MM, LARGURA_RUA_LOCAL_M,
  classificarArea, ladoMaximoSemEngrossarM, larguraImpressa,
} from './core/limites.ts';

const MESA_IMPRESSORA_MM = 270; // volume útil da Snapmaker U1

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const botao = (id: string) => $<HTMLButtonElement>(id);

// ---------- estado (vem da URL) ----------
const estado: Estado = urlParaEstado(location.hash);
let modelo: (ResultadoGeracao & Malha) | null = null;
let modeloDesatualizado = false;

const previa = criarPrevia($('previa'));
const gerador = criarGerador();
const mapa = criarMapa($('mapa'));
const desenho = criarDesenho(mapa, {
  aoMudar(forma, final) {
    estado.forma = forma;
    atualizarArea();
    if (final) {
      salvarNaUrl();
      if (modelo) agendarGeracao(400);
    }
  },
  aoMudarFerramenta: mostrarFerramenta,
});

if (estado.forma) {
  desenho.definirForma(estado.forma);
  enquadrar(mapa, caixaDaForma(estado.forma), false);
}

// ---------- URL ----------
function salvarNaUrl() {
  const hash = estadoParaUrl(estado);
  if (hash !== location.hash.replace(/^#/, '')) history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
}
window.addEventListener('hashchange', () => {
  // o usuário colou outro link na mesma aba
  Object.assign(estado, urlParaEstado(location.hash));
  aplicarParametrosNaTela();
  desenho.definirForma(estado.forma);
  if (estado.forma) enquadrar(mapa, caixaDaForma(estado.forma));
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
  const { largura, altura } = dimensoesMetros(caixaDaForma(f));
  const km2 = areaM2(f) / 1e6;
  const tamanho = estado.params.tamanhoMm;
  const escala = tamanho / Math.max(largura, altura); // mm por metro
  const avisos: string[] = [];
  const faixa = classificarArea(km2);
  if (km2 > AREA_MAXIMA_KM2) avisos.push('Área enorme: a projeção fica distorcida. Escolha uma região menor.');
  else if (faixa === 'muito-grande') {
    avisos.push(`Acima de ${AREA_GRANDE_KM2} km²: prédios e ruas ficam desligados por padrão (dá para ligar manualmente). Ficam relevo, água e áreas verdes.`);
  } else if (faixa === 'grande') {
    avisos.push(`Entre ${AREA_LIVRE_KM2} e ${AREA_GRANDE_KM2} km²: o download do OpenStreetMap fica lento, e prédios e ruas locais saem finos demais para imprimir. Sugestão: só vias principais (rodovias e avenidas), água e cobertura do solo.`);
  }
  if (km2 < 0.01) avisos.push('Área muito pequena: o relevo vai sair quase plano.');
  if (tamanho > MESA_IMPRESSORA_MM) avisos.push(`O modelo passa de ${MESA_IMPRESSORA_MM} mm, o limite da mesa da Snapmaker U1.`);
  if (f.tipo === 'poligono' && poligonoSeCruza(f.pontos)) {
    avisos.push('O polígono cruza a si mesmo. Arraste os vértices para desfazer o cruzamento.');
  }

  // largura impressa de uma rua local, para ver na hora se é imprimível
  const rua = larguraImpressa(LARGURA_RUA_LOCAL_M, escala);
  const fmtMm = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: v < 1 ? 2 : 1 });
  const linhaRua = rua.engrossada
    ? `<div class="aviso-leve">Rua local (${LARGURA_RUA_LOCAL_M} m) sairia com <strong>${fmtMm(rua.realMm)} mm</strong>,
       abaixo do mínimo de ${fmtMm(LARGURA_MINIMA_MM)} mm. Será engrossada para ${fmtMm(LARGURA_MINIMA_MM)} mm
       (≈ ${Math.round(rua.impressaEmMetros)} m reais). Na largura real, só com lado maior até
       ${formatarKm(ladoMaximoSemEngrossarM(LARGURA_RUA_LOCAL_M, tamanho))}.</div>`
    : `<div><span class="ok">✓</span> Rua local (${LARGURA_RUA_LOCAL_M} m): <strong>${fmtMm(rua.realMm)} mm</strong> impressa, imprimível.</div>`;

  info.innerHTML = `
    <div><strong>${descreverForma(f, largura, altura)}</strong> · ${km2 < 10 ? km2.toFixed(2) : Math.round(km2).toLocaleString('pt-BR')} km²</div>
    <div>Modelo: ${(largura * escala).toFixed(0)} × ${(altura * escala).toFixed(0)} mm · 1 mm = ${(1 / escala).toFixed(1)} m</div>
    ${linhaRua}
    <div class="dica">Centro: ${formatarCoordenadas(caixaDaForma(f))} · arraste as alças brancas para ajustar${f.tipo === 'poligono' ? ' (botão direito apaga um vértice)' : ''}</div>
    ${avisos.map((a) => `<div class="aviso">${a}</div>`).join('')}`;
  info.hidden = false;
}

function descreverForma(f: Forma, largura: number, altura: number) {
  switch (f.tipo) {
    case 'retangulo':
      return `Retângulo ${formatarKm(largura)} × ${formatarKm(altura)}`;
    case 'circulo':
      return `Círculo com ${formatarKm(f.raioM * 2)} de diâmetro`;
    case 'hexagono':
      return `Hexágono com ${formatarKm(f.raioM * 2)} entre vértices opostos`;
    case 'poligono':
      return `Polígono de ${f.pontos.length} vértices, ${formatarKm(largura)} × ${formatarKm(altura)}`;
  }
}

function formatarKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// ---------- parâmetros ----------
const entradas = [...document.querySelectorAll<HTMLInputElement>('[data-param]')];

function aplicarParametrosNaTela() {
  for (const el of entradas) {
    const nome = el.dataset.param as NomeParametro;
    const def = PARAMETROS[nome];
    const v = estado.params[nome];
    if (def.tipo === 'booleano') el.checked = v as boolean;
    else {
      el.min = String(def.min);
      el.max = String(def.max);
      el.value = String(v);
    }
  }
  atualizarRotulos();
}

function atualizarRotulos() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-valor]')) {
    const v = estado.params[el.dataset.valor as NomeParametro] as number;
    const casas = Number(el.dataset.casas ?? 0);
    el.textContent = `${v.toFixed(casas)}${el.dataset.sufixo ?? ''}`;
  }
}

for (const el of entradas) {
  const nome = el.dataset.param as NomeParametro;
  const aplicar = () => {
    const bruto = el.type === 'checkbox' ? el.checked : el.value;
    const novo = validarParametro(nome, bruto);
    if (novo === estado.params[nome]) return;
    (estado.params as Record<NomeParametro, number | boolean>)[nome] = novo;
    atualizarRotulos();
    atualizarArea();
    salvarNaUrl();
    if (modelo) agendarGeracao(nome === 'resolucao' ? 500 : 150);
  };
  el.addEventListener('input', () => {
    // número digitado pela metade (ex.: "1" a caminho de "150") só é aplicado ao sair do campo
    if (el.type === 'number' && (el.value === '' || !el.checkValidity())) return;
    aplicar();
  });
  // ao sair do campo: aplica o valor (limitado à faixa permitida) e mostra o valor usado
  el.addEventListener('change', () => {
    aplicar();
    aplicarParametrosNaTela();
  });
}
aplicarParametrosNaTela();
atualizarArea();

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

async function gerar() {
  const forma = estado.forma;
  if (!forma) return;
  if (gerando) {
    // já tem uma geração em andamento: gera de novo quando ela terminar
    modeloDesatualizado = true;
    return;
  }
  gerando = true;
  modeloDesatualizado = false;
  const barra = $('progresso');
  barra.hidden = false;
  try {
    const params = { ...estado.params };
    const r = await gerador.gerar(forma, params, (etapa, fracao) => {
      status(`${etapa}…`);
      $('progresso-barra').style.width = `${Math.round(fracao * 100)}%`;
    });
    modelo = { ...r, posicoes: r.posicoes, indices: r.indices };

    // reposiciona a câmera só quando a área ou o tamanho mudam
    const chave = `${JSON.stringify(forma)}|${params.tamanhoMm}`;
    previa.mostrar([{ malha: modelo, cor: CORES_CAMADAS.terreno }], chave !== chaveEnquadrada);
    chaveEnquadrada = chave;
    $('previa-vazia').hidden = true;

    const medidas = $('previa-medidas');
    medidas.textContent = `${r.larguraMm.toFixed(1)} × ${r.profundidadeMm.toFixed(1)} × ${r.alturaMaxMm.toFixed(1)} mm`;
    medidas.hidden = false;
    const v = r.verificacao;
    const avisoAltura =
      r.alturaMaxMm > MESA_IMPRESSORA_MM
        ? `<div class="aviso">Altura de ${r.alturaMaxMm.toFixed(0)} mm passa do limite de ${MESA_IMPRESSORA_MM} mm da impressora. Reduza o exagero ou o tamanho.</div>`
        : '';
    status(
      v.valida
        ? `<span class="ok">✓ Malha fechada e válida</span> · ${v.triangulos.toLocaleString('pt-BR')} triângulos · zoom de elevação ${r.zoom}${avisoAltura}`
        : `<span class="erro">✗ Malha com problemas: ${v.erros.join('; ')}</span>`,
    );
    botao('btn-stl').disabled = !v.valida;
  } catch (erro) {
    status(`<span class="erro">Erro: ${erro instanceof Error ? erro.message : erro}</span>`);
  } finally {
    gerando = false;
    barra.hidden = true;
    if (modeloDesatualizado) agendarGeracao(0);
  }
}

function status(html: string) {
  const el = $('status');
  el.innerHTML = html;
  el.hidden = false;
}

// Link com área: gera o modelo ao abrir a página (os dados vêm do cache)
if (estado.forma) agendarGeracao(0);

// ---------- exportação ----------
botao('btn-stl').addEventListener('click', () => {
  if (!modelo || !estado.forma) return;
  const nome = nomeArquivo(estado.nome || formatarCoordenadas(caixaDaForma(estado.forma)));
  baixar(new Blob([escreverStl(modelo, `Relevo3D ${nome}`)], { type: 'model/stl' }), `${nome}-${estado.params.tamanhoMm}mm.stl`);
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
