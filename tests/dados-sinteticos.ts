// Dados OSM e terreno sintéticos usados nos testes da Fase C.
import type { DadosCamadas } from '../src/core/camadas.ts';
import type { GradeElevacao } from '../src/core/elevacao.ts';
import { parametrosPadrao, type Parametros } from '../src/core/estado.ts';
import { deslocar, dimensoesMetros, type Forma, type LonLat } from '../src/core/geo.ts';
import { planejarAmostragem } from '../src/core/modelo.ts';
import { extrairAgua, extrairPredios, extrairVias, type ElementoOSM } from '../src/core/osm.ts';

export const centro: LonLat = [-43.16, -22.95];
export const forma: Forma = { tipo: 'retangulo', oeste: -43.17, sul: -22.958, leste: -43.15, norte: -22.942 };
export const em = (dx: number, dy: number) => deslocar(centro, dx, dy); // metros a partir do centro
export const geo = (pts: LonLat[]) => pts.map(([lon, lat]) => ({ lat, lon }));
export const quadrado = (cx: number, cy: number, lado: number): LonLat[] => {
  const h = lado / 2;
  const a = [em(cx - h, cy - h), em(cx + h, cy - h), em(cx + h, cy + h), em(cx - h, cy + h)];
  return [...a, a[0]];
};

// ---------- dados OSM falsos ----------
export const elementos: ElementoOSM[] = [
  // prédio de 30 m (10 andares) e um sem altura
  { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '10' }, geometry: geo(quadrado(-300, 200, 60)) },
  { type: 'way', id: 2, tags: { building: 'house' }, geometry: geo(quadrado(-150, 200, 30)) },
  // prédio com pátio interno (multipolígono)
  {
    type: 'relation', id: 3, tags: { building: 'yes', type: 'multipolygon', height: '20 m' },
    members: [
      { type: 'way', ref: 31, role: 'outer', geometry: geo(quadrado(250, 250, 120)) },
      { type: 'way', ref: 32, role: 'inner', geometry: geo(quadrado(250, 250, 50)) },
    ],
  },
  // ruas
  { type: 'way', id: 10, tags: { highway: 'primary' }, geometry: geo([em(-900, -50), em(0, -50), em(900, 100)]) },
  { type: 'way', id: 11, tags: { highway: 'residential' }, geometry: geo([em(0, -800), em(0, 800)]) },
  { type: 'way', id: 12, tags: { highway: 'footway', footway: 'sidewalk' }, geometry: geo([em(-500, 400), em(-100, 400)]) },
  { type: 'way', id: 13, tags: { highway: 'residential', tunnel: 'yes' }, geometry: geo([em(400, -400), em(800, -400)]) },
  // água: lago, rio e costa (terra ao norte de y = -600: costa indo para leste, terra à esquerda)
  { type: 'way', id: 20, tags: { natural: 'water' }, geometry: geo(quadrado(-500, -350, 200)) },
  { type: 'way', id: 21, tags: { waterway: 'river' }, geometry: geo([em(600, 800), em(600, -500)]) },
  { type: 'way', id: 22, tags: { natural: 'coastline' }, geometry: geo([em(-2000, -600), em(2000, -600)]) },
];

export function grade(f: Forma, resolucao: number): GradeElevacao {
  const plano = planejarAmostragem(f, resolucao);
  const { largura, altura } = dimensoesMetros(plano.caixaGrade);
  const esp = Math.max(largura, altura) / (plano.amostras - 1);
  const nx = Math.round(largura / esp) + 1;
  const ny = Math.round(altura / esp) + 1;
  const elev = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const y = (j / (ny - 1) - 0.5) * altura;
      // mar abaixo de y = -600 m; morro suave ao norte
      elev[j * nx + i] = y < -620 ? 0 : 5 + Math.max(0, (y + 600) * 0.05) + 15 * Math.sin(i / 25);
    }
  }
  return { nx, ny, elev, larguraM: largura, alturaM: altura, zoom: 15 };
}

export const dados = (detalhados = false): DadosCamadas => ({
  predios: extrairPredios(elementos, detalhados, 10),
  vias: extrairVias(elementos),
  agua: extrairAgua(elementos),
});
export const params = (extra: Partial<Parametros> = {}): Parametros => ({ ...parametrosPadrao(), tamanhoMm: 200, exagero: 3, ...extra });


export function casos(): [string, Forma, GradeElevacao, Parametros, DadosCamadas][] {
  const hex: Forma = { tipo: 'hexagono', centro, raioM: 900, rotacaoGraus: 0 };
  return [
    ['padrão', forma, grade(forma, 180), params(), dados()],
    ['rebaixado', forma, grade(forma, 180), params({ ruasIntegracao: 'rebaixada', prediosIntegracao: 'rebaixado' }), dados()],
    ['hex detalhado', hex, grade(hex, 150), params({ prediosDetalhados: true }), dados(true)],
    ['hex 1:1', hex, grade(hex, 120), params({ modo: 'real', baseMm: 5 }), dados()],
  ];
}
