// Verifica se um ou mais arquivos STL são sólidos fechados (manifold).
// Uso: npm run verificar -- caminho\do\arquivo.stl
import { readFile } from 'node:fs/promises';
import { caixaLimite } from '../src/core/malha.ts';
import { validarComManifold } from '../src/core/manifold.ts';
import { lerStl } from '../src/core/stl.ts';
import { verificarMalha } from '../src/core/verificacao.ts';

const arquivos = process.argv.slice(2);
if (arquivos.length === 0) {
  console.log('Uso: npm run verificar -- arquivo.stl [outro.stl ...]');
  process.exit(1);
}

let falhou = false;
for (const arquivo of arquivos) {
  const buf = await readFile(arquivo);
  const malha = lerStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const v = verificarMalha(malha);
  const m = await validarComManifold(malha);
  const { min, max } = caixaLimite(malha);
  const ok = v.valida && m.status === 'NoError';
  falhou ||= !ok;

  console.log(`\n${arquivo}`);
  console.log(`  Tamanho: ${(max[0] - min[0]).toFixed(1)} × ${(max[1] - min[1]).toFixed(1)} × ${(max[2] - min[2]).toFixed(1)} mm`);
  console.log(`  Triângulos: ${v.triangulos.toLocaleString('pt-BR')} · Volume: ${(v.volumeMm3 / 1000).toFixed(1)} cm³`);
  console.log(`  Verificação própria: ${v.valida ? 'OK' : v.erros.join('; ')}`);
  console.log(`  manifold-3d: ${m.status} (gênero ${m.genero})`);
  console.log(`  Resultado: ${ok ? '✓ VÁLIDO — malha fechada, pronta para fatiar' : '✗ INVÁLIDO'}`);
}
process.exit(falhou ? 1 : 0);
