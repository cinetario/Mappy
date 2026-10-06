import './estilo.css';
import { amostrarElevacao, type GradeElevacao } from './core/elevacao.ts';
import { dimensoesMetros, formatarCoordenadas, type Retangulo } from './core/geo.ts';
import { escreverStl } from './core/stl.ts';
import { gerarTerreno, type ModeloTerreno } from './core/terreno.ts';
import { verificarMalha } from './core/verificacao.ts';
import { criarMapa } from './navegador/mapa.ts';
import { CORES_CAMADAS, criarPrevia } from './navegador/previa.ts';
import { carregarTileTerreno } from './navegador/tiles.ts';

// Limites usados nos avisos
const AREA_MAX_OSM_KM2 = 25; // acima disso o Overpass (prédios/ruas, fase 2) fica lento ou recusa
const AREA_MAX_KM2 = 250_000; // acima disso a projeção local distorce demais
const MESA_IMPRESSORA_MM = 270; // volume útil da Snapmaker U1

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const entrada = (id: string) => $<HTMLInputElement>(id);

let area: Retangulo | null = null;
let nomeLocal = '';
let grade: GradeElevacao | null = null;
let gradeChave = '';
let modelo: ModeloTerreno | null = null;

const previa = criarPrevia($('previa'));
const mapa = criarMapa($('mapa'), selecionarArea, (ativo) => {
  $('btn-desenhar').classList.toggle('ativo', ativo);
  $('dica-desenho').textContent = ativo
    ? 'Clique e arraste no mapa para desenhar. Esc cancela.'
    : 'Clique em "Desenhar retângulo" e arraste no mapa.';
});

// ---------- busca ----------
$('form-busca').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = entrada('busca').value.trim();
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
        nomeLocal = item.name || item.display_name.split(',')[0];
        mapa.irPara(item.boundingbox.map(Number) as [number, number, number, number]);
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

// ---------- área ----------
$('btn-desenhar').addEventListener('click', () => mapa.iniciarDesenho());
$('btn-visivel').addEventListener('click', () => mapa.usarAreaVisivel());

function selecionarArea(r: Retangulo) {
  area = r;
  modelo = null;
  ($('btn-gerar') as HTMLButtonElement).disabled = false;
  ($('btn-stl') as HTMLButtonElement).disabled = true;
  atualizarInfoArea();
}

function atualizarInfoArea() {
  const info = $('info-area');
  if (!area) {
    info.hidden = true;
    return;
  }
  const { largura, altura } = dimensoesMetros(area);
  const km2 = (largura * altura) / 1e6;
  const tamanho = Number(entrada('p-tamanho').value) || 150;
  const escala = tamanho / Math.max(largura, altura); // mm por metro
  const avisos: string[] = [];
  if (km2 > AREA_MAX_KM2) avisos.push('Área enorme: a projeção fica distorcida. Escolha uma região menor.');
  else if (km2 > AREA_MAX_OSM_KM2) {
    avisos.push(`Área grande para prédios e ruas (acima de ~${AREA_MAX_OSM_KM2} km² o Overpass fica lento ou recusa). Para só o relevo, tudo bem.`);
  }
  if (km2 < 0.01) avisos.push('Área muito pequena: o relevo vai sair quase plano.');
  if (tamanho > MESA_IMPRESSORA_MM) avisos.push(`O modelo passa de ${MESA_IMPRESSORA_MM} mm, o limite da mesa da Snapmaker U1.`);

  info.innerHTML = `
    <div><strong>${formatarKm(largura)} × ${formatarKm(altura)}</strong> (${km2 < 10 ? km2.toFixed(2) : Math.round(km2).toLocaleString('pt-BR')} km²)</div>
    <div>Modelo: ${(largura * escala).toFixed(0)} × ${(altura * escala).toFixed(0)} mm · 1 mm = ${(1 / escala).toFixed(1)} m</div>
    <div class="dica">Centro: ${formatarCoordenadas(area)}</div>
    ${avisos.map((a) => `<div class="aviso">${a}</div>`).join('')}`;
  info.hidden = false;
}

function formatarKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// ---------- parâmetros ----------
const lerParametros = () => ({
  tamanhoMm: limitar(Number(entrada('p-tamanho').value), 20, 400, 150),
  exagero: limitar(Number(entrada('p-exagero').value), 1, 5, 1.5),
  baseMm: limitar(Number(entrada('p-base').value), 0.6, 30, 3),
  achatarMar: entrada('p-mar').checked,
});
const limitar = (v: number, min: number, max: number, padrao: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;

entrada('p-exagero').addEventListener('input', () => {
  $('v-exagero').textContent = `${Number(entrada('p-exagero').value).toFixed(1)}x`;
});
entrada('p-resolucao').addEventListener('input', () => {
  $('v-resolucao').textContent = entrada('p-resolucao').value;
});

// Se o modelo já foi gerado, mudanças de parâmetros atualizam a prévia na hora
// (sem baixar nada de novo; só a resolução exige nova amostragem).
let espera: number | undefined;
for (const id of ['p-tamanho', 'p-exagero', 'p-base', 'p-mar', 'p-resolucao']) {
  entrada(id).addEventListener('input', () => {
    atualizarInfoArea();
    if (!modelo) return;
    clearTimeout(espera);
    espera = window.setTimeout(gerar, id === 'p-resolucao' ? 500 : 150);
  });
}

// ---------- geração ----------
$('btn-gerar').addEventListener('click', gerar);

let gerando = false;
async function gerar() {
  if (!area || gerando) return;
  gerando = true;
  const botao = $('btn-gerar') as HTMLButtonElement;
  botao.disabled = true;
  try {
    const resolucao = Number(entrada('p-resolucao').value);
    const chave = `${area.oeste},${area.sul},${area.leste},${area.norte},${resolucao}`;
    const mesmaArea = gradeChave.startsWith(`${area.oeste},${area.sul},${area.leste},${area.norte},`);
    const tamanhoAnterior = modelo?.larguraMm;
    if (!grade || chave !== gradeChave) {
      status('Baixando dados de elevação…');
      grade = await amostrarElevacao(area, resolucao, carregarTileTerreno);
      gradeChave = chave;
    }
    status('Gerando malha…');
    await new Promise((r) => setTimeout(r, 0)); // deixa a tela atualizar
    modelo = gerarTerreno(grade, lerParametros());
    const enquadrar = !mesmaArea || tamanhoAnterior !== modelo.larguraMm;
    previa.mostrar([{ malha: modelo, cor: CORES_CAMADAS.terreno }], enquadrar);
    $('previa-vazia').hidden = true;

    const v = verificarMalha(modelo);
    const medidas = $('previa-medidas');
    medidas.textContent = `${modelo.larguraMm.toFixed(1)} × ${modelo.profundidadeMm.toFixed(1)} × ${modelo.alturaMaxMm.toFixed(1)} mm`;
    medidas.hidden = false;
    const avisoAltura =
      modelo.alturaMaxMm > MESA_IMPRESSORA_MM
        ? `<div class="aviso">Altura de ${modelo.alturaMaxMm.toFixed(0)} mm passa do limite de ${MESA_IMPRESSORA_MM} mm da impressora. Reduza o exagero ou o tamanho.</div>`
        : '';
    status(
      v.valida
        ? `<span class="ok">✓ Malha fechada e válida</span> · ${v.triangulos.toLocaleString('pt-BR')} triângulos · zoom de elevação ${grade.zoom}${avisoAltura}`
        : `<span class="erro">✗ Malha com problemas: ${v.erros.join('; ')}</span>`,
    );
    ($('btn-stl') as HTMLButtonElement).disabled = !v.valida;
  } catch (erro) {
    status(`<span class="erro">Erro: ${erro instanceof Error ? erro.message : erro}</span>`);
  } finally {
    gerando = false;
    botao.disabled = false;
  }
}

function status(html: string) {
  const el = $('status');
  el.innerHTML = html;
  el.hidden = false;
}

// ---------- exportação ----------
$('btn-stl').addEventListener('click', () => {
  if (!modelo || !area) return;
  const p = lerParametros();
  const nome = nomeArquivo(nomeLocal || formatarCoordenadas(area));
  baixar(new Blob([escreverStl(modelo, `Relevo3D ${nome}`)], { type: 'model/stl' }), `${nome}-${p.tamanhoMm}mm.stl`);
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
