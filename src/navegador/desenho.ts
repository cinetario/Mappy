// Ferramentas de desenho e edição da área no mapa:
// Retângulo, Círculo, Hexágono e Polígono livre, com alças arrastáveis.
import type { GeoJSONSource, Map as MapaLibre, MapMouseEvent } from 'maplibre-gl';
import {
  anguloGraus, contornoLonLat, distanciaM, normalizarRetangulo,
  type Forma, type LonLat,
} from '../core/geo.ts';

export type Ferramenta = 'retangulo' | 'circulo' | 'hexagono' | 'poligono';

type Papel = 'vertice' | 'meio' | 'centro' | 'raio';
interface Alca { papel: Papel; idx: number; pos: LonLat }

interface OpcoesDesenho {
  /** chamada a cada mudança; `final` = fim de um desenho ou de um arraste */
  aoMudar(forma: Forma | null, final: boolean): void;
  aoMudarFerramenta(f: Ferramenta | null): void;
}

const COR = '#2f6f4f';
const PIXELS_FECHAR = 10;

export function criarDesenho(mapa: MapaLibre, opcoes: OpcoesDesenho) {
  let forma: Forma | null = null;
  let ferramenta: Ferramenta | null = null;
  let antesDoDesenho: Forma | null = null; // para o "Cancelar"
  let inicio: LonLat | null = null; // ponto inicial do arraste (ret/círc/hex)
  let pontosPoligono: LonLat[] = [];
  let cursorPoligono: LonLat | null = null;
  let arraste: { alca: Alca; origem: LonLat; formaOriginal: Forma } | null = null;
  let pronto = false;

  // ---------- camadas do mapa ----------
  const iniciarCamadas = () => {
    mapa.addSource('selecao', { type: 'geojson', data: vazio() });
    mapa.addSource('alcas', { type: 'geojson', data: vazio() });
    mapa.addLayer({ id: 'selecao-fundo', type: 'fill', source: 'selecao', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': COR, 'fill-opacity': 0.15 } });
    mapa.addLayer({ id: 'selecao-borda', type: 'line', source: 'selecao', paint: { 'line-color': COR, 'line-width': 2.5 } });
    mapa.addLayer({
      id: 'alcas-ponto',
      type: 'circle',
      source: 'alcas',
      paint: {
        'circle-radius': ['match', ['get', 'papel'], 'meio', 4.5, 'centro', 6, 7],
        'circle-color': ['match', ['get', 'papel'], 'centro', COR, '#ffffff'],
        'circle-opacity': ['match', ['get', 'papel'], 'meio', 0.75, 1],
        'circle-stroke-color': COR,
        'circle-stroke-width': 2,
      },
    });
    pronto = true;
    desenhar();
  };
  if (mapa.isStyleLoaded()) iniciarCamadas();
  else mapa.once('load', iniciarCamadas);

  function vazio(): GeoJSON.FeatureCollection {
    return { type: 'FeatureCollection', features: [] };
  }

  function desenhar() {
    if (!pronto) return;
    const selecao = vazio();
    const alcas = vazio();
    if (ferramenta === 'poligono' && pontosPoligono.length > 0) {
      const linha = cursorPoligono ? [...pontosPoligono, cursorPoligono] : pontosPoligono;
      selecao.features.push(linhaGeo(linha.length > 2 ? [...linha, linha[0]] : linha));
      pontosPoligono.forEach((pos, idx) => alcas.features.push(pontoGeo({ papel: 'vertice', idx, pos })));
    } else if (forma) {
      const anel = contornoLonLat(forma);
      selecao.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...anel, anel[0]]] } });
      if (!ferramenta) for (const a of alcasDe(forma)) alcas.features.push(pontoGeo(a));
    }
    (mapa.getSource('selecao') as GeoJSONSource).setData(selecao);
    (mapa.getSource('alcas') as GeoJSONSource).setData(alcas);
  }

  const linhaGeo = (pts: LonLat[]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
  const pontoGeo = (a: Alca): GeoJSON.Feature => ({ type: 'Feature', properties: { papel: a.papel, idx: a.idx }, geometry: { type: 'Point', coordinates: a.pos } });

  function alcasDe(f: Forma): Alca[] {
    switch (f.tipo) {
      case 'retangulo':
        return [
          ...contornoLonLat(f).map((pos, idx) => ({ papel: 'vertice' as const, idx, pos })),
          { papel: 'centro', idx: 0, pos: [(f.oeste + f.leste) / 2, (f.sul + f.norte) / 2] },
        ];
      case 'circulo':
        return [
          { papel: 'centro', idx: 0, pos: f.centro },
          { papel: 'raio', idx: 0, pos: contornoLonLat(f)[0] },
        ];
      case 'hexagono':
        return [
          { papel: 'centro', idx: 0, pos: f.centro },
          { papel: 'raio', idx: 0, pos: contornoLonLat(f)[0] },
        ];
      case 'poligono': {
        const n = f.pontos.length;
        const r: Alca[] = f.pontos.map((pos, idx) => ({ papel: 'vertice', idx, pos }));
        for (let i = 0; i < n; i++) {
          const a = f.pontos[i];
          const b = f.pontos[(i + 1) % n];
          r.push({ papel: 'meio', idx: i, pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
        }
        const c = f.pontos.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
        r.push({ papel: 'centro', idx: 0, pos: c as LonLat });
        return r;
      }
    }
  }

  // ---------- desenho de novas formas ----------
  function terminarFerramenta(nova: Forma | null, cancelado = false) {
    ferramenta = null;
    inicio = null;
    pontosPoligono = [];
    cursorPoligono = null;
    mapa.dragPan.enable();
    mapa.doubleClickZoom.enable();
    mapa.getCanvas().style.cursor = '';
    if (cancelado) forma = antesDoDesenho;
    else if (nova) forma = nova;
    desenhar();
    opcoes.aoMudarFerramenta(null);
    if (!cancelado && nova) opcoes.aoMudar(forma, true);
    else if (cancelado) opcoes.aoMudar(forma, false);
  }

  const lonLat = (e: MapMouseEvent): LonLat => [e.lngLat.lng, e.lngLat.lat];

  function formaArrastada(f: Ferramenta, a: LonLat, b: LonLat): Forma | null {
    if (f === 'retangulo') {
      const r = normalizarRetangulo(a, b);
      return r.leste - r.oeste > 1e-6 && r.norte - r.sul > 1e-6 ? { tipo: 'retangulo', ...r } : null;
    }
    const raioM = distanciaM(a, b);
    if (raioM < 1) return null;
    return f === 'circulo'
      ? { tipo: 'circulo', centro: a, raioM }
      : { tipo: 'hexagono', centro: a, raioM, rotacaoGraus: 0 };
  }

  function alcaSob(e: MapMouseEvent): Alca | null {
    if (!pronto) return null;
    const { x, y } = e.point;
    const f = mapa.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: ['alcas-ponto'] });
    if (f.length === 0) return null;
    // preferir vértices às alças de meio e de centro
    const ordem: Record<string, number> = { vertice: 0, raio: 0, meio: 1, centro: 2 };
    f.sort((a, b) => ordem[a.properties.papel] - ordem[b.properties.papel]);
    const p = f[0].properties as { papel: Papel; idx: number };
    return { papel: p.papel, idx: p.idx, pos: lonLat(e) };
  }

  mapa.on('mousedown', (e) => {
    if (e.originalEvent.button !== 0) return;
    if (ferramenta && ferramenta !== 'poligono') {
      e.preventDefault();
      inicio = lonLat(e);
      return;
    }
    if (ferramenta || !forma) return;
    const alca = alcaSob(e);
    if (!alca) return;
    e.preventDefault();
    mapa.dragPan.disable();
    let atual = forma;
    if (alca.papel === 'meio' && atual.tipo === 'poligono') {
      // arrastar o meio de um lado cria um vértice novo
      const pontos = atual.pontos.slice();
      pontos.splice(alca.idx + 1, 0, lonLat(e));
      atual = forma = { tipo: 'poligono', pontos };
      alca.papel = 'vertice';
      alca.idx += 1;
    }
    arraste = { alca, origem: lonLat(e), formaOriginal: atual };
  });

  mapa.on('mousemove', (e) => {
    const p = lonLat(e);
    if (ferramenta === 'poligono') {
      cursorPoligono = p;
      desenhar();
      return;
    }
    if (ferramenta && inicio) {
      forma = formaArrastada(ferramenta, inicio, p) ?? forma;
      desenhar();
      return;
    }
    if (arraste) {
      forma = aplicarArraste(arraste.formaOriginal, arraste.alca, arraste.origem, p);
      desenhar();
      opcoes.aoMudar(forma, false);
      return;
    }
    if (!ferramenta) mapa.getCanvas().style.cursor = alcaSob(e) ? 'move' : '';
  });

  mapa.on('mouseup', (e) => {
    if (ferramenta && ferramenta !== 'poligono' && inicio) {
      const nova = formaArrastada(ferramenta, inicio, lonLat(e));
      if (nova) terminarFerramenta(nova);
      else inicio = null; // foi só um clique: continua esperando o arraste
      return;
    }
    if (arraste) {
      arraste = null;
      mapa.dragPan.enable();
      opcoes.aoMudar(forma, true);
    }
  });

  // polígono: clique adiciona ponto; clique no primeiro ponto, duplo clique ou Enter fecha
  mapa.on('click', (e) => {
    if (ferramenta !== 'poligono') return;
    const p = lonLat(e);
    if (pontosPoligono.length >= 3) {
      const primeiro = mapa.project(pontosPoligono[0]);
      if (Math.hypot(primeiro.x - e.point.x, primeiro.y - e.point.y) < PIXELS_FECHAR) {
        fecharPoligono();
        return;
      }
    }
    const ultimo = pontosPoligono.at(-1);
    if (ultimo) {
      const u = mapa.project(ultimo);
      if (Math.hypot(u.x - e.point.x, u.y - e.point.y) < 3) return; // clique repetido
    }
    pontosPoligono.push(p);
    desenhar();
  });
  mapa.on('dblclick', (e) => {
    if (ferramenta !== 'poligono') return;
    e.preventDefault();
    fecharPoligono();
  });

  // botão direito num vértice do polígono remove o vértice
  mapa.on('contextmenu', (e) => {
    if (ferramenta || !forma || forma.tipo !== 'poligono' || forma.pontos.length <= 3) return;
    const alca = alcaSob(e);
    if (alca?.papel !== 'vertice') return;
    e.preventDefault();
    forma = { tipo: 'poligono', pontos: forma.pontos.filter((_, i) => i !== alca.idx) };
    desenhar();
    opcoes.aoMudar(forma, true);
  });

  function fecharPoligono() {
    if (pontosPoligono.length < 3) return;
    terminarFerramenta({ tipo: 'poligono', pontos: pontosPoligono.slice() });
  }

  window.addEventListener('keydown', (e) => {
    if (!ferramenta) return;
    if (e.key === 'Escape') terminarFerramenta(null, true);
    else if (e.key === 'Enter' && ferramenta === 'poligono') fecharPoligono();
    else if (e.key === 'Backspace' && ferramenta === 'poligono' && !(e.target instanceof HTMLInputElement)) {
      pontosPoligono.pop();
      desenhar();
    }
  });

  return {
    iniciar(f: Ferramenta) {
      if (ferramenta) terminarFerramenta(null, true);
      antesDoDesenho = forma;
      ferramenta = f;
      if (f === 'poligono') mapa.doubleClickZoom.disable();
      else mapa.dragPan.disable();
      mapa.getCanvas().style.cursor = 'crosshair';
      if (f !== 'poligono') forma = null;
      desenhar();
      opcoes.aoMudarFerramenta(f);
    },
    cancelar() {
      if (ferramenta) terminarFerramenta(null, true);
    },
    definirForma(f: Forma | null) {
      forma = f;
      desenhar();
    },
    get forma() {
      return forma;
    },
  };
}

