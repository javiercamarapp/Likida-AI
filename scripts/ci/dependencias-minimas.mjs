// Versiones mínimas de dependencias sensibles (F22). Puro: recibe el package.json y el lockfile ya parseados.
// Fuente de los pisos: la versión que el lock trae hoy; subir un piso es un cambio deliberado, bajarlo no (sharp: CVE
// de libvips en fotos de WhatsApp sin autenticar; next: advisories 16.3.x).
export const MINIMOS = {
  next: '16.4.5',
  sharp: '0.35.0',
  '@supabase/supabase-js': '2.117.1',
  '@supabase/ssr': '0.12.7',
  'pdf-parse': '2.4.5',
};
export const NODE_MINIMO_MAYOR = 22;

const partes = (v) => String(v).replace(/^[^\d]*/, '').split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
export function comparar(a, b) {
  const x = partes(a), y = partes(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Todas las copias instaladas de cada paquete del lock (incluye anidadas) por debajo del mínimo. */
export function violacionesDeLock(lock, minimos = MINIMOS) {
  const fallos = [];
  for (const [ruta, info] of Object.entries(lock.packages ?? {})) {
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(ruta);
    if (!m || !(m[1] in minimos) || !info.version) continue;
    if (comparar(info.version, minimos[m[1]]) < 0) fallos.push(`${ruta} ${info.version} < ${minimos[m[1]]}`);
  }
  return fallos;
}

/** El piso declarado en package.json (dependencies/overrides) no puede quedar por debajo del mínimo. */
export function violacionesDePackage(pkg, minimos = MINIMOS) {
  const fallos = [];
  for (const [nombre, minimo] of Object.entries(minimos)) {
    const rango = pkg.dependencies?.[nombre] ?? pkg.devDependencies?.[nombre];
    if (rango === undefined) { fallos.push(`${nombre} no está declarada en package.json`); continue; }
    if (/^(file:|git|http|\*|latest)/.test(rango)) continue;
    if (comparar(rango, minimo) < 0) fallos.push(`${nombre} declara ${rango}, piso ${minimo}`);
  }
  const nodo = pkg.engines?.node;
  if (!nodo) fallos.push('engines.node no está declarado');
  else if (Number.parseInt(String(nodo).replace(/^[^\d]*/, ''), 10) < NODE_MINIMO_MAYOR) fallos.push(`engines.node "${nodo}" por debajo de ${NODE_MINIMO_MAYOR}`);
  return fallos;
}

/** Mayores de Node que usan los workflows (`node-version: N`) por debajo del piso de engines. */
export function violacionesDeWorkflows(textos, piso = NODE_MINIMO_MAYOR) {
  const fallos = [];
  for (const [nombre, texto] of Object.entries(textos)) {
    for (const m of texto.matchAll(/node-version:\s*['"]?(\d+)/g)) if (Number(m[1]) < piso) fallos.push(`${nombre}: node-version ${m[1]} < ${piso}`);
  }
  return fallos;
}
