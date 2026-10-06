// Busca os dados do OpenStreetMap pelo servidor local, bloco a bloco.
// Duas fontes:
// - "local": índice gerado de um .osm.pbf (npm run importar-osm), sem internet;
// - "overpass": servidores públicos, com novas tentativas e troca de servidor
//   (core/blocos.ts); aqui é só uma tentativa por chamada.
// Funciona dentro do Web Worker.
import { Cancelado, baixarBlocos, blocosDaArea, type Bloco, type RespostaBloco } from '../core/blocos.ts';
import type { GrupoOSM } from '../core/categorias-osm.ts';
import type { Retangulo } from '../core/geo.ts';
import { semDuplicatas, type ElementoOSM } from '../core/osm.ts';

/** Informações do índice local (resposta de /api/osm/local). */
export interface InfoIndiceLocal {
  disponivel: boolean;
  arquivos: { nome: string; caixa: [number, number, number, number] | null; dataDados: string | null }[];
  dataImportacao: string | null;
  contagens: Partial<Record<GrupoOSM, number>>;
  pasta: string;
  desatualizado?: boolean;
}

export async function obterInfoIndiceLocal(): Promise<InfoIndiceLocal | null> {
  try {
    const r = await fetch('/api/osm/local');
    return r.ok ? ((await r.json()) as InfoIndiceLocal) : null;
  } catch {
    return null;
  }
}

/** O arquivo local tem dados para todos os blocos da área? (o servidor confere a cobertura real) */
export async function indiceCobre(info: InfoIndiceLocal | null, area: Retangulo): Promise<boolean> {
  if (!info?.disponivel || info.desatualizado) return false;
  const q = new URLSearchParams({ oeste: String(area.oeste), sul: String(area.sul), leste: String(area.leste), norte: String(area.norte) });
  try {
    const r = await fetch(`/api/osm/local/cobre?${q}`);
    return r.ok && ((await r.json()) as { cobre: boolean }).cobre;
  } catch {
    return false;
  }
}

// cache em memória durante a sessão (o servidor guarda cada bloco do Overpass em disco)
const memoria = new Map<string, ElementoOSM[]>();
/** folga além dos 60 s do servidor local */
const TEMPO_LIMITE_MS = 75_000;

let servidores: Promise<string[]> | null = null;
/** servidores que não respondem ficam para o fim da fila durante a sessão */
let saude: number[] | null = null;
function listaServidores() {
  servidores ??= fetch('/api/osm/servidores').then((r) => r.json() as Promise<string[]>).catch(() => ['overpass-api.de']);
  return servidores;
}

async function baixarBloco(grupo: GrupoOSM, b: Bloco, servidor: number, sinal: AbortSignal): Promise<RespostaBloco<ElementoOSM[]>> {
  const chave = `${grupo}/${b.s}/${b.w}/${b.n}/${b.e}`;
  const guardado = memoria.get(chave);
  if (guardado) return { dados: guardado };
  const q = new URLSearchParams({ grupo, s: String(b.s), w: String(b.w), n: String(b.n), e: String(b.e), servidor: String(servidor) });
  const limite = AbortSignal.timeout(TEMPO_LIMITE_MS);
  let resp: Response;
  try {
    resp = await fetch(`/api/osm?${q}`, { signal: AbortSignal.any([sinal, limite]) });
    if (resp.ok) {
      const json = (await resp.json()) as { elements: ElementoOSM[] };
      memoria.set(chave, json.elements);
      return { dados: json.elements };
    }
  } catch (erro) {
    if (sinal.aborted) throw new Cancelado();
    if (limite.aborted) return { erro: 'tempo', mensagem: 'sem resposta em 75 s' };
    return { erro: 'rede', mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
  try {
    const falha = (await resp.json()) as { tipo: 'ocupado' | 'tempo' | 'pesado' | 'rede' | 'erro'; mensagem: string };
    return { erro: falha.tipo, mensagem: falha.mensagem };
  } catch {
    return { erro: 'erro', mensagem: `HTTP ${resp.status}` };
  }
}

/** Bloco do índice local: sem novas tentativas (não depende de internet). */
async function baixarBlocoLocal(grupo: GrupoOSM, b: Bloco, sinal: AbortSignal): Promise<ElementoOSM[]> {
  const q = new URLSearchParams({ grupo, s: String(b.s), w: String(b.w), n: String(b.n), e: String(b.e), fonte: 'local' });
  try {
    const resp = await fetch(`/api/osm?${q}`, { signal: sinal });
    if (!resp.ok) throw new Error(`Índice local: ${await resp.text()}`);
    return ((await resp.json()) as { elements: ElementoOSM[] }).elements;
  } catch (erro) {
    if (sinal.aborted) throw new Cancelado();
    throw erro;
  }
}

export interface ResultadoOSM {
  elementos: ElementoOSM[];
  faltando: Bloco[];
}

export async function baixarOSM(
  grupo: GrupoOSM,
  area: Retangulo,
  aoProgredir: (p: { feitos: number; total: number; mensagem?: string }) => void,
  sinal: AbortSignal,
  fonte: 'local' | 'overpass' = 'overpass',
): Promise<ResultadoOSM> {
  const blocos = blocosDaArea(area);
  if (fonte === 'local') {
    const listas: ElementoOSM[][] = [];
    for (const [k, b] of blocos.entries()) {
      aoProgredir({ feitos: k, total: blocos.length });
      listas.push(await baixarBlocoLocal(grupo, b, sinal));
    }
    aoProgredir({ feitos: blocos.length, total: blocos.length });
    return { elementos: semDuplicatas(listas), faltando: [] };
  }
  const nServidores = (await listaServidores()).length;
  saude ??= new Array<number>(nServidores).fill(0);
  const r = await baixarBlocos(blocos, {
    baixar: (b, servidor, s) => baixarBloco(grupo, b, servidor, s),
    servidores: nServidores,
    saudeServidores: saude,
    aoProgredir,
    sinal,
  });
  return { elementos: semDuplicatas(r.dados), faltando: r.faltando };
}
