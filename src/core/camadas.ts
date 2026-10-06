// Geometria das camadas do mapa (prédios, ruas, água) sobre o terreno.
//
// Ideia central: S(k) é o bloco de terreno com a superfície deslocada k para
// cima (k < 0: para baixo). Uma feição que ocupa, acima do terreno, a faixa
// [a, b] é  prisma(feição) ∩ S(b) − S(a). Assim ela acompanha exatamente a
// superfície, sem frestas e sem invadir o terreno.
import { alinharEspessura, alinharZ, type GradeCamadas } from './camadas-impressao.ts';
import { aleatorio } from './aleatorio.ts';
import { montarTerra, type Caixa2D, type P } from './costa.ts';
import type { LonLat } from './geo.ts';
import type { Malha } from './malha.ts';
import { malhaParaSolido, type Solido, type Wasm } from './manifold.ts';
import { larguraRioM, type AreaCobertura, type DadosAgua, type DadosArvores, type LinhaOSM, type Predio, type Via } from './osm.ts';
import { TIPOS_VIA, type TipoVia } from './vias.ts';
import { LISTA_COBERTURA, TIPOS_COBERTURA, type TipoCobertura } from './categorias-osm.ts';
import type { ConfigCobertura } from './cobertura.ts';
import { posicionarArvores, type EstiloArvore } from './arvores.ts';
import { rasterizar } from './raster.ts';

type Secao = InstanceType<Wasm['CrossSection']>;

export interface DadosCamadas {
  predios: Predio[] | null;
  vias: Via[] | null;
  agua: DadosAgua | null;
  /** áreas de cobertura do solo (também usadas para encher florestas de árvores) */
  cobertura?: AreaCobertura[] | null;
  arvores?: DadosArvores | null;
  /** curvas de nível já em coordenadas do modelo */
  curvas?: P[][] | null;
}

export interface OpcoesCamadas {
  real: boolean;
  /** converte um valor em mm de impressão para unidades do modelo */
  mm: (v: number) => number;
  camadas: GradeCamadas;
  /** largura mínima imprimível (unidades do modelo); 0 no modo 1:1 */
  larguraMinima: number;
  predios: {
    exagero: number; aleatorio: number; integracao: 'elevado' | 'rebaixado';
    profundidade: number; deslocamento: number; cor: string;
  };
  ruas: {
    modo: 'superficie' | 'extrudada'; altura: number; integracao: 'elevada' | 'rebaixada';
    profundidade: number; deslocamento: number; cor: string; escalaLargura: number; desligados: TipoVia[];
  };
  agua: {
    modo: 'superficie' | 'extrudada'; altura: number; integracao: 'elevada' | 'rebaixada';
    profundidade: number; cor: string; rios: boolean; ocultarPequenos: boolean; larguraMin: number; areaMin: number;
  };
  cobertura?: {
    ligada: boolean; modo: 'superficie' | 'extrudada'; deslocamento: number;
    /** altura já em unidades do modelo */
    categorias: ConfigCobertura; areaMin: number;
  };
  arvores?: {
    ligada: boolean; estilo: EstiloArvore; usarMapeadas: boolean; encherFlorestas: boolean;
    /** árvores por unidade² do modelo */
    densidade: number; altura: number; distancia: number; cor: string; maximo: number;
  };
  curvas?: { imprimir: boolean; altura: number; largura: number; cor: string };
}

export interface ContextoTerreno {
  wasm: Wasm;
  /** lon/lat → coordenadas do modelo */
  projetar: (p: LonLat) => P;
  contorno: P[];
  /** bloco de terreno (malha) antes do recorte */
  bloco: Malha;
  /** altura da superfície do terreno num ponto do modelo */
  alturaEm: (x: number, y: number) => number;
  zTopo: number;
  zBase: number;
  /** unidades do modelo por metro real (horizontal) */
  porMetro: number;
  /** caixa da grade no modelo (para o mar) */
  caixaGrade: Caixa2D;
  /** toda a grade está no nível do mar (oceano aberto, sem costa) */
  gradeTodaNoMar: boolean;
}

