// Lembra a última sessão neste navegador: área + configurações (o mesmo texto
// do link, depois do #) e a posição do mapa. Ao abrir o app sem link, ele
// volta como estava. Sem armazenamento disponível (janela anônima, bloqueio),
// tudo continua funcionando, só não lembra.
const CHAVE = 'relevo3d-ultima-sessao';

export interface UltimaSessao {
  /** estado no formato da URL (sem o #) */
  hash: string;
  mapa?: { centro: [number, number]; zoom: number };
}

export function lerUltimaSessao(): UltimaSessao | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const s = JSON.parse(bruto) as UltimaSessao;
    return typeof s.hash === 'string' ? s : null;
  } catch {
    return null;
  }
}

function gravar(mudar: (s: UltimaSessao) => UltimaSessao) {
  try {
    const atual = lerUltimaSessao() ?? { hash: '' };
    localStorage.setItem(CHAVE, JSON.stringify(mudar(atual)));
  } catch {
    // sem armazenamento: não lembra, e tudo bem
  }
}

export const lembrarEstado = (hash: string) => gravar((s) => ({ ...s, hash }));
export const lembrarMapa = (centro: [number, number], zoom: number) =>
  gravar((s) => ({ ...s, mapa: { centro: [Math.round(centro[0] * 1e5) / 1e5, Math.round(centro[1] * 1e5) / 1e5], zoom: Math.round(zoom * 100) / 100 } }));
