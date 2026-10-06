// Texto → contornos 2D (para extrudar na moldura), a partir de fontes TrueType.
import { parse, type Font } from 'opentype.js';

export type P = [number, number];

export const FONTES_TEXTO = {
  archivo: { nome: 'Archivo Black', arquivo: 'ArchivoBlack-Regular.ttf' },
  bebas: { nome: 'Bebas Neue', arquivo: 'BebasNeue-Regular.ttf' },
  anton: { nome: 'Anton', arquivo: 'Anton-Regular.ttf' },
} as const;
export type NomeFonteTexto = keyof typeof FONTES_TEXTO;

const cache = new Map<string, Font>();

export function carregarFonte(nome: string, dados: ArrayBuffer): Font {
  let f = cache.get(nome);
  if (!f) {
    f = parse(dados);
    cache.set(nome, f);
  }
  return f;
}

export interface ContornosTexto {
  /** anéis (contornos e furos das letras), centrados na origem */
  aneis: P[][];
  largura: number;
  altura: number;
}

/**
 * Contornos do texto com as maiúsculas medindo `alturaMaiusculas`, centrado
 * em (0, 0). Curvas viram segmentos (8 por curva).
 */
export function contornosTexto(fonte: Font, texto: string, alturaMaiusculas: number): ContornosTexto {
  const os2 = (fonte.tables as { os2?: { sCapHeight?: number } }).os2;
  const capHeight = os2?.sCapHeight || fonte.unitsPerEm * 0.7;
  const tamanho = (alturaMaiusculas * fonte.unitsPerEm) / capHeight;
  const caminho = fonte.getPath(texto, 0, 0, tamanho);
  const aneis: P[][] = [];
  let atual: P[] = [];
  let ultimo: P = [0, 0];
  // o eixo y da fonte é para baixo: inverte
  const ponto = (x: number, y: number): P => [x, -y];
  const fechar = () => {
    if (atual.length >= 3) aneis.push(atual);
    atual = [];
  };
  const PASSOS = 8;
  for (const c of caminho.commands) {
    switch (c.type) {
      case 'M':
        fechar();
        ultimo = ponto(c.x, c.y);
        atual.push(ultimo);
        break;
      case 'L':
        ultimo = ponto(c.x, c.y);
        atual.push(ultimo);
        break;
      case 'Q': {
        const [x0, y0] = ultimo;
        const [x1, y1] = ponto(c.x1, c.y1);
        const [x2, y2] = ponto(c.x, c.y);
        for (let k = 1; k <= PASSOS; k++) {
          const t = k / PASSOS;
          const a = (1 - t) ** 2, b = 2 * (1 - t) * t, d = t * t;
          atual.push([a * x0 + b * x1 + d * x2, a * y0 + b * y1 + d * y2]);
        }
        ultimo = [x2, y2];
        break;
      }
      case 'C': {
        const [x0, y0] = ultimo;
        const [x1, y1] = ponto(c.x1, c.y1);
        const [x2, y2] = ponto(c.x2, c.y2);
        const [x3, y3] = ponto(c.x, c.y);
        for (let k = 1; k <= PASSOS; k++) {
          const t = k / PASSOS;
          const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, d = 3 * (1 - t) * t * t, e = t ** 3;
          atual.push([a * x0 + b * x1 + d * x2 + e * x3, a * y0 + b * y1 + d * y2 + e * y3]);
        }
        ultimo = [x3, y3];
        break;
      }
      case 'Z':
        fechar();
        break;
    }
  }
  fechar();
  if (!aneis.length) return { aneis: [], largura: 0, altura: 0 };
  // centraliza
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of aneis) for (const [x, y] of a) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    aneis: aneis.map((a) => a.map(([x, y]) => [x - cx, y - cy] as P)),
    largura: x1 - x0,
    altura: y1 - y0,
  };
}
