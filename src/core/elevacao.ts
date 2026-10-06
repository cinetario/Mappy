// Amostragem de elevação a partir dos tiles Terrarium (AWS Terrain Tiles).
// Cada pixel guarda a altitude em metros: (R * 256 + G + B / 256) - 32768.
import { dimensoesMetros, lonLatParaPixel, metrosPorPixel, type Retangulo } from './geo.ts';

/** Imagem RGBA de um tile (vinda do canvas no navegador ou do pngjs no Node). */
export interface ImagemTile {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type CarregarTile = (z: number, x: number, y: number) => Promise<ImagemTile>;

/** Grade regular de altitudes. Linha j = 0 é a borda sul; coluna i = 0 é a borda oeste. */
export interface GradeElevacao {
  nx: number;
  ny: number;
  /** elev[j * nx + i], em metros */
  elev: Float32Array;
  larguraM: number;
  alturaM: number;
  zoom: number;
}

const ZOOM_MAXIMO = 15;
const MAX_TILES = 64;
const TAMANHO_TILE = 256;

export function decodificarTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Faixa de tiles necessária para cobrir o retângulo no zoom z (com 1 px de folga). */
export function tilesNecessarios(r: Retangulo, z: number) {
  const [x0, y0] = lonLatParaPixel(r.oeste, r.norte, z);
  const [x1, y1] = lonLatParaPixel(r.leste, r.sul, z);
  return {
    tx0: Math.floor((x0 - 1) / TAMANHO_TILE),
    tx1: Math.floor((x1 + 1) / TAMANHO_TILE),
    ty0: Math.max(0, Math.floor((y0 - 1) / TAMANHO_TILE)),
    ty1: Math.min(2 ** z - 1, Math.floor((y1 + 1) / TAMANHO_TILE)),
  };
}

/** Escolhe o menor zoom cuja resolução é suficiente para o espaçamento da grade. */
export function escolherZoom(r: Retangulo, espacamentoM: number): number {
  const lat = (r.norte + r.sul) / 2;
  let z = 0;
  while (z < ZOOM_MAXIMO && metrosPorPixel(lat, z) > espacamentoM) z++;
  // não baixar tiles demais para áreas grandes
  while (z > 0) {
    const t = tilesNecessarios(r, z);
    if ((t.tx1 - t.tx0 + 1) * (t.ty1 - t.ty0 + 1) <= MAX_TILES) break;
    z--;
  }
  return z;
}

/**
 * Monta uma grade de elevação cobrindo o retângulo, com `amostrasLadoMaior`
 * pontos no lado mais comprido e o mesmo espaçamento no outro lado.
 */
export async function amostrarElevacao(
  r: Retangulo,
  amostrasLadoMaior: number,
  carregar: CarregarTile,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<GradeElevacao> {
  const { largura, altura } = dimensoesMetros(r);
  const espacamento = Math.max(largura, altura) / (amostrasLadoMaior - 1);
  const nx = Math.max(2, Math.round(largura / espacamento) + 1);
  const ny = Math.max(2, Math.round(altura / espacamento) + 1);
  const z = escolherZoom(r, espacamento);
  const n = 2 ** z;

  // baixa e decodifica todos os tiles necessários
  const t = tilesNecessarios(r, z);
  const tiles = new Map<string, Float32Array>();
  const tarefas: Promise<void>[] = [];
  const total = (t.tx1 - t.tx0 + 1) * (t.ty1 - t.ty0 + 1);
  let feitos = 0;
  for (let ty = t.ty0; ty <= t.ty1; ty++) {
    for (let tx = t.tx0; tx <= t.tx1; tx++) {
      const txReal = ((tx % n) + n) % n;
      tarefas.push(
        carregar(z, txReal, ty).then((img) => {
          const valores = new Float32Array(TAMANHO_TILE * TAMANHO_TILE);
          for (let k = 0; k < valores.length; k++) {
            valores[k] = decodificarTerrarium(img.data[k * 4], img.data[k * 4 + 1], img.data[k * 4 + 2]);
          }
          tiles.set(`${tx},${ty}`, valores);
          aoProgredir?.(++feitos, total);
        }),
      );
    }
  }
  await Promise.all(tarefas);

  const pixel = (px: number, py: number): number => {
    const ty = Math.min(t.ty1, Math.max(t.ty0, Math.floor(py / TAMANHO_TILE)));
    const tx = Math.min(t.tx1, Math.max(t.tx0, Math.floor(px / TAMANHO_TILE)));
    const lx = Math.min(TAMANHO_TILE - 1, Math.max(0, px - tx * TAMANHO_TILE));
    const ly = Math.min(TAMANHO_TILE - 1, Math.max(0, py - ty * TAMANHO_TILE));
    return tiles.get(`${tx},${ty}`)![ly * TAMANHO_TILE + lx];
  };

  // interpolação bilinear entre os centros dos pixels
  const elev = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = r.sul + ((r.norte - r.sul) * j) / (ny - 1);
    for (let i = 0; i < nx; i++) {
      const lon = r.oeste + ((r.leste - r.oeste) * i) / (nx - 1);
      const [gx, gy] = lonLatParaPixel(lon, lat, z);
      const fx = gx - 0.5;
      const fy = gy - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const v00 = pixel(x0, y0);
      const v10 = pixel(x0 + 1, y0);
      const v01 = pixel(x0, y0 + 1);
      const v11 = pixel(x0 + 1, y0 + 1);
      elev[j * nx + i] = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
    }
  }
  return { nx, ny, elev, larguraM: largura, alturaM: altura, zoom: z };
}
