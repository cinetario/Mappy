// Plugin do Vite que adiciona as rotas /api/* ao servidor de desenvolvimento.
// Assim um único comando (npm run dev) sobe o app e o "proxy" com cache.
import { access, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { obterGradeCopernicus } from './copernicus.ts';
import { PASTA_CACHE, buscarEndereco, ehFonteTile, obterTile, tipoDoTile } from './fontes.ts';

export function apiLocal(): Plugin {
  return {
    name: 'relevo3d-api',
    async configureServer(server) {
      await migrarCacheAntigo();
      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        try {
          // /api/terreno/<fonte>/<z>/<x>/<y>
          const tile = url.pathname.match(/^\/terreno\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)$/);
          if (tile && ehFonteTile(tile[1])) {
            const [z, x, y] = tile.slice(2).map(Number);
            const dados = await obterTile(tile[1], z, x, y);
            if (!dados) {
              res.statusCode = 404;
              res.end('Tile inexistente nesta fonte');
              return;
            }
            res.setHeader('Content-Type', tipoDoTile(tile[1]));
            res.setHeader('Cache-Control', 'public, max-age=604800');
            res.end(dados);
            return;
          }
          if (url.pathname === '/copernicus') {
            const n = (k: string) => Number(url.searchParams.get(k));
            const pedido = { oeste: n('oeste'), sul: n('sul'), leste: n('leste'), norte: n('norte'), nx: n('nx'), ny: n('ny') };
            const ok = Object.values(pedido).every(Number.isFinite)
              && pedido.leste > pedido.oeste && pedido.norte > pedido.sul
              && pedido.leste - pedido.oeste <= 4 && pedido.norte - pedido.sul <= 4
              && pedido.nx >= 2 && pedido.ny >= 2 && pedido.nx * pedido.ny <= 2_000_000;
            if (!ok) throw new Error('Pedido inválido para o Copernicus (área máxima de 4° × 4°)');
            const g = await obterGradeCopernicus(pedido);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('X-Tiles-Faltando', `${g.tilesFaltando}/${g.tilesTotal}`);
            res.setHeader('X-Resolucao-M', g.resolucaoM.toFixed(2));
            res.end(Buffer.from(g.elev.buffer, g.elev.byteOffset, g.elev.byteLength));
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

/** A Fase 1 guardava os tiles em cache/terreno; agora é cache/terrarium. */
async function migrarCacheAntigo() {
  const antigo = path.join(PASTA_CACHE, 'terreno');
  const novo = path.join(PASTA_CACHE, 'terrarium');
  const existe = (p: string) => access(p).then(() => true, () => false);
  if ((await existe(antigo)) && !(await existe(novo))) await rename(antigo, novo).catch(() => undefined);
}
