import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const distDir = join(projectRoot, 'dist');
const indexFile = join(distDir, 'index.html');
const routes = ['team', 'research', 'demo', 'publication', 'resources', 'about'];

if (!existsSync(indexFile)) {
  throw new Error('dist/index.html does not exist. Run this script after vite build.');
}

for (const route of routes) {
  const routeDir = join(distDir, route);
  mkdirSync(routeDir, { recursive: true });
  copyFileSync(indexFile, join(routeDir, 'index.html'));
}
