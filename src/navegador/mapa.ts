// Mapa 2D (MapLibre) com busca e desenho do retângulo de seleção.
import { LngLatBounds, Map as MapaLibre, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { normalizarRetangulo, type Retangulo } from '../core/geo.ts';

setWorkerUrl(urlWorker);

// Mapa de fundo gratuito, sem chave e com uso comercial permitido (dados OSM).
const ESTILO = 'https://tiles.openfreemap.org/styles/liberty';

export interface ControleMapa {
  mapa: MapaLibre;
  iniciarDesenho(): void;
  usarAreaVisivel(): void;
  irPara(caixa: [number, number, number, number]): void;
}

export function criarMapa(
  container: HTMLElement,
  aoSelecionar: (r: Retangulo) => void,
  aoMudarModoDesenho: (ativo: boolean) => void,
): ControleMapa {
  const mapa = new MapaLibre({
    container,
    style: ESTILO,
    center: [-46.6333, -23.5505],
    zoom: 11,
    attributionControl: { compact: false, customAttribution: 'Elevação: AWS Terrain Tiles' },
  });
  mapa.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

  const vazio: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  let selecao: GeoJSON.FeatureCollection = vazio;

  mapa.on('load', () => {
    mapa.addSource('selecao', { type: 'geojson', data: selecao });
    mapa.addLayer({ id: 'selecao-fundo', type: 'fill', source: 'selecao', paint: { 'fill-color': '#2f6f4f', 'fill-opacity': 0.15 } });
    mapa.addLayer({ id: 'selecao-borda', type: 'line', source: 'selecao', paint: { 'line-color': '#2f6f4f', 'line-width': 2.5 } });
  });

  const mostrar = (r: Retangulo) => {
    selecao = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[r.oeste, r.sul], [r.leste, r.sul], [r.leste, r.norte], [r.oeste, r.norte], [r.oeste, r.sul]]],
        },
      }],
    };
    const fonte = mapa.getSource('selecao') as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
    fonte?.setData?.(selecao);
  };

  let desenhando = false;
  let inicio: [number, number] | null = null;

  const terminarModo = () => {
    desenhando = false;
    inicio = null;
    mapa.dragPan.enable();
    mapa.getCanvas().style.cursor = '';
    aoMudarModoDesenho(false);
  };

  mapa.on('mousedown', (e) => {
    if (!desenhando) return;
    e.preventDefault();
    inicio = [e.lngLat.lng, e.lngLat.lat];
  });
  mapa.on('mousemove', (e) => {
    if (!desenhando || !inicio) return;
    mostrar(normalizarRetangulo(inicio, [e.lngLat.lng, e.lngLat.lat]));
  });
  mapa.on('mouseup', (e) => {
    if (!desenhando || !inicio) return;
    const r = normalizarRetangulo(inicio, [e.lngLat.lng, e.lngLat.lat]);
    terminarModo();
    if (r.leste - r.oeste < 1e-5 || r.norte - r.sul < 1e-5) {
      mostrar({ oeste: 0, sul: 0, leste: 0, norte: 0 });
      return; // foi só um clique, sem arrastar
    }
    mostrar(r);
    aoSelecionar(r);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && desenhando) terminarModo();
  });

  return {
    mapa,
    iniciarDesenho() {
      desenhando = true;
      mapa.dragPan.disable();
      mapa.getCanvas().style.cursor = 'crosshair';
      aoMudarModoDesenho(true);
    },
    usarAreaVisivel() {
      const b = mapa.getBounds();
      // margem de 10% para a seleção não colar na borda da tela
      const mx = (b.getEast() - b.getWest()) * 0.1;
      const my = (b.getNorth() - b.getSouth()) * 0.1;
      const r = { oeste: b.getWest() + mx, leste: b.getEast() - mx, sul: b.getSouth() + my, norte: b.getNorth() - my };
      mostrar(r);
      aoSelecionar(r);
    },
    irPara([sul, norte, oeste, leste]) {
      mapa.fitBounds(new LngLatBounds([oeste, sul], [leste, norte]), { padding: 40, maxZoom: 15 });
    },
  };
}
