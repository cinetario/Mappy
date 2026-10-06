// Amostragem de elevação a partir de tiles Terrarium (AWS Terrain Tiles e Mapterhorn).
// Cada pixel guarda a altitude em metros: (R * 256 + G + B / 256) - 32768.
import { dimensoesMetros, lonLatParaPixel, metrosPorPixel, type Retangulo } from './geo.ts';

/** Imagem RGBA de um tile (vinda do canvas no navegador ou do pngjs no Node). */
export interface ImagemTile {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Carrega um tile; `null` quando a fonte não tem esse tile (ex.: 404 em zoom alto). */
export type CarregarTile = (z: number, x: number, y: number) => Promise<ImagemTile | null>;

export interface FonteTiles {
  /** lado do tile em pixels (256 ou 512) */
  tamanhoTile: number;
  zoomMaximo: number;
  carregar: CarregarTile;
}

/** Grade regular de altitudes. Linha j = 0 é a borda sul; coluna i = 0 é a borda oeste. */
export interface GradeElevacao {
  nx: number;
  ny: number;
  /** elev[j * nx + i], em metros */
  elev: Float32Array;
  larguraM: number;
  alturaM: number;
  /** zoom pedido (tiles) ou -1 para fontes que não usam tiles */
  zoom: number;
  /** menor zoom realmente usado (quando faltaram tiles e foi usado o "pai") */
  zoomEfetivo?: number;
  /** tamanho do pixel da fonte no solo, em metros */
  resolucaoM?: number;
}

const MAX_TILES = 64;
const MAX_NIVEIS_ACIMA = 6;

export function decodificarTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Posição em pixels globais no zoom z, para tiles de `t` px. */
function pixel(lon: number, lat: number, z: number, t: number): [number, number] {
  const [x, y] = lonLatParaPixel(lon, lat, z);
  return [(x * t) / 256, (y * t) / 256];
}

/** Faixa de tiles necessária para cobrir o retângulo no zoom z (com 1 px de folga). */
export function tilesNecessarios(r: Retangulo, z: number, t = 256) {
  const [x0, y0] = pixel(r.oeste, r.norte, z, t);
  const [x1, y1] = pixel(r.leste, r.sul, z, t);
  return {
    tx0: Math.floor((x0 - 1) / t),
    tx1: Math.floor((x1 + 1) / t),
    ty0: Math.max(0, Math.floor((y0 - 1) / t)),
    ty1: Math.min(2 ** z - 1, Math.floor((y1 + 1) / t)),
  };
}

/** Escolhe o menor zoom cuja resolução é suficiente para o espaçamento da grade. */
export function escolherZoom(r: Retangulo, espacamentoM: number, t = 256, zoomMaximo = 15): number {
  const lat = (r.norte + r.sul) / 2;
  let z = 0;
  while (z < zoomMaximo && (metrosPorPixel(lat, z) * 256) / t > espacamentoM) z++;
  return limitarTiles(r, z, t);
}

/** Reduz o zoom até a área caber em MAX_TILES tiles. */
function limitarTiles(r: Retangulo, z: number, t: number): number {
  while (z > 0) {
    const n = tilesNecessarios(r, z, t);
    if ((n.tx1 - n.tx0 + 1) * (n.ty1 - n.ty0 + 1) <= MAX_TILES) break;
    z--;
  }
  return z;
}

interface TileDecodificado {
  valores: Float32Array;
  /** quantos níveis acima do zoom pedido este tile está (0 = o próprio) */
  niveis: number;
  /** coordenadas do tile realmente usado */
  tx: number;
  ty: number;
}

export interface OpcoesAmostragem {
  aoProgredir?: (feitos: number, total: number) => void;
  /** zoom fixo; sem ele, é escolhido automaticamente */
  zoom?: number;
}

/**
 * Monta uma grade de elevação cobrindo o retângulo, com `amostrasLadoMaior`
 * pontos no lado mais comprido e o mesmo espaçamento no outro lado.
 */
export async function amostrarElevacao(
  r: Retangulo,
  amostrasLadoMaior: number,
  fonte: FonteTiles,
  opcoes: OpcoesAmostragem = {},
): Promise<GradeElevacao> {
  const T = fonte.tamanhoTile;
  const { largura, altura } = dimensoesMetros(r);
  const espacamento = Math.max(largura, altura) / (amostrasLadoMaior - 1);
  const nx = Math.max(2, Math.round(largura / espacamento) + 1);
  const ny = Math.max(2, Math.round(altura / espacamento) + 1);
  const z = opcoes.zoom
    ? limitarTiles(r, Math.min(opcoes.zoom, fonte.zoomMaximo), T)
    : escolherZoom(r, espacamento, T, fonte.zoomMaximo);
  const n = 2 ** z;

  // baixa e decodifica os tiles; se faltar algum, usa um "ancestral" de zoom menor
  const t = tilesNecessarios(r, z, T);
  const tiles = new Map<string, TileDecodificado>();
  const cacheAncestrais = new Map<string, Promise<Float32Array | null>>();
  const decodificado = (zz: number, x: number, y: number) => {
    const chave = `${zz}/${x}/${y}`;
    let p = cacheAncestrais.get(chave);
    if (!p) {
      p = fonte.carregar(zz, x, y).then((img) => (img ? decodificar(img, T) : null));
      cacheAncestrais.set(chave, p);
    }
    return p;
  };
  const total = (t.tx1 - t.tx0 + 1) * (t.ty1 - t.ty0 + 1);
  let feitos = 0;
  let niveisMax = 0;
  const tarefas: Promise<void>[] = [];
  for (let ty = t.ty0; ty <= t.ty1; ty++) {
    for (let tx = t.tx0; tx <= t.tx1; tx++) {
      const txReal = ((tx % n) + n) % n;
      tarefas.push(
        (async () => {
          for (let k = 0; k <= Math.min(MAX_NIVEIS_ACIMA, z); k++) {
            const ax = txReal >> k;
            const ay = ty >> k;
            const valores = await decodificado(z - k, ax, ay);
            if (valores) {
              tiles.set(`${tx},${ty}`, { valores, niveis: k, tx: ax, ty: ay });
              niveisMax = Math.max(niveisMax, k);
              break;
            }
          }
          if (!tiles.has(`${tx},${ty}`)) {
            // sem dados nem em zoom baixo (ex.: oceano aberto): nível do mar
            tiles.set(`${tx},${ty}`, { valores: new Float32Array(T * T), niveis: 0, tx: txReal, ty });
          }
          opcoes.aoProgredir?.(++feitos, total);
        })(),
      );
    }
  }
  await Promise.all(tarefas);

  // valor de um pixel inteiro no zoom z (com interpolação dentro do ancestral, se for o caso)
  const valorPixel = (px: number, py: number): number => {
    const ty = Math.min(t.ty1, Math.max(t.ty0, Math.floor(py / T)));
    const tx = Math.min(t.tx1, Math.max(t.tx0, Math.floor(px / T)));
    const tile = tiles.get(`${tx},${ty}`)!;
    if (tile.niveis === 0) {
      const lx = Math.min(T - 1, Math.max(0, px - tx * T));
      const ly = Math.min(T - 1, Math.max(0, py - ty * T));
      return tile.valores[ly * T + lx];
    }
    const f = 2 ** tile.niveis;
    const pxRel = px - tx * T + (txRelativo(tx, n) - tile.tx * f) * T;
    const pyRel = py - ty * T + (ty - tile.ty * f) * T;
    return bilinear(tile.valores, T, (pxRel + 0.5) / f - 0.5, (pyRel + 0.5) / f - 0.5);
  };

  // interpolação bilinear entre os centros dos pixels
  const elev = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = r.sul + ((r.norte - r.sul) * j) / (ny - 1);
    for (let i = 0; i < nx; i++) {
      const lon = r.oeste + ((r.leste - r.oeste) * i) / (nx - 1);
      const [gx, gy] = pixel(lon, lat, z, T);
      const fx = gx - 0.5;
      const fy = gy - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const v00 = valorPixel(x0, y0);
      const v10 = valorPixel(x0 + 1, y0);
      const v01 = valorPixel(x0, y0 + 1);
      const v11 = valorPixel(x0 + 1, y0 + 1);
      elev[j * nx + i] = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
    }
  }
  const lat = (r.norte + r.sul) / 2;
  return {
    nx, ny, elev, larguraM: largura, alturaM: altura, zoom: z,
    zoomEfetivo: z - niveisMax,
    resolucaoM: (metrosPorPixel(lat, z - niveisMax) * 256) / T,
  };
}

