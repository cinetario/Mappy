// Acesso às fontes de dados abertas, com cache em disco.
// Tudo que é baixado fica em ./cache para não sobrecarregar os serviços públicos.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PASTA_CACHE = path.resolve(process.cwd(), 'cache');

// Política do Nominatim: identificar a aplicação. Defina RELEVO3D_CONTATO
// (ex.: seu e-mail) para incluí-lo no User-Agent, como a política recomenda.
const CONTATO = process.env.RELEVO3D_CONTATO;
export const USER_AGENT = `Relevo3D/0.2 (aplicativo local de modelos 3D de mapas${CONTATO ? `; ${CONTATO}` : ''})`;

const emAndamento = new Map<string, Promise<Buffer | null>>();

/** Erro de rede/servidor que vale a pena tentar de novo. */
class ErroTemporario extends Error {}

async function gravar(destino: string, dados: Buffer | string) {
  await mkdir(path.dirname(destino), { recursive: true });
  const temp = `${destino}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, dados);
  await rename(temp, destino);
}

const existe = (p: string) => access(p).then(() => true, () => false);

/**
 * Baixa `url` uma única vez e guarda em `cache/<arquivo>`.
 * Um 404 também fica guardado (arquivo `.404`), para não perguntar de novo.
 * Devolve null quando o recurso não existe.
 */
async function comCache(arquivo: string, url: string, headers: Record<string, string> = {}): Promise<Buffer | null> {
  const destino = path.join(PASTA_CACHE, arquivo);
  try {
    return await readFile(destino);
  } catch {
    // não está em cache
  }
  if (await existe(`${destino}.404`)) return null;
  const existente = emAndamento.get(destino);
  if (existente) return existente;

  const tarefa = comTentativas(async () => {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (resp.status === 404 || resp.status === 403) {
      await gravar(`${destino}.404`, '');
      return null;
    }
    if (resp.status === 429 || resp.status >= 500) throw new ErroTemporario(`HTTP ${resp.status} ao baixar ${url}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
    const dados = Buffer.from(await resp.arrayBuffer());
    await gravar(destino, dados);
    return dados;
  });
  emAndamento.set(destino, tarefa);
  try {
    return await tarefa;
  } finally {
    emAndamento.delete(destino);
  }
}

/** Repete em falhas temporárias, esperando 1 s, 2 s, 4 s. */
export async function comTentativas<T>(fn: () => Promise<T>, tentativas = 4): Promise<T> {
  for (let k = 0; ; k++) {
    try {
      return await fn();
    } catch (erro) {
      const temporario = erro instanceof ErroTemporario || (erro instanceof TypeError && /fetch/i.test(erro.message));
      if (!temporario || k >= tentativas - 1) throw erro;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** k));
    }
  }
}

// ---------- tiles de elevação ----------
export type FonteTile = 'terrarium' | 'mapterhorn';

const FONTES_TILE: Record<FonteTile, { url: (z: number, x: number, y: number) => string; ext: string; zoomMax: number }> = {
  terrarium: {
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    ext: 'png',
    zoomMax: 15,
  },
  mapterhorn: {
    url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
    ext: 'webp',
    zoomMax: 17,
  },
};

export function ehFonteTile(f: string): f is FonteTile {
  return f in FONTES_TILE;
}

/** Tile de elevação (Terrarium). null = a fonte não tem esse tile. */
export function obterTile(fonte: FonteTile, z: number, x: number, y: number): Promise<Buffer | null> {
  const def = FONTES_TILE[fonte];
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > def.zoomMax || x < 0 || x >= n || y < 0 || y >= n) {
    return Promise.reject(new Error(`Tile inválido: ${z}/${x}/${y}`));
  }
  return comCache(`${fonte}/${z}/${x}/${y}.${def.ext}`, def.url(z, x, y));
}

export function tipoDoTile(fonte: FonteTile) {
  return FONTES_TILE[fonte].ext === 'png' ? 'image/png' : 'image/webp';
}

/** Compatibilidade com a Fase 1 (scripts): tile Terrarium da AWS. */
export async function obterTileTerreno(z: number, x: number, y: number): Promise<Buffer> {
  const t = await obterTile('terrarium', z, x, y);
  if (!t) throw new Error(`Tile ${z}/${x}/${y} não existe`);
  return t;
}

// ---------- Nominatim ----------
// O Nominatim permite no máximo 1 requisição por segundo.
let filaNominatim: Promise<unknown> = Promise.resolve();
function naFilaNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = filaNominatim.then(fn);
  filaNominatim = resultado.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
  return resultado;
}

/** Busca de endereços (Nominatim / OpenStreetMap). Retorna o JSON da API. */
export async function buscarEndereco(consulta: string): Promise<Buffer> {
  const q = consulta.trim().slice(0, 200);
  if (!q) throw new Error('Busca vazia');
  const chave = createHash('sha1').update(q.toLowerCase()).digest('hex');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  const arquivo = `busca/${chave}.json`;
  const r = await readFile(path.join(PASTA_CACHE, arquivo)).catch(() =>
    naFilaNominatim(() => comCache(arquivo, url, { 'Accept-Language': 'pt-BR,pt,en' })),
  );
  return r ?? Buffer.from('[]');
}

export { PASTA_CACHE, gravar };
