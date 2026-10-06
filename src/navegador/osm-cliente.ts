// Busca os dados do OpenStreetMap pelo servidor local, bloco a bloco.
// Funciona dentro do Web Worker.
import { baixarBlocos, blocosDaArea, type Bloco } from '../core/blocos.ts';
import type { Retangulo } from '../core/geo.ts';
import { semDuplicatas, type ElementoOSM, type GrupoOSM } from '../core/osm.ts';

// cache em memória durante a sessão (o servidor guarda em disco)
const memoria = new Map<string, ElementoOSM[]>();

async function baixarBloco(grupo: GrupoOSM, b: Bloco) {
  const chave = `${grupo}/${b.s}/${b.w}/${b.n}/${b.e}`;
  const guardado = memoria.get(chave);
  if (guardado) return { dados: guardado };
  const q = new URLSearchParams({ grupo, s: String(b.s), w: String(b.w), n: String(b.n), e: String(b.e) });
  const resp = await fetch(`/api/osm?${q}`);
  if (resp.status === 504) return 'dividir' as const;
  if (!resp.ok) throw new Error(`Falha ao baixar do OpenStreetMap: ${await resp.text()}`);
  const json = (await resp.json()) as { elements: ElementoOSM[] };
  memoria.set(chave, json.elements);
  return { dados: json.elements };
}

export async function baixarOSM(
  grupo: GrupoOSM,
  area: Retangulo,
  aoProgredir: (feitos: number, total: number) => void,
): Promise<ElementoOSM[]> {
  const listas = await baixarBlocos(blocosDaArea(area), (b) => baixarBloco(grupo, b), aoProgredir);
  return semDuplicatas(listas);
}
