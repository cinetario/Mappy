// Validação independente com a biblioteca manifold-3d (a mesma usada pelos
// fatiadores modernos). Se ela aceitar a malha sem erros, a malha é manifold.
import Module from 'manifold-3d';
import type { Malha } from './malha.ts';

let modulo: Awaited<ReturnType<typeof Module>> | undefined;

export async function carregarManifold() {
  if (!modulo) {
    modulo = await Module();
    modulo.setup();
  }
  return modulo;
}

export interface ResultadoManifold {
  status: string;
  volumeMm3: number;
  genero: number;
}

export async function validarComManifold(m: Malha): Promise<ResultadoManifold> {
  const wasm = await carregarManifold();
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: m.posicoes, triVerts: m.indices });
  try {
    const solido = new wasm.Manifold(mesh);
    try {
      return { status: solido.status(), volumeMm3: solido.volume(), genero: solido.genus() };
    } finally {
      solido.delete();
    }
  } catch (erro) {
    return { status: `Rejeitada: ${erro instanceof Error ? erro.message : String(erro)}`, volumeMm3: 0, genero: -1 };
  }
}
