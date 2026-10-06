// Moldura em volta do modelo e texto (nome, coordenadas…) gravado ou em relevo.
//
// A moldura é um anel: contorno ampliado − contorno, da mesa até a altura
// pedida. Com texto, um "plaquinha" retangular é acrescentada no lado
// escolhido, larga o bastante para as letras (funciona em qualquer formato:
// retângulo, círculo, hexágono, polígono).
import { alinharEspessura, alinharZ, type GradeCamadas } from './camadas-impressao.ts';
import type { Solido, Wasm } from './manifold.ts';
import type { ContornosTexto, P } from './texto.ts';

type Secao = InstanceType<Wasm['CrossSection']>;

export interface OpcoesMoldura {
  estilo: 'reta' | 'arredondada';
  espessura: number;
  /** altura total (da mesa ao topo da moldura) */
  altura: number;
  /** texto já em contornos (centrado na origem), ou null */
  texto: ContornosTexto | null;
  borda: 'inferior' | 'superior' | 'esquerda' | 'direita';
  modoTexto: 'relevo' | 'gravado';
  relevo: number;
  /** grade de camadas (null no modo 1:1) */
  camadas: GradeCamadas | null;
  larguraMinima: number;
}

export interface ResultadoMoldura {
  moldura: Solido;
  texto: Solido | null;
  /** altura efetiva (alinhada às camadas) */
  altura: number;
  avisos: string[];
}

export function gerarMoldura(wasm: Wasm, contorno: P[], o: OpcoesMoldura): ResultadoMoldura {
  const lixo: { delete(): void }[] = [];
  const g = <T extends { delete(): void }>(x: T): T => (lixo.push(x), x);
  const avisos: string[] = [];
  try {
    const altura = o.camadas ? alinharZ(o.altura, o.camadas) : o.altura;
    const relevo = o.camadas ? alinharEspessura(o.relevo, o.camadas) : o.relevo;
    const espessura = Math.max(o.espessura, o.larguraMinima);
    const contornoCS = g(new wasm.CrossSection([contorno], 'NonZero'));
    const externo = g(contornoCS.offset(espessura, o.estilo === 'arredondada' ? 'Round' : 'Miter', 4, 48));
    let anel: Secao = g(externo.subtract(contornoCS));

    // ---- plaquinha e posição do texto ----
    let textoCS: Secao | null = null;
    if (o.texto && o.texto.aneis.length) {
      const margem = Math.max(espessura * 0.5, o.texto.altura * 0.35);
      const vertical = o.borda === 'esquerda' || o.borda === 'direita';
      // texto girado nas laterais (lê de baixo para cima à esquerda, de cima para baixo à direita)
      const giro = o.borda === 'esquerda' ? 90 : o.borda === 'direita' ? -90 : 0;
      const larguraTexto = o.texto.largura;
      const alturaTexto = o.texto.altura;
      const profundidade = Math.max(espessura, alturaTexto + 2 * margem);
      const comprimento = larguraTexto + 2 * margem + 2 * espessura;
      const caixa = caixaDe(contorno);
      const cx = (caixa.x0 + caixa.x1) / 2;
      const cy = (caixa.y0 + caixa.y1) / 2;
      // retângulo da plaquinha: encostado (por fora) no lado escolhido do contorno
      let r: [number, number, number, number]; // x0, y0, x1, y1
      let centro: P;
      switch (o.borda) {
        case 'inferior':
          r = [cx - comprimento / 2, caixa.y0 - profundidade, cx + comprimento / 2, caixa.y0 + espessura];
          centro = [cx, caixa.y0 - profundidade / 2];
          break;
        case 'superior':
          r = [cx - comprimento / 2, caixa.y1 - espessura, cx + comprimento / 2, caixa.y1 + profundidade];
          centro = [cx, caixa.y1 + profundidade / 2];
          break;
        case 'esquerda':
          r = [caixa.x0 - profundidade, cy - comprimento / 2, caixa.x0 + espessura, cy + comprimento / 2];
          centro = [caixa.x0 - profundidade / 2, cy];
          break;
        default:
          r = [caixa.x1 - espessura, cy - comprimento / 2, caixa.x1 + profundidade, cy + comprimento / 2];
          centro = [caixa.x1 + profundidade / 2, cy];
      }
      const placa = g(new wasm.CrossSection([[[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]], 'NonZero'));
      anel = g(g(wasm.CrossSection.union([anel, placa])).subtract(contornoCS));
      textoCS = g(g(g(new wasm.CrossSection(o.texto.aneis, 'NonZero')).rotate(giro)).translate(centro));
      // o texto fica inteiro em cima da moldura (nunca sobre o mapa)
      textoCS = g(textoCS.intersect(anel));
      if (vertical && comprimento > caixa.y1 - caixa.y0 + 2 * espessura) {
        avisos.push('O texto é mais comprido que a lateral do modelo: a plaquinha passa da borda.');
      } else if (!vertical && comprimento > caixa.x1 - caixa.x0 + 2 * espessura) {
        avisos.push('O texto é mais largo que o modelo: a plaquinha passa da borda.');
      }
    }

    let moldura = g(anel.extrude(altura));
    let texto: Solido | null = null;
    if (textoCS && !textoCS.isEmpty()) {
      if (o.modoTexto === 'relevo') {
        texto = g(g(textoCS.extrude(relevo)).translate(0, 0, altura));
      } else {
        // gravado: as letras são uma peça embutida, rente ao topo da moldura
        texto = g(g(textoCS.extrude(relevo)).translate(0, 0, altura - relevo));
        moldura = g(moldura.subtract(texto));
      }
    }
    const resultado = { moldura, texto, altura, avisos };
    // os sólidos devolvidos são de quem chama
    for (let k = lixo.length - 1; k >= 0; k--) if (lixo[k] === moldura || lixo[k] === texto) lixo.splice(k, 1);
    return resultado;
  } finally {
    for (const x of lixo) x.delete();
  }
}

function caixaDe(pts: P[]) {
  const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y);
  }
  return c;
}
