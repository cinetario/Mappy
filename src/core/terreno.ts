// Transforma uma grade de elevação em um sólido fechado (pronto para imprimir):
// superfície do relevo em cima, quatro paredes laterais e fundo plano em z = 0.
// A superfície pode ser uma grade uniforme ou uma triangulação adaptativa
// (Delatin): muitos triângulos onde o relevo muda, poucos onde é plano.
import Delatin from 'delatin';
import type { GradeElevacao } from './elevacao.ts';
import type { Malha } from './malha.ts';

export interface OpcoesBloco {
  /** escala horizontal: unidades do modelo por metro real */
  porMetro: number;
  /** escala vertical: unidades do modelo por metro de altitude (já com exagero) */
  porMetroVertical: number;
  /** altura (z) do ponto mais baixo do relevo = topo da base */
  zBase: number;
  /** altitude (m) que fica em zBase */
  altitudeMinima: number;
  achatarMar: boolean;
  /** erro máximo da triangulação adaptativa; 0 = grade uniforme */
  erroMax: number;
}

export interface BlocoTerreno extends Malha {
  alturaMax: number;
  /** triângulos da superfície se fosse grade uniforme (para estatística) */
  triangulosGrade: number;
}

/** Altura (z) do modelo para cada ponto da grade. */
export function alturasDaGrade(grade: GradeElevacao, op: Pick<OpcoesBloco, 'porMetroVertical' | 'zBase' | 'altitudeMinima' | 'achatarMar'>): Float32Array {
  const z = new Float32Array(grade.nx * grade.ny);
  for (let k = 0; k < z.length; k++) {
    const e = op.achatarMar ? Math.max(0, grade.elev[k]) : grade.elev[k];
    z[k] = op.zBase + Math.max(0, e - op.altitudeMinima) * op.porMetroVertical;
  }
  return z;
}

export function menorAltitude(grade: GradeElevacao, achatarMar: boolean): number {
  let m = Infinity;
  for (const e of grade.elev) m = Math.min(m, achatarMar ? Math.max(0, e) : e);
  return m;
}

