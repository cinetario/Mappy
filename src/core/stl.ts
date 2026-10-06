// Leitura e escrita de STL binário (unidades em mm).
import { soldarVertices, type Malha } from './malha.ts';

export function escreverStl(m: Malha, nome = 'Relevo3D'): ArrayBuffer {
  const nT = m.indices.length / 3;
  const buffer = new ArrayBuffer(84 + nT * 50);
  const dv = new DataView(buffer);
  const cabecalho = `${nome}`.slice(0, 79);
  for (let k = 0; k < cabecalho.length; k++) dv.setUint8(k, cabecalho.charCodeAt(k) & 0x7f);
  dv.setUint32(80, nT, true);

  const p = m.posicoes;
  let o = 84;
  for (let t = 0; t < nT; t++) {
    const a = m.indices[t * 3] * 3;
    const b = m.indices[t * 3 + 1] * 3;
    const c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (const v of [a, b, c]) {
      dv.setFloat32(o, p[v], true);
      dv.setFloat32(o + 4, p[v + 1], true);
      dv.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}

/** Lê STL binário ou ASCII e devolve uma malha indexada (vértices soldados). */
export function lerStl(dados: ArrayBuffer): Malha {
  const dv = new DataView(dados);
  if (dados.byteLength >= 84) {
    const nT = dv.getUint32(80, true);
    if (84 + nT * 50 === dados.byteLength) {
      const soltas = new Float32Array(nT * 9);
      for (let t = 0; t < nT; t++) {
        const o = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) soltas[t * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return soldarVertices(soltas);
    }
  }
  const texto = new TextDecoder().decode(dados);
  const numeros: number[] = [];
  for (const linha of texto.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    numeros.push(Math.fround(+linha[1]), Math.fround(+linha[2]), Math.fround(+linha[3]));
  }
  if (numeros.length === 0) throw new Error('Arquivo STL vazio ou inválido');
  return soldarVertices(new Float32Array(numeros));
}
