// Atribuição das fontes de prédios (exigida pelas licenças).
//
// - OpenStreetMap: ODbL 1.0 → "© OpenStreetMap contributors".
// - Overture Maps, tema buildings: ODbL 1.0 → "© Overture Maps Foundation", mais
//   as bases originais de cada prédio (o Overture junta OSM, Esri Community
//   Maps, Google Open Buildings e Microsoft ML Buildings; cada prédio diz de
//   qual veio, na coluna "sources").
// - Arquivo da prefeitura: a licença e o texto vêm de quem forneceu o arquivo
//   (informados na importação).

/** Licenças conhecidas das bases que o Overture usa (quando o arquivo não informa). */
const BASES_OVERTURE: Record<string, { texto: string; licenca: string; link: string }> = {
  OpenStreetMap: { texto: '© OpenStreetMap contributors', licenca: 'ODbL 1.0', link: 'https://www.openstreetmap.org/copyright' },
  'Google Open Buildings': { texto: 'Google Open Buildings', licenca: 'CC BY 4.0 / ODbL 1.0', link: 'https://sites.research.google/open-buildings/' },
  'Microsoft ML Buildings': { texto: 'Microsoft ML Building Footprints', licenca: 'ODbL 1.0', link: 'https://github.com/microsoft/GlobalMLBuildingFootprints' },
  'Esri Community Maps': { texto: 'Esri Community Maps contributors', licenca: 'CC BY 4.0', link: 'https://communitymaps.arcgis.com/' },
};

export interface Atribuicao {
  texto: string;
  licenca: string;
  link?: string;
}

export const ATRIBUICAO_OVERTURE: Atribuicao = {
  texto: '© Overture Maps Foundation', licenca: 'ODbL 1.0', link: 'https://docs.overturemaps.org/attribution/',
};

/** Base original de um prédio do Overture → atribuição. */
export function atribuicaoBaseOverture(dataset: string, licencaInformada?: string | null): Atribuicao {
  const conhecida = BASES_OVERTURE[dataset];
  return {
    texto: conhecida?.texto ?? dataset,
    licenca: licencaInformada?.replace('-', ' ').replace(/^ODbL 1\.0$/, 'ODbL 1.0') || conhecida?.licenca || 'ver Overture',
    link: conhecida?.link,
  };
}
