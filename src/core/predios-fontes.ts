// Junta prédios de duas fontes sem duplicar (modo "Automático" da camada Prédios).
//
// - Prédios do OSM ficam sempre (o desenho do OSM costuma ser o mais fiel).
// - Prédio do OSM sem altura recebe a altura do prédio da outra fonte que o cobre.
// - Prédio da outra fonte entra só onde não há prédio do OSM: se ele e um prédio
//   do OSM se sobrepõem em pelo menos 30% da área de um dos dois, é o mesmo prédio.
// - Os prédios que o Overture copiou do próprio OSM (origem "OpenStreetMap")
//   já estão no OSM e são ignorados.
//
// A sobreposição é medida por amostras: pontos espalhados dentro de cada
// polígono, testados contra o outro. Rápido e suficiente para decidir "mesmo
// prédio ou não".
import type { LonLat } from './geo.ts';
import { centroide, dentro, type Predio } from './osm.ts';

const LIMIAR = 0.3;
const LADO_AMOSTRA = 5;
const CELULA = 0.002; // graus (~200 m), para achar vizinhos rápido

type Caixa = [number, number, number, number];

function caixaDe(p: Predio): Caixa {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p.aneis[0]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Pontos dentro do polígono (grade 5 × 5 na caixa; se nenhum cair dentro, o centro). */
export function amostras(p: Predio, c = caixaDe(p)): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < LADO_AMOSTRA; i++) {
    for (let j = 0; j < LADO_AMOSTRA; j++) {
      const q: LonLat = [c[0] + ((i + 0.5) / LADO_AMOSTRA) * (c[2] - c[0]), c[1] + ((j + 0.5) / LADO_AMOSTRA) * (c[3] - c[1])];
      if (dentro(q, p.aneis)) pts.push(q);
    }
  }
  return pts.length ? pts : [centroide(p.aneis[0])];
}

interface Indexado { p: Predio; caixa: Caixa; amostras: LonLat[]; k: number }

function indexar(lista: Predio[]) {
  const itens: Indexado[] = lista.map((p, k) => {
    const caixa = caixaDe(p);
    return { p, caixa, amostras: amostras(p, caixa), k };
  });
  const grade = new Map<string, number[]>();
  itens.forEach((it, k) => {
    for (let i = Math.floor(it.caixa[0] / CELULA); i <= Math.floor(it.caixa[2] / CELULA); i++) {
      for (let j = Math.floor(it.caixa[1] / CELULA); j <= Math.floor(it.caixa[3] / CELULA); j++) {
        const chave = `${i},${j}`;
        const l = grade.get(chave);
        if (l) l.push(k);
        else grade.set(chave, [k]);
      }
    }
  });
  const vizinhos = (c: Caixa): Indexado[] => {
    const ks = new Set<number>();
    for (let i = Math.floor(c[0] / CELULA); i <= Math.floor(c[2] / CELULA); i++) {
      for (let j = Math.floor(c[1] / CELULA); j <= Math.floor(c[3] / CELULA); j++) {
        for (const k of grade.get(`${i},${j}`) ?? []) ks.add(k);
      }
    }
    return [...ks].map((k) => itens[k]).filter((it) => it.caixa[0] <= c[2] && it.caixa[2] >= c[0] && it.caixa[1] <= c[3] && it.caixa[3] >= c[1]);
  };
  return { itens, vizinhos };
}

const fracaoDentro = (pts: LonLat[], aneis: LonLat[][]) => pts.filter((q) => dentro(q, aneis)).length / pts.length;

/** Sobreposição entre dois prédios: a maior das duas frações (de A dentro de B e de B dentro de A). */
function sobreposicao(a: Indexado, b: Indexado): number {
  return Math.max(fracaoDentro(a.amostras, b.p.aneis), fracaoDentro(b.amostras, a.p.aneis));
}

export interface ResultadoCombinacao {
  predios: Predio[];
  /** prédios do OSM sem altura que receberam a altura da outra fonte */
  alturasCompletadas: number;
  /** prédios da outra fonte descartados por coincidirem com um do OSM */
  descartados: number;
  /** prédios da outra fonte que eram cópia do OSM */
  copiasDoOsm: number;
}

export function combinarPredios(osm: Predio[], outros: Predio[]): ResultadoCombinacao {
  const copiasDoOsm = outros.filter((p) => p.origem === 'OpenStreetMap').length;
  const candidatos = outros.filter((p) => p.origem !== 'OpenStreetMap');
  const idxOsm = indexar(osm);
  const resultadoOsm = idxOsm.itens.map((it) => ({ ...it.p }));
  /** melhor prédio da outra fonte (com altura) para cada prédio do OSM sem altura */
  const melhorAltura = new Map<number, { s: number; p: Predio }>();
  const novos: Predio[] = [];
  let descartados = 0;
  for (const p of candidatos) {
    const caixa = caixaDe(p);
    const eu: Indexado = { p, caixa, amostras: amostras(p, caixa), k: -1 };
    let coincide = false;
    for (const v of idxOsm.vizinhos(caixa)) {
      const s = sobreposicao(eu, v);
      if (s < LIMIAR) continue;
      coincide = true;
      const k = v.k;
      if (!v.p.alturaInformada && p.alturaInformada && (melhorAltura.get(k)?.s ?? 0) < s) melhorAltura.set(k, { s, p });
    }
    if (coincide) descartados++;
    else novos.push(p);
  }
  for (const [k, { p }] of melhorAltura) {
    resultadoOsm[k] = { ...resultadoOsm[k], alturaM: p.alturaM, alturaInformada: true, alturaDe: p.fonte };
  }
  return { predios: [...resultadoOsm, ...novos], alturasCompletadas: melhorAltura.size, descartados, copiasDoOsm };
}