export interface PecaCamada {
  /** predios, ruas, agua, arvores, curvas ou cobertura-<tipo> */
  id: string;
  nome: string;
  cor: string;
  solido: Solido;
}

export interface EstatisticasCamadas {
  predios?: { quantidade: number; menorMm: number; maiorMm: number; menorM: number; maiorM: number; semAltura: number };
  ruas?: { quantidade: number; porTipo: Partial<Record<TipoVia, number>> };
  agua?: { poligonos: number; rios: number; temMar: boolean; removidosPequenos: number; planos: number };
  cobertura?: { areas: number; porTipo: Partial<Record<TipoCobertura, number>>; removidasPequenas: number };
  arvores?: { quantidade: number; mapeadas: number; removidasPorDistancia: number; cortadasPeloMaximo: number; alturaMm: number; copaMm: number };
  curvas?: { linhas: number };
}

export interface ResultadoCamadas {
  pecas: PecaCamada[];
  /** sólidos a subtrair do terreno (sulcos, lagos aplainados) */
  cortes: Solido[];
  avisos: string[];
  estatisticas: EstatisticasCamadas;
  /** curvas de nível só para a visualização (x, y, z, x, y, z, …), quando não vão para a impressão */
  linhasPrevia: Float32Array[];
}

export const MARGEM_FUNDO = 0.2;

