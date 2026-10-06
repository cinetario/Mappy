// Consultas ao Overpass (OpenStreetMap) com cache em disco, fila e novas tentativas.
// Política de uso do Overpass: no máximo 2 consultas ao mesmo tempo por IP,
// e evitar consultas gigantes (o cliente divide a área em blocos).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PASTA_CACHE, USER_AGENT, gravar } from './fontes.ts';

export type GrupoOSM = 'predios' | 'vias' | 'agua';

const CONSULTAS: Record<GrupoOSM, string> = {
  predios: `(way["building"];relation["building"]["type"="multipolygon"];way["building:part"];relation["building:part"]["type"="multipolygon"];);`,
  vias: `(way["highway"];way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|monorail|funicular)$"];way["route"="ferry"];);`,
  agua: `(way["natural"="water"];relation["natural"="water"];way["waterway"~"^(riverbank|dock|river|stream|canal)$"];relation["waterway"="riverbank"];way["landuse"~"^(reservoir|basin)$"];relation["landuse"~"^(reservoir|basin)$"];way["natural"="coastline"];);`,
};

const SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** O bloco é grande demais para o Overpass: quem pediu deve dividir em blocos menores. */
export class ErroDividir extends Error {}

export function ehGrupoOSM(g: string): g is GrupoOSM {
  return g in CONSULTAS;
}

// ---- fila: no máximo 2 consultas simultâneas ----
let ativas = 0;
const esperando: (() => void)[] = [];
async function naFila<T>(fn: () => Promise<T>): Promise<T> {
  if (ativas >= 2) await new Promise<void>((r) => esperando.push(r));
  ativas++;
  try {
    return await fn();
  } finally {
    ativas--;
    esperando.shift()?.();
  }
}

const emAndamento = new Map<string, Promise<Buffer>>();

export async function consultarOSM(grupo: GrupoOSM, s: number, w: number, n: number, e: number): Promise<Buffer> {
  const f = (v: number) => v.toFixed(5);
  const arquivo = path.join(PASTA_CACHE, 'osm', grupo, `${f(s)}_${f(w)}_${f(n)}_${f(e)}.json`);
  try {
    return await readFile(arquivo);
  } catch {
    // não está em cache
  }
  const existente = emAndamento.get(arquivo);
  if (existente) return existente;
  const consulta = `[out:json][timeout:90][maxsize:536870912][bbox:${f(s)},${f(w)},${f(n)},${f(e)}];${CONSULTAS[grupo]}out geom qt;`;
  const tarefa = naFila(() => baixarComTentativas(consulta)).then(async (dados) => {
    await gravar(arquivo, dados);
    return dados;
  });
  emAndamento.set(arquivo, tarefa);
  try {
    return await tarefa;
  } finally {
    emAndamento.delete(arquivo);
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function baixarComTentativas(consulta: string): Promise<Buffer> {
  let ultimoErro: unknown;
  let esgotados = 0; // respostas 504 (o servidor desistiu da consulta)
  for (const servidor of SERVIDORES) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const resp = await fetch(servidor, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(consulta)}`,
        });
        if (resp.status === 429) {
          // limite de consultas por IP: espera mais (5 s, 10 s, 20 s)
          ultimoErro = new Error('O Overpass pediu para esperar (muitas consultas seguidas). Tente de novo em alguns minutos.');
          await esperar(5000 * 2 ** tentativa);
          continue;
        }
        if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
          // servidor sobrecarregado: tenta de novo o mesmo bloco antes de dividir
          if (resp.status === 504) esgotados++;
          ultimoErro = new Error(`Overpass sobrecarregado (HTTP ${resp.status})`);
          await esperar(3000 * 2 ** tentativa);
          continue;
        }
        const texto = await resp.text();
        if (!resp.ok) throw new Error(`Overpass respondeu HTTP ${resp.status}: ${texto.slice(0, 200)}`);
        // o Overpass às vezes devolve 200 com um aviso de erro no JSON
        const json = JSON.parse(texto) as { remark?: string; elements?: unknown[] };
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
          throw new ErroDividir(`Overpass: ${json.remark}`);
        }
        return Buffer.from(texto);
      } catch (erro) {
        if (erro instanceof ErroDividir) throw erro;
        ultimoErro = erro;
        if (erro instanceof SyntaxError) break; // resposta não-JSON: tenta o outro servidor
        await esperar(1000 * 2 ** tentativa);
      }
    }
  }
  // vários 504 seguidos: provavelmente o bloco é pesado demais; quem pediu divide em 4
  if (esgotados >= 3) throw new ErroDividir('Overpass: tempo esgotado várias vezes');
  throw ultimoErro instanceof Error ? ultimoErro : new Error('Overpass indisponível');
}
