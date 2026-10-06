// Mapa 2D (MapLibre) com mapa de fundo da OpenFreeMap.
import { LngLatBounds, Map as MapaLibre, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Retangulo } from '../core/geo.ts';

setWorkerUrl(urlWorker);

// Mapa de fundo gratuito, sem chave e com uso comercial permitido (dados OSM).
const ESTILO = 'https://tiles.openfreemap.org/styles/liberty';

export function criarMapa(container: HTMLElement) {
  const mapa = new MapaLibre({
    container,
    style: ESTILO,
    center: [-46.6333, -23.5505],
    zoom: 11,
    attributionControl: { compact: false },
  });
  mapa.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  return mapa;
}

export function enquadrar(mapa: MapaLibre, r: Retangulo, animar = true) {
  mapa.fitBounds(new LngLatBounds([r.oeste, r.sul], [r.leste, r.norte]), { padding: 60, maxZoom: 16, animate: animar });
}
