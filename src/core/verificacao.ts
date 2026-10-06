// Verifica se uma malha é um sólido fechado e bem orientado (manifold):
// - cada aresta é compartilhada por exatamente 2 triângulos;
// - os dois triângulos percorrem a aresta em sentidos opostos (nenhuma face invertida);
// - nenhum triângulo repete vértice;
// - o volume é positivo (normais apontando para fora).
// Triângulos de área zero com 3 vértices distintos ("agulhas" que as booleanas
// às vezes deixam) não quebram a malha nem o fatiamento: viram só uma observação.
import type { Malha } from './malha.ts';

export interface ResultadoVerificacao {
  valida: boolean;
  triangulos: number;
  /** arestas usadas por só um triângulo (buracos) */
  arestasAbertas: number;
  /** arestas usadas por mais de 2 triângulos ou percorridas no mesmo sentido */
  arestasProblematicas: number;
  /** triângulos de área zero (colineares): observação, não erro */
  degenerados: number;
  /** triângulos que repetem vértice: erro de topologia */
  repetidos: number;
  volumeMm3: number;
  erros: string[];
}

export function verificarMalha(m: Malha): ResultadoVerificacao {
  const nV = m.posicoes.length / 3;
  const nT = m.indices.length / 3;
  const arestas = new Map<number, number>();
  let degenerados = 0;
  let repetidos = 0;
  let volume = 0;
  const p = m.posicoes;

  for (let t = 0; t < nT; t++) {
    const a = m.indices[t * 3];
    const b = m.indices[t * 3 + 1];
    const c = m.indices[t * 3 + 2];
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    // produto vetorial (b - a) x (c - a)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (a === b || b === c || a === c) repetidos++;
    else if (Math.hypot(nx, ny, nz) < 1e-12) degenerados++;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const [de, para] of [[a, b], [b, c], [c, a]]) {
      const chave = de * nV + para;
      arestas.set(chave, (arestas.get(chave) ?? 0) + 1);
    }
  }

  let abertas = 0;
  let problematicas = 0;
  for (const [chave, n] of arestas) {
    const de = Math.floor(chave / nV);
    const para = chave - de * nV;
    const inversa = arestas.get(para * nV + de) ?? 0;
    if (n > 1) problematicas++;
    else if (inversa === 0) abertas++;
  }

  const erros: string[] = [];
  if (nT === 0) erros.push('A malha não tem triângulos');
  if (abertas > 0) erros.push(`${abertas} arestas abertas (a malha tem buracos)`);
  if (problematicas > 0) erros.push(`${problematicas} arestas com faces invertidas ou sobrepostas`);
  if (repetidos > 0) erros.push(`${repetidos} triângulos com vértice repetido`);
  if (!(volume > 0)) erros.push('Volume não positivo (normais apontando para dentro)');

  return {
    valida: erros.length === 0,
    triangulos: nT,
    arestasAbertas: abertas,
    arestasProblematicas: problematicas,
    degenerados,
    repetidos,
    volumeMm3: volume,
    erros,
  };
}
