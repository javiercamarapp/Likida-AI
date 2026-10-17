#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GUARDA CONTRA PRODUCCIÓN del demo. Una sola implementación, la usan sembrar.sh, vaciar-sintetico.sh,
// probar-idempotencia.sh y los scripts .mjs con base. Corre ANTES de abrir ninguna conexión.
//
//   node guarda-host.mjs      (lee DEMO_DATABASE_URL, PGHOST, PGHOSTADDR, PGSERVICE, DEMO_PERMITIR_RED_PRIVADA)
//   sale 0 = se puede seguir · 2 = falta DEMO_DATABASE_URL · 3 = RECHAZADO (mensaje en stderr)
//
// Regla: solo se acepta un host que sea LOCAL de verdad:
//   · socket Unix (host vacío o ruta «/…»), «localhost», «host.docker.internal», 127.x.x.x, [::1];
//   · las redes privadas (10/8, 172.16/12, 192.168/16) SOLO con DEMO_PERMITIR_RED_PRIVADA=1 (valor exacto «1»):
//     una base de producción detrás de una VPN o de un pooler suele tener justo esas direcciones;
//   · todo lo demás se rechaza: IP pública, link-local, CGNAT (Tailscale), nombres de dominio (incluidos
//     «localhost.evil.com» y «127.0.0.1.nip.io»), IPs escritas en decimal/hex/abreviadas/con ceros, IPv6 mapeado,
//     listas de hosts con coma.
// Y se rechazan SIEMPRE las vías por las que libpq cambia de host sin que se vea en el «host» de la URL:
// ?host=, ?hostaddr=, ?service= (en la URL o en la cadena de conexión), y PGHOSTADDR / PGSERVICE en el entorno.
// Un túnel SSH a producción se ve como «localhost»: por eso se rechaza también un nombre de base con «prod».
// ═══════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'node:url';

const REMOTOS_CONOCIDOS = /supabase\.(co|com)|pooler\.|neon\.tech|amazonaws\.com|vercel|rds\.|render\.com|railway\.app|fly\.dev|azure|googleapis|cloud\.google|digitalocean|heroku/i;
const PARAMETROS_QUE_CAMBIAN_EL_HOST = ['host', 'hostaddr', 'service', 'servicefile'];

const ok = () => ({ ok: true, motivo: null });
const no = (motivo) => ({ ok: false, motivo });

function octetosEstrictos(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const o = m.slice(1).map((x) => (x.length > 1 && x.startsWith('0') ? NaN : Number(x)));
  return o.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? o : null;
}

/** Evalúa UN host (ya decodificado). `origen` es solo para el mensaje. */
export function evaluarUnHost(host, { permitirRedPrivada = false, origen = 'host' } = {}) {
  const h = String(host ?? '').trim().toLowerCase();
  if (h === '') return ok(); // socket Unix
  if (h.includes(',')) return no(`${origen} «${host}» lista varios hosts (libpq prueba uno por uno): solo se acepta uno, local.`);
  if (h.startsWith('/')) return ok(); // directorio del socket
  if (h === 'localhost' || h === 'host.docker.internal' || h === '[::1]' || h === '::1') return ok();
  const o = octetosEstrictos(h);
  if (!o) return no(`${origen} «${host}» no es localhost ni una IPv4 escrita en forma canónica. El demo solo se siembra en una base local.`);
  if (o[0] === 127) return ok();
  const privada = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
  if (privada) {
    return permitirRedPrivada
      ? ok()
      : no(`${origen} «${host}» es una red privada (10/8, 172.16/12, 192.168/16): ahí también viven las bases de producción detrás de una VPN o un pooler. Si de verdad es TU base de laboratorio, exporta DEMO_PERMITIR_RED_PRIVADA=1.`);
  }
  return no(`${origen} «${host}» no es local.`);
}

