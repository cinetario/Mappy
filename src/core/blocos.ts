// Download da área em blocos, com novas tentativas, troca de servidor,
// divisão de blocos problemáticos e cancelamento.
// Os blocos seguem uma grade fixa (0,04° ≈ 4 km), então mover ou ajustar a
// área reaproveita o cache dos blocos já baixados.
import type { Retangulo } from './geo.ts';

export interface Bloco {
  s: number;
  w: number;
  n: number;
  e: number;
}

export const TAMANHO_BLOCO = 0.04;

const arred = (v: number) => Math.round(v * 1e6) / 1e6;

export function blocosDaArea(r: Retangulo, tamanho = TAMANHO_BLOCO): Bloco[] {
  const blocos: Bloco[] = [];
  const i0 = Math.floor(r.sul / tamanho);
  const i1 = Math.floor(r.norte / tamanho);
  const j0 = Math.floor(r.oeste / tamanho);
  const j1 = Math.floor(r.leste / tamanho);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      blocos.push({ s: arred(i * tamanho), n: arred((i + 1) * tamanho), w: arred(j * tamanho), e: arred((j + 1) * tamanho) });
    }
  }
  return blocos;
}

export function dividirEm4(b: Bloco): Bloco[] {
  const ms = arred((b.s + b.n) / 2);
  const mw = arred((b.w + b.e) / 2);
  return [
    { s: b.s, w: b.w, n: ms, e: mw },
    { s: b.s, w: mw, n: ms, e: b.e },
    { s: ms, w: b.w, n: b.n, e: mw },
    { s: ms, w: mw, n: b.n, e: b.e },
  ];
}

/**
 * Resposta de uma tentativa:
 * - ocupado: servidor sobrecarregado ou limite de consultas (429/503/504);
 * - tempo: passou do tempo limite (60 s);
 * - pesado: o Overpass avisou que a consulta é grande demais;
 * - rede/erro: falha de conexão ou resposta inesperada.
 */
export type RespostaBloco<T> =
  | { dados: T }
  | { erro: 'ocupado' | 'tempo' | 'pesado' | 'rede' | 'erro'; mensagem: string };

export interface OpcoesDownload<T> {
  baixar: (b: Bloco, servidor: number, sinal: AbortSignal) => Promise<RespostaBloco<T>>;
  /** quantos servidores Overpass existem para alternar */
  servidores: number;
  aoProgredir?: (p: { feitos: number; total: number; mensagem?: string }) => void;
  sinal?: AbortSignal;
  /** espera cancelável (trocável nos testes) */
  esperar?: (ms: number, sinal?: AbortSignal) => Promise<void>;
  simultaneos?: number;
  /** tentativas por bloco antes de dividir ou desistir */
  tentativas?: number;
  /** espera (s) antes de cada nova tentativa: cresce a cada falha */
  esperasS?: number[];
  /** quantas vezes um bloco que falhou pode ser dividido em 4 */
  divisoesPorFalha?: number;
  /** quantas vezes um bloco "pesado" pode ser dividido em 4 */
  divisoesPorPeso?: number;
  /** falhas seguidas (em qualquer bloco) até concluir que o serviço está fora do ar */
  falhasParaDesistir?: number;
  /** falhas por servidor, compartilhadas entre downloads da mesma sessão */
  saudeServidores?: number[];
}

export interface ResultadoDownload<T> {
  dados: T[];
  /** blocos que não vieram (o modelo é gerado sem eles) */
  faltando: Bloco[];
}

export class Cancelado extends Error {
  constructor() {
    super('Cancelado');
  }
}

export function esperarCancelavel(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    if (sinal?.aborted) return rejeitar(new Cancelado());
    const t = setTimeout(() => {
      sinal?.removeEventListener('abort', aoAbortar);
      resolver();
    }, ms);
    const aoAbortar = () => {
      clearTimeout(t);
      rejeitar(new Cancelado());
    };
    sinal?.addEventListener('abort', aoAbortar, { once: true });
  });
}

const TEXTO_ERRO: Record<string, string> = {
  ocupado: 'Servidor ocupado',
  tempo: 'Servidor demorou mais de 60 s',
  pesado: 'Bloco pesado demais',
  rede: 'Falha de conexão',
  erro: 'Resposta inesperada',
};

