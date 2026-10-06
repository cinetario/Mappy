// Gera um STL de exemplo com dados reais, sem abrir o navegador.
// Uso: npm run exemplo                    (retângulo no Pão de Açúcar, Rio de Janeiro)
//      npm run exemplo -- hexagono        (ou: circulo, retangulo)
//      npm run exemplo -- "#a=c:-43.16,-22.95,1500&t=120"   (estado copiado da URL do app)
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { obterTileTerreno } from '../server/fontes.ts';
import { amostrarElevacao } from '../src/core/elevacao.ts';
import { urlParaEstado } from '../src/core/estado.ts';
import type { Forma } from '../src/core/geo.ts';
import { carregarManifold } from '../src/core/manifold.ts';
import { gerarModelo, planejarAmostragem } from '../src/core/modelo.ts';
import { escreverStl } from '../src/core/stl.ts';
import { verificarMalha } from '../src/core/verificacao.ts';

const arg = process.argv[2] ?? 'retangulo';
const centro: [number, number] = [-43.165, -22.9515];
const exemplos: Record<string, Forma> = {
  retangulo: { tipo: 'retangulo', oeste: -43.19, sul: -22.968, leste: -43.14, norte: -22.935 },
  circulo: { tipo: 'circulo', centro, raioM: 2000 },
  hexagono: { tipo: 'hexagono', centro, raioM: 2000, rotacaoGraus: 90 },
};
const estado = urlParaEstado(arg.includes('=') ? arg : `#a=r:0,0,1,1`);
const forma = arg.includes('=') ? estado.forma : exemplos[arg];
if (!forma) {
  console.log(`Forma desconhecida: ${arg}. Use retangulo, circulo, hexagono ou um trecho de URL do app.`);
  process.exit(1);
}

const plano = planejarAmostragem(forma, estado.params.resolucao);
const grade = await amostrarElevacao(plano.caixaGrade, plano.amostras, async (z, x, y) =>
  PNG.sync.read(await obterTileTerreno(z, x, y)),
);
const r = gerarModelo(await carregarManifold(), grade, forma, estado.params);
const v = verificarMalha(r.malha);

await mkdir('saida', { recursive: true });
const arquivo = `saida/exemplo-${forma.tipo}-${estado.params.tamanhoMm}mm.stl`;
await writeFile(arquivo, new Uint8Array(escreverStl(r.malha)));
console.log(`Grade ${grade.nx}×${grade.ny} (zoom ${grade.zoom}) · ${r.larguraMm.toFixed(1)} × ${r.profundidadeMm.toFixed(1)} × ${r.alturaMaxMm.toFixed(1)} mm`);
console.log(`Malha: ${v.valida ? 'válida' : v.erros.join('; ')} · ${v.triangulos} triângulos · salvo em ${arquivo}`);
