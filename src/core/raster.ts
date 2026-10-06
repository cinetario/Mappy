// Máscara em grade (raster) de polígonos, para perguntas rápidas do tipo
// "este ponto está dentro de alguma floresta / perto de alguma rua?" para
// milhares de pontos (posições de árvores).

export type P = [number, number];

export interface Mascara {
  dentro(x: number, y: number): boolean;
  /** células marcadas (para testes) */
  marcadas(): number;
}

/**
 * Preenche os polígonos (regra par-ímpar) numa grade de passo `passo`
 * cobrindo a caixa [x0, x1] × [y0, y1]. O centro de cada célula decide.
 */
export function rasterizar(poligonos: P[][], x0: number, y0: number, x1: number, y1: number, passo: number): Mascara {
  const w = Math.max(1, Math.ceil((x1 - x0) / passo));
  const h = Math.max(1, Math.ceil((y1 - y0) / passo));
  const dados = new Uint8Array(w * h);
  // cruzamentos de cada linha de centros com as arestas
  const cruzamentos: number[][] = Array.from({ length: h }, () => []);
  for (const anel of poligonos) {
    for (let k = 0; k < anel.length; k++) {
      const [ax, ay] = anel[k];
      const [bx, by] = anel[(k + 1) % anel.length];
      if (ay === by) continue;
      const ymin = Math.min(ay, by);
      const ymax = Math.max(ay, by);
      const r0 = Math.max(0, Math.ceil((ymin - y0) / passo - 0.5));
      const r1 = Math.min(h - 1, Math.floor((ymax - y0) / passo - 0.5));
      for (let r = r0; r <= r1; r++) {
        const yc = y0 + (r + 0.5) * passo;
        if (yc < ymin || yc >= ymax) continue; // meio-aberto: vértices não contam duas vezes
        cruzamentos[r].push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
    }
  }
  for (let r = 0; r < h; r++) {
    const xs = cruzamentos[r].sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / passo - 0.5));
      const c1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / passo - 0.5));
      for (let c = c0; c <= c1; c++) dados[r * w + c] = 1;
    }
  }
  return {
    dentro(x, y) {
      const c = Math.floor((x - x0) / passo);
      const r = Math.floor((y - y0) / passo);
      return c >= 0 && r >= 0 && c < w && r < h && dados[r * w + c] === 1;
    },
    marcadas: () => dados.reduce((s, v) => s + v, 0),
  };
}
