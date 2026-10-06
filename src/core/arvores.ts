// Posições e forma das árvores.
// Fontes: árvores mapeadas no OSM (natural=tree e tree_row) e preenchimento
// das florestas com árvores geradas (grade com sorteio, sempre igual para a
// mesma área). Árvores perto de ruas, prédios e água são removidas.
import { aleatorio } from './aleatorio.ts';
import type { Mascara, P } from './raster.ts';

export type EstiloArvore = 'classica' | 'classicaLowpoly' | 'copa' | 'copaLowpoly';

export interface Arvore {
  x: number;
  y: number;
  /** fator de tamanho (1 = tamanho configurado) */
  escala: number;
}

export interface OpcoesPosicoes {
  /** árvores mapeadas (já em coordenadas do modelo) */
  mapeadas: P[];
  /** linhas de fileiras de árvores (coordenadas do modelo) */
  fileiras: P[][];
  /** florestas a preencher (null = não preencher) */
  florestas: Mascara | null;
  /** caixa onde procurar posições nas florestas */
  caixa: { x0: number; y0: number; x1: number; y1: number };
  /** dentro do contorno do modelo */
  noModelo: Mascara;
  /** áreas proibidas (ruas, prédios, água, já com a distância de segurança) */
  proibido: Mascara | null;
  /** árvores por unidade² do modelo, nas florestas */
  densidade: number;
  /** diâmetro da copa (para espaçar as fileiras e checar a distância) */
  diametro: number;
  maximo: number;
}

export interface ResultadoPosicoes {
  arvores: Arvore[];
  removidasPorDistancia: number;
  cortadasPeloMaximo: number;
}

export function posicionarArvores(o: OpcoesPosicoes): ResultadoPosicoes {
  const candidatas: (Arvore & { id: string })[] = [];
  const variacao = (id: string) => 0.85 + 0.3 * aleatorio(`${id}:t`);
  o.mapeadas.forEach(([x, y], k) => candidatas.push({ id: `m${k}`, x, y, escala: variacao(`m${k}`) }));
  // fileiras: uma árvore a cada diâmetro de copa
  o.fileiras.forEach((linha, f) => {
    for (let k = 0; k < linha.length - 1; k++) {
      const [ax, ay] = linha[k];
      const [bx, by] = linha[k + 1];
      const n = Math.max(1, Math.floor(Math.hypot(bx - ax, by - ay) / o.diametro));
      for (let s = 0; s < n; s++) {
        const id = `f${f}:${k}:${s}`;
        candidatas.push({ id, x: ax + ((bx - ax) * s) / n, y: ay + ((by - ay) * s) / n, escala: variacao(id) });
      }
    }
  });
  // florestas: grade com sorteio dentro de cada célula
  if (o.florestas && o.densidade > 0) {
    const passo = 1 / Math.sqrt(o.densidade);
    const { x0, y0, x1, y1 } = o.caixa;
    for (let j = Math.floor(y0 / passo); j * passo < y1; j++) {
      for (let i = Math.floor(x0 / passo); i * passo < x1; i++) {
        const id = `g${i},${j}`;
        const x = (i + 0.15 + 0.7 * aleatorio(`${id}:x`)) * passo;
        const y = (j + 0.15 + 0.7 * aleatorio(`${id}:y`)) * passo;
        if (o.florestas.dentro(x, y)) candidatas.push({ id, x, y, escala: variacao(id) });
      }
    }
  }

  // maiores primeiro: numa disputa por espaço, são as primeiras a sair
  candidatas.sort((a, b) => b.escala - a.escala);
  let removidas = 0;
  const aceitas: (Arvore & { id: string })[] = [];
  for (const a of candidatas) {
    if (!o.noModelo.dentro(a.x, a.y)) continue;
    if (o.proibido?.dentro(a.x, a.y)) {
      removidas++;
      continue;
    }
    aceitas.push(a);
  }
  // acima do máximo: mantém uma amostra espalhada (sorteio estável), não só um canto
  let cortadas = 0;
  let final = aceitas;
  if (aceitas.length > o.maximo) {
    final = aceitas
      .map((a) => ({ a, r: aleatorio(`${a.id}:max`) }))
      .sort((p, q) => p.r - q.r)
      .slice(0, o.maximo)
      .map((p) => p.a);
    cortadas = aceitas.length - o.maximo;
  }
  return { arvores: final.map(({ x, y, escala }) => ({ x, y, escala })), removidasPorDistancia: removidas, cortadasPeloMaximo: cortadas };
}
