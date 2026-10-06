// Exportação 3MF (3D Manufacturing Format), multicolor.
//
// Um arquivo que funciona dos dois jeitos:
// - 3MF "puro" (núcleo da especificação): cada camada é um <object> com nome e
//   cor (basematerials) e um objeto de montagem junta todas como componentes,
//   já alinhadas na mesma origem;
// - Orca / Snapmaker Orca / Bambu Studio: Metadata/model_settings.config diz o
//   nome e o filamento (extrusora) de cada peça. Quem não conhece o arquivo o ignora.
import { strToU8, zipSync } from 'fflate';
import type { Malha } from './malha.ts';

export interface PecaTmf {
  nome: string;
  /** cor #rrggbb */
  cor: string;
  malha: Malha;
  /** filamento 1–4 da impressora */
  extrusora: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** número curto: até 4 casas (0,1 µm em mm), sem zeros à toa */
const num = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};

function xmlMalha(m: Malha): string {
  const p = m.posicoes;
  const partes: string[] = ['<mesh><vertices>'];
  for (let k = 0; k < p.length; k += 3) partes.push(`<vertex x="${num(p[k])}" y="${num(p[k + 1])}" z="${num(p[k + 2])}"/>`);
  partes.push('</vertices><triangles>');
  const t = m.indices;
  for (let k = 0; k < t.length; k += 3) partes.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
  partes.push('</triangles></mesh>');
  return partes.join('');
}

export function escrever3mf(pecas: PecaTmf[], o: { titulo: string; unidade: 'millimeter' | 'meter' }): Uint8Array {
  const idMaterial = 1;
  const idsPecas = pecas.map((_, k) => k + 2);
  const idMontagem = pecas.length + 2;

  const modelo = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="${o.unidade}" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`,
    `<metadata name="Title">${esc(o.titulo)}</metadata>`,
    '<metadata name="Application">Relevo3D</metadata>',
    '<metadata name="Copyright">Dados: © OpenStreetMap contributors</metadata>',
    '<resources>',
    `<basematerials id="${idMaterial}">`,
    ...pecas.map((p) => `<base name="${esc(p.nome)}" displaycolor="${p.cor.toUpperCase()}FF"/>`),
    '</basematerials>',
    ...pecas.map((p, k) =>
      `<object id="${idsPecas[k]}" type="model" name="${esc(p.nome)}" pid="${idMaterial}" pindex="${k}">${xmlMalha(p.malha)}</object>`),
    `<object id="${idMontagem}" type="model" name="${esc(o.titulo)}"><components>`,
    ...idsPecas.map((id) => `<component objectid="${id}"/>`),
    '</components></object>',
    '</resources>',
    `<build><item objectid="${idMontagem}"/></build>`,
    '</model>',
  ].join('\n');

  const config = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    `  <object id="${idMontagem}">`,
    `    <metadata key="name" value="${esc(o.titulo)}"/>`,
    `    <metadata key="extruder" value="${pecas[0]?.extrusora ?? 1}"/>`,
    ...pecas.flatMap((p, k) => [
      `    <part id="${idsPecas[k]}" subtype="normal_part">`,
      `      <metadata key="name" value="${esc(p.nome)}"/>`,
      `      <metadata key="extruder" value="${p.extrusora}"/>`,
      '    </part>',
    ]),
    '  </object>',
    '</config>',
  ].join('\n');

  const tipos = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    '<Default Extension="config" ContentType="text/xml"/>',
    '</Types>',
  ].join('\n');

  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
  ].join('\n');

  return zipSync({
    '[Content_Types].xml': strToU8(tipos),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(modelo),
    'Metadata/model_settings.config': strToU8(config),
  }, { level: 6 });
}

// ---------- filamentos ----------
export interface Filamento {
  extrusora: number;
  cor: string;
  pecas: string[];
}

/** Cor #rrggbb → CIE Lab (distâncias nesse espaço seguem a percepção humana). */
function lab(c: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** A claridade (L) pesa metade: para trocar uma cor por outra no mapa, manter
 *  o matiz (verde continua verde) importa mais que manter o tom claro/escuro. */
const distancia = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot((l1 - l2) * 0.5, a1 - a2, b1 - b2);
};

/**
 * Distribui as cores das peças entre os filamentos da impressora.
 * Cada cor diferente ganha um filamento; se houver mais cores que filamentos,
 * as cores que sobram vão para o filamento de cor mais parecida (as cores
 * das peças maiores têm preferência por um filamento próprio).
 */
export function distribuirFilamentos(pecas: { nome: string; cor: string; volume: number }[], maximo = 4): { porPeca: number[]; filamentos: Filamento[]; agrupadas: boolean } {
  const volumePorCor = new Map<string, number>();
  for (const p of pecas) volumePorCor.set(p.cor, (volumePorCor.get(p.cor) ?? 0) + p.volume);
  const cores = [...volumePorCor.keys()].sort((a, b) => volumePorCor.get(b)! - volumePorCor.get(a)!);
  const proprias = cores.slice(0, maximo);
  const extrusoraDaCor = new Map<string, number>();
  proprias.forEach((c, k) => extrusoraDaCor.set(c, k + 1));
  for (const c of cores.slice(maximo)) {
    const maisParecida = proprias.reduce((melhor, x) => (distancia(c, x) < distancia(c, melhor) ? x : melhor), proprias[0]);
    extrusoraDaCor.set(c, extrusoraDaCor.get(maisParecida)!);
  }
  const porPeca = pecas.map((p) => extrusoraDaCor.get(p.cor)!);
  const filamentos: Filamento[] = proprias.map((cor, k) => ({
    extrusora: k + 1,
    cor,
    pecas: pecas.filter((_, i) => porPeca[i] === k + 1).map((p) => p.nome),
  }));
  return { porPeca, filamentos, agrupadas: cores.length > maximo };
}