export async function baixarBlocos<T>(blocos: Bloco[], o: OpcoesDownload<T>): Promise<ResultadoDownload<T>> {
  const esperar = o.esperar ?? esperarCancelavel;
  const tentativas = o.tentativas ?? 3;
  const esperas = o.esperasS ?? [5, 10, 20, 30];
  const divisoesFalha = o.divisoesPorFalha ?? 1;
  const divisoesPeso = o.divisoesPorPeso ?? 3;
  const falhasParaDesistir = o.falhasParaDesistir ?? 8;
  const sinal = o.sinal;

  const fila: { b: Bloco; nivel: number }[] = blocos.map((b) => ({ b, nivel: 0 }));
  const dados: T[] = [];
  const faltando: Bloco[] = [];
  let total = fila.length;
  let feitos = 0;
  let falhasSeguidas = 0;
  let foraDoAr = false;
  let proximoServidor = 0;
  // servidores que não respondem (tempo esgotado/rede) vão para o fim da fila:
  // um espelho fora do ar não deve custar 60 s a cada tentativa
  const falhasDoServidor = o.saudeServidores ?? new Array<number>(o.servidores).fill(0);
  const escolherServidor = () => {
    const menor = Math.min(...falhasDoServidor.map((f) => Math.min(f, 2)));
    for (let k = 0; k < o.servidores; k++) {
      const s = (proximoServidor + k) % o.servidores;
      if (Math.min(falhasDoServidor[s], 2) === menor) {
        proximoServidor = s + 1;
        return s;
      }
    }
    return proximoServidor++ % o.servidores;
  };
  const progresso = (mensagem?: string) => o.aoProgredir?.({ feitos, total, mensagem });
  progresso();

  const processar = async (item: { b: Bloco; nivel: number }) => {
    let ultimo: { erro: string; mensagem: string } | null = null;
    for (let t = 0; t < tentativas && !foraDoAr; t++) {
      if (sinal?.aborted) throw new Cancelado();
      const servidor = escolherServidor();
      const r = await o.baixar(item.b, servidor, sinal ?? new AbortController().signal);
      if (sinal?.aborted) throw new Cancelado();
      if ('dados' in r) {
        falhasSeguidas = 0;
        falhasDoServidor[servidor] = 0;
        dados.push(r.dados);
        feitos++;
        progresso();
        return;
      }
      ultimo = r;
      if (r.erro === 'pesado') break; // não adianta repetir: divide
      if (r.erro === 'tempo' || r.erro === 'rede') falhasDoServidor[servidor]++;
      falhasSeguidas++;
      if (falhasSeguidas >= falhasParaDesistir) {
        foraDoAr = true;
        break;
      }
      if (t < tentativas - 1) {
        // espera crescente, com contagem regressiva na tela
        const espera = esperas[Math.min(t, esperas.length - 1)];
        for (let s = espera; s > 0; s--) {
          progresso(`${TEXTO_ERRO[r.erro]} (${r.mensagem}). Tentando de novo em ${s} s… (tentativa ${t + 2} de ${tentativas}, outro servidor)`);
          await esperar(1000, sinal);
        }
      }
    }
    // não veio: divide em 4 (blocos menores costumam passar) ou desiste deste pedaço
    const limite = ultimo?.erro === 'pesado' ? divisoesPeso : divisoesFalha;
    if (!foraDoAr && item.nivel < limite) {
      const filhos = dividirEm4(item.b).map((b) => ({ b, nivel: item.nivel + 1 }));
      fila.push(...filhos);
      total += filhos.length - 1;
      progresso(`${ultimo ? TEXTO_ERRO[ultimo.erro] : 'Falha'}: dividindo o bloco em 4 menores`);
      return;
    }
    faltando.push(item.b);
    feitos++;
    progresso(foraDoAr ? 'O OpenStreetMap não está respondendo agora; seguindo sem os blocos que faltam.' : undefined);
  };

  const trabalhador = async () => {
    for (let item = fila.shift(); item; item = fila.shift()) {
      if (foraDoAr) {
        faltando.push(item.b);
        feitos++;
        continue;
      }
      await processar(item);
    }
  };
  const n = Math.max(1, Math.min(o.simultaneos ?? 2, fila.length));
  await Promise.all(Array.from({ length: n }, trabalhador));
  progresso();
  return { dados, faltando: faltando.sort((a, b) => a.s - b.s || a.w - b.w) };
}
