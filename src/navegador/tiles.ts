// Carrega tiles de elevação pelo servidor local (que guarda tudo em cache).
import type { ImagemTile } from '../core/elevacao.ts';

export async function carregarTileTerreno(z: number, x: number, y: number): Promise<ImagemTile> {
  const resp = await fetch(`/api/terreno/${z}/${x}/${y}.png`);
  if (!resp.ok) throw new Error(`Falha ao baixar elevação (${z}/${x}/${y}): ${await resp.text()}`);
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
