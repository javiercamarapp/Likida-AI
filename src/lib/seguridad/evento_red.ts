import { createHmac } from 'node:crypto';
import { redactarTexto } from '@/lib/logger';
import { ipCrudaDeCabeceras } from '@/lib/http/ip_cliente';

// ═══════════════════════════════════════════════════════════════════════════
// LA RED DE UN EVENTO DE SEGURIDAD (0954, CT-SEG-11).
//
// QUÉ SE GUARDA Y POR QUÉ: la IP completa es dato personal y para la pregunta
// «¿es la misma fuente la que insiste?» sobra. Se guarda `ip_hash`:
//   HMAC-SHA256(sal secreta, red truncada) cortado a 32 hex,
// con la red truncada a /24 (IPv4) o /48 (IPv6) ANTES de hashear. Truncar baja la
// identificabilidad; la sal secreta impide recuperar la red recorriendo las 2^24
// redes posibles. Sin la sal configurada (`SEGURIDAD_SAL_RED`, ≥ 16 caracteres)
// NO se guarda huella: se prefiere un null honesto a una huella sin sal. La
// huella y el user-agent se anonimizan a los 30 días (0955).
// ═══════════════════════════════════════════════════════════════════════════

const SAL_MINIMA = 16;

function salDeEntorno(): string | undefined {
  return process.env.SEGURIDAD_SAL_RED;
}

const salValida = (sal: string | undefined): sal is string => typeof sal === 'string' && sal.length >= SAL_MINIMA;

function aOctetos(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

/** Expande una IPv6 a ocho grupos de 16 bits, o null si no es una IPv6 válida. */
function aGruposV6(ip: string): number[] | null {
  let s = ip;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const o = aOctetos(v4[1]);
    if (!o) return null;
    s = s.slice(0, s.length - v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const mitades = s.split('::');
  if (mitades.length > 2) return null;
  const sep = (t: string) => (t === '' ? [] : t.split(':'));
  const izq = sep(mitades[0]);
  const der = mitades.length === 2 ? sep(mitades[1]) : [];
  if (mitades.length === 1 && izq.length !== 8) return null;
  if (mitades.length === 2 && izq.length + der.length > 7) return null;
  const relleno = mitades.length === 2 ? new Array(8 - izq.length - der.length).fill('0') : [];
  const todos = [...izq, ...relleno, ...der];
  if (todos.length !== 8 || !todos.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return todos.map((g) => parseInt(g, 16));
}

/**
 * La red a la que pertenece una IP, truncada: `a.b.c.0/24` o `g1:g2:g3::/48`. Null si no es una IP.
 * La IP completa no sale de esta función.
 */
export function truncarRed(ip: string | null | undefined): string | null {
  if (typeof ip !== 'string') return null;
  const t = ip.trim();
  if (!t) return null;
  const v4 = aOctetos(t);
  if (v4) return `${v4[0]}.${v4[1]}.${v4[2]}.0/24`;
  if (!t.includes(':')) return null;
  const g = aGruposV6(t);
  if (!g) return null;
  // IPv4 mapeada (::ffff:a.b.c.d): se trata como la IPv4 que es.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.0/24`;
  }
  return `${g[0].toString(16)}:${g[1].toString(16)}:${g[2].toString(16)}::/48`;
}

/** La huella (32 hex) de la red de una IP, o null si no hay IP válida o no hay sal (no se inventa una huella sin sal). */
export function huellaDeRed(ip: string | null | undefined, sal: string | undefined = salDeEntorno()): string | null {
  if (!salValida(sal)) return null;
  const red = truncarRed(ip);
  if (!red) return null;
  return createHmac('sha256', sal).update(`red|${red}`).digest('hex').slice(0, 32);
}

/** La IP del cliente segun las cabeceras: la UNICA regla de confianza (`http/ip_cliente.ts`), sin copia propia. */
export function ipDeCabeceras(h: Headers): string | null {
  return ipCrudaDeCabeceras(h);
}

/** User-agent sin caracteres de control y recortado a 200; null si queda vacío. */
export function uaSaneado(ua: string | null | undefined): string | null {
  if (typeof ua !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpio = ua.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return limpio === '' ? null : limpio;
}

export interface RedEvento { ipHash: string | null; ua: string | null }

/** Lo que se guarda de la red de una petición: la huella (si hay sal) y el user-agent saneado. */
export function redDeCabeceras(h: Headers, sal: string | undefined = salDeEntorno()): RedEvento {
  return { ipHash: huellaDeRed(ipDeCabeceras(h), sal), ua: uaSaneado(h.get('user-agent')) };
}

/**
 * El actor de un login fallido. NUNCA el correo: con sal, una huella estable de 12 hex (sirve para ver «la misma cuenta insistida»
 * sin guardar a quién pertenece); sin sal, solo el dominio (la parte local es la personal).
 */
export function huellaCuenta(email: string, sal: string | undefined = salDeEntorno()): string {
  const limpio = String(email ?? '').trim().toLowerCase();
  const arroba = limpio.lastIndexOf('@');
  if (arroba < 1 || arroba === limpio.length - 1) return 'cuenta:desconocida';
  if (salValida(sal)) return `cuenta:${createHmac('sha256', sal).update(`cuenta|${limpio}`).digest('hex').slice(0, 12)}`;
  return `cuenta:${limpio.slice(arroba)}`;
}

const LLAVE_SENSIBLE = /(pass|secret|token|authorization|cookie|llave|api[_-]?key|bearer|otp|jwt)/i;
const MAX_CADENA = 300;
const MAX_LLAVES = 20;
const MAX_PROFUNDIDAD = 3;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Redacta PII pero conserva los UUID (viaje, flota): son identificadores internos y sin ellos el evento no se puede rastrear. */
function redactarConservandoIds(t: string): string {
  const ids: string[] = [];
  const marcado = t.replace(UUID_RE, (m) => { ids.push(m); return `\u0000${ids.length - 1}\u0000`; });
  return redactarTexto(marcado).replace(/\u0000(\d+)\u0000/g, (_, i: string) => ids[Number(i)] ?? '');
}

function redactarValor(v: unknown, prof: number): unknown {
  if (typeof v === 'string') return redactarConservandoIds(v).slice(0, MAX_CADENA);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return prof >= MAX_PROFUNDIDAD ? '[recortado]' : v.slice(0, MAX_LLAVES).map((x) => redactarValor(x, prof + 1));
  if (v && typeof v === 'object') {
    if (prof >= MAX_PROFUNDIDAD) return '[recortado]';
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, MAX_LLAVES)) {
      out[k] = LLAVE_SENSIBLE.test(k) ? '[redactado]' : redactarValor(x, prof + 1);
    }
    return out;
  }
  return undefined;
}

/**
 * El detalle de un evento sin datos personales: correos/teléfonos/RFC/UUID por el MISMO redactor de los logs, llaves de nombre
 * sensible (token, cookie, authorization, llave…) borradas, cadenas a 300 caracteres, ≤ 20 llaves y 3 niveles. Nunca lanza.
 */
export function redactarDetalle(d: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!d || typeof d !== 'object') return undefined;
  try {
    const r = redactarValor(d, 0);
    return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : undefined;
  } catch {
    return { redaccion: 'fallo' };
  }
}
