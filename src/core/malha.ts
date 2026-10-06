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

/**
 * Garante que vértices DISTINTOS tenham posições distintas em float32.
 * O STL não guarda topologia: quem lê o arquivo junta vértices pela posição.
 * Se dois corpos se tocam num ponto ou numa aresta (vértices diferentes na
 * mesma posição), a leitura criaria arestas com 4 triângulos. Aqui cada
 * vértice repetido é afastado `distancia` para dentro dos próprios triângulos.
 * Devolve quantos vértices foram afastados.
 */
export function separarVerticesCoincidentes(m: Malha, distancia: number): number {
  const p = m.posicoes;
  const nV = p.length / 3;
  const chave = (v: number) => `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`; // posicoes já é float32
  const grupos = new Map<string, number[]>();
  for (let v = 0; v < nV; v++) {
    const k = chave(v);
    const g = grupos.get(k);
    if (g) g.push(v);
    else grupos.set(k, [v]);
  }
  const repetidos = [...grupos.values()].filter((g) => g.length > 1);
  if (!repetidos.length) return 0;

  // centro dos triângulos de cada vértice repetido (direção "para dentro" da sua superfície)
  const alvo = new Set(repetidos.flatMap((g) => g.slice(1)));
  const soma = new Map<number, [number, number, number, number]>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    for (const v of tri) {
      if (!alvo.has(v)) continue;
      const s = soma.get(v) ?? [0, 0, 0, 0];
      for (const u of tri) for (let e = 0; e < 3; e++) s[e] += p[u * 3 + e] / 3;
      s[3]++;
      soma.set(v, s);
    }
  }
  let afastados = 0;
  for (const v of alvo) {
    const s = soma.get(v);
    if (!s) continue;
    const dir = [0, 1, 2].map((e) => s[e] / s[3] - p[v * 3 + e]);
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    let fator = 1;
    // aumenta o passo até a nova posição ser única em float32
    for (let tentativa = 0; tentativa < 6; tentativa++, fator *= 2) {
      const novo = [0, 1, 2].map((e) => Math.fround(p[v * 3 + e] + (dir[e] / len) * distancia * fator));
      const k = `${novo[0]},${novo[1]},${novo[2]}`;
      if (!grupos.has(k)) {
        p[v * 3] = novo[0];
        p[v * 3 + 1] = novo[1];
        p[v * 3 + 2] = novo[2];
        grupos.set(k, [v]);
        afastados++;
        break;
      }
    }
  }
  return afastados;
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
