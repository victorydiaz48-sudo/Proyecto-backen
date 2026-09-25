// Quita de node_modules lo que solo está instalado como "peer" OPCIONAL de otra dependencia.
// npm instala igualmente esas peers (p. ej. @prisma/client → prisma, la herramienta de línea de
// comandos con Prisma Studio, una BD embebida, React…), que el servidor nunca usa.
// Recorre el grafo del package-lock.json desde las dependencias de producción de un workspace,
// siguiendo dependencies, optionalDependencies instaladas y peers NO opcionales; borra el resto.
// Uso: node prune-optional-peers.mjs <raíz> <workspace>   (p. ej. /app apps/api)
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [root = '.', workspace = 'apps/api'] = process.argv.slice(2);
const { packages } = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const installed = (loc) => loc in packages && existsSync(join(root, loc));

/** Resolución de Node: node_modules del propio paquete, luego el de cada paquete padre y la raíz. */
function resolve(from, name) {
  const dirs = [from];
  for (let d = from, i; (i = d.lastIndexOf('/node_modules/')) !== -1; ) dirs.push((d = d.slice(0, i)));
  dirs.push('');
  for (const dir of dirs) {
    const loc = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (installed(loc)) return packages[loc].link ? packages[loc].resolved : loc;
  }
  return null;
}

const reachable = new Set();
const queue = [workspace];
while (queue.length) {
  const loc = queue.pop();
  if (reachable.has(loc)) continue;
  reachable.add(loc);
  const p = packages[loc] ?? {};
  const optionalPeers = new Set(Object.entries(p.peerDependenciesMeta ?? {}).filter(([, m]) => m.optional).map(([n]) => n));
  const names = [
    ...Object.keys(p.dependencies ?? {}),
    ...Object.keys(p.optionalDependencies ?? {}),
    ...Object.keys(p.peerDependencies ?? {}).filter((n) => !optionalPeers.has(n)),
  ];
  for (const name of names) {
    const dep = resolve(loc, name);
    if (dep) queue.push(dep);
  }
}

let removed = 0;
for (const loc of Object.keys(packages).sort()) {
  if (!loc.startsWith('node_modules/') || reachable.has(loc) || !existsSync(join(root, loc))) continue;
  rmSync(join(root, loc), { recursive: true, force: true });
  removed++;
}
console.log(`prune-optional-peers: ${reachable.size} paquetes necesarios, ${removed} eliminados`);
