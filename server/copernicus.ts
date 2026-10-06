// Copernicus DEM GLO-30: arquivos GeoTIFF (COG) de 1°×1° no S3 da AWS.
// Só os pedaços necessários de cada arquivo são baixados (leitura parcial),
// e a grade resultante fica em cache em disco.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import { PASTA_CACHE, comTentativas, gravar } from './fontes.ts';

const BASE = 'https://copernicus-dem-30m.s3.amazonaws.com';

export interface PedidoCopernicus {
  oeste: number;
  sul: number;
  leste: number;
  norte: number;
  nx: number;
  ny: number;
}

export interface GradeCopernicus {
  elev: Float32Array;
  /** quantos tiles de 1° não existem (mar aberto ou região não liberada) */
  tilesFaltando: number;
  tilesTotal: number;
  resolucaoM: number;
}

function nomeTile(latSul: number, lonOeste: number) {
  const la = `${latSul < 0 ? 'S' : 'N'}${String(Math.abs(latSul)).padStart(2, '0')}_00`;
  const lo = `${lonOeste < 0 ? 'W' : 'E'}${String(Math.abs(lonOeste)).padStart(3, '0')}_00`;
  const nome = `Copernicus_DSM_COG_10_${la}_${lo}_DEM`;
  return `${BASE}/${nome}/${nome}.tif`;
}

// arquivos abertos ficam na memória durante a sessão (só o cabeçalho é baixado)
const abertos = new Map<string, Promise<GeoTIFFImage | null>>();

function abrir(latSul: number, lonOeste: number): Promise<GeoTIFFImage | null> {
  const url = nomeTile(latSul, lonOeste);
  let p = abertos.get(url);
  if (!p) {
    p = (async () => {
      const resp = await fetch(url, { method: 'HEAD' });
      if (resp.status === 404 || resp.status === 403) return null; // sem dados (mar ou região não liberada)
      const tiff: GeoTIFF = await comTentativas(() => fromUrl(url, { allowFullFile: false }));
      return tiff.getImage();
    })();
    abertos.set(url, p);
    p.catch(() => abertos.delete(url));
  }
  return p;
}

interface Janela {
  img: GeoTIFFImage;
  dados: Float32Array | null; // null = tile inexistente (altitude 0)
  x0: number; // coluna inicial da janela no arquivo
  y0: number;
  largura: number;
  altura: number;
  origemLon: number;
  origemLat: number;
  resLon: number;
  resLat: number; // positivo
}

export async function obterGradeCopernicus(p: PedidoCopernicus): Promise<GradeCopernicus> {
  const chave = createHash('sha1').update(JSON.stringify(p)).digest('hex');
  const arquivo = path.join(PASTA_CACHE, 'copernicus', `${chave}.bin`);
  try {
    const buf = await readFile(arquivo);
    const meta = JSON.parse(buf.subarray(0, 256).toString('utf8').replace(/\0+$/, ''));
    const elev = new Float32Array(buf.buffer.slice(buf.byteOffset + 256, buf.byteOffset + buf.byteLength));
    return { elev, ...meta };
  } catch {
    // não está em cache
  }

  // tiles de 1° que cobrem a área
  const janelas = new Map<string, Janela | null>();
  const tarefas: Promise<void>[] = [];
  let faltando = 0;
  let total = 0;
  for (let lat = Math.floor(p.sul); lat <= Math.floor(p.norte); lat++) {
    for (let lon = Math.floor(p.oeste); lon <= Math.floor(p.leste); lon++) {
      total++;
      tarefas.push(
        (async () => {
          const img = await abrir(lat, lon);
          if (!img) {
            faltando++;
            janelas.set(`${lat},${lon}`, null);
            return;
          }
          janelas.set(`${lat},${lon}`, await lerJanela(img, p));
        })(),
      );
    }
  }
  await Promise.all(tarefas);

  // altitude num ponto: bilinear dentro do tile; tile ausente = 0 (nível do mar)
  const valor = (lon: number, lat: number): number => {
    const j = janelas.get(`${Math.floor(lat)},${Math.floor(lon)}`);
    if (!j || !j.dados) return 0;
    // centro dos pixels (pixel-is-area)
    const fx = (lon - j.origemLon) / j.resLon - 0.5 - j.x0;
    const fy = (j.origemLat - lat) / j.resLat - 0.5 - j.y0;
    const cx = Math.min(j.largura - 1, Math.max(0, fx));
    const cy = Math.min(j.altura - 1, Math.max(0, fy));
    const x0 = Math.min(j.largura - 2, Math.floor(cx));
    const y0 = Math.min(j.altura - 2, Math.floor(cy));
    if (x0 < 0 || y0 < 0) return j.dados[0];
    const ax = cx - x0;
    const ay = cy - y0;
    const L = j.largura;
    const d = j.dados;
    const i = y0 * L + x0;
    return (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) + (d[i + L] * (1 - ax) + d[i + L + 1] * ax) * ay;
  };

  const elev = new Float32Array(p.nx * p.ny);
  for (let j = 0; j < p.ny; j++) {
    const lat = p.sul + ((p.norte - p.sul) * j) / (p.ny - 1);
    for (let i = 0; i < p.nx; i++) {
      const lon = p.oeste + ((p.leste - p.oeste) * i) / (p.nx - 1);
      elev[j * p.nx + i] = valor(lon, lat);
    }
  }

  const qualquer = [...janelas.values()].find((j) => j);
  const latMedia = ((p.sul + p.norte) / 2) * (Math.PI / 180);
  const resolucaoM = qualquer ? qualquer.resLat * 111_320 * Math.max(1, (qualquer.resLon / qualquer.resLat) * Math.cos(latMedia)) : 30;
  const meta = { tilesFaltando: faltando, tilesTotal: total, resolucaoM };
  const cabecalho = Buffer.alloc(256);
  cabecalho.write(JSON.stringify(meta), 'utf8');
  await gravar(arquivo, Buffer.concat([cabecalho, Buffer.from(elev.buffer)]));
  return { elev, ...meta };
}

/** Lê do arquivo só o retângulo de pixels que cobre o pedido (com folga de 2 px). */
async function lerJanela(img: GeoTIFFImage, p: PedidoCopernicus): Promise<Janela> {
  const [origemLon, origemLat] = img.getOrigin();
  const [resLon, resLatNeg] = img.getResolution();
  const resLat = Math.abs(resLatNeg);
  const W = img.getWidth();
  const H = img.getHeight();
  const x0 = Math.max(0, Math.floor((p.oeste - origemLon) / resLon) - 2);
  const x1 = Math.min(W, Math.ceil((p.leste - origemLon) / resLon) + 2);
  const y0 = Math.max(0, Math.floor((origemLat - p.norte) / resLat) - 2);
  const y1 = Math.min(H, Math.ceil((origemLat - p.sul) / resLat) + 2);
  if (x1 <= x0 || y1 <= y0) {
    return { img, dados: null, x0: 0, y0: 0, largura: 0, altura: 0, origemLon, origemLat, resLon, resLat };
  }
  const r = await comTentativas(() => img.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: true }));
  return {
    img,
    dados: Float32Array.from(r as unknown as ArrayLike<number>),
    x0, y0, largura: x1 - x0, altura: y1 - y0,
    origemLon, origemLat, resLon, resLat,
  };
}