/** Nova forma depois de arrastar uma alça de `de` até `para`. */
export function aplicarArraste(f: Forma, alca: { papel: Papel; idx: number }, de: LonLat, para: LonLat): Forma {
  const dLon = para[0] - de[0];
  const dLat = para[1] - de[1];
  const mover = (p: LonLat): LonLat => [p[0] + dLon, p[1] + dLat];
  if (alca.papel === 'centro') {
    switch (f.tipo) {
      case 'retangulo':
        return { ...f, oeste: f.oeste + dLon, leste: f.leste + dLon, sul: f.sul + dLat, norte: f.norte + dLat };
      case 'circulo':
      case 'hexagono':
        return { ...f, centro: mover(f.centro) };
      case 'poligono':
        return { tipo: 'poligono', pontos: f.pontos.map(mover) };
    }
  }
  switch (f.tipo) {
    case 'retangulo': {
      const cantos = contornoLonLat(f);
      const oposto = cantos[(alca.idx + 2) % 4];
      const r = normalizarRetangulo(oposto, para);
      if (r.leste - r.oeste < 1e-6 || r.norte - r.sul < 1e-6) return f;
      return { tipo: 'retangulo', ...r };
    }
    case 'circulo':
      return { ...f, raioM: Math.max(1, distanciaM(f.centro, para)) };
    case 'hexagono':
      return { ...f, raioM: Math.max(1, distanciaM(f.centro, para)), rotacaoGraus: anguloGraus(f.centro, para) };
    case 'poligono': {
      const pontos = f.pontos.slice();
      pontos[alca.idx] = para;
      return { tipo: 'poligono', pontos };
    }
  }
}