export function gerarCamadas(ctx: ContextoTerreno, dados: DadosCamadas, op: OpcoesCamadas): ResultadoCamadas {
  const { wasm } = ctx;
  const lixo: { delete(): void }[] = [];
  const g = <T extends { delete(): void }>(o: T): T => (lixo.push(o), o);
  const avisos: string[] = [];
  const estatisticas: EstatisticasCamadas = {};
  const margem = op.mm(MARGEM_FUNDO);
  let furouBase = false;

  // ---- superfícies deslocadas S(k), reaproveitadas entre camadas ----
  const superficies = new Map<number, Solido>();
  const S = (k: number): Solido => {
    const chave = Math.round(k * 1e6) / 1e6;
    let s = superficies.get(chave);
    if (!s) {
      const pos = new Float32Array(ctx.bloco.posicoes);
      for (let v = 2; v < pos.length; v += 3) {
        if (pos[v] > 0) {
          const z = pos[v] + chave;
          if (z < margem) furouBase = true;
          pos[v] = Math.max(z, margem);
        }
      }
      s = malhaParaSolido(wasm, { posicoes: pos, indices: ctx.bloco.indices });
      superficies.set(chave, s);
    }
    return s;
  };
  const alturaPrisma = ctx.zTopo + op.mm(30) + 4;
  const prisma = (cs: Secao, z0 = -1, z1 = alturaPrisma) => g(g(cs.extrude(z1 - z0)).translate(0, 0, z0));
  /** feição que ocupa [terreno + a, terreno + b] */
  const laje = (cs: Secao, a: number, b: number) => g(g(prisma(cs).intersect(S(b))).subtract(S(a)));
  /**
   * Corte no terreno para uma feição cujo fundo fica em terreno + a (a < 0):
   * a coluna INTEIRA acima do fundo, senão o terreno ficaria por cima dela.
   */
  const coluna = (cs: Secao, a: number) => g(prisma(cs).subtract(S(a)));

  const contornoCS = g(new wasm.CrossSection([ctx.contorno], 'NonZero'));
  const recortar = (cs: Secao) => g(cs.intersect(contornoCS));
  /** remove partes mais finas que `largura` (abertura morfológica) */
  const abrir = (cs: Secao, largura: number) =>
    largura > 0 ? g(g(cs.offset(-largura / 2, 'Miter', 2)).offset(largura / 2, 'Miter', 2)) : cs;
  const espessuraFina = op.real ? op.mm(0.4) : alinharEspessura(0.4, op.camadas);
  const esp = (v: number) => (op.real ? v : alinharEspessura(v, op.camadas));
  const pecas: PecaCamada[] = [];
  const cortes: Solido[] = [];
  /** áreas (2D) de prédios, ruas e água: as árvores ficam longe delas */
  const obstaculos2D: Secao[] = [];
  let agua2D: Secao | null = null;
  const linhasPrevia: Float32Array[] = [];

  /** [a, b] relativos ao terreno para uma camada "drapeada" */
  const faixaVertical = (modo: 'superficie' | 'extrudada', integ: 'elevada' | 'rebaixada', altura: number, prof: number, desl: number) => {
    if (modo === 'superficie') return { a: desl - espessuraFina, b: desl };
    if (integ === 'elevada') return { a: desl, b: desl + esp(altura) };
    return { a: desl - esp(prof) - espessuraFina, b: desl - esp(prof) };
  };

  try {
    // ================= PRÉDIOS =================
    let solidoPredios: Solido | null = null;
    if (dados.predios?.length) {
      const p = op.predios;
      /** por altura de telhado: anéis simples (juntados por NonZero) e prédios com pátio (par-ímpar) */
      const grupos = new Map<number, { simples: P[][]; comFuros: P[][][] }>();
      const caixaC = caixaDe(ctx.contorno);
      let menor = Infinity, maior = -Infinity, menorM = Infinity, maiorM = -Infinity, semAltura = 0, n = 0;
      for (const pr of dados.predios) {
        const aneis = pr.aneis.map((a) => a.map(ctx.projetar));
        const cx = caixaDe(aneis[0]);
        if (cx.x1 < caixaC.x0 || cx.x0 > caixaC.x1 || cx.y1 < caixaC.y0 || cx.y0 > caixaC.y1) continue;
        // chão: alturas do terreno nos vértices
        let soma = 0, zMax = -Infinity, cont = 0;
        const passo = Math.max(1, Math.floor(aneis[0].length / 40));
        for (let k = 0; k < aneis[0].length; k += passo) {
          const z = ctx.alturaEm(aneis[0][k][0], aneis[0][k][1]);
          soma += z; zMax = Math.max(zMax, z); cont++;
        }
        const chao = soma / cont;
        const variacao = p.aleatorio > 0 ? 1 + (p.aleatorio / 100) * (aleatorio(pr.id) * 2 - 1) : 1;
        const alturaM = pr.alturaM * p.exagero * variacao;
        let telhado = chao + alturaM * ctx.porMetro + p.deslocamento;
        telhado = Math.max(telhado, zMax + (op.real ? op.mm(0.2) : op.camadas.h));
        if (!op.real) telhado = alinharZ(telhado, op.camadas);
        const grupo = grupos.get(telhado) ?? { simples: [], comFuros: [] };
        if (aneis.length === 1) grupo.simples.push(orientarAntiHorario(aneis[0]));
        else grupo.comFuros.push(aneis);
        grupos.set(telhado, grupo);
        n++;
        if (!pr.alturaInformada) semAltura++;
        const alturaFinal = telhado - chao;
        menor = Math.min(menor, alturaFinal); maior = Math.max(maior, alturaFinal);
        menorM = Math.min(menorM, alturaM); maiorM = Math.max(maiorM, alturaM);
      }
      const prismas: Solido[] = [];
      for (const [telhado, grupo] of grupos) {
        const secoes: Secao[] = [];
        if (grupo.simples.length) secoes.push(g(new wasm.CrossSection(grupo.simples, 'NonZero')));
        for (const aneis of grupo.comFuros) secoes.push(g(new wasm.CrossSection(aneis, 'EvenOdd')));
        const uniao2d = secoes.length === 1 ? secoes[0] : g(wasm.CrossSection.union(secoes));
        const cs = abrir(recortar(uniao2d), op.larguraMinima);
        if (cs.isEmpty()) continue;
        obstaculos2D.push(cs);
        prismas.push(prisma(cs, margem, telhado));
      }
      if (prismas.length) {
        const uniao = g(wasm.Manifold.union(prismas));
        const fundo = p.integracao === 'rebaixado' ? -esp(p.profundidade) : 0;
        solidoPredios = g(uniao.subtract(S(fundo)));
        if (!solidoPredios.isEmpty()) {
          pecas.push({ id: 'predios', nome: 'Prédios', cor: p.cor, solido: solidoPredios });
          if (fundo < 0) cortes.push(solidoPredios);
        }
        estatisticas.predios = { quantidade: n, menorMm: menor, maiorMm: maior, menorM, maiorM, semAltura };
      }
    }

    // ================= RUAS =================
    let solidoRuas: Solido | null = null;
    if (dados.vias?.length) {
      const r = op.ruas;
      const poligonos: P[][] = [];
      const porTipo: Partial<Record<TipoVia, number>> = {};
      for (const v of dados.vias) {
        if (r.desligados.includes(v.tipo)) continue;
        const largura = Math.max(TIPOS_VIA[v.tipo].larguraM * r.escalaLargura * ctx.porMetro, op.larguraMinima);
        engrossarLinha(v.pontos.map(ctx.projetar), largura, poligonos);
        porTipo[v.tipo] = (porTipo[v.tipo] ?? 0) + 1;
      }
      if (poligonos.length) {
        const cs = recortar(g(new wasm.CrossSection(poligonos, 'NonZero')));
        if (!cs.isEmpty()) {
          obstaculos2D.push(cs);
          const { a, b } = faixaVertical(r.modo, r.integracao, r.altura, r.profundidade, r.deslocamento);
          let s = laje(cs, a, b);
          if (solidoPredios) s = g(s.subtract(solidoPredios));
          if (!s.isEmpty()) {
            solidoRuas = s;
            pecas.push({ id: 'ruas', nome: 'Ruas', cor: r.cor, solido: s });
            if (a < 0) cortes.push(coluna(cs, a));
          }
        }
      }
      estatisticas.ruas = { quantidade: Object.values(porTipo).reduce((x, y) => x + (y ?? 0), 0), porTipo };
    }

    // ================= ÁGUA =================
    let solidoAgua: Solido | null = null;
    if (dados.agua) {
      const w = op.agua;
      const partes: Secao[] = [];
      for (const pol of dados.agua.poligonos) partes.push(g(new wasm.CrossSection(pol.aneis.map((a) => a.map(ctx.projetar)), 'EvenOdd')));
      if (w.rios && dados.agua.rios.length) {
        const pols: P[][] = [];
        for (const rio of dados.agua.rios as LinhaOSM[]) {
          engrossarLinha(rio.pontos.map(ctx.projetar), Math.max(larguraRioM(rio.tags) * ctx.porMetro, op.larguraMinima), pols);
        }
        partes.push(g(new wasm.CrossSection(pols, 'NonZero')));
      }
      // mar a partir da linha de costa
      const costa = montarTerra(dados.agua.costa.map((c) => c.map(ctx.projetar)), ctx.caixaGrade);
      const c = ctx.caixaGrade;
      const caixaCS = g(new wasm.CrossSection([[[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]]], 'NonZero'));
      let temMar = false;
      if (costa.situacao === 'terra-recortada' || costa.situacao === 'ilhas' || (costa.situacao === 'sem-costa' && ctx.gradeTodaNoMar)) {
        const terra = costa.terra.length ? g(new wasm.CrossSection(costa.terra, 'NonZero')) : null;
        partes.push(terra ? g(caixaCS.subtract(terra)) : caixaCS);
        temMar = true;
      }
      if (costa.lagosDeMar.length) {
        partes.push(g(new wasm.CrossSection(costa.lagosDeMar, 'NonZero')));
        temMar = true;
      }
      if (costa.incompleta) avisos.push('Parte da linha de costa veio incompleta do OpenStreetMap; o mar pode estar faltando em algum trecho.');

      let removidos = 0;
      let planos = 0;
      if (partes.length) {
        let cs = recortar(g(wasm.CrossSection.union(partes)));
        if (w.ocultarPequenos) cs = abrir(cs, w.larguraMin);
        agua2D = cs;
        obstaculos2D.push(cs);
        const componentes = cs.decompose().map(g);
        const { a, b } = faixaVertical(w.modo, w.integracao, w.altura, w.profundidade, 0);
        const solidos: Solido[] = [];
        const drapeados: Secao[] = [];
        for (const comp of componentes) {
          if (w.ocultarPequenos && comp.area() < w.areaMin) {
            removidos++;
            continue;
          }
          // lagos e mar: superfície plana, numa altura de camada; rios em declive: acompanham o terreno
          const faixa = faixaDeAltura(comp, ctx.alturaEm);
          if (faixa && faixa.max - faixa.min <= (op.real ? op.mm(1) : 4 * op.camadas.h)) {
            planos++;
            const zRef = op.real ? faixa.min : alinharZ(faixa.min, op.camadas);
            const z0 = Math.max(zRef + a, margem);
            if (zRef + a < margem) furouBase = true;
            const z1 = Math.max(zRef + b, z0 + espessuraFina);
            solidos.push(prisma(comp, z0, z1));
            // o terreno dentro do lago é aplainado até o fundo da água
            cortes.push(prisma(comp, z0, alturaPrisma));
          } else {
            drapeados.push(comp);
          }
        }
        if (drapeados.length) {
          const cs = g(wasm.CrossSection.compose(drapeados));
          solidos.push(laje(cs, a, b));
          if (a < 0) cortes.push(coluna(cs, a));
        }
        if (solidos.length) {
          let s = g(wasm.Manifold.union(solidos));
          if (solidoPredios) s = g(s.subtract(solidoPredios));
          if (solidoRuas) s = g(s.subtract(solidoRuas));
          if (!s.isEmpty()) {
            solidoAgua = s;
            pecas.push({ id: 'agua', nome: 'Água', cor: w.cor, solido: s });
          }
        }
      }
      estatisticas.agua = { poligonos: dados.agua.poligonos.length, rios: dados.agua.rios.length, temMar, removidosPequenos: removidos, planos };
    }

    /** subtrai das peças de menor prioridade as de maior prioridade */
    const semPrioritarias = (s: Solido, ...outros: (Solido | null)[]) => {
      let r = s;
      for (const o of outros) if (o) r = g(r.subtract(o));
      return r;
    };

    // ================= ÁRVORES =================
    let solidoArvores: Solido | null = null;
    const ar = op.arvores;
    if (ar?.ligada) {
      const altura = ar.altura;
      const diametro = Math.max(0.7 * altura, op.larguraMinima);
      const caixaC = caixaDe(ctx.contorno);
      const passo = Math.max(diametro / 6, (caixaC.x1 - caixaC.x0) / 3000);
      const mascara = (polys: P[][]) => rasterizar(polys, caixaC.x0, caixaC.y0, caixaC.x1, caixaC.y1, passo);
      // proibido: perto de prédios, ruas e água (distância de segurança + raio da copa)
      let proibido = null;
      if (obstaculos2D.length) {
        const obst = g(g(wasm.CrossSection.union(obstaculos2D)).offset(ar.distancia + diametro / 2, 'Round', 2, 12));
        proibido = mascara(obst.toPolygons() as P[][]);
      }
      // florestas (mesmo com a camada de cobertura desligada)
      let florestas = null;
      const areasFloresta = (dados.cobertura ?? []).filter((c) => c.tipo === 'floresta');
      if (ar.encherFlorestas && areasFloresta.length) {
        const secoes = areasFloresta.map((c) => g(new wasm.CrossSection(c.aneis.map((a) => a.map(ctx.projetar)), 'EvenOdd')));
        florestas = mascara((recortar(g(wasm.CrossSection.union(secoes))).toPolygons()) as P[][]);
      }
      const mapeadas = ar.usarMapeadas ? (dados.arvores?.pontos ?? []).map((p) => ctx.projetar(p.pos)) : [];
      const fileiras = ar.usarMapeadas ? (dados.arvores?.fileiras ?? []).map((f) => f.pontos.map(ctx.projetar)) : [];
      const pos = posicionarArvores({
        mapeadas, fileiras, florestas, caixa: caixaC, noModelo: mascara([ctx.contorno]), proibido,
        densidade: ar.densidade, diametro, maximo: ar.maximo,
      });
      if (pos.arvores.length) {
        const modelo = g(modeloArvore(wasm, ar.estilo, altura, diametro, g));
        // afunda um pouco no chão, para a árvore não ficar no ar em terreno inclinado
        const afundar = altura * 0.25;
        const instancias = pos.arvores.map((a) =>
          g(g(modelo.scale(a.escala)).translate(a.x, a.y, ctx.alturaEm(a.x, a.y) - afundar * a.escala)));
        let s = g(wasm.Manifold.union(instancias));
        s = g(s.subtract(S(0)));
        s = semPrioritarias(s, solidoPredios, solidoRuas, solidoAgua);
        if (!s.isEmpty()) {
          solidoArvores = s;
          pecas.push({ id: 'arvores', nome: 'Árvores', cor: ar.cor, solido: s });
        }
      }
      estatisticas.arvores = {
        quantidade: pos.arvores.length, mapeadas: mapeadas.length + fileiras.length,
        removidasPorDistancia: pos.removidasPorDistancia, cortadasPeloMaximo: pos.cortadasPeloMaximo,
        alturaMm: altura, copaMm: diametro,
      };
      if (pos.cortadasPeloMaximo) {
        avisos.push(`Árvores: ${pos.cortadasPeloMaximo.toLocaleString('pt-BR')} ficaram de fora pelo limite de ${ar.maximo.toLocaleString('pt-BR')}. Reduza a densidade ou aumente o limite.`);
      }
    }

    // ================= CURVAS DE NÍVEL =================
    let solidoCurvas: Solido | null = null;
    if (dados.curvas?.length && op.curvas) {
      const cv = op.curvas;
      if (cv.imprimir) {
        const pols: P[][] = [];
        const largura = Math.max(cv.largura, op.larguraMinima);
        // simplifica antes de engrossar: menos vértices = menos juntas e triângulos
        for (const linha of dados.curvas) engrossarLinha(simplificarLinha(linha, largura / 4), largura, pols);
        let cs = recortar(g(new wasm.CrossSection(pols, 'NonZero')));
        if (agua2D) cs = g(cs.subtract(agua2D)); // não desenha curvas por cima da água
        if (!cs.isEmpty()) {
          let s = laje(cs, 0, esp(cv.altura));
          s = semPrioritarias(s, solidoPredios, solidoRuas, solidoAgua, solidoArvores);
          if (!s.isEmpty()) {
            solidoCurvas = s;
            pecas.push({ id: 'curvas', nome: 'Curvas de nível', cor: cv.cor, solido: s });
          }
        }
      } else {
        // só na visualização: linhas um pouco acima do terreno
        const acima = op.mm(0.05);
        for (const linha of dados.curvas) {
          const xyz = new Float32Array(linha.length * 3);
          linha.forEach(([x, y], k) => xyz.set([x, y, ctx.alturaEm(x, y) + acima], k * 3));
          linhasPrevia.push(xyz);
        }
      }
      estatisticas.curvas = { linhas: dados.curvas.length };
    }

    // ================= COBERTURA DO SOLO =================
    const cb = op.cobertura;
    if (cb?.ligada && dados.cobertura?.length) {
      const porTipo: Partial<Record<TipoCobertura, number>> = {};
      let usado: Secao | null = null; // uma área só entra numa categoria (a primeira da lista)
      let removidas = 0;
      for (const tipo of LISTA_COBERTURA) {
        const conf = cb.categorias[tipo];
        if (!conf.ligada) continue;
        const areas = dados.cobertura.filter((c) => c.tipo === tipo);
        if (!areas.length) continue;
        let cs = recortar(g(wasm.CrossSection.union(areas.map((c) => g(new wasm.CrossSection(c.aneis.map((a) => a.map(ctx.projetar)), 'EvenOdd'))))));
        if (usado) cs = g(cs.subtract(usado));
        if (agua2D) cs = g(cs.subtract(agua2D));
        cs = abrir(cs, op.larguraMinima);
        // descarta pedacinhos menores que a área mínima
        const comps = cs.decompose().map(g);
        const grandes = comps.filter((c) => c.area() >= cb.areaMin);
        removidas += comps.length - grandes.length;
        if (!grandes.length) continue;
        cs = g(wasm.CrossSection.compose(grandes));
        usado = usado ? g(wasm.CrossSection.union([usado, cs])) : cs;
        const { a, b } = faixaVertical(cb.modo, conf.integracao, conf.alturaMm, conf.alturaMm, cb.deslocamento);
        let s = laje(cs, a, b);
        s = semPrioritarias(s, solidoPredios, solidoRuas, solidoAgua, solidoArvores, solidoCurvas);
        if (s.isEmpty()) continue;
        pecas.push({ id: `cobertura-${tipo}`, nome: `Cobertura – ${TIPOS_COBERTURA[tipo].nome}`, cor: conf.cor, solido: s });
        if (a < 0) cortes.push(coluna(cs, a));
        porTipo[tipo] = grandes.length;
      }
      estatisticas.cobertura = { areas: dados.cobertura.length, porTipo, removidasPequenas: removidas };
    }

    if (furouBase) {
      avisos.push(`Algum rebaixo chegaria ao fundo do modelo; ele foi limitado para deixar ${op.real ? '0,2 m' : '0,2 mm'} de base. Aumente a base para rebaixos mais fundos.`);
    }
    // os sólidos devolvidos são de quem chama: tira da lista de descarte
    const devolvidos = new Set<unknown>([...pecas.map((p) => p.solido), ...cortes]);
    for (let k = lixo.length - 1; k >= 0; k--) if (devolvidos.has(lixo[k])) lixo.splice(k, 1);
    return { pecas, cortes, avisos, estatisticas, linhasPrevia };
  } finally {
    for (const o of lixo) o.delete();
    for (const s of superficies.values()) s.delete();
  }
}

