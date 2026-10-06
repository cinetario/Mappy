// Prédios de outras fontes (Overture Maps, arquivo da prefeitura) no mesmo
// índice local do OSM, em tabelas próprias. Cada importação é um "conjunto"
// (ex.: overture:df, prefeitura:brasilia-lotes) que pode ser trocado sem
// mexer no resto. Reimportar o OSM preserva esses conjuntos.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ARQUIVO_INDICE, VERSAO_INDICE, criarTabelas } from './indice-osm.ts';

export type FonteExtra = 'overture' | 'prefeitura';

export interface ConjuntoExtra {
  /** fonte:nome */
  id: string;
  fonte: FonteExtra;
  nome: string;
  /** oeste, sul, leste, norte da região importada */
  caixa: [number, number, number, number];
  /** versão dos dados (release do Overture ou data do arquivo) */
  versao: string;
  importadoEm: string;
  quantidade: number;
  /** quantos prédios vieram de cada base original (Overture: OSM, Google, Microsoft…) */
  origens: Record<string, number>;
  /** texto de atribuição obrigatório */
  atribuicao: string;
  licenca: string;
}

const SQL_TABELAS = `
  CREATE TABLE IF NOT EXISTS extras (id INTEGER PRIMARY KEY, conjunto TEXT NOT NULL, dados TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS extras_conjunto ON extras (conjunto);
  CREATE VIRTUAL TABLE IF NOT EXISTS caixa_extras USING rtree(id, x0, x1, y0, y1);
`;

function lerConjuntos(db: DatabaseSync): ConjuntoExtra[] {
  const r = db.prepare("SELECT valor FROM meta WHERE chave = 'conjuntos'").get() as { valor: string } | undefined;
  return r ? JSON.parse(r.valor) : [];
}

function gravarConjuntos(db: DatabaseSync, lista: ConjuntoExtra[]) {
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('conjuntos', ?)").run(JSON.stringify(lista));
}

/** Abre o índice para escrita (cria um índice vazio se ainda não houver OSM importado). */
function abrirParaEscrita(arquivo: string): DatabaseSync {
  const novo = !existsSync(arquivo);
  const db = new DatabaseSync(arquivo);
  if (novo) {
    criarTabelas(db);
    const ins = db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?)');
    ins.run('versao', VERSAO_INDICE);
    ins.run('arquivos', '[]');
    ins.run('contagens', '{}');
    ins.run('celulas', '[]');
  }
  db.exec(SQL_TABELAS);
  return db;
}

export interface Gravador {
  inserir(elemento: object, caixa: [number, number, number, number]): void;
  /** grava o resumo do conjunto e fecha */
  concluir(resumo: Omit<ConjuntoExtra, 'id' | 'quantidade' | 'importadoEm'>): ConjuntoExtra;
  cancelar(): void;
}

/** Substitui (ou cria) um conjunto de prédios extras no índice. */
export function gravarConjunto(fonte: FonteExtra, nome: string, arquivo = ARQUIVO_INDICE): Gravador {
  const id = `${fonte}:${nome}`;
  const db = abrirParaEscrita(arquivo);
  db.exec('BEGIN');
  db.prepare('DELETE FROM caixa_extras WHERE id IN (SELECT id FROM extras WHERE conjunto = ?)').run(id);
  db.prepare('DELETE FROM extras WHERE conjunto = ?').run(id);
  const insDados = db.prepare('INSERT INTO extras (conjunto, dados) VALUES (?, ?)');
  const insCaixa = db.prepare('INSERT INTO caixa_extras (id, x0, x1, y0, y1) VALUES (?, ?, ?, ?, ?)');
  let quantidade = 0;
  return {
    inserir(elemento, [x0, y0, x1, y1]) {
      const r = insDados.run(id, JSON.stringify(elemento));
      insCaixa.run(r.lastInsertRowid, x0, x1, y0, y1);
      quantidade++;
    },
    concluir(resumo) {
      const conjunto: ConjuntoExtra = { ...resumo, id, quantidade, importadoEm: new Date().toISOString() };
      gravarConjuntos(db, [...lerConjuntos(db).filter((c) => c.id !== id), conjunto]);
      db.exec('COMMIT');
      db.close();
      return conjunto;
    },
    cancelar() {
      db.exec('ROLLBACK');
      db.close();
    },
  };
}

/** Na reimportação do OSM: copia os conjuntos extras do índice antigo para o novo. */
export function copiarExtras(dbNovo: DatabaseSync, arquivoAntigo: string): number {
  if (!existsSync(arquivoAntigo)) return 0;
  dbNovo.exec(SQL_TABELAS);
  dbNovo.prepare('ATTACH DATABASE ? AS antigo').run(arquivoAntigo);
  try {
    const tem = dbNovo.prepare("SELECT 1 FROM antigo.sqlite_master WHERE name = 'extras'").get();
    if (!tem) return 0;
    dbNovo.exec('INSERT INTO extras SELECT * FROM antigo.extras; INSERT INTO caixa_extras SELECT * FROM antigo.caixa_extras;');
    const r = dbNovo.prepare("SELECT valor FROM antigo.meta WHERE chave = 'conjuntos'").get() as { valor: string } | undefined;
    if (r) dbNovo.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('conjuntos', ?)").run(r.valor);
    return (dbNovo.prepare('SELECT count(*) AS n FROM extras').get() as { n: number }).n;
  } finally {
    dbNovo.exec('DETACH DATABASE antigo');
  }
}

export function listarConjuntos(arquivo = ARQUIVO_INDICE): ConjuntoExtra[] {
  if (!existsSync(arquivo)) return [];
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    return lerConjuntos(db);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Conjuntos da fonte cuja região contém a área inteira. */
export function conjuntosQueCobrem(fonte: FonteExtra, oeste: number, sul: number, leste: number, norte: number, arquivo = ARQUIVO_INDICE) {
  return listarConjuntos(arquivo).filter((c) => c.fonte === fonte
    && c.caixa[0] <= oeste && c.caixa[1] <= sul && c.caixa[2] >= leste && c.caixa[3] >= norte);
}

/** Prédios extras de uma fonte que tocam a área, no formato da resposta do Overpass. */
export function consultarExtras(fonte: FonteExtra, s: number, w: number, n: number, e: number, arquivo = ARQUIVO_INDICE): string {
  if (!existsSync(arquivo)) return '{"elements":[]}';
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const tem = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'extras'").get();
    if (!tem) return '{"elements":[]}';
    const linhas = db.prepare(
      `SELECT x.dados FROM caixa_extras c JOIN extras x ON x.id = c.id
       WHERE c.x1 >= ? AND c.x0 <= ? AND c.y1 >= ? AND c.y0 <= ? AND x.conjunto LIKE ?`,
    ).all(w, e, s, n, `${fonte}:%`) as { dados: string }[];
    return `{"elements":[${linhas.map((l) => l.dados).join(',')}]}`;
  } finally {
    db.close();
  }
}