function txRelativo(tx: number, n: number) {
  return ((tx % n) + n) % n;
}

function decodificar(img: ImagemTile, T: number): Float32Array {
  if (img.width !== T || img.height !== T) throw new Error(`Tile com tamanho inesperado: ${img.width}×${img.height}`);
  const valores = new Float32Array(T * T);
  for (let k = 0; k < valores.length; k++) {
    valores[k] = decodificarTerrarium(img.data[k * 4], img.data[k * 4 + 1], img.data[k * 4 + 2]);
  }
  return valores;
}

function bilinear(v: Float32Array, T: number, fx: number, fy: number): number {
  const cx = Math.min(T - 1, Math.max(0, fx));
  const cy = Math.min(T - 1, Math.max(0, fy));
  const x0 = Math.min(T - 2, Math.floor(cx));
  const y0 = Math.min(T - 2, Math.floor(cy));
  const ax = cx - x0;
  const ay = cy - y0;
  const i = y0 * T + x0;
  return (v[i] * (1 - ax) + v[i + 1] * ax) * (1 - ay) + (v[i + T] * (1 - ax) + v[i + T + 1] * ax) * ay;
}

// ---------- informações das fontes (exibidas no painel) ----------
export type NomeFonte = 'mapterhorn' | 'copernicus' | 'terrarium';

export const FONTES: Record<NomeFonte, {
  nome: string;
  resolucao: string;
  vertical: string;
  atribuicao: string;
  link: string;
}> = {
  mapterhorn: {
    nome: 'Mapterhorn',
    resolucao: '~30 m no mundo; até 1 m em vários países (Europa, Japão, EUA…)',
    vertical: 'depende da fonte local; em geral de 1 a 4 m',
    atribuicao: 'Mapterhorn (dados abertos de diversas agências; ver mapterhorn.com/attribution)',
    link: 'https://mapterhorn.com/attribution',
  },
  copernicus: {
    nome: 'Copernicus DEM GLO-30',
    resolucao: '~30 m (1 segundo de arco)',
    vertical: 'precisão absoluta < 4 m. Mede a superfície, com prédios e copas de árvores.',
    atribuicao: '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    link: 'https://registry.opendata.aws/copernicus-dem/',
  },
  terrarium: {
    nome: 'Terrain Tiles (Terrarium)',
    resolucao: '~30 m onde há SRTM, ~90 m no resto',
    vertical: 'precisão de ~6 a 16 m (SRTM)',
    atribuicao: 'AWS Terrain Tiles (Mapzen): SRTM, GMTED2010, ETOPO1 e outras fontes',
    link: 'https://registry.opendata.aws/terrain-tiles/',
  },
};
