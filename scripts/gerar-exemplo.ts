// Gera um STL de exemplo com dados reais, sem abrir o navegador.
// Uso: npm run exemplo                    (retângulo no Pão de Açúcar, Rio de Janeiro)
//      npm run exemplo -- hexagono        (ou: circulo, retangulo)
//      npm run exemplo -- a=c:-43.16,-22.95,1500 t=120 f=copernicus
//        (pedaços da URL do app, separados por espaço em vez de "&", porque o
//         Windows trata "&" como separador de comandos)
// Fontes: Terrarium e Copernicus. O Mapterhorn usa imagens WebP, que o Node não
// decodifica sem bibliotecas extras; nesse caso o script usa o Terrarium.
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { obterGradeCopernicus } from '../server/copernicus.ts';
import { obterTile } from '../server/fontes.ts';
import { amostrarElevacao, type GradeElevacao } from '../src/core/elevacao.ts';
import { urlParaEstado } from '../src/core/estado.ts';
import { dimensoesMetros, type Forma } from '../src/core/geo.ts';
import { carregarManifold } from '../src/core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../src/core/modelo.ts';
import { escreverStl } from '../src/core/stl.ts';
import { verificarMalha } from '../src/core/verificacao.ts';

const args = process.argv.slice(2);
const arg = args.some((a) => a.includes('=')) ? args.join('&').replace(/^#/, '') : (args[0] ?? 'retangulo');
const centro: [number, number] = [-43.165, -22.9515];
const exemplos: Record<string, Forma> = {
  retangulo: { tipo: 'retangulo', oeste: -43.19, sul: -22.968, leste: -43.14, norte: -22.935 },
  circulo: { tipo: 'circulo', centro, raioM: 2000 },
  hexagono: { tipo: 'hexagono', centro, raioM: 2000, rotacaoGraus: 90 },
};
const estado = urlParaEstado(arg.includes('=') ? arg : '');
const forma = arg.includes('=') ? estado.forma : exemplos[arg];
if (!forma) {
  console.log(`Forma desconhecida: ${arg}. Use retangulo, circulo, hexagono ou um trecho de URL do app.`);
  process.exit(1);
}
const p = estado.params;

const plano = planejarAmostragem(forma, p.resolucao);
let grade: GradeElevacao;
if (p.fonte === 'copernicus') {
  const { largura, altura } = dimensoesMetros(plano.caixaGrade);
  const esp = Math.max(largura, altura) / (plano.amostras - 1);
  const nx = Math.round(largura / esp) + 1;
  const ny = Math.round(altura / esp) + 1;
  const g = await obterGradeCopernicus({ ...plano.caixaGrade, nx, ny });
  grade = { nx, ny, elev: g.elev, larguraM: largura, alturaM: altura, zoom: -1, resolucaoM: g.resolucaoM };
} else {
  if (p.fonte === 'mapterhorn') console.log('(Mapterhorn não disponível no script; usando Terrarium)');
  grade = await amostrarElevacao(plano.caixaGrade, plano.amostras, {
    tamanhoTile: 256,
    zoomMaximo: 15,
    carregar: async (z, x, y) => {
      const png = await obterTile('terrarium', z, x, y);
      return png ? PNG.sync.read(png) : null;
    },
  }, { zoom: p.zoom || undefined });
}
const r = gerarModelo(await carregarManifold(), grade, forma, p);
const v = verificarMalha(r.malhaUnica);

await mkdir('saida', { recursive: true });
const arquivo = `saida/exemplo-${forma.tipo}-${p.modo === 'real' ? '1x1' : `${p.tamanhoMm}mm`}.stl`;
await writeFile(arquivo, new Uint8Array(escreverStl(r.malhaUnica)));
console.log(`Grade ${grade.nx}×${grade.ny} · ${r.largura.toFixed(1)} × ${r.profundidade.toFixed(1)} × ${r.alturaMax.toFixed(1)} ${r.unidade} · escala 1:${Math.round(r.escala)}`);
console.log(`Peças: ${r.partes.map((x) => x.nome).join(', ')}`);
console.log(`Malha: ${v.valida ? 'válida' : v.erros.join('; ')} · ${v.triangulos} triângulos · salvo em ${arquivo}`);
