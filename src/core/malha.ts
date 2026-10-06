// Representação de malha triangular indexada, em milímetros.
// Triângulos em sentido anti-horário vistos de fora (normal apontando para fora).

export interface Malha {
  /** x, y, z de cada vértice */
  posicoes: Float32Array;
  /** 3 índices por triângulo */
  indices: Uint32Array;
}

export function contarTriangulos(m: Malha): number {
  return m.indices.length / 3;
}

export function caixaLimite(m: Malha) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m.posicoes.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      min[e] = Math.min(min[e], m.posicoes[k + e]);
      max[e] = Math.max(max[e], m.posicoes[k + e]);
    }
  }
  return { min, max };
}

/** Une vértices com a mesma posição (necessário ao ler STL, que não é indexado). */
export function soldarVertices(posicoesSoltas: Float32Array): Malha {
  const mapa = new Map<string, number>();
  const posicoes: number[] = [];
  const indices = new Uint32Array(posicoesSoltas.length / 3);
  for (let v = 0; v < indices.length; v++) {
    const x = posicoesSoltas[v * 3];
    const y = posicoesSoltas[v * 3 + 1];
    const z = posicoesSoltas[v * 3 + 2];
    const chave = `${x},${y},${z}`;
    let idx = mapa.get(chave);
    if (idx === undefined) {
      idx = posicoes.length / 3;
      mapa.set(chave, idx);
      posicoes.push(x, y, z);
    }
    indices[v] = idx;
  }
  return { posicoes: new Float32Array(posicoes), indices };
}
