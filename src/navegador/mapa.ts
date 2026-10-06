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
    // tudo da OpenFreeMap passa pelo servidor local, que guarda em cache/mapa/
    transformRequest: (url) => (url.startsWith('https://tiles.openfreemap.org/')
      ? { url: `${location.origin}/api/mapa?u=${encodeURIComponent(url)}` }
      : undefined),
  });
  mapa.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  return mapa;
}

/** Marca em vermelho os pedaços da área que ficaram sem dados do OpenStreetMap. */
export function mostrarFaltando(mapa: MapaLibre, blocos: { s: number; w: number; n: number; e: number }[]) {
  const dados: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: blocos.map((b) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[b.w, b.s], [b.e, b.s], [b.e, b.n], [b.w, b.n], [b.w, b.s]]] },
    })),
  };
  const aplicar = () => {
    const fonte = mapa.getSource('faltando') as { setData(d: GeoJSON.FeatureCollection): void } | undefined;
    if (fonte) {
      fonte.setData(dados);
      return;
    }
    mapa.addSource('faltando', { type: 'geojson', data: dados });
    mapa.addLayer({ id: 'faltando-fundo', type: 'fill', source: 'faltando', paint: { 'fill-color': '#c62828', 'fill-opacity': 0.18 } });
    mapa.addLayer({ id: 'faltando-borda', type: 'line', source: 'faltando', paint: { 'line-color': '#c62828', 'line-width': 2, 'line-dasharray': [2, 2] } });
  };
  if (mapa.isStyleLoaded()) aplicar();
  else mapa.once('load', aplicar);
}

export function enquadrar(mapa: MapaLibre, r: Retangulo, animar = true) {
  mapa.fitBounds(new LngLatBounds([r.oeste, r.sul], [r.leste, r.norte]), { padding: 60, maxZoom: 16, animate: animar });
}
