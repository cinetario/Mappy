// Monta o modelo final a partir da grade de elevação e da forma escolhida:
// bloco de terreno → recorte no contorno → divisão em peças (base, terreno/faixas).
import { alinharZ, type GradeCamadas } from './camadas-impressao.ts';
import { gerarCamadas, type DadosCamadas, type EstatisticasCamadas, type OpcoesCamadas, type ResultadoCamadas } from './camadas.ts';
import type { GradeElevacao } from './elevacao.ts';
import { lerFaixas, type Parametros } from './estado.ts';
import { areaAssinada, caixaDaForma, contornoLonLat, criarProjecao, deslocar, dimensoesMetros, type Forma, type Retangulo } from './geo.ts';
import { LARGURA_MINIMA_MM } from './limites.ts';
import { caixaLimite, separarVerticesCoincidentes, type Malha } from './malha.ts';
import { solidoParaMalha, malhaParaSolido, type Solido, type Wasm } from './manifold.ts';
import { alturasDaGrade, gerarBlocoTerreno, menorAltitude } from './terreno.ts';
import { lerTiposDesligados } from './vias.ts';
import { coberturaPadrao, lerCobertura, type ConfigCobertura } from './cobertura.ts';
import { intervaloAutomatico, niveis, tracarCurvas } from './curvas.ts';

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
  camadas: { avisos: string[]; estatisticas: EstatisticasCamadas; linhasPrevia: Float32Array[] } | null;
  curvas: InfoCurvas | null;
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

export type ParametrosModelo = Parametros;

function opcoesCamadas(p: Parametros, mm: (v: number) => number, real: boolean, camadas: GradeCamadas): OpcoesCamadas {
  return {
    real,
    mm,
    camadas,
    larguraMinima: real ? 0 : LARGURA_MINIMA_MM,
    predios: {
      exagero: p.prediosExagero,
      aleatorio: p.prediosAleatorio,
      integracao: p.prediosIntegracao,
      profundidade: mm(p.prediosProfundidadeMm),
      deslocamento: mm(p.prediosDeslocamentoMm),
      cor: p.prediosCor,
    },
    ruas: {
      modo: p.ruasModo,
      altura: mm(p.ruasAlturaMm),
      integracao: p.ruasIntegracao,
      profundidade: mm(p.ruasProfundidadeMm),
      deslocamento: mm(p.ruasDeslocamentoMm),
      cor: p.ruasCor,
      escalaLargura: p.ruasEscalaLargura,
      desligados: lerTiposDesligados(p.ruasTiposDesligados) ?? [],
    },
    agua: {
      modo: p.aguaModo,
      altura: mm(p.aguaAlturaMm),
      integracao: p.aguaIntegracao,
      profundidade: mm(p.aguaProfundidadeMm),
      cor: p.aguaCor,
      rios: p.aguaRios,
      ocultarPequenos: p.aguaOcultarPequenos,
      larguraMin: mm(p.aguaLarguraMinMm),
      areaMin: mm(1) ** 2 * p.aguaAreaMinMm2,
    },
    cobertura: {
      ligada: p.cobertura,
      modo: p.coberturaModo,
      deslocamento: mm(p.coberturaDeslocamentoMm),
      categorias: Object.fromEntries(Object.entries(lerCobertura(p.coberturaCategorias) ?? coberturaPadrao())
        .map(([t, c]) => [t, { ...c, alturaMm: mm(c.alturaMm) }])) as ConfigCobertura,
      areaMin: mm(1) ** 2 * p.coberturaAreaMinMm2,
    },
    arvores: {
      ligada: p.arvores,
      estilo: p.arvoresEstilo,
      usarMapeadas: p.arvoresOsm,
      encherFlorestas: p.arvoresFlorestas,
      // árvores por cm² do modelo impresso → por unidade² do modelo
      densidade: p.arvoresDensidade / mm(10) ** 2,
      altura: mm(p.arvoresAlturaMm),
      distancia: mm(p.arvoresDistanciaMm),
      cor: p.arvoresCor,
      maximo: p.arvoresMaximo,
    },
    curvas: {
      imprimir: p.curvasImprimir,
      altura: mm(p.curvasAlturaMm),
      largura: mm(p.curvasLarguraMm),
      cor: p.curvasCor,
    },
  };
}