/** Gera o bloco de terreno centrado na origem. */
export function gerarBlocoTerreno(grade: GradeElevacao, op: OpcoesBloco): BlocoTerreno {
  const { nx, ny } = grade;
  if (nx < 2 || ny < 2) throw new Error('A grade precisa de pelo menos 2x2 pontos');
  if (!(op.zBase > 0)) throw new Error('A base precisa ter espessura maior que zero');
  const largura = grade.larguraM * op.porMetro;
  const profundidade = grade.alturaM * op.porMetro;
  const alturas = alturasDaGrade(grade, op);

  // ---- superfície: lista de vértices (i, j) da grade e triângulos ----
  let verts: number[]; // pares i, j
  let tris: number[];
  if (op.erroMax > 0) {
    const tin = new Delatin(alturas, nx, ny);
    tin.run(op.erroMax);
    verts = tin.coords;
    tris = tin.triangles;
  } else {
    verts = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) verts.push(i, j);
    tris = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        tris.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx);
      }
    }
  }
  const nTopo = verts.length / 2;

  // ---- contorno: vértices da borda em sentido anti-horário visto de cima ----
  const borda: { v: number; t: number }[] = [];
  for (let v = 0; v < nTopo; v++) {
    const i = verts[v * 2];
    const j = verts[v * 2 + 1];
    let t = -1;
    if (j === 0) t = i; // sul, oeste → leste
    else if (i === nx - 1) t = nx - 1 + j; // leste, sul → norte
    else if (j === ny - 1) t = 2 * (nx - 1) + (ny - 1) - i; // norte, leste → oeste
    else if (i === 0) t = 2 * (nx - 1) + 2 * (ny - 1) - j; // oeste, norte → sul
    if (t >= 0) borda.push({ v, t });
  }
  borda.sort((a, b) => a.t - b.t);
  const contorno = borda.map((b) => b.v);

  // ---- posições: topo, contorno do fundo, centro do fundo ----
  const nVertices = nTopo + contorno.length + 1;
  const posicoes = new Float32Array(nVertices * 3);
  let alturaMax = 0;
  for (let v = 0; v < nTopo; v++) {
    const i = verts[v * 2];
    const j = verts[v * 2 + 1];
    const z = alturas[j * nx + i];
    alturaMax = Math.max(alturaMax, z);
    posicoes[v * 3] = (i / (nx - 1) - 0.5) * largura;
    posicoes[v * 3 + 1] = (j / (ny - 1) - 0.5) * profundidade;
    posicoes[v * 3 + 2] = z;
  }
  contorno.forEach((vTopo, c) => {
    const v = nTopo + c;
    posicoes[v * 3] = posicoes[vTopo * 3];
    posicoes[v * 3 + 1] = posicoes[vTopo * 3 + 1];
    posicoes[v * 3 + 2] = 0;
  });
  const centro = nVertices - 1; // (0, 0, 0)

  const indices = new Uint32Array(tris.length + contorno.length * 9);
  let t = 0;
  const tri = (a: number, b: number, c: number) => {
    indices[t++] = a;
    indices[t++] = b;
    indices[t++] = c;
  };
  // topo, garantindo normal para cima (+z)
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
    const cruz = (verts[b * 2] - verts[a * 2]) * (verts[c * 2 + 1] - verts[a * 2 + 1])
      - (verts[b * 2 + 1] - verts[a * 2 + 1]) * (verts[c * 2] - verts[a * 2]);
    if (cruz > 0) tri(a, b, c);
    else tri(a, c, b);
  }
  // paredes e fundo
  for (let c = 0; c < contorno.length; c++) {
    const c2 = (c + 1) % contorno.length;
    const topoA = contorno[c];
    const topoB = contorno[c2];
    const fundoA = nTopo + c;
    const fundoB = nTopo + c2;
    tri(fundoA, fundoB, topoB);
    tri(fundoA, topoB, topoA);
    tri(centro, fundoB, fundoA);
  }

  return { posicoes, indices, alturaMax, triangulosGrade: (nx - 1) * (ny - 1) * 2 };
}

// ---------- interface simples (usada nos testes da Fase 1) ----------
export interface ParametrosTerreno {
  /** tamanho do lado maior do modelo, em mm */
  tamanhoMm: number;
  /** exagero vertical do relevo (1 = escala real) */
  exagero: number;
  /** espessura da base abaixo do ponto mais baixo, em mm */
  baseMm: number;
  /** trata altitudes abaixo de 0 (fundo do mar) como 0 */
  achatarMar: boolean;
}

export interface ModeloTerreno extends Malha {
  larguraMm: number;
  profundidadeMm: number;
  alturaMaxMm: number;
  mmPorMetro: number;
}

export function gerarTerreno(grade: GradeElevacao, p: ParametrosTerreno, erroMax = 0): ModeloTerreno {
  if (!(p.tamanhoMm > 0) || !(p.baseMm > 0) || !(p.exagero > 0)) {
    throw new Error('Tamanho, base e exagero precisam ser maiores que zero');
  }
  const mmPorMetro = p.tamanhoMm / Math.max(grade.larguraM, grade.alturaM);
  const b = gerarBlocoTerreno(grade, {
    porMetro: mmPorMetro,
    porMetroVertical: mmPorMetro * p.exagero,
    zBase: p.baseMm,
    altitudeMinima: menorAltitude(grade, p.achatarMar),
    achatarMar: p.achatarMar,
    erroMax,
  });
  return {
    posicoes: b.posicoes,
    indices: b.indices,
    larguraMm: grade.larguraM * mmPorMetro,
    profundidadeMm: grade.alturaM * mmPorMetro,
    alturaMaxMm: b.alturaMax,
    mmPorMetro,
  };
}
