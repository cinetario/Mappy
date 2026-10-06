// Monta o modelo final: bloco de terreno recortado no formato da área escolhida.
import type { GradeElevacao } from './elevacao.ts';
import { areaAssinada, caixaDaForma, contornoLonLat, criarProjecao, deslocar, dimensoesMetros, type Forma, type Retangulo } from './geo.ts';
import { caixaLimite, type Malha } from './malha.ts';
import { malhaParaSolido, solidoParaMalha, type Wasm } from './manifold.ts';
import { gerarTerreno, type ParametrosTerreno } from './terreno.ts';

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

export interface ResultadoModelo {
  malha: Malha;
  larguraMm: number;
  profundidadeMm: number;
  alturaMaxMm: number;
  mmPorMetro: number;
  /** contorno do modelo em mm (anti-horário), útil para camadas futuras */
  contornoMm: [number, number][];
}

/** Contorno da forma em milímetros, centrado na origem e em sentido anti-horário. */
export function contornoEmMm(forma: Forma, mmPorMetro: number): [number, number][] {
  const proj = criarProjecao(caixaDaForma(forma));
  const pts = contornoLonLat(forma).map((p) => {
    const [x, y] = proj.paraMetros(p);
    return [x * mmPorMetro, y * mmPorMetro] as [number, number];
  });
  if (areaAssinada(pts) < 0) pts.reverse();
  return pts;
}

export function gerarModelo(wasm: Wasm, grade: GradeElevacao, forma: Forma, p: ParametrosTerreno): ResultadoModelo {
  const caixa = caixaDaForma(forma);
  const { largura, altura } = dimensoesMetros(caixa);
  if (!(largura > 0 && altura > 0)) throw new Error('A área escolhida está vazia');
  const mmPorMetro = p.tamanhoMm / Math.max(largura, altura);

  const bloco = gerarTerreno(grade, p, mmPorMetro);
  const contorno = contornoEmMm(forma, mmPorMetro);
  if (contorno.length < 3 || Math.abs(areaAssinada(contorno)) < 1) {
    throw new Error('O contorno precisa de pelo menos 3 pontos e área maior que 1 mm²');
  }

  const solidoBloco = malhaParaSolido(wasm, bloco);
  const secao = new wasm.CrossSection([contorno], 'NonZero');
  const prisma = secao.extrude(bloco.alturaMaxMm + 2).translate(0, 0, -1);
  const recortado = solidoBloco.intersect(prisma);
  try {
    const status = recortado.status();
    if (status !== 'NoError') throw new Error(`Falha no recorte do contorno: ${status}`);
    if (recortado.isEmpty()) throw new Error('O recorte do contorno ficou vazio');
    const malha = solidoParaMalha(recortado);
    const { min, max } = caixaLimite(malha);
    return {
      malha,
      larguraMm: max[0] - min[0],
      profundidadeMm: max[1] - min[1],
      alturaMaxMm: max[2],
      mmPorMetro,
      contornoMm: contorno,
    };
  } finally {
    for (const o of [solidoBloco, secao, prisma, recortado]) o.delete();
  }
}
