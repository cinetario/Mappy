// Busca os dados do OpenStreetMap pelo servidor local, bloco a bloco.
// Funciona dentro do Web Worker. As novas tentativas e a troca de servidor
// ficam em core/blocos.ts; aqui é só uma tentativa por chamada.
import { Cancelado, baixarBlocos, blocosDaArea, type Bloco, type RespostaBloco } from '../core/blocos.ts';
import type { Retangulo } from '../core/geo.ts';
import { semDuplicatas, type ElementoOSM, type GrupoOSM } from '../core/osm.ts';

// cache em memória durante a sessão (o servidor guarda cada bloco em disco)
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

export interface ResultadoOSM {
  elementos: ElementoOSM[];
  faltando: Bloco[];
}

export async function baixarOSM(
  grupo: GrupoOSM,
  area: Retangulo,
  aoProgredir: (p: { feitos: number; total: number; mensagem?: string }) => void,
  sinal: AbortSignal,
): Promise<ResultadoOSM> {
  const nServidores = (await listaServidores()).length;
  saude ??= new Array<number>(nServidores).fill(0);
  const r = await baixarBlocos(blocosDaArea(area), {
    baixar: (b, servidor, s) => baixarBloco(grupo, b, servidor, s),
    servidores: nServidores,
    saudeServidores: saude,
    aoProgredir,
    sinal,
  });
  return { elementos: semDuplicatas(r.dados), faltando: r.faltando };
}
