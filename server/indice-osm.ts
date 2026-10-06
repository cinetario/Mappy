// Índice local dos dados do OpenStreetMap (SQLite embutido no Node, com R*Tree).
// Gerado por `npm run importar-osm` a partir de arquivos .osm.pbf em dados-osm/.
// O servidor local consulta este índice sem nenhuma requisição externa.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GRUPOS_OSM, type GrupoOSM } from '../src/core/categorias-osm.ts';

export const PASTA_DADOS_OSM = path.resolve(process.env.RELEVO3D_DADOS_OSM ?? path.join(process.cwd(), 'dados-osm'));
export const ARQUIVO_INDICE = path.join(PASTA_DADOS_OSM, 'indice-osm.sqlite');
export const VERSAO_INDICE = '2';

// ---------- cobertura: blocos de 0,04° (a mesma grade dos blocos de download) ----------
const TAM = 0.04;
export const montarCelula = (i: number, j: number) => (i + 3000) * 10000 + (j + 5000);
export const abrirCelula = (c: number) => ({ i: Math.floor(c / 10000) - 3000, j: (c % 10000) - 5000 });
export const chaveCelula = (lat: number, lon: number) => montarCelula(Math.floor(lat / TAM), Math.floor(lon / TAM));

let cacheCelulas: { mtime: number; celulas: Set<number> } | null = null;

/** O índice tem dados para TODOS os blocos da área? (senão o app usa o Overpass) */
export function indiceCobre(oeste: number, sul: number, leste: number, norte: number): boolean {
  if (!existsSync(ARQUIVO_INDICE)) return false;
  const mtime = statSync(ARQUIVO_INDICE).mtimeMs;
  if (cacheCelulas?.mtime !== mtime) {
    try {
      const valor = comIndice((db) => (db.prepare("SELECT valor FROM meta WHERE chave = 'celulas'").get() as { valor: string } | undefined)?.valor);
      cacheCelulas = { mtime, celulas: new Set(JSON.parse(valor ?? '[]')) };
    } catch {
      return false;
    }
  }
  for (let i = Math.floor(sul / TAM); i <= Math.floor(norte / TAM); i++) {
    for (let j = Math.floor(oeste / TAM); j <= Math.floor(leste / TAM); j++) {
      if (!cacheCelulas.celulas.has(montarCelula(i, j))) return false;
    }
  }
  return true;
}

/** Cria as tabelas (usado pelo importador). */
export function criarTabelas(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE feicoes (id INTEGER PRIMARY KEY, grupo TEXT NOT NULL, osm TEXT NOT NULL UNIQUE, dados TEXT NOT NULL);
    ${GRUPOS_OSM.map((g) => `CREATE VIRTUAL TABLE caixa_${g} USING rtree(id, x0, x1, y0, y1);`).join('\n')}
  `);
}

export interface InfoIndice {
  disponivel: boolean;
  arquivos: { nome: string; caixa: [number, number, number, number] | null; dataDados: string | null }[];
  dataImportacao: string | null;
  contagens: Partial<Record<GrupoOSM, number>>;
  pasta: string;
  /** o índice é de uma versão antiga do importador */
  desatualizado?: boolean;
}

let cacheInfo: { mtime: number; info: InfoIndice } | null = null;

/** Abre o índice só para leitura, faz a consulta e fecha (não prende o arquivo: dá para reimportar com o app aberto). */
function comIndice<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(ARQUIVO_INDICE, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function infoIndice(): InfoIndice {
  const vazio: InfoIndice = { disponivel: false, arquivos: [], dataImportacao: null, contagens: {}, pasta: PASTA_DADOS_OSM };
  if (!existsSync(ARQUIVO_INDICE)) return vazio;
  const mtime = statSync(ARQUIVO_INDICE).mtimeMs;
  if (cacheInfo?.mtime === mtime) return cacheInfo.info;
  try {
    const info = comIndice((db) => {
      const meta = Object.fromEntries((db.prepare('SELECT chave, valor FROM meta').all() as { chave: string; valor: string }[]).map((r) => [r.chave, r.valor]));
      return {
        disponivel: true,
        arquivos: JSON.parse(meta.arquivos ?? '[]'),
        dataImportacao: meta.dataImportacao ?? null,
        contagens: JSON.parse(meta.contagens ?? '{}'),
        pasta: PASTA_DADOS_OSM,
        desatualizado: meta.versao !== VERSAO_INDICE,
      } satisfies InfoIndice;
    });
    cacheInfo = { mtime, info };
    return info;
  } catch {
    return vazio;
  }
}

/**
 * Elementos de um grupo cuja caixa toca o bloco, no mesmo formato da resposta
 * do Overpass ("out geom"), para o app tratar as duas fontes igual.
 */
export function consultarIndice(grupo: GrupoOSM, s: number, w: number, n: number, e: number): string {
  const linhas = comIndice((db) => db.prepare(
    `SELECT f.dados FROM caixa_${grupo} c JOIN feicoes f ON f.id = c.id WHERE c.x1 >= ? AND c.x0 <= ? AND c.y1 >= ? AND c.y0 <= ?`,
  ).all(w, e, s, n) as { dados: string }[]);
  return `{"elements":[${linhas.map((l) => l.dados).join(',')}]}`;
}
