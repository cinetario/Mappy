// Aba "Modelo": dimensões, terreno, estilo, base, laterais, camadas de impressão e estatísticas.
import { FONTES } from '../core/elevacao.ts';
import { lerFaixas } from '../core/estado.ts';
import {
  booleano, cor, editorFaixas, informacao, numero, opcoes, secao,
  type AoMudar, type Contexto, type Controle,
} from './painel.ts';
import { bytes, decimal, inteiro, medidaModelo, type Sistema } from './unidades.ts';

const MESA_MM = 270;

export function montarAbaModelo(container: HTMLElement, aoMudar: AoMudar) {
  const impressao = (c: Contexto) => c.params.modo === 'impressao';
  const sis = (c: Contexto) => c.params.unidades as Sistema;
  const unidadeModelo = (c: Contexto) => (impressao(c) ? 'mm' : 'm');

  const secoes: Controle[] = [
    secao('dimensoes', 'Dimensões e coordenadas', [
      opcoes('modo', 'Modo', [['impressao', 'Impressão 3D (escalado)'], ['real', 'Escala 1:1 (mundo real)']], aoMudar),
      informacao(() =>
        'Gera o modelo em <strong>metros reais</strong> (1 unidade = 1 m), centrado no meio da área. '
        + 'Útil para Blender ou programas de GIS. Para imprimir, use o modo Impressão 3D.',
      { visivel: (c) => !impressao(c) }),
      numero('tamanhoMm', 'Tamanho do maior lado', aoMudar, {
        unidade: 'mm', passo: 5, visivel: impressao,
        dica: (c) => (c.params.tamanhoMm > MESA_MM ? `<span class="erro">Passa de ${MESA_MM} mm, o limite da mesa da Snapmaker U1.</span>` : ''),
      }),
      booleano('travarAltura', 'Travar altura total do modelo', aoMudar, { visivel: impressao }),
      numero('alturaTotalMm', 'Altura total', aoMudar, {
        unidade: 'mm', passo: 0.5,
        visivel: (c) => impressao(c) && c.params.travarAltura,
        dica: (c) => `O exagero vertical é calculado para o ponto mais alto ficar nessa altura${
          c.info ? `: <strong>${decimal(c.info.exageroEfetivo, 2)}x</strong>` : ''}.`,
      }),
      opcoes('unidades', 'Unidades na tela', [['metrico', 'Métrico'], ['imperial', 'Imperial']], aoMudar, {
        dica: 'Só muda como as medidas aparecem. Os arquivos exportados são sempre em mm.',
      }),
    ], (c) => (impressao(c) ? `${inteiro(c.params.tamanhoMm)} mm` : 'Escala 1:1')),

    secao('terreno', 'Detalhes do terreno', [
      numero('exagero', 'Exagero de elevação', aoMudar, {
        deslizante: true, passo: 0.1,
        exibir: (c) => (impressao(c) && c.params.travarAltura
          ? (c.info ? `${decimal(c.info.exageroEfetivo, 2)}x (automático)` : 'automático')
          : `${decimal(c.params.exagero, 1)}x`),
        desativado: (c) => impressao(c) && c.params.travarAltura && 'Desligue "Travar altura total" para escolher o exagero.',
      }),
      opcoes('fonte', 'Fonte de elevação', [
        ['mapterhorn', 'Mapterhorn (~30 m; até 1 m em alguns países)'],
        ['copernicus', 'Copernicus DEM GLO-30 (~30 m)'],
        ['terrarium', 'Terrain Tiles / Terrarium (~30–90 m)'],
      ], aoMudar, { lista: true }),
      informacao((c) => {
        const f = FONTES[c.params.fonte];
        let t = `<strong>Resolução no solo:</strong> ${f.resolucao}<br><strong>Vertical:</strong> ${f.vertical}`;
        if (c.info) {
          const zoom = c.info.zoom < 0 ? '' : ` (zoom ${c.info.zoomEfetivo}${c.info.zoomEfetivo !== c.info.zoom ? `; pedido ${c.info.zoom}, sem dados mais finos aqui` : ''})`;
          t += `<br><strong>Neste modelo:</strong> pixel de ~${decimal(c.info.resolucaoM, 1)} m${zoom}`;
        }
        if (c.params.fonte === 'copernicus') t += '<div class="aviso">Copernicus inclui prédios e copas de árvores no relevo. Em cidades, prefira o Mapterhorn.</div>';
        if (c.info?.aviso) t += `<div class="aviso">${c.info.aviso}</div>`;
        return t;
      }),
      opcoes('zoom', 'Zoom dos tiles', [['0', 'Automático'], ...Array.from({ length: 10 }, (_, k) => [String(k + 8), String(k + 8)] as [string, string])], aoMudar, {
        lista: true, visivel: (c) => c.params.fonte !== 'copernicus',
        dica: 'Automático escolhe o zoom pela resolução do modelo. Se faltar dado no zoom pedido, o app usa o maior disponível.',
      }),
      numero('resolucao', 'Pontos no lado maior', aoMudar, {
        deslizante: true, passo: 10, dica: 'Mais pontos = mais detalhe e geração mais lenta.',
      }),
      numero('simplificacaoMm', 'Simplificação da malha (erro máx.)', aoMudar, {
        deslizante: true, passo: 0.01,
        exibir: (c) => (c.params.simplificacaoMm === 0 ? 'desligada' : `${decimal(c.params.simplificacaoMm, 2)} mm`),
        dica: (c) => {
          if (!c.info) return 'Triangulação adaptativa: muitos triângulos onde o relevo muda, poucos onde é plano.';
          const red = 1 - c.info.triangulosSuperficie / c.info.triangulosGrade;
          return `Superfície: <strong>${inteiro(c.info.triangulosSuperficie)}</strong> triângulos (grade uniforme: ${inteiro(c.info.triangulosGrade)}${red > 0.005 ? `, −${Math.round(red * 100)}%` : ''}).`;
        },
      }),
      booleano('achatarMar', 'Mar plano (ignora o fundo do oceano)', aoMudar),
    ], (c) => `${c.params.travarAltura && impressao(c) ? 'auto' : `${decimal(c.params.exagero, 1)}x`} · ${FONTES[c.params.fonte].nome.split(' ')[0]}`),

    secao('estilo', 'Estilo do terreno', [
      opcoes('estilo', '', [['solido', 'Cor sólida'], ['faixas', 'Faixas por altitude']], aoMudar),
      cor('corTerreno', 'Cor do terreno', aoMudar, { visivel: (c) => c.params.estilo === 'solido' }),
      editorFaixas(aoMudar, {
        visivel: (c) => c.params.estilo === 'faixas',
        dica: (c) => {
          const cortes = (c.partes ?? []).filter((p) => p.id.startsWith('faixa-')).slice(0, -1).map((p) => p.zMax);
          if (!cortes.length) return 'Cada faixa vira uma peça separada, para trocar de filamento por altitude.';
          return `Trocas de cor em ${cortes.map((z) => medidaModelo(z, sis(c), 1)).join(' · ')}${impressao(c) ? ` (alinhadas às camadas de ${decimal(c.params.alturaCamadaMm, 2)} mm)` : ''}.`;
        },
      }),
    ], (c) => (c.params.estilo === 'solido' ? 'Cor sólida' : `${lerFaixas(c.params.faixas)?.length ?? 0} faixas`)),

    secao('base', 'Base', [
      numero('baseMm', 'Altura da base abaixo do ponto mais baixo', aoMudar, {
        unidade: 'mm', passo: 0.2,
        dica: (c) => {
          if (!impressao(c)) return 'No modo 1:1 este valor é em <strong>metros</strong>.';
          if (!c.info) return '';
          const n = Math.round((c.info.zBase - c.params.primeiraCamadaMm) / c.params.alturaCamadaMm) + 1;
          return `Usada: <strong>${decimal(c.info.zBase, 2)} mm</strong> = ${n} camadas.`;
        },
      }),
    ], (c) => `${decimal(c.params.baseMm, 1)} ${unidadeModelo(c)}`),

    secao('laterais', 'Laterais', [
      cor('corLaterais', 'Cor da base (e das laterais da base)', aoMudar),
      informacao(() => 'A base é uma peça separada; no 3MF (Fase E) ela pode receber outro filamento. Acima da base, as laterais têm a cor do terreno ou da faixa.'),
    ]),

    secao('impressao', 'Camadas de impressão', [
      numero('alturaCamadaMm', 'Altura de camada', aoMudar, { unidade: 'mm', passo: 0.02 }),
      numero('primeiraCamadaMm', 'Altura da primeira camada', aoMudar, {
        unidade: 'mm', passo: 0.02,
        dica: 'Use os mesmos valores do perfil no Snapmaker Orca. A base e as trocas de cor das faixas caem exatamente nessas alturas, sem degraus.',
      }),
    ], (c) => `${decimal(c.params.alturaCamadaMm, 2)} mm`),

    secao('estatisticas', 'Estatísticas', [
      informacao((c) => {
        if (!c.info || !c.partes) return 'Gere o modelo para ver as estatísticas.';
        const tri = c.partes.reduce((s, p) => s + p.indices.length / 3, 0);
        const verts = c.partes.reduce((s, p) => s + p.posicoes.length / 3, 0);
        const terreno = c.partes.filter((p) => p.id === 'terreno' || p.id.startsWith('faixa-')).length;
        const camadas = c.partes.filter((p) => ['predios', 'ruas', 'agua'].includes(p.id));
        const stlPecas = c.partes.reduce((s, p) => s + 84 + 50 * (p.indices.length / 3), 0);
        // 3MF: XML com vértices e triângulos, compactado em zip (~30%)
        const tmf = (verts * 60 + tri * 55) * 0.3;
        const cores = new Set(c.partes.map((p) => p.cor)).size;
        return `<table>
          <tr><td>Triângulos (todas as peças)</td><td>${inteiro(tri)}</td></tr>
          <tr><td>Objetos: Base</td><td>1</td></tr>
          <tr><td>Objetos: Terreno</td><td>${terreno}</td></tr>
          ${camadas.map((p) => `<tr><td>Objetos: ${p.nome}</td><td>1 (${inteiro(p.indices.length / 3)} triângulos)</td></tr>`).join('')}
          <tr><td>Cores</td><td>${cores}</td></tr>
          <tr><td>STL único</td><td>≈ ${bytes(stlPecas - 84 * (c.partes.length - 1))}</td></tr>
          <tr><td>STL por peça (total)</td><td>≈ ${bytes(stlPecas)}</td></tr>
          <tr><td>3MF (estimado)</td><td>≈ ${bytes(tmf)}</td></tr>
        </table>`;
      }),
    ], (c) => (c.partes ? `${inteiro(c.partes.reduce((s, p) => s + p.indices.length / 3, 0))} triângulos` : '')),
  ];

  for (const s of secoes) container.append(s.el);
  (secoes[0].el as HTMLDetailsElement).open = true;

  return {
    atualizar(c: Contexto) {
      for (const s of secoes) s.atualizar(c);
    },
  };
}
