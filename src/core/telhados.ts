// Telhados (roof:shape do OSM): duas águas, quatro águas, piramidal e cúpula.
//
// O telhado é desenhado sobre o menor retângulo que envolve o prédio (girado
// junto com ele), com a cumeeira no sentido do lado maior, e depois cortado
// pelo contorno do prédio. Em prédios retangulares fica exato; em formatos
// irregulares é uma aproximação boa.
import type { Solido, Wasm } from './manifold.ts';
import type { FormaTelhado } from './osm.ts';

type P = [number, number];
type Secao = InstanceType<Wasm['CrossSection']>;

export interface Retangulo {
  centro: P;
  /** ângulo do lado maior, em graus */
  angulo: number;
  /** lado maior (direção da cumeeira) e menor */
  comprimento: number;
  largura: number;
}

function casco(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo: P[] = [];
  for (const q of p) {
    while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0) baixo.pop();
    baixo.push(q);
  }
  const cima: P[] = [];
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k];
    while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], q) <= 0) cima.pop();
    cima.push(q);
  }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)];
}

/** Menor retângulo (em área) que envolve o polígono: testa a direção de cada lado do casco convexo. */
export function menorRetangulo(anel: P[]): Retangulo {
  const h = casco(anel);
  let melhor: Retangulo & { area: number } = { centro: [0, 0], angulo: 0, comprimento: 0, largura: 0, area: Infinity };
  for (let k = 0; k < h.length; k++) {
    const a = h[k];
    const b = h[(k + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of h) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < melhor.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      const centro: P = [uc * c - vc * s, uc * s + vc * c];
      const lu = u1 - u0;
      const lv = v1 - v0;
      const graus = (ang * 180) / Math.PI;
      melhor = lu >= lv
        ? { centro, angulo: graus, comprimento: lu, largura: lv, area }
        : { centro, angulo: graus + 90, comprimento: lv, largura: lu, area };
    }
  }
  return melhor;
}

/** Altura padrão do telhado quando o OSM não diz: inclinação de 30° (cúpula: meia largura). */
export function alturaPadraoTelhado(forma: FormaTelhado, r: Retangulo): number {
  if (forma === 'plano') return 0;
  if (forma === 'cupula') return r.largura / 2;
  return (r.largura / 2) * Math.tan(Math.PI / 6);
}

/**
 * Sólido do telhado: base em z0, topo em z0 + h, cortado pelo contorno do prédio
 * (`pegada`, já em coordenadas do modelo). null se não sobrar nada.
 */
export function solidoTelhado(wasm: Wasm, pegada: Secao, r: Retangulo, forma: FormaTelhado, z0: number, h: number): Solido | null {
  if (forma === 'plano' || h <= 0) return null;
  const lixo: { delete(): void }[] = [];
  const g = <T extends { delete(): void }>(x: T): T => (lixo.push(x), x);
  try {
    const L = r.comprimento / 2;
    const W = r.largura / 2;
    let local: Solido;
    if (forma === 'cupula') {
      // meio elipsoide inscrito no retângulo
      local = g(g(g(wasm.Manifold.sphere(1, 48)).scale([L, W, h])).trimByPlane([0, 0, 1], 0));
    } else {
      const base: [number, number, number][] = [[-L, -W, 0], [L, -W, 0], [L, W, 0], [-L, W, 0]];
      let topo: [number, number, number][];
      if (forma === 'duas-aguas') topo = [[-L, 0, h], [L, 0, h]];
      else if (forma === 'quatro-aguas' && L > W) topo = [[-(L - W), 0, h], [L - W, 0, h]];
      else topo = [[0, 0, h]]; // piramidal (ou quatro águas num quadrado)
      local = g(wasm.Manifold.hull([...base, ...topo]));
    }
    const posto = g(g(local.rotate([0, 0, r.angulo])).translate([r.centro[0], r.centro[1], z0]));
    const coluna = g(g(pegada.extrude(h * 1.5 + 1)).translate([0, 0, z0 - 0.5]));
    const telhado = posto.intersect(coluna);
    if (telhado.isEmpty()) {
      telhado.delete();
      return null;
    }
    return telhado;
  } finally {
    for (const x of lixo) x.delete();
  }
}