// ---------- forma das árvores ----------
/**
 * Árvore com a base em z = 0 e o topo em z = altura.
 * - copa: uma copa arredondada (elipsoide) do chão ao topo, boa para imprimir;
 * - clássica: tronco (40% da altura) + copa.
 * Versões low-poly usam menos lados (aspecto facetado, arquivo menor).
 */
export function modeloArvore(
  wasm: Wasm, estilo: EstiloArvore, altura: number, diametro: number,
  g: <T extends { delete(): void }>(o: T) => T,
): Solido {
  const lowpoly = estilo === 'copaLowpoly' || estilo === 'classicaLowpoly';
  const lados = lowpoly ? 6 : 14;
  if (estilo === 'copa' || estilo === 'copaLowpoly') {
    return g(g(wasm.Manifold.sphere(0.5, lados)).scale([diametro, diametro, altura])).translate(0, 0, altura / 2);
  }
  const alturaTronco = altura * 0.4;
  const raioTronco = Math.max(diametro * 0.14, 0.2);
  const tronco = g(wasm.Manifold.cylinder(alturaTronco + altura * 0.1, raioTronco, raioTronco, lowpoly ? 5 : 8));
  const alturaCopa = altura - alturaTronco;
  const copa = g(g(g(wasm.Manifold.sphere(0.5, lados)).scale([diametro, diametro, alturaCopa])).translate(0, 0, alturaTronco + alturaCopa / 2));
  return wasm.Manifold.union(tronco, copa);
}

