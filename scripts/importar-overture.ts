// Baixa os prédios do Overture Maps de uma região e importa para o índice local.
// Uso: npm run importar-overture -- df
//      npm run importar-overture -- oeste,sul,leste,norte
import { gravarConjunto } from '../server/extras.ts';
import { arquivosDaRegiao, lerPrediosOverture } from '../server/overture.ts';
import { ARQUIVO_INDICE } from '../server/indice-osm.ts';
import { ATRIBUICAO_OVERTURE, atribuicaoBaseOverture } from '../src/core/atribuicoes.ts';
import { lerRegiao } from './regioes.ts';

const regiao = lerRegiao(process.argv[2]);
if (!regiao) {
  console.log('Uso: npm run importar-overture -- df');
  console.log('     npm run importar-overture -- oeste,sul,leste,norte   (graus, ex.: -48.3,-16.1,-47.3,-15.5)');
  process.exit(1);
}

const inicio = Date.now();
const seg = () => `${Math.round((Date.now() - inicio) / 1000)} s`;
console.log(`Prédios do Overture Maps: ${regiao.nome}`);
const { versao, urls } = await arquivosDaRegiao(regiao.caixa);
console.log(`Release ${versao}: ${urls.length} arquivo(s) tocam a região. Lendo só os pedaços necessários…`);

const gravador = gravarConjunto('overture', regiao.id);
try {
  const origens = await lerPrediosOverture(urls, regiao.caixa, (r) => gravador.inserir(r.elemento, r.caixa), (p) => {
    process.stdout.write(`\r  arquivo ${p.arquivo}/${p.arquivos} · pedaço ${p.grupo}/${p.grupos} · ${(p.bytes / 1e6).toFixed(0)} MB · ${p.predios.toLocaleString('pt-BR')} prédios · ${seg()}   `);
  });
  process.stdout.write('\n');
  const bases = Object.entries(origens).sort((a, b) => b[1].quantidade - a[1].quantidade);
  const atribuicao = [ATRIBUICAO_OVERTURE, ...bases.map(([d, o]) => atribuicaoBaseOverture(d, o.licenca))]
    .map((a) => `${a.texto} (${a.licenca})`).join('; ');
  const c = gravador.concluir({
    fonte: 'overture',
    nome: regiao.id,
    caixa: regiao.caixa,
    versao,
    origens: Object.fromEntries(bases.map(([d, o]) => [d, o.quantidade])),
    atribuicao,
    licenca: 'ODbL 1.0',
  });
  console.log(`\n✓ ${c.quantidade.toLocaleString('pt-BR')} prédios gravados em ${ARQUIVO_INDICE} (${seg()})`);
  for (const [d, o] of bases) console.log(`  ${d}: ${o.quantidade.toLocaleString('pt-BR')}`);
  console.log(`Atribuição: ${atribuicao}`);
  console.log('No app, aba Camadas → Prédios → Fonte dos prédios. Se o app estiver aberto, aperte F5.');
} catch (erro) {
  gravador.cancelar();
  console.error(`\nFalhou: ${erro instanceof Error ? erro.message : erro}. Nada foi alterado; rode de novo.`);
  process.exit(1);
}
