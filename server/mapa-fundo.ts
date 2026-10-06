// Cache em disco do mapa de fundo (OpenFreeMap): estilo, tiles vetoriais,
// fontes e ícones. O navegador pede pelo servidor local (/api/mapa?u=…),
// que baixa uma vez e guarda em cache/mapa/.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PASTA_CACHE, USER_AGENT, gravar } from './fontes.ts';

/** Só estes servidores podem ser buscados (o servidor local não é um proxy aberto). */
const PERMITIDOS = new Set(['tiles.openfreemap.org']);
/** JSON (estilo, índice de tiles) muda de vez em quando; tiles têm a versão no endereço. */
const VALIDADE_JSON_MS = 24 * 60 * 60 * 1000;

export function urlPermitida(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && PERMITIDOS.has(url.hostname);
  } catch {
    return false;
  }
}

function tipoDe(u: string): string {
  const p = new URL(u).pathname;
  if (p.endsWith('.pbf') || p.endsWith('.mvt')) return 'application/x-protobuf';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'application/json; charset=utf-8';
}

const emAndamento = new Map<string, Promise<{ dados: Buffer; tipo: string }>>();

export async function obterRecursoMapa(u: string): Promise<{ dados: Buffer; tipo: string; origem: 'cache' | 'rede' }> {
  const tipo = tipoDe(u);
  const hash = createHash('sha1').update(u).digest('hex');
  const arquivo = path.join(PASTA_CACHE, 'mapa', hash.slice(0, 2), hash);
  const ehJson = tipo.startsWith('application/json');
  let guardado: Buffer | null = null;
  try {
    const st = await stat(arquivo);
    guardado = await readFile(arquivo);
    if (!ehJson || Date.now() - st.mtimeMs < VALIDADE_JSON_MS) return { dados: guardado, tipo, origem: 'cache' };
  } catch {
    // não está em cache
  }
  let tarefa = emAndamento.get(arquivo);
  if (!tarefa) {
    tarefa = (async () => {
      const resp = await fetch(u, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = Buffer.from(await resp.arrayBuffer());
      await gravar(arquivo, dados);
      return { dados, tipo };
    })();
    emAndamento.set(arquivo, tarefa);
    tarefa.finally(() => emAndamento.delete(arquivo)).catch(() => undefined);
  }
  try {
    return { ...(await tarefa), origem: 'rede' };
  } catch (erro) {
    // sem internet: serve a versão guardada, mesmo antiga
    if (guardado) return { dados: guardado, tipo, origem: 'cache' };
    throw erro;
  }
}
