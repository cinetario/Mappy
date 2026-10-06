// Utilidades de teste: medição independente de sobreposição entre peças.
//
// Por que não usar a interseção da manifold-3d? Quando duas peças apenas se
// ENCOSTAM (ex.: fundo da água sobre o topo da base), recalcular a interseção
// a partir das malhas exportadas pode acusar volume onde não há nenhum.
// Aqui sorteamos pontos e testamos, com um raio vertical, se cada ponto está
// dentro das duas malhas: um método simples e independente.
import { caixaLimite, type Malha } from '../src/core/malha.ts';

/** Ponto dentro da malha fechada: paridade de cruzamentos de um raio para +z. */
export function pontoDentro(m: Malha, x: number, y: number, z: number): boolean {
  let n = 0;
  const p = m.posicoes;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3;
    const b = m.indices[t + 1] * 3;
    const c = m.indices[t + 2] * 3;
    const d1 = (x - p[b]) * (p[a + 1] - p[b + 1]) - (p[a] - p[b]) * (y - p[b + 1]);
    const d2 = (x - p[c]) * (p[b + 1] - p[c + 1]) - (p[b] - p[c]) * (y - p[c + 1]);
    const d3 = (x - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (y - p[a + 1]);
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    const den = (p[b + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 1] - p[c + 1]);
    if (Math.abs(den) < 1e-12) continue; // face vertical
    const l1 = ((p[b + 1] - p[c + 1]) * (x - p[c]) + (p[c] - p[b]) * (y - p[c + 1])) / den;
    const l2 = ((p[c + 1] - p[a + 1]) * (x - p[c]) + (p[a] - p[c]) * (y - p[c + 1])) / den;
    if (l1 * p[a + 2] + l2 * p[b + 2] + (1 - l1 - l2) * p[c + 2] > z) n++;
  }
  return n % 2 === 1;
}

/**
 * Fração dos pontos de `a` que também estão dentro de `b`
 * (amostragem na interseção das caixas das duas peças).
 */
export function fracaoSobreposta(a: Malha, b: Malha, amostras = 4000): number {
  const ca = caixaLimite(a);
  const cb = caixaLimite(b);
  const min = [0, 1, 2].map((e) => Math.max(ca.min[e], cb.min[e]));
  const max = [0, 1, 2].map((e) => Math.min(ca.max[e], cb.max[e]));
  if (min.some((v, e) => v >= max[e])) return 0;
  let semente = 12345;
  const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
  let emA = 0;
  let emAmbos = 0;
  for (let k = 0; k < amostras; k++) {
    const [x, y, z] = [0, 1, 2].map((e) => min[e] + (max[e] - min[e]) * rnd());
    if (!pontoDentro(a, x, y, z)) continue;
    emA++;
    if (pontoDentro(b, x, y, z)) emAmbos++;
  }
  return emA ? emAmbos / emA : 0;
}