export interface InfoCurvas {
  intervaloM: number;
  niveis: number;
  minM: number;
  maxM: number;
}

/** Curvas de nível da grade, em coordenadas do modelo. */
function calcularCurvas(grade: GradeElevacao, p: Parametros, porMetro: number, minM: number, maxM: number): { linhas: [number, number][][]; info: InfoCurvas } {
  const intervalo = p.curvasIntervaloM > 0 ? p.curvasIntervaloM : intervaloAutomatico(minM, maxM);
  const lista = niveis(minM, maxM, intervalo);
  const valores = p.achatarMar ? grade.elev.map((e) => Math.max(0, e)) : grade.elev;
  const W = grade.larguraM * porMetro;
  const H = grade.alturaM * porMetro;
  const linhas: [number, number][][] = [];
  // proteção: no máximo 80 níveis (intervalo pequeno demais numa área montanhosa)
  for (const nivel of lista.slice(0, 80)) {
    for (const l of tracarCurvas(valores, grade.nx, grade.ny, nivel)) {
      linhas.push(l.map(([i, j]) => [(i / (grade.nx - 1) - 0.5) * W, (j / (grade.ny - 1) - 0.5) * H]));
    }
  }
  return { linhas, info: { intervaloM: intervalo, niveis: Math.min(lista.length, 80), minM, maxM } };
}

function bilinear(v: Float32Array, nx: number, ny: number, fx: number, fy: number): number {
  const cx = Math.min(nx - 1, Math.max(0, fx));
  const cy = Math.min(ny - 1, Math.max(0, fy));
  const x0 = Math.min(nx - 2, Math.floor(cx));
  const y0 = Math.min(ny - 2, Math.floor(cy));
  const ax = cx - x0;
  const ay = cy - y0;
  const i = y0 * nx + x0;
  return (v[i] * (1 - ax) + v[i + 1] * ax) * (1 - ay) + (v[i + nx] * (1 - ax) + v[i + nx + 1] * ax) * ay;
}