// ---------- utilidades geométricas ----------
/** Douglas-Peucker: remove vértices que desviam menos que `tolerancia` da linha. */
export function simplificarLinha(pts: P[], tolerancia: number): P[] {
  if (pts.length <= 2) return pts;
  const manter = new Uint8Array(pts.length);
  manter[0] = 1;
  manter[pts.length - 1] = 1;
  const pilha: [number, number][] = [[0, pts.length - 1]];
  while (pilha.length) {
    const [i, j] = pilha.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let maior = -1;
    let k = -1;
    for (let m = i + 1; m < j; m++) {
      const [px, py] = pts[m];
      const d = len < 1e-12 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maior) {
        maior = d;
        k = m;
      }
    }
    if (k >= 0 && maior > tolerancia) {
      manter[k] = 1;
      pilha.push([i, k], [k, j]);
    }
  }
  return pts.filter((_, i) => manter[i]);
}

function caixaDe(pts: P[]): Caixa2D {
  const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y);
  }
  return c;
}

function orientarAntiHorario(anel: P[]): P[] {
  let s = 0;
  for (let k = 0; k < anel.length; k++) {
    const [x1, y1] = anel[k];
    const [x2, y2] = anel[(k + 1) % anel.length];
    s += x1 * y2 - x2 * y1;
  }
  return s >= 0 ? anel : anel.slice().reverse();
}

