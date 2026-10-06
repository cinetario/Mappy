// Importa os arquivos .osm.pbf de dados-osm/ para o índice local.
// Uso: npm run importar-osm
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { importarArquivos } from '../server/importador.ts';
import { ARQUIVO_INDICE, PASTA_DADOS_OSM } from '../server/indice-osm.ts';

if (!existsSync(PASTA_DADOS_OSM)) mkdirSync(PASTA_DADOS_OSM, { recursive: true });
const arquivos = readdirSync(PASTA_DADOS_OSM)
  .filter((f) => f.endsWith('.osm.pbf'))
  .map((f) => path.join(PASTA_DADOS_OSM, f));

if (!arquivos.length) {
  console.log(`Nenhum arquivo .osm.pbf em ${PASTA_DADOS_OSM}`);
  console.log('Baixe um extrato, por exemplo:');
  console.log('  https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf');
  console.log('e salve nessa pasta. Depois rode de novo: npm run importar-osm');
  process.exit(1);
}

const r = importarArquivos(arquivos, ARQUIVO_INDICE);
const tamanho = (statSync(ARQUIVO_INDICE).size / 1e6).toFixed(0);
const n = (v: number) => v.toLocaleString('pt-BR');
const c = r.contagens;
console.log(`\n✓ Pronto em ${r.segundos.toFixed(0)} s. Índice: ${ARQUIVO_INDICE} (${tamanho} MB)`);
console.log(`  prédios ${n(c.predios)} · vias ${n(c.vias)} · água ${n(c.agua)} · cobertura ${n(c.cobertura)} · árvores ${n(c.arvores)}`);
for (const i of r.arquivos) {
  console.log(`  ${i.nome}: dados de ${i.dataDados ? new Date(i.dataDados).toLocaleDateString('pt-BR') : 'data desconhecida'}`);
}
console.log('\nSe o app estiver aberto, aperte F5 para ver os dados novos.');