export function gerarModelo(wasm: Wasm, grade: GradeElevacao, forma: Forma, p: ParametrosModelo, dados?: DadosCamadas | null): ResultadoModelo {
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

  const objetos = new Set<{ delete(): void }>();
  const guardar = <T extends { delete(): void }>(o: T) => (objetos.add(o), o);
  // Limpeza antes de exportar: junta vértices a menos de 0,001 mm (o STL guarda
  // float32 e solda vértices pela posição; vértices quase iguais virariam
  // triângulos degenerados) e remove triângulos colineares das booleanas.
  const tolerancia = real ? 1e-3 / mmPorMetroImpressao : 1e-3;
  const limpa = (s: Solido) => {
    const m = solidoParaMalha(guardar(s.simplify(tolerancia)));
    separarVerticesCoincidentes(m, tolerancia / 10);
    return m;
  };
  try {
    const solidoBloco = guardar(malhaParaSolido(wasm, bloco));
    const secao = guardar(new wasm.CrossSection([contorno], 'NonZero'));
    const prisma = guardar(guardar(secao.extrude(bloco.alturaMax + 2)).translate(0, 0, -1));
    let recortado = guardar(solidoBloco.intersect(prisma));
    const status = recortado.status();
    if (status !== 'NoError') throw new Error(`Falha no recorte do contorno: ${status}`);
    if (recortado.isEmpty()) throw new Error('O recorte do contorno ficou vazio');

    const { min, max } = caixaLimite(solidoParaMalha(recortado));
    const zTopoTerreno = max[2];

    // ---- curvas de nível (da própria grade de elevação) ----
    let infoCurvas: InfoCurvas | null = null;
    if (p.curvas) {
      const c = calcularCurvas(grade, p, porMetro, altitudeMin, altitudeMax);
      infoCurvas = c.info;
      dados = { predios: null, vias: null, agua: null, ...dados, curvas: c.linhas };
    }

    // ---- camadas do mapa (prédios, ruas, água, árvores, curvas, cobertura) ----
    let camadasGeradas: ResultadoCamadas | null = null;
    if (dados && (dados.predios || dados.vias || dados.agua || dados.cobertura || dados.arvores || dados.curvas)) {
      const proj = criarProjecao(caixa);
      const alturas = alturasDaGrade(grade, { porMetroVertical: porMetro * exagero, zBase, altitudeMinima, achatarMar: p.achatarMar });
      const W = grade.larguraM * porMetro;
      const H = grade.alturaM * porMetro;
      const mm = (v: number) => (real ? v / mmPorMetroImpressao : v);
      camadasGeradas = gerarCamadas({
        wasm,
        projetar: (ll) => {
          const [x, y] = proj.paraMetros(ll);
          return [x * porMetro, y * porMetro];
        },
        contorno,
        bloco,
        alturaEm: (x, y) => bilinear(alturas, grade.nx, grade.ny, (x / W + 0.5) * (grade.nx - 1), (y / H + 0.5) * (grade.ny - 1)),
        zTopo: zTopoTerreno,
        zBase,
        porMetro,
        caixaGrade: { x0: -W / 2, y0: -H / 2, x1: W / 2, y1: H / 2 },
        gradeTodaNoMar: grade.elev.every((e) => e <= 0),
      }, dados, opcoesCamadas(p, mm, real, camadas));
      for (const pc of camadasGeradas.pecas) guardar(pc.solido);
      for (const c of camadasGeradas.cortes) guardar(c);
      if (camadasGeradas.cortes.length) {
        const uniaoCortes = guardar(wasm.Manifold.union(camadasGeradas.cortes));
        recortado = guardar(recortado.subtract(uniaoCortes));
      }
    }
    const zTopo = zTopoTerreno;

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
    const solidosPartes: Solido[] = [];
    for (const c of cortes) {
      let peca: Solido = recortado;
      if (Number.isFinite(c.zMin)) peca = guardar(peca.trimByPlane([0, 0, 1], c.zMin));
      if (Number.isFinite(c.zMax)) peca = guardar(peca.trimByPlane([0, 0, -1], -c.zMax));
      if (peca.isEmpty() || peca.volume() < 1e-9) continue;
      solidosPartes.push(peca);
      partes.push({
        id: c.id, nome: c.nome, cor: c.cor, malha: limpa(peca),
        zMin: Math.max(0, c.zMin), zMax: Math.min(zTopo, c.zMax),
      });
    }
    for (const pc of camadasGeradas?.pecas ?? []) {
      if (pc.solido.isEmpty()) continue;
      solidosPartes.push(pc.solido);
      const b = pc.solido.boundingBox();
      partes.push({ id: pc.id, nome: pc.nome, cor: pc.cor, malha: limpa(pc.solido), zMin: b.min[2], zMax: b.max[2] });
    }

    // STL único: todas as peças fundidas num só sólido. As camadas só ENCOSTAM
    // no terreno (face com face, inclusive nas paredes dos sulcos). O STL não
    // guarda topologia: quem abre o arquivo junta vértices na mesma posição, e
    // faces encostadas viram arestas com 4 triângulos. Por isso as camadas são
    // deslocadas 0,001 mm numa direção oblíqua: cada contato vira sobreposição
    // (fundida pela união) ou uma folga ínfima (sem vértices em comum).
    const d = tolerancia;
    const paraUniao = solidosPartes.map((s, i) =>
      (!ehTerreno(partes[i].id) ? guardar(s.translate(0.37 * d, 0.61 * d, -d)) : s));
    const unico = paraUniao.length === 1 ? paraUniao[0] : guardar(wasm.Manifold.union(paraUniao));
    const malhaUnica = limpa(unico);
    const caixaFinal = caixaLimite(malhaUnica);

    return {
      partes,
      malhaUnica,
      camadas: camadasGeradas ? { avisos: camadasGeradas.avisos, estatisticas: camadasGeradas.estatisticas, linhasPrevia: camadasGeradas.linhasPrevia } : null,
      curvas: infoCurvas,
      unidade: real ? 'm' : 'mm',
      largura: max[0] - min[0],
      profundidade: max[1] - min[1],
      alturaMax: caixaFinal.max[2],
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

const ehTerreno = (id: string) => id === 'base' || id === 'terreno' || id.startsWith('faixa-');

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
