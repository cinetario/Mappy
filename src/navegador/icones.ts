// Ícones do Relevo3D (desenho próprio, traço de 1,7 px numa grade de 24 × 24).
const TRACOS = {
  terreno: '<path d="M2.5 19 9 8.5l3.6 5.6L15 10.5l6.5 8.5z"/><path d="m7.4 11.2 1.6 1.3 1.4-1.4"/>',
  predios: '<path d="M4 20V9l6-3v14M10 20V4h10v16M3 20h18"/><path d="M13 8h1.5M16.5 8H18M13 11.5h1.5M16.5 11.5H18M13 15h1.5M16.5 15H18M6.5 12h1M6.5 15h1"/>',
  ruas: '<path d="M8 3 4 21M16 3l4 18"/><path d="M12 4v2.5M12 10.5v3M12 17.5V20"/>',
  agua: '<path d="M2.5 9c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 5-.6"/><path d="M2.5 14c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 5-.6"/><path d="M2.5 19c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 5-.6"/>',
  cobertura: '<path d="M5 19c0-8 5-13.5 14-14 .4 8.8-4.8 14-13 14z"/><path d="M5 19 13 11"/>',
  arvores: '<path d="M12 3 6 12h3l-4 6h14l-4-6h3z"/><path d="M12 18v3"/>',
  curvas: '<path d="M4.5 12c0-4.5 3.3-7.5 7.5-7.5s7.5 3 7.5 7-3 7.5-7.5 7.5S4.5 16 4.5 12z"/><path d="M8.5 12.2c0-2.3 1.6-4 3.6-4s3.5 1.5 3.5 3.6-1.5 3.9-3.6 3.9-3.5-1.3-3.5-3.5z"/><circle cx="12" cy="12" r=".6"/>',
  dimensoes: '<path d="M3 15.5 15.5 3 21 8.5 8.5 21z"/><path d="m7 11.5 2 2M10 8.5l1.5 1.5M13 5.5l2 2M5.5 14.5l1 1M11.5 7l1 1"/>',
  estilo: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-1 1.4-2.2-.6-1.4.2-2.8 1.8-2.8H18c1.5 0 2.5-1.1 2.5-2.7C20.5 7.3 16.7 3.5 12 3.5z"/><circle cx="8" cy="11" r="1"/><circle cx="11.5" cy="7.5" r="1"/><circle cx="15.5" cy="9" r="1"/>',
  base: '<path d="m12 4 9 4.5-9 4.5-9-4.5z"/><path d="m3 12.5 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  laterais: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M12 12l8-4.5M12 12 4 7.5"/>',
  moldura: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><rect x="6.5" y="7.5" width="11" height="7"/><path d="M9 17.3h6"/>',
  impressao: '<path d="M4 4h16v4H4z"/><path d="M10 8v3l2 2.5 2-2.5V8"/><path d="M5 20h14M7.5 17h9"/>',
  estatisticas: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  topografico: '<path d="M3 17c3-1 4.5-4 7-4s3 2 5.5 2 3.5-2 5.5-2.5"/><path d="M3 12.5c3-1 4-5 7-5s3 3 5.5 3 3.5-2 5.5-2.5"/><path d="M3 21h18"/>',
  enquadrar: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path d="m12 8 4 2.2v4.3L12 17l-4-2.5v-4.3z"/>',
  topo: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 12h16M12 4v16"/>',
  aramado: '<path d="M3 19 12 4l9 15z"/><path d="M7.5 11.5h9M12 4l-4.5 15M12 4l4.5 15"/>',
  grade: '<path d="M3 8h18M3 16h18M8 3v18M16 3v18"/>',
  mapa: '<path d="m3 6 6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 3.5v14.5M15 6v14.5"/>',
  cubo: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M12 12l8-4.5M12 12 4 7.5"/>',
  lado: '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M12 4.5v15"/>',
  baixar: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  redefinir: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>',
  olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  busca: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
} as const;

export type NomeIcone = keyof typeof TRACOS;

export function icone(nome: NomeIcone, classe = 'icone-svg'): string {
  return `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TRACOS[nome]}</svg>`;
}

/** Ícone como elemento (para os construtores do painel). */
export function elementoIcone(nome: NomeIcone, classe?: string): Element {
  const t = document.createElement('template');
  t.innerHTML = icone(nome, classe);
  return t.content.firstElementChild!;
}

/** Preenche todos os [data-icone] da página. */
export function preencherIcones(raiz: ParentNode = document) {
  for (const el of raiz.querySelectorAll<HTMLElement>('[data-icone]')) {
    if (el.querySelector('svg')) continue;
    el.insertAdjacentHTML('afterbegin', icone(el.dataset.icone as NomeIcone));
  }
}
