// Carrega dados de elevação pelo servidor local (que guarda tudo em cache).
// Funciona tanto na página quanto dentro do Web Worker.
import type { FonteTiles, GradeElevacao, ImagemTile, NomeFonte } from '../core/elevacao.ts';
import type { Retangulo } from '../core/geo.ts';
import { dimensoesMetros } from '../core/geo.ts';

async function carregarImagem(fonte: string, z: number, x: number, y: number): Promise<ImagemTile | null> {
  const resp = await fetch(`/api/terreno/${fonte}/${z}/${x}/${y}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Falha ao baixar elevação (${fonte} ${z}/${x}/${y}): ${await resp.text()}`);
  // sem conversão de cor nem pré-multiplicação: os valores RGB são dados, não cores
  const bitmap = await createImageBitmap(await resp.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const dados = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return dados;
}

export const FONTES_TILES: Record<'terrarium' | 'mapterhorn', FonteTiles> = {
  terrarium: { tamanhoTile: 256, zoomMaximo: 15, carregar: (z, x, y) => carregarImagem('terrarium', z, x, y) },
  mapterhorn: { tamanhoTile: 512, zoomMaximo: 17, carregar: (z, x, y) => carregarImagem('mapterhorn', z, x, y) },
};

/** Copernicus: o servidor devolve a grade pronta (Float32). */
export async function gradeCopernicus(r: Retangulo, amostrasLadoMaior: number): Promise<GradeElevacao & { aviso?: string }> {
  const { largura, altura } = dimensoesMetros(r);
  const esp = Math.max(largura, altura) / (amostrasLadoMaior - 1);
  const nx = Math.max(2, Math.round(largura / esp) + 1);
  const ny = Math.max(2, Math.round(altura / esp) + 1);
  const q = new URLSearchParams({
    oeste: String(r.oeste), sul: String(r.sul), leste: String(r.leste), norte: String(r.norte),
    nx: String(nx), ny: String(ny),
  });
  const resp = await fetch(`/api/copernicus?${q}`);
  if (!resp.ok) throw new Error(`Falha no Copernicus: ${await resp.text()}`);
  const elev = new Float32Array(await resp.arrayBuffer());
  const [faltando, total] = (resp.headers.get('X-Tiles-Faltando') ?? '0/1').split('/').map(Number);
  return {
    nx, ny, elev, larguraM: largura, alturaM: altura, zoom: -1,
    resolucaoM: Number(resp.headers.get('X-Resolucao-M')) || 30,
    aviso: faltando === total
      ? 'O Copernicus não tem dados para esta área (mar aberto ou região não liberada). Use outra fonte.'
      : faltando > 0
        ? 'O Copernicus não tem dados para parte da área (tratada como nível do mar).'
        : undefined,
  };
}

export type { NomeFonte };
