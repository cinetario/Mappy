// Consultas ao Overpass (OpenStreetMap) com cache em disco.
// Cada pedido faz UMA tentativa, num servidor escolhido por quem pede, com
// tempo limite de 60 s. As novas tentativas, a troca de servidor e a divisão
// de blocos ficam no navegador (core/blocos.ts), que mostra tudo na tela.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PASTA_CACHE, USER_AGENT, gravar } from './fontes.ts';

export type GrupoOSM = 'predios' | 'vias' | 'agua';

const CONSULTAS: Record<GrupoOSM, string> = {
  predios: `(way["building"];relation["building"]["type"="multipolygon"];way["building:part"];relation["building:part"]["type"="multipolygon"];);`,
  vias: `(way["highway"];way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|monorail|funicular)$"];way["route"="ferry"];);`,
  agua: `(way["natural"="water"];relation["natural"="water"];way["waterway"~"^(riverbank|dock|river|stream|canal)$"];relation["waterway"="riverbank"];way["landuse"~"^(reservoir|basin)$"];relation["landuse"~"^(reservoir|basin)$"];way["natural"="coastline"];);`,
};

/** Servidores Overpass públicos (o principal e espelhos). */
export const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const TEMPO_LIMITE_MS = 60_000;

export type TipoFalha = 'ocupado' | 'tempo' | 'pesado' | 'rede' | 'erro';

export class FalhaOverpass extends Error {
  constructor(public tipo: TipoFalha, mensagem: string) {
    super(mensagem);
  }
}

export function ehGrupoOSM(g: string): g is GrupoOSM {
  return g in CONSULTAS;
}

const f = (v: number) => v.toFixed(5);
const arquivoDe = (grupo: GrupoOSM, s: number, w: number, n: number, e: number) =>
  path.join(PASTA_CACHE, 'osm', grupo, `${f(s)}_${f(w)}_${f(n)}_${f(e)}.json`);

/** Bloco já baixado antes? */
export async function lerDoCache(grupo: GrupoOSM, s: number, w: number, n: number, e: number): Promise<Buffer | null> {
  return readFile(arquivoDe(grupo, s, w, n, e)).catch(() => null);
}

/**
 * Uma tentativa num servidor. Salva no cache quando dá certo.
 * Lança FalhaOverpass com o tipo de falha (o navegador decide o que fazer).
 */
export async function consultarOSM(
  grupo: GrupoOSM, s: number, w: number, n: number, e: number,
  servidor: number, sinal: AbortSignal,
): Promise<Buffer> {
  const guardado = await lerDoCache(grupo, s, w, n, e);
  if (guardado) return guardado;

  // [timeout:45]: o próprio Overpass desiste antes dos nossos 60 s
  const consulta = `[out:json][timeout:45][maxsize:536870912][bbox:${f(s)},${f(w)},${f(n)},${f(e)}];${CONSULTAS[grupo]}out geom qt;`;
  const url = SERVIDORES[((servidor % SERVIDORES.length) + SERVIDORES.length) % SERVIDORES.length];
  const limite = AbortSignal.timeout(TEMPO_LIMITE_MS);
  let resp: Response;
  let texto: string;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(consulta)}`,
      signal: AbortSignal.any([sinal, limite]),
    });
    texto = await resp.text();
  } catch (erro) {
    if (limite.aborted) throw new FalhaOverpass('tempo', `${nomeServidor(url)} não respondeu em 60 s`);
    if (sinal.aborted) throw new FalhaOverpass('erro', 'cancelado');
    throw new FalhaOverpass('rede', `${nomeServidor(url)}: ${erro instanceof Error ? erro.message : erro}`);
  }
  if (resp.status === 429) throw new FalhaOverpass('ocupado', `${nomeServidor(url)}: muitas consultas seguidas (HTTP 429)`);
  if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
    throw new FalhaOverpass('ocupado', `${nomeServidor(url)}: sobrecarregado (HTTP ${resp.status})`);
  }
  if (!resp.ok) throw new FalhaOverpass('erro', `${nomeServidor(url)}: HTTP ${resp.status}`);
  let json: { remark?: string; elements?: unknown[] };
  try {
    json = JSON.parse(texto);
  } catch {
    throw new FalhaOverpass('erro', `${nomeServidor(url)}: resposta não é JSON`);
  }
  // o Overpass às vezes responde 200 com um aviso de erro no JSON
  if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
    throw new FalhaOverpass(/out of memory|maxsize/i.test(json.remark) ? 'pesado' : 'tempo', `${nomeServidor(url)}: ${json.remark.slice(0, 120)}`);
  }
  if (!Array.isArray(json.elements)) throw new FalhaOverpass('erro', `${nomeServidor(url)}: resposta sem elementos`);
  const dados = Buffer.from(texto);
  await gravar(arquivoDe(grupo, s, w, n, e), dados);
  return dados;
}

function nomeServidor(url: string) {
  return new URL(url).hostname;
}
