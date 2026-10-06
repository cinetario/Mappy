// Configuração por categoria de cobertura do solo (Floresta, Grama, …):
// ligada, cor, altura e integração com o terreno. Guardada na URL num texto
// compacto: "floresta:1:3d6b35:0.4:e;grama:1:8cb369:0.2:e;…".
import { LISTA_COBERTURA, TIPOS_COBERTURA, type TipoCobertura } from './categorias-osm.ts';

export interface ConfigCategoria {
  ligada: boolean;
  cor: string;
  /** espessura em mm (altura se elevada, profundidade se rebaixada) */
  alturaMm: number;
  integracao: 'elevada' | 'rebaixada';
}

export type ConfigCobertura = Record<TipoCobertura, ConfigCategoria>;

/** Urbano vem desligado: cobriria quase toda cidade com uma cor só. */
const DESLIGADAS_PADRAO = new Set<TipoCobertura>(['urbano', 'gelo']);

export function coberturaPadrao(): ConfigCobertura {
  const c = {} as ConfigCobertura;
  for (const t of LISTA_COBERTURA) {
    c[t] = { ligada: !DESLIGADAS_PADRAO.has(t), cor: TIPOS_COBERTURA[t].cor, alturaMm: t === 'floresta' ? 0.4 : 0.2, integracao: 'elevada' };
  }
  return c;
}

export function escreverCobertura(c: ConfigCobertura): string {
  return LISTA_COBERTURA.map((t) => {
    const x = c[t];
    return `${t}:${x.ligada ? 1 : 0}:${x.cor.replace('#', '')}:${Number(x.alturaMm.toFixed(2))}:${x.integracao === 'elevada' ? 'e' : 'r'}`;
  }).join(';');
}

export function lerCobertura(texto: string): ConfigCobertura | null {
  const c = coberturaPadrao();
  for (const parte of texto.split(';')) {
    if (!parte) continue;
    const [t, l, cor, alt, integ] = parte.split(':');
    if (!(t in c)) return null;
    const altura = Number(alt);
    if (!/^[0-9a-f]{6}$/i.test(cor ?? '') || !Number.isFinite(altura) || altura < 0.04 || altura > 10 || !['e', 'r'].includes(integ)) return null;
    c[t as TipoCobertura] = { ligada: l === '1', cor: `#${cor.toLowerCase()}`, alturaMm: altura, integracao: integ === 'e' ? 'elevada' : 'rebaixada' };
  }
  return c;
}

export function validarCoberturaTexto(v: string): string | null {
  const c = lerCobertura(v);
  return c ? escreverCobertura(c) : null;
}
