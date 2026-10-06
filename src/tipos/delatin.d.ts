declare module 'delatin' {
  /** Triangulação adaptativa de mapas de altura (Delaunay com refinamento). */
  export default class Delatin {
    constructor(data: ArrayLike<number>, width: number, height?: number);
    /** refina até o erro máximo ficar abaixo de `maxError` (mesma unidade dos dados) */
    run(maxError?: number): void;
    getMaxError(): number;
    /** [x0, y0, x1, y1, …] em coordenadas de pixel inteiras */
    coords: number[];
    /** índices de vértices, 3 por triângulo */
    triangles: number[];
  }
}
