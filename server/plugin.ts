// Plugin do Vite que adiciona as rotas /api/* ao servidor de desenvolvimento.
// Assim um único comando (npm run dev) sobe o app e o "proxy" com cache.
import type { Plugin } from 'vite';
import { buscarEndereco, obterTileTerreno } from './fontes.ts';

export function apiLocal(): Plugin {
  return {
    name: 'relevo3d-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        try {
          const tile = url.pathname.match(/^\/terreno\/(\d+)\/(\d+)\/(\d+)\.png$/);
          if (tile) {
            const [z, x, y] = tile.slice(1).map(Number);
            const png = await obterTileTerreno(z, x, y);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=604800');
            res.end(png);
            return;
          }
          if (url.pathname === '/busca') {
            const json = await buscarEndereco(url.searchParams.get('q') ?? '');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(json);
            return;
          }
          res.statusCode = 404;
          res.end('Rota não encontrada');
        } catch (erro) {
          res.statusCode = 502;
          res.end(String(erro instanceof Error ? erro.message : erro));
        }
      });
    },
  };
}
