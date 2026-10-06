// Guarda no cache, de uma vez, a elevação (Mapterhorn) e o mapa de fundo de uma
// região. Depois disso, gerar modelos ali não depende da internet para esses dados.
// Uso: npm run pre-carregar -- df
//      npm run pre-carregar -- -48.3,-16.1,-47.3,-15.5      (oeste,sul,leste,norte)
import { obterTile } from '../server/fontes.ts';
import { obterRecursoMapa } from '../server/mapa-fundo.ts';

/** Regiões prontas (caixa com uma pequena folga). */
const REGIOES: Record<string, { nome: string; caixa: [number, number, number, number] }> = {
  df: { nome: 'Distrito Federal', caixa: [-48.30, -16.07, -47.29, -15.48] },
};
const ZOOM_ELEVACAO = [6, 14] as const;
const ZOOM_MAPA_MAX = 14;
const SIMULTANEOS = 6;
const ESTILO = 'https://tiles.openfreemap.org/styles/liberty';

const arg = process.argv[2]?.toLowerCase();
const regiao = arg && REGIOES[arg] ? REGIOES[arg] : arg?.split(',').length === 4
  ? { nome: arg, caixa: arg.split(',').map(Number) as [number, number, number, number] }
  : null;
if (!regiao || regiao.caixa.some((v) => !Number.isFinite(v))) {
  console.log('Uso: npm run pre-carregar -- df');
  console.log('     npm run pre-carregar -- oeste,sul,leste,norte   (graus, ex.: -48.3,-16.1,-47.3,-15.5)');
  process.exit(1);
}
const [oeste, sul, leste, norte] = regiao.caixa;

/** Tiles (z, x, y) que cobrem a caixa num zoom. */
function tilesDaCaixa(z: number): [number, number, number][] {
  const n = 2 ** z;
  const tx = (lon: number) => Math.min(n - 1, Math.floor(((lon + 180) / 360) * n));
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n));
  };
  const lista: [number, number, number][] = [];
  for (let x = tx(oeste); x <= tx(leste); x++) for (let y = ty(norte); y <= ty(sul); y++) lista.push([z, x, y]);
  return lista;
}

/** Roda as tarefas com poucas conexões ao mesmo tempo, mostrando o progresso. */
async function executar(titulo: string, tarefas: (() => Promise<'cache' | 'rede' | 'vazio'>)[]) {
  const conta = { cache: 0, rede: 0, vazio: 0, erro: 0 };
  let proxima = 0;
  let feitas = 0;
  const mostrar = () => process.stdout.write(`\r  ${titulo}: ${feitas}/${tarefas.length} (baixados ${conta.rede}, já no cache ${conta.cache}${conta.erro ? `, falhas ${conta.erro}` : ''})   `);
  const trabalhador = async () => {
    while (proxima < tarefas.length) {
      const t = tarefas[proxima++];
      try {
        conta[await t()]++;
      } catch {
        conta.erro++;
      }
      feitas++;
      if (feitas % 20 === 0 || feitas === tarefas.length) mostrar();
    }
  };
  await Promise.all(Array.from({ length: SIMULTANEOS }, trabalhador));
  mostrar();
  process.stdout.write('\n');
  return conta;
}

console.log(`Pré-carregando ${regiao.nome} (${oeste}, ${sul} → ${leste}, ${norte})\n`);

// ---- elevação (Mapterhorn, a fonte padrão) ----
const tilesElevacao: [number, number, number][] = [];
for (let z = ZOOM_ELEVACAO[0]; z <= ZOOM_ELEVACAO[1]; z++) tilesElevacao.push(...tilesDaCaixa(z));
let zoomComDados = 0;
const elev = await executar('Elevação (Mapterhorn)', tilesElevacao.map(([z, x, y]) => async () => {
  const t = await obterTile('mapterhorn', z, x, y);
  if (t) zoomComDados = Math.max(zoomComDados, z);
  return t ? 'rede' : 'vazio';
}));

// ---- mapa de fundo (OpenFreeMap): os mesmos endereços que o navegador pede ----
const lerJson = async (u: string) => JSON.parse((await obterRecursoMapa(u)).dados.toString('utf8'));
const estilo = await lerJson(ESTILO);
const tarefasMapa: (() => Promise<'cache' | 'rede' | 'vazio'>)[] = [];
for (const fonte of Object.values(estilo.sources) as { url?: string; tiles?: string[]; maxzoom?: number; minzoom?: number }[]) {
  const tj = fonte.url ? await lerJson(fonte.url) : fonte;
  const modelo = tj.tiles?.[0];
  if (!modelo || !modelo.startsWith('https://tiles.openfreemap.org/')) continue;
  const zMax = Math.min(tj.maxzoom ?? ZOOM_MAPA_MAX, ZOOM_MAPA_MAX);
  for (let z = tj.minzoom ?? 0; z <= zMax; z++) {
    for (const [zz, x, y] of tilesDaCaixa(z)) {
      const u = modelo.replace('{z}', String(zz)).replace('{x}', String(x)).replace('{y}', String(y));
      tarefasMapa.push(async () => (await obterRecursoMapa(u)).origem);
    }
  }
}
const mapa = await executar('Mapa de fundo (OpenFreeMap)', tarefasMapa);

console.log(`\nPronto. Elevação: ${elev.rede} tiles, com dados até o zoom ${zoomComDados}`
  + (zoomComDados < ZOOM_ELEVACAO[1] ? ' (para mais detalhe o app usa esse zoom; os pedidos sem dados também ficam anotados no cache)' : '')
  + `. Mapa: ${mapa.rede + mapa.cache} tiles.`);
if (elev.erro || mapa.erro) console.log('Alguns tiles falharam (internet instável?). Rode o comando de novo: o que já veio fica guardado.');
