// Monta o modelo final a partir da grade de elevação e da forma escolhida:
// bloco de terreno → recorte no contorno → divisão em peças (base, terreno/faixas).
import { alinharZ, type GradeCamadas } from './camadas-impressao.ts';
import type { GradeElevacao } from './elevacao.ts';
import { lerFaixas, type Parametros } from './estado.ts';
import { areaAssinada, caixaDaForma, contornoLonLat, criarProjecao, deslocar, dimensoesMetros, type Forma, type Retangulo } from './geo.ts';
import { caixaLimite, type Malha } from './malha.ts';
import { solidoParaMalha, malhaParaSolido, type Solido, type Wasm } from './manifold.ts';
import { gerarBlocoTerreno, menorAltitude } from './terreno.ts';

export interface PlanoAmostragem {
  /** caixa do contorno escolhido */
  caixa: Retangulo;
  /** caixa da grade de elevação: um pouco maior, para o recorte cair dentro dela */
  caixaGrade: Retangulo;
  /** pontos no lado maior da grade */
  amostras: number;
}

/** Decide a área e a resolução da grade de elevação para uma forma. */
export function planejarAmostragem(forma: Forma, resolucao: number): PlanoAmostragem {
  const caixa = caixaDaForma(forma);
  const { largura, altura } = dimensoesMetros(caixa);
  const lado = Math.max(largura, altura);
  const espacamento = lado / (resolucao - 1);
  const margem = espacamento * 1.5;
  const centro: [number, number] = [(caixa.oeste + caixa.leste) / 2, (caixa.sul + caixa.norte) / 2];
  const [lonM, latM] = deslocar(centro, largura / 2 + margem, altura / 2 + margem);
  const caixaGrade = {
    oeste: 2 * centro[0] - lonM,
    leste: lonM,
    sul: 2 * centro[1] - latM,
    norte: latM,
  };
  return { caixa, caixaGrade, amostras: Math.round((lado + 2 * margem) / espacamento) + 1 };
}

/** Contorno da forma em unidades do modelo, centrado na origem e em sentido anti-horário. */
export function contornoDoModelo(forma: Forma, porMetro: number): [number, number][] {
  const proj = criarProjecao(caixaDaForma(forma));
  const pts = contornoLonLat(forma).map((p) => {
    const [x, y] = proj.paraMetros(p);
    return [x * porMetro, y * porMetro] as [number, number];
  });
  if (areaAssinada(pts) < 0) pts.reverse();
  return pts;
}

export interface Parte {
  /** identificador estável (base, terreno, faixa-1…) */
  id: string;
  nome: string;
  cor: string;
  malha: Malha;
  /** faixa de altura da peça (z mínimo e máximo do corte) */
  zMin: number;
  zMax: number;
}

export interface ResultadoModelo {
  partes: Parte[];
  /** todas as peças fundidas (para o STL único) */
  malhaUnica: Malha;
  unidade: 'mm' | 'm';
  largura: number;
  profundidade: number;
  alturaMax: number;
  /** unidades do modelo por metro real (horizontal) */
  porMetro: number;
  /** escala 1:N da impressão (N metros reais por metro do modelo) */
  escala: number;
  exageroEfetivo: number;
  zBase: number;
  /** altitudes reais dentro do contorno, em metros */
  altitudeMin: number;
  altitudeMax: number;
  triangulosGrade: number;
  triangulosSuperficie: number;
  contorno: [number, number][];
}

export type ParametrosModelo = Pick<Parametros,
  'modo' | 'tamanhoMm' | 'travarAltura' | 'alturaTotalMm' | 'exagero' | 'simplificacaoMm' | 'achatarMar' |
  'estilo' | 'corTerreno' | 'faixas' | 'baseMm' | 'corLaterais' | 'alturaCamadaMm' | 'primeiraCamadaMm'>;

