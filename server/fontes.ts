// Acesso às fontes de dados abertas, com cache em disco.
// Tudo que é baixado fica em ./cache para não sobrecarregar os serviços públicos.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PASTA_CACHE = path.resolve(process.cwd(), 'cache');

// Política do Nominatim: identificar a aplicação. Defina RELEVO3D_CONTATO
// (ex.: seu e-mail) para incluí-lo no User-Agent, como a política recomenda.
const CONTATO = process.env.RELEVO3D_CONTATO;
export const USER_AGENT = `Relevo3D/0.1 (aplicativo local de modelos 3D de mapas${CONTATO ? `; ${CONTATO}` : ''})`;

const emAndamento = new Map<string, Promise<Buffer>>();

/** Baixa `url` uma única vez e guarda em `cache/<arquivo>`. */
async function comCache(arquivo: string, url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const destino = path.join(PASTA_CACHE, arquivo);
  try {
    return await readFile(destino);
  } catch {
    // não está em cache: baixa
  }
  const existente = emAndamento.get(destino);
  if (existente) return existente;

  const tarefa = (async () => {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
    const dados = Buffer.from(await resp.arrayBuffer());
    await mkdir(path.dirname(destino), { recursive: true });
    const temp = `${destino}.${process.pid}.tmp`;
    await writeFile(temp, dados);
    await rename(temp, destino);
    return dados;
  })();
  emAndamento.set(destino, tarefa);
  try {
    return await tarefa;
  } finally {
    emAndamento.delete(destino);
  }
}

/** Tile de elevação no formato Terrarium (AWS Terrain Tiles, dados abertos). */
export function obterTileTerreno(z: number, x: number, y: number): Promise<Buffer> {
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 15 || x < 0 || x >= n || y < 0 || y >= n) {
    return Promise.reject(new Error(`Tile inválido: ${z}/${x}/${y}`));
  }
  return comCache(
    `terreno/${z}/${x}/${y}.png`,
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  );
}

// O Nominatim permite no máximo 1 requisição por segundo.
let filaNominatim: Promise<unknown> = Promise.resolve();
function naFilaNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = filaNominatim.then(fn);
  filaNominatim = resultado.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
  return resultado;
}

/** Busca de endereços (Nominatim / OpenStreetMap). Retorna o JSON da API. */
export function buscarEndereco(consulta: string): Promise<Buffer> {
  const q = consulta.trim().slice(0, 200);
  if (!q) return Promise.reject(new Error('Busca vazia'));
  const chave = createHash('sha1').update(q.toLowerCase()).digest('hex');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  const arquivo = `busca/${chave}.json`;
  return readFile(path.join(PASTA_CACHE, arquivo)).catch(() =>
    naFilaNominatim(() => comCache(arquivo, url, { 'Accept-Language': 'pt-BR,pt,en' })),
  );
}
