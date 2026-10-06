// Gera um STL de exemplo com dados reais, sem abrir o navegador.
// Uso: npm run exemplo            (Pão de Açúcar, Rio de Janeiro)
//      npm run exemplo -- oeste sul leste norte [tamanhoMm] [exagero]
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { obterTileTerreno } from '../server/fontes.ts';
import { amostrarElevacao } from '../src/core/elevacao.ts';
import { escreverStl } from '../src/core/stl.ts';
import { gerarTerreno } from '../src/core/terreno.ts';
import { verificarMalha } from '../src/core/verificacao.ts';

const args = process.argv.slice(2).map(Number);
const [oeste, sul, leste, norte] = args.length >= 4 ? args : [-43.19, -22.968, -43.14, -22.935];
const tamanhoMm = args[4] || 150;
const exagero = args[5] || 1.5;

const grade = await amostrarElevacao({ oeste, sul, leste, norte }, 300, async (z, x, y) =>
  PNG.sync.read(await obterTileTerreno(z, x, y)),
);
const modelo = gerarTerreno(grade, { tamanhoMm, exagero, baseMm: 3, achatarMar: true });
const v = verificarMalha(modelo);

await mkdir('saida', { recursive: true });
const arquivo = `saida/exemplo-${tamanhoMm}mm.stl`;
await writeFile(arquivo, new Uint8Array(escreverStl(modelo)));
console.log(`Grade ${grade.nx}×${grade.ny} (zoom ${grade.zoom}) · ${modelo.larguraMm.toFixed(1)} × ${modelo.profundidadeMm.toFixed(1)} × ${modelo.alturaMaxMm.toFixed(1)} mm`);
console.log(`Malha: ${v.valida ? 'válida' : v.erros.join('; ')} · salvo em ${arquivo}`);
