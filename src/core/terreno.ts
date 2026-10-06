// Transforma uma grade de elevação em um sólido fechado (pronto para imprimir):
// superfície do relevo em cima, quatro paredes laterais e fundo plano em z = 0.
import type { GradeElevacao } from './elevacao.ts';
import type { Malha } from './malha.ts';

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
  /** milímetros do modelo por metro real (escala horizontal) */
  mmPorMetro: number;
}

export function gerarTerreno(grade: GradeElevacao, p: ParametrosTerreno): ModeloTerreno {
  const { nx, ny } = grade;
  if (nx < 2 || ny < 2) throw new Error('A grade precisa de pelo menos 2x2 pontos');
  if (!(p.tamanhoMm > 0) || !(p.baseMm > 0) || !(p.exagero > 0)) {
    throw new Error('Tamanho, base e exagero precisam ser maiores que zero');
  }

  const mmPorMetro = p.tamanhoMm / Math.max(grade.larguraM, grade.alturaM);
  const larguraMm = grade.larguraM * mmPorMetro;
  const profundidadeMm = grade.alturaM * mmPorMetro;

  const altitude = (k: number) => {
    const e = grade.elev[k];
    return p.achatarMar ? Math.max(0, e) : e;
  };
  let minimo = Infinity;
  for (let k = 0; k < nx * ny; k++) minimo = Math.min(minimo, altitude(k));

  // vértices: grade do topo (nx*ny), depois o contorno do fundo, depois o centro do fundo
  const contorno = indicesDoContorno(nx, ny);
  const nTopo = nx * ny;
  const nVertices = nTopo + contorno.length + 1;
  const posicoes = new Float32Array(nVertices * 3);
  let alturaMaxMm = 0;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const z = p.baseMm + (altitude(k) - minimo) * mmPorMetro * p.exagero;
      alturaMaxMm = Math.max(alturaMaxMm, z);
      posicoes[k * 3] = (i / (nx - 1)) * larguraMm - larguraMm / 2;
      posicoes[k * 3 + 1] = (j / (ny - 1)) * profundidadeMm - profundidadeMm / 2;
      posicoes[k * 3 + 2] = z;
    }
  }
  contorno.forEach((kTopo, c) => {
    const v = nTopo + c;
    posicoes[v * 3] = posicoes[kTopo * 3];
    posicoes[v * 3 + 1] = posicoes[kTopo * 3 + 1];
    posicoes[v * 3 + 2] = 0;
  });
  const centro = nVertices - 1;
  posicoes[centro * 3] = 0;
  posicoes[centro * 3 + 1] = 0;
  posicoes[centro * 3 + 2] = 0;

  const nTri = (nx - 1) * (ny - 1) * 2 + contorno.length * 2 + contorno.length;
  const indices = new Uint32Array(nTri * 3);
  let t = 0;
  const tri = (a: number, b: number, c: number) => {
    indices[t++] = a;
    indices[t++] = b;
    indices[t++] = c;
  };

  // topo: dois triângulos por célula, normal para cima (+z)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      tri(a, b, c);
      tri(a, c, d);
    }
  }

  // paredes e fundo: o contorno está em sentido anti-horário visto de cima
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

  return { posicoes, indices, larguraMm, profundidadeMm, alturaMaxMm, mmPorMetro };
}

/** Índices dos pontos da borda da grade, em sentido anti-horário visto de cima. */
function indicesDoContorno(nx: number, ny: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < nx - 1; i++) r.push(i); // borda sul, oeste → leste
  for (let j = 0; j < ny - 1; j++) r.push(j * nx + nx - 1); // borda leste, sul → norte
  for (let i = nx - 1; i > 0; i--) r.push((ny - 1) * nx + i); // borda norte, leste → oeste
  for (let j = ny - 1; j > 0; j--) r.push(j * nx); // borda oeste, norte → sul
  return r;
}
