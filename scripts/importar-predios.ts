// Importa prédios de um arquivo da prefeitura (GeoJSON ou shapefile) para o índice local.
// Uso:
//   npm run importar-predios -- arquivo.zip                       (mostra os campos)
//   npm run importar-predios -- arquivo.zip --altura ALTURA --atribuicao "Prefeitura de X (licença Y)"
// Opções: --andares CAMPO (número de andares, 3 m cada), --epsg 31983 (se o
// arquivo não disser o sistema de coordenadas), --nome nome-curto.
import path from 'node:path';
import { gravarConjunto } from '../server/extras.ts';
import { camposDoArquivo, elementoPrefeitura, lerArquivoPredios, sugerirCampos } from '../server/prefeitura.ts';

const args = process.argv.slice(2);
const opcao = (nome: string) => {
  const k = args.indexOf(`--${nome}`);
  return k >= 0 ? args[k + 1] : undefined;
};
const arquivo = args.find((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--'));
if (!arquivo) {
  console.log('Uso: npm run importar-predios -- arquivo.zip|arquivo.shp|arquivo.geojson [--altura CAMPO] [--andares CAMPO] [--atribuicao "texto"] [--epsg 31983] [--nome nome]');
  process.exit(1);
}

const epsg = opcao('epsg') ? Number(opcao('epsg')) : undefined;
const { colecao, crs } = await lerArquivoPredios(path.resolve(arquivo), epsg);
const poligonos = colecao.features.filter((f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
console.log(`${path.basename(arquivo)}: ${colecao.features.length.toLocaleString('pt-BR')} feições (${poligonos.length.toLocaleString('pt-BR')} polígonos). Coordenadas: ${crs}.`);
const campos = camposDoArquivo(colecao);
const campoAltura = opcao('altura');
const campoAndares = opcao('andares');

if (!campoAltura && !campoAndares) {
  console.log('\nCampos do arquivo (nome: exemplos):');
  for (const c of campos) console.log(`  ${c.nome}: ${c.exemplos.join(' | ')}${c.total && c.numericos === c.total ? '  (números)' : ''}`);
  const s = sugerirCampos(campos);
  console.log('\nEscolha o campo da altura (em metros) com --altura, ou o de andares com --andares.');
  if (s.altura.length) console.log(`Parecem altura: ${s.altura.join(', ')}`);
  if (s.andares.length) console.log(`Parecem andares: ${s.andares.join(', ')}`);
  console.log(`Exemplo: npm run importar-predios -- "${arquivo}" --altura ${s.altura[0] ?? 'CAMPO'} --atribuicao "Prefeitura de … (licença …)"`);
  process.exit(0);
}
for (const c of [campoAltura, campoAndares]) {
  if (c && !campos.some((x) => x.nome === c)) {
    console.error(`O campo "${c}" não existe. Campos: ${campos.map((x) => x.nome).join(', ')}`);
    process.exit(1);
  }
}
let atribuicao = opcao('atribuicao');
if (!atribuicao) {
  atribuicao = `Prédios: ${path.basename(arquivo)}`;
  console.log(`\nAviso: sem --atribuicao. Vou mostrar "${atribuicao}". Confira a licença do arquivo e o texto que ela exige.`);
}
const nome = (opcao('nome') ?? path.basename(arquivo, path.extname(arquivo))).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const gravador = gravarConjunto('prefeitura', nome);
let comAltura = 0;
let ignorados = 0;
const caixa: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
try {
  let id = 1;
  for (const f of poligonos) {
    const r = elementoPrefeitura(f, id, { campoAltura, campoAndares, nome: atribuicao });
    if (!r) {
      ignorados++;
      continue;
    }
    id++;
    const tags = (r.elemento as { tags: Record<string, string> }).tags;
    if (tags.height || tags['building:levels']) comAltura++;
    caixa[0] = Math.min(caixa[0], r.caixa[0]); caixa[1] = Math.min(caixa[1], r.caixa[1]);
    caixa[2] = Math.max(caixa[2], r.caixa[2]); caixa[3] = Math.max(caixa[3], r.caixa[3]);
    gravador.inserir(r.elemento, r.caixa);
  }
  const c = gravador.concluir({
    fonte: 'prefeitura', nome, caixa, versao: path.basename(arquivo),
    origens: { [atribuicao]: id - 1 }, atribuicao, licenca: 'informada pelo usuário',
  });
  console.log(`\n✓ ${c.quantidade.toLocaleString('pt-BR')} prédios importados (${comAltura.toLocaleString('pt-BR')} com altura)${ignorados ? `; ${ignorados} ignorados` : ''}.`);
  console.log(`Área: ${caixa.map((v) => v.toFixed(4)).join(', ')}`);
  console.log('No app, aba Camadas → Prédios → Fonte dos prédios → Arquivo da prefeitura. Se o app estiver aberto, aperte F5.');
} catch (erro) {
  gravador.cancelar();
  throw erro;
}