const SEGMENTOS_JUNTA = 8;

/** Transforma uma linha em polígonos (retângulos por trecho + octógonos nas juntas). */
export function engrossarLinha(pts: P[], largura: number, saida: P[][]) {
  const r = largura / 2;
  const junta = (c: P) => {
    const anel: P[] = [];
    for (let k = 0; k < SEGMENTOS_JUNTA; k++) {
      const ang = (2 * Math.PI * k) / SEGMENTOS_JUNTA;
      anel.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    }
    saida.push(anel);
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * r;
    const ny = (dx / len) * r;
    // esquerda de a → direita de a → direita de b → esquerda de b: sentido anti-horário
    saida.push([[ax + nx, ay + ny], [ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny]]);
    junta(pts[k]);
  }
  if (pts.length) junta(pts[pts.length - 1]);
}

/** Menor e maior altura do terreno dentro de uma seção (amostrando vértices e pontos internos). */
function faixaDeAltura(cs: Secao, alturaEm: (x: number, y: number) => number): { min: number; max: number } | null {
  const b = cs.bounds();
  const polys = cs.toPolygons() as P[][];
  let min = Infinity;
  let max = -Infinity;
  const usar = (x: number, y: number) => {
    const z = alturaEm(x, y);
    min = Math.min(min, z);
    max = Math.max(max, z);
  };
  for (const pol of polys) {
    const passo = Math.max(1, Math.floor(pol.length / 200));
    for (let k = 0; k < pol.length; k += passo) usar(pol[k][0], pol[k][1]);
  }
  const n = 24;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = b.min[0] + ((b.max[0] - b.min[0]) * i) / n;
      const y = b.min[1] + ((b.max[1] - b.min[1]) * j) / n;
      if (dentroPar([x, y], polys)) usar(x, y);
    }
  }
  return min === Infinity ? null : { min, max };
}

function dentroPar([x, y]: P, aneis: P[][]): boolean {
  let d = false;
  for (const pts of aneis) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
    }
  }
  return d;
}

export { aleatorio };