export function gerarModelo(wasm: Wasm, grade: GradeElevacao, forma: Forma, p: ParametrosModelo): ResultadoModelo {
  const caixa = caixaDaForma(forma);
  const { largura, altura } = dimensoesMetros(caixa);
  if (!(largura > 0 && altura > 0)) throw new Error('A área escolhida está vazia');
  const real = p.modo === 'real';
  const mmPorMetroImpressao = p.tamanhoMm / Math.max(largura, altura);
  const porMetro = real ? 1 : mmPorMetroImpressao;
  const camadas: GradeCamadas = { h: p.alturaCamadaMm, h1: p.primeiraCamadaMm };

  const contorno = contornoDoModelo(forma, porMetro);
  if (contorno.length < 3 || Math.abs(areaAssinada(contorno)) < 1e-6 * porMetro ** 2 * largura * altura) {
    throw new Error('O contorno precisa de pelo menos 3 pontos e área maior que zero');
  }

  // altitudes: a mínima da grade toda (garante a base) e a faixa dentro do contorno
  const altitudeMinima = menorAltitude(grade, p.achatarMar);
  const { min: altitudeMin, max: altitudeMax } = altitudesDentro(grade, contorno, porMetro, p.achatarMar);

  // base: no modo de impressão, o topo da base cai exatamente numa camada
  const zBase = real ? p.baseMm : alinharZ(p.baseMm, camadas);

  // exagero: fixo, ou calculado para o modelo ter a altura total pedida
  let exagero = p.exagero;
  if (!real && p.travarAltura) {
    const relevoM = altitudeMax - altitudeMinima;
    exagero = relevoM > 0 ? Math.max(0.01, (p.alturaTotalMm - zBase) / (relevoM * porMetro)) : 1;
  }

  const bloco = gerarBlocoTerreno(grade, {
    porMetro,
    porMetroVertical: porMetro * exagero,
    zBase,
    altitudeMinima,
    achatarMar: p.achatarMar,
    // mesma tolerância em metros reais nos dois modos
    erroMax: real ? p.simplificacaoMm / mmPorMetroImpressao : p.simplificacaoMm,
  });
  const triangulosSuperficie = bloco.indices.length / 3;

  const objetos: { delete(): void }[] = [];
  const guardar = <T extends { delete(): void }>(o: T) => (objetos.push(o), o);
  try {
    const solidoBloco = guardar(malhaParaSolido(wasm, bloco));
    const secao = guardar(new wasm.CrossSection([contorno], 'NonZero'));
    const prisma = guardar(guardar(secao.extrude(bloco.alturaMax + 2)).translate(0, 0, -1));
    const recortado = guardar(solidoBloco.intersect(prisma));
    const status = recortado.status();
    if (status !== 'NoError') throw new Error(`Falha no recorte do contorno: ${status}`);
    if (recortado.isEmpty()) throw new Error('O recorte do contorno ficou vazio');

    const malhaUnica = solidoParaMalha(recortado);
    const { min, max } = caixaLimite(malhaUnica);
    const zTopo = max[2];

    // ---- cortes horizontais que definem as peças ----
    const cortes: { id: string; nome: string; cor: string; zMin: number; zMax: number }[] = [
      { id: 'base', nome: 'Base', cor: p.corLaterais, zMin: -Infinity, zMax: zBase },
    ];
    const faixas = p.estilo === 'faixas' ? lerFaixas(p.faixas) : null;
    if (faixas && faixas.length > 1) {
      let zAnterior = zBase;
      faixas.forEach((f, k) => {
        const ultima = k === faixas.length - 1;
        let zLimite = ultima ? Infinity : zBase + (f.ate / 100) * (zTopo - zBase);
        if (!ultima && !real) zLimite = alinharZ(zLimite, camadas);
        if (!ultima && (zLimite <= zAnterior || zLimite >= zTopo)) return; // faixa sem espessura
        cortes.push({ id: `faixa-${k + 1}`, nome: `Terreno – faixa ${k + 1} (até ${f.ate}%)`, cor: f.cor, zMin: zAnterior, zMax: zLimite });
        zAnterior = zLimite;
      });
    } else {
      cortes.push({ id: 'terreno', nome: 'Terreno', cor: faixas?.[0].cor ?? p.corTerreno, zMin: zBase, zMax: Infinity });
    }

    const partes: Parte[] = [];
    for (const c of cortes) {
      let peca: Solido = recortado;
      if (Number.isFinite(c.zMin)) peca = guardar(peca.trimByPlane([0, 0, 1], c.zMin));
      if (Number.isFinite(c.zMax)) peca = guardar(peca.trimByPlane([0, 0, -1], -c.zMax));
      if (peca.isEmpty() || peca.volume() < 1e-9) continue;
      partes.push({
        id: c.id, nome: c.nome, cor: c.cor, malha: solidoParaMalha(peca),
        zMin: Math.max(0, c.zMin), zMax: Math.min(zTopo, c.zMax),
      });
    }

    return {
      partes,
      malhaUnica,
      unidade: real ? 'm' : 'mm',
      largura: max[0] - min[0],
      profundidade: max[1] - min[1],
      alturaMax: zTopo,
      porMetro,
      escala: real ? 1 : 1000 / porMetro,
      exageroEfetivo: exagero,
      zBase,
      altitudeMin,
      altitudeMax,
      triangulosGrade: bloco.triangulosGrade,
      triangulosSuperficie,
      contorno,
    };
  } finally {
    for (const o of objetos) o.delete();
  }
}

/** Menor e maior altitude dos pontos da grade que caem dentro do contorno. */
function altitudesDentro(grade: GradeElevacao, contorno: [number, number][], porMetro: number, achatarMar: boolean) {
  const { nx, ny } = grade;
  const W = grade.larguraM * porMetro;
  const H = grade.alturaM * porMetro;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < ny; j++) {
    const y = (j / (ny - 1) - 0.5) * H;
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1) - 0.5) * W;
      if (!dentroDoPoligono(x, y, contorno)) continue;
      const e = achatarMar ? Math.max(0, grade.elev[j * nx + i]) : grade.elev[j * nx + i];
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
  }
  if (min === Infinity) {
    // contorno menor que uma célula da grade: usa a grade toda
    for (const e0 of grade.elev) {
      const e = achatarMar ? Math.max(0, e0) : e0;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
  }
  return { min, max };
}

export function dentroDoPoligono(x: number, y: number, pts: readonly [number, number][]): boolean {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
