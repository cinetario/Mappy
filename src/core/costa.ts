// Mar a partir das linhas de costa do OSM (natural=coastline).
// Convenção do OSM: a terra fica à ESQUERDA do sentido da linha.
// Recortamos as linhas na caixa do modelo e fechamos os pedaços seguindo a
// borda da caixa no sentido anti-horário: o resultado são os polígonos de TERRA.
// O mar é a caixa menos a terra (feito com booleanas 2D por quem chama).

export type P = [number, number];
export interface Caixa2D { x0: number; y0: number; x1: number; y1: number }

export interface ResultadoCosta {
  /** anéis de terra, anti-horários */
  terra: P[][];
  /** anéis de mar cercados de terra (costa fechada no sentido horário) */
  lagosDeMar: P[][];
  /**
   * 'terra-recortada': o mar é a caixa menos `terra`;
   * 'sem-costa': nenhuma costa cruza a caixa nem há ilhas (sem mar, a não ser `lagosDeMar`);
   * 'ilhas': só ilhas inteiras dentro da caixa, o resto é mar.
   */
  situacao: 'terra-recortada' | 'sem-costa' | 'ilhas';
  /** pedaços de costa que terminam dentro da caixa (dados incompletos) foram ignorados */
  incompleta: boolean;
}

/** Parâmetro ao longo da borda, anti-horário a partir do canto (x0, y0). */
function perimetro(p: P, c: Caixa2D): number {
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  const dS = Math.abs(p[1] - c.y0);
  const dL = Math.abs(p[0] - c.x1);
  const dN = Math.abs(p[1] - c.y1);
  const dO = Math.abs(p[0] - c.x0);
  const m = Math.min(dS, dL, dN, dO);
  if (m === dS) return p[0] - c.x0; // sul
  if (m === dL) return w + (p[1] - c.y0); // leste
  if (m === dN) return w + h + (c.x1 - p[0]); // norte
  return 2 * w + h + (c.y1 - p[1]); // oeste
}

function cantos(c: Caixa2D): { t: number; p: P }[] {
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  return [
    { t: 0, p: [c.x0, c.y0] },
    { t: w, p: [c.x1, c.y0] },
    { t: w + h, p: [c.x1, c.y1] },
    { t: 2 * w + h, p: [c.x0, c.y1] },
  ];
}

const dentroCaixa = (p: P, c: Caixa2D) => p[0] > c.x0 && p[0] < c.x1 && p[1] > c.y0 && p[1] < c.y1;

/** Recorte de um segmento na caixa (Liang–Barsky); devolve [t0, t1] ou null. */
function recortarSegmento(a: P, b: P, c: Caixa2D): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const testes: [number, number][] = [[-dx, a[0] - c.x0], [dx, c.x1 - a[0]], [-dy, a[1] - c.y0], [dy, c.y1 - a[1]]];
  for (const [p, q] of testes) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 > t0 ? [t0, t1] : null;
}

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

interface Pedaco {
  pts: P[];
  /** começa e termina na borda */
  completo: boolean;
}

/** Divide uma cadeia em pedaços dentro da caixa. */
function recortarCadeia(cadeia: P[], c: Caixa2D): Pedaco[] {
  const pedacos: Pedaco[] = [];
  let atual: P[] | null = null;
  let comecouNaBorda = false;
  for (let k = 0; k < cadeia.length - 1; k++) {
    const a = cadeia[k];
    const b = cadeia[k + 1];
    const r = recortarSegmento(a, b, c);
    if (!r) continue;
    const [t0, t1] = r;
    if (!atual) {
      atual = [t0 > 0 ? lerp(a, b, t0) : a];
      comecouNaBorda = t0 > 0;
    }
    if (t1 < 1) {
      atual.push(lerp(a, b, t1));
      pedacos.push({ pts: atual, completo: comecouNaBorda });
      atual = null;
    } else {
      atual.push(b);
    }
  }
  if (atual) pedacos.push({ pts: atual, completo: false });
  return pedacos;
}

export function areaAssinada2D(pts: P[]): number {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x1, y1] = pts[k];
    const [x2, y2] = pts[(k + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function montarTerra(cadeias: P[][], c: Caixa2D): ResultadoCosta {
  const terra: P[][] = [];
  const lagosDeMar: P[][] = [];
  const pedacos: Pedaco[] = [];
  let incompleta = false;
  let ilhas = 0;

  for (const cadeia of cadeias) {
    if (cadeia.length < 2) continue;
    const ini = cadeia[0];
    const fim = cadeia[cadeia.length - 1];
    const fechada = ini[0] === fim[0] && ini[1] === fim[1];
    if (fechada && cadeia.every((p) => dentroCaixa(p, c))) {
      const anel = cadeia.slice(0, -1);
      if (areaAssinada2D(anel) > 0) {
        terra.push(anel); // ilha inteira dentro da caixa
        ilhas++;
      } else {
        lagosDeMar.push(anel.reverse());
      }
      continue;
    }
    for (const p of recortarCadeia(cadeia, c)) {
      if (p.completo) pedacos.push(p);
      else incompleta = true;
    }
  }

  if (pedacos.length === 0) {
    return { terra, lagosDeMar, situacao: ilhas > 0 ? 'ilhas' : 'sem-costa', incompleta };
  }

  // fecha os pedaços seguindo a borda no sentido anti-horário
  const total = 2 * (c.x1 - c.x0 + c.y1 - c.y0);
  const entrada = pedacos.map((p) => perimetro(p.pts[0], c));
  const saida = pedacos.map((p) => perimetro(p.pts[p.pts.length - 1], c));
  const usados = new Set<number>();
  for (let inicio = 0; inicio < pedacos.length; inicio++) {
    if (usados.has(inicio)) continue;
    const anel: P[] = [];
    let k = inicio;
    for (let guarda = 0; guarda <= pedacos.length; guarda++) {
      usados.add(k);
      anel.push(...pedacos[k].pts);
      // próxima entrada no sentido anti-horário a partir desta saída
      let proximo = -1;
      let dProximo = Infinity;
      for (let i = 0; i < pedacos.length; i++) {
        if (usados.has(i) && i !== inicio) continue;
        let d = (entrada[i] - saida[k] + total) % total;
        if (d === 0 && i === k) d = total; // o próprio pedaço só se der a volta inteira
        if (d < dProximo) {
          dProximo = d;
          proximo = i;
        }
      }
      // cantos da caixa no caminho, em ordem de percurso
      const noCaminho = cantos(c)
        .map((cn) => ({ ...cn, d: (cn.t - saida[k] + total) % total }))
        .filter((cn) => cn.d > 0 && cn.d < dProximo)
        .sort((a, b) => a.d - b.d);
      for (const cn of noCaminho) anel.push(cn.p);
      if (proximo === inicio || proximo < 0) break;
      k = proximo;
    }
    if (anel.length >= 3 && Math.abs(areaAssinada2D(anel)) > 0) terra.push(anel);
  }
  return { terra, lagosDeMar, situacao: 'terra-recortada', incompleta };
}
