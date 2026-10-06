// Ponte com a biblioteca manifold-3d (WASM): booleanas robustas e validação.
// Se ela aceitar a malha sem erros, a malha é manifold.
import Module from 'manifold-3d';
import type { Malha } from './malha.ts';

export type Wasm = Awaited<ReturnType<typeof Module>>;
export type Solido = InstanceType<Wasm['Manifold']>;

let carregando: Promise<Wasm> | undefined;

/** Carrega o WASM uma vez. No navegador, passe a URL do manifold.wasm. */
export function carregarManifold(urlWasm?: string): Promise<Wasm> {
  carregando ??= (async () => {
    const wasm = await Module(urlWasm ? { locateFile: () => urlWasm } : undefined);
    wasm.setup();
    return wasm;
  })();
  return carregando;
}

export function malhaParaSolido(wasm: Wasm, m: Malha): Solido {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: m.posicoes, triVerts: m.indices });
  return new wasm.Manifold(mesh);
}

export function solidoParaMalha(s: Solido): Malha {
  const mesh = s.getMesh();
  const nV = mesh.vertProperties.length / mesh.numProp;
  let posicoes: Float32Array;
  if (mesh.numProp === 3) {
    posicoes = new Float32Array(mesh.vertProperties);
  } else {
    posicoes = new Float32Array(nV * 3);
    for (let v = 0; v < nV; v++) {
      for (let e = 0; e < 3; e++) posicoes[v * 3 + e] = mesh.vertProperties[v * mesh.numProp + e];
    }
  }
  return { posicoes, indices: new Uint32Array(mesh.triVerts) };
}

export interface ResultadoManifold {
  status: string;
  volumeMm3: number;
  genero: number;
}

export async function validarComManifold(m: Malha): Promise<ResultadoManifold> {
  const wasm = await carregarManifold();
  try {
    const solido = malhaParaSolido(wasm, m);
    try {
      return { status: solido.status(), volumeMm3: solido.volume(), genero: solido.genus() };
    } finally {
      solido.delete();
    }
  } catch (erro) {
    return { status: `Rejeitada: ${erro instanceof Error ? erro.message : String(erro)}`, volumeMm3: 0, genero: -1 };
  }
}