function parsearConninfo(s) {
  const pares = {};
  const re = /([A-Za-z_]+)\s*=\s*('(?:[^'\\]|\\.)*'|\S*)/g;
  let m; let resto = s;
  while ((m = re.exec(s)) !== null) {
    let v = m[2];
    if (v.startsWith("'")) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    pares[m[1].toLowerCase()] = v;
    resto = resto.replace(m[0], '');
  }
  return { pares, resto: resto.trim() };
}

/**
 * @param {{ url?: string, env?: Record<string,string|undefined> }} a
 * @returns {{ ok: boolean, motivo: string|null }}
 */
export function evaluarHost({ url, env = {} }) {
  const permitirRedPrivada = env.DEMO_PERMITIR_RED_PRIVADA === '1';
  const u = String(url ?? '').trim();
  if (u === '') return no('la URL de la base está vacía.');
  if (REMOTOS_CONOCIDOS.test(u)) return no('la URL parece una base remota o de producción (Supabase, pooler, Neon, nube…).');
  if (env.PGSERVICE) return no('PGSERVICE está definido: el archivo de servicios de libpq puede traer otro host. Quítalo para correr el demo.');
  if (env.PGHOSTADDR) {
    const r = evaluarUnHost(env.PGHOSTADDR, { permitirRedPrivada, origen: 'PGHOSTADDR' });
    if (!r.ok) return r;
  }

  let hostsDeLaUrl; let nombreBase = '';
  if (/^postgres(ql)?:\/\//i.test(u)) {
    if (/\s/.test(u)) return no('la URL trae espacios.');
    let p;
    try { p = new URL(u); } catch { return no('la URL no se puede interpretar.'); }
    for (const k of p.searchParams.keys()) {
      if (PARAMETROS_QUE_CAMBIAN_EL_HOST.includes(k.toLowerCase())) {
        return no(`la URL trae «?${k}=»: ese parámetro cambia el host real y salta esta guarda. Pon el host en la parte del servidor de la URL.`);
      }
    }
    let h = p.hostname;
    try { h = decodeURIComponent(h); } catch { return no('el host de la URL tiene un escape inválido.'); }
    hostsDeLaUrl = h;
    try { nombreBase = decodeURIComponent(p.pathname.replace(/^\//, '')); } catch { nombreBase = p.pathname; }
  } else if (/=/.test(u)) {
    const { pares, resto } = parsearConninfo(u);
    if (resto !== '') return no('la cadena de conexión no se pudo interpretar completa.');
    for (const k of Object.keys(pares)) {
      if (k === 'service' || k === 'servicefile') return no(`la cadena de conexión trae «${k}=»: puede traer otro host.`);
    }
    if (pares.hostaddr) {
      const r = evaluarUnHost(pares.hostaddr, { permitirRedPrivada, origen: 'hostaddr' });
      if (!r.ok) return r;
    }
    hostsDeLaUrl = pares.host ?? '';
    nombreBase = pares.dbname ?? '';
  } else {
    return no('no parece una URL postgresql:// ni una cadena de conexión «clave=valor».');
  }

  if (/prod/i.test(nombreBase)) return no(`el nombre de la base («${nombreBase}») contiene «prod»: un túnel local a producción se ve como localhost.`);

  // Sin host en la URL, libpq usa PGHOST (o el socket por omisión).
  const host = hostsDeLaUrl === '' ? (env.PGHOST ?? '') : hostsDeLaUrl;
  return evaluarUnHost(host, { permitirRedPrivada, origen: hostsDeLaUrl === '' && env.PGHOST ? 'PGHOST' : 'el host' });
}

/** Para los .mjs con base: corta el proceso si la guarda no pasa. */
export function exigirBaseLocal(env = process.env) {
  const url = env.DEMO_DATABASE_URL;
  if (!url) { console.error('Define DEMO_DATABASE_URL (p. ej. postgresql:///likida_demo). Este seed no adivina la base.'); process.exit(2); }
  const r = evaluarHost({ url, env });
  if (!r.ok) { console.error(`RECHAZADO: ${r.motivo}`); process.exit(3); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) exigirBaseLocal();
