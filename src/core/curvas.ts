// Curvas de nível pelo algoritmo "marching squares" sobre a grade de elevação.

export type P = [number, number];

const INTERVALOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** Intervalo "redondo" que dá no máximo ~15 linhas entre a menor e a maior altitude. */
export function intervaloAutomatico(min: number, max: number, alvo = 15): number {
  const faixa = Math.max(0, max - min);
  return INTERVALOS.find((i) => faixa / i <= alvo) ?? INTERVALOS[INTERVALOS.length - 1];
}

/** Níveis múltiplos do intervalo estritamente dentro de (min, max). */
export function niveis(min: number, max: number, intervalo: number): number[] {
  const r: number[] = [];
  for (let v = Math.floor(min / intervalo + 1) * intervalo; v < max; v += intervalo) r.push(Math.round(v * 1e6) / 1e6);
  return r;
}

/**
 * Linhas de cada nível, em coordenadas da grade (x = coluna, y = linha; podem
 * ser fracionárias). As linhas são emendadas pelas arestas das células, então
 * saem como polilinhas contínuas (fechadas quando a curva fecha).
 */
export function tracarCurvas(valores: ArrayLike<number>, nx: number, ny: number, nivel: number): P[][] {
  const v = (i: number, j: number) => valores[j * nx + i];
  // ponto onde o nível cruza cada aresta; a chave identifica a aresta (compartilhada por 2 células)
  const ponto = new Map<string, P>();
  const cruza = (chave: string, a: P, va: number, b: P, vb: number) => {
    if (!ponto.has(chave)) {
      const t = (nivel - va) / (vb - va);
      ponto.set(chave, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return chave;
  };
  // vizinhos: cada aresta cruzada liga-se a 1 ou 2 outras (uma por célula)
  const ligacoes = new Map<string, string[]>();
  const ligar = (a: string, b: string) => {
    (ligacoes.get(a) ?? ligacoes.set(a, []).get(a)!).push(b);
    (ligacoes.get(b) ?? ligacoes.set(b, []).get(b)!).push(a);
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const caso = (a >= nivel ? 1 : 0) | (b >= nivel ? 2 : 0) | (c >= nivel ? 4 : 0) | (d >= nivel ? 8 : 0);
      if (caso === 0 || caso === 15) continue;
      const sul = () => cruza(`h${i},${j}`, [i, j], a, [i + 1, j], b);
      const leste = () => cruza(`v${i + 1},${j}`, [i + 1, j], b, [i + 1, j + 1], c);
      const norte = () => cruza(`h${i},${j + 1}`, [i, j + 1], d, [i + 1, j + 1], c);
      const oeste = () => cruza(`v${i},${j}`, [i, j], a, [i, j + 1], d);
      switch (caso) {
        case 1: case 14: ligar(oeste(), sul()); break;
        case 2: case 13: ligar(sul(), leste()); break;
        case 3: case 12: ligar(oeste(), leste()); break;
        case 4: case 11: ligar(leste(), norte()); break;
        case 6: case 9: ligar(sul(), norte()); break;
        case 7: case 8: ligar(oeste(), norte()); break;
        case 5: case 10: {
          // sela: decide pelo valor médio no centro da célula
          const centroAcima = (a + b + c + d) / 4 >= nivel;
          if ((caso === 5) === centroAcima) {
            ligar(oeste(), norte());
            ligar(sul(), leste());
          } else {
            ligar(oeste(), sul());
            ligar(leste(), norte());
          }
          break;
        }
      }
    }
  }

  // percorre as ligações formando polilinhas: começa pelas pontas (grau 1), depois os ciclos
  const visitado = new Set<string>();
  const linhas: P[][] = [];
  const percorrer = (inicio: string) => {
    const linha: P[] = [ponto.get(inicio)!];
    visitado.add(inicio);
    let atual = inicio;
    for (;;) {
      const prox = (ligacoes.get(atual) ?? []).find((x) => !visitado.has(x));
      if (!prox) {
        // fecha o ciclo se voltou ao começo
        if (linha.length > 2 && (ligacoes.get(atual) ?? []).includes(inicio)) linha.push(linha[0]);
        break;
      }
      visitado.add(prox);
      linha.push(ponto.get(prox)!);
      atual = prox;
    }
    if (linha.length >= 2) linhas.push(linha);
  };
  for (const [k, vs] of ligacoes) if (vs.length === 1 && !visitado.has(k)) percorrer(k);
  for (const k of ligacoes.keys()) if (!visitado.has(k)) percorrer(k);
  return linhas;
}
