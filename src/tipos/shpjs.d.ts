declare module 'shpjs' {
  type Colecao = { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> | null }[] };
  type Entrada = ArrayBuffer | Uint8Array | { shp: ArrayBuffer | Uint8Array; dbf?: ArrayBuffer | Uint8Array; prj?: string; cpg?: string };
  export default function getShapefile(entrada: Entrada): Promise<Colecao | Colecao[]>;
}
