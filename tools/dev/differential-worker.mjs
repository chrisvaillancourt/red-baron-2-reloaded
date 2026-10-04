import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, version as viteVersion } from 'vite';
import { validateValue } from './differential-values.mjs';

// The parent supplies exactly one identical scenario/input job to each fresh worker.
process.once('message', async ({ root, scenario, input, cacheDir }) => {
  let server;
  let packet;
  try {
    server = await createServer({
      root,
      configFile: false,
      envDir: false,
      publicDir: false,
      cacheDir,
      devtools: false,
      appType: 'custom',
      mode: 'development',
      logLevel: 'error',
      server: { middlewareMode: true, watch: null, ws: false, hmr: false, preTransformRequests: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const load = async (modulePath) => {
      if (typeof modulePath !== 'string' || isAbsolute(modulePath) || /[?#\0]/.test(modulePath)) throw new Error('load expects a root-relative module path without query/hash');
      const file = resolve(root, modulePath);
      const local = relative(root, file);
      if (local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error(`load path leaves comparison root: ${modulePath}`);
      return server.ssrLoadModule(`/@fs/${file}`);
    };
    const { default: run } = await import(pathToFileURL(scenario).href);
    if (typeof run !== 'function') throw new Error('scenario must default-export an async function ({ load, input })');
    const result = await run({ load, input });
    validateValue(result);
    packet = { ok: true, result, pid: process.pid };
  } catch (error) {
    packet = { ok: false, error: error?.stack ?? String(error), pid: process.pid };
  } finally {
    try {
      await server?.close();
    } catch (error) {
      packet = { ok: false, error: `Vite close failed: ${error?.stack ?? error}`, pid: process.pid };
    }
  }
  packet.viteVersion = viteVersion;
  process.send(packet, (error) => {
    if (error) process.exitCode = 2;
    process.disconnect();
  });
});
