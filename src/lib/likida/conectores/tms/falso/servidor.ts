// Servidor TMS FALSO en memoria: un `Http` (función), no un servidor de red. Sirve de insumo de contrato a los lectores
// y a la demo cuando no hay API. Reproduce de forma DETERMINISTA los modos de falla que el origen real puede dar:
// login con token de vida corta, paginación, 401 al vencer, 429 con Retry-After, 5xx intermitente y HTML de login con 200.
import { generarDatos, type ConjuntoSintetico } from './datos';

export interface SolicitudHttp {
  metodo: 'GET' | 'POST';
  ruta: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  cuerpo?: unknown;
}
export interface RespuestaHttp {
  status: number;
  headers: Record<string, string>;
  /** Objeto JSON, o texto cuando el origen responde HTML. */
  cuerpo: unknown;
}
export type Http = (s: SolicitudHttp) => Promise<RespuestaHttp>;

export interface ConfigFalla {
  /** Devuelve 503 en cada solicitud de datos número N, 2N, 3N… (0/undefined = nunca). */
  cincoxxCada?: number;
  /** Tras `maximo` solicitudes de datos aceptadas, responde 429 con Retry-After (se reinicia al contarlo `reiniciarLimite`). */
  limite?: { maximo: number; retryAfterSeg: number };
  /** Toda ruta de datos responde 200 con la página HTML de login (sesión caída que NO da 401). */
  htmlLogin?: boolean;
}

export interface OpcionesServidor {
  datos?: ConjuntoSintetico;
  usuario?: string;
  clave?: string;
  /** Vigencia del token en ms (corta, configurable). */
  vigenciaTokenMs?: number;
  /** Reloj inyectable para vencer tokens sin esperar. */
  reloj?: () => number;
  tamPaginaDefecto?: number;
  fallas?: ConfigFalla;
}

export const HTML_LOGIN = '<!doctype html><html><head><title>Iniciar sesión</title></head><body><form action="/login"><input name="usuario"><input name="clave" type="password"></form></body></html>';

export const RUTAS_DATOS = ['liquidaciones', 'peajes', 'viajes', 'posiciones'] as const;
type RutaDatos = (typeof RUTAS_DATOS)[number];

/** Campo por el que se filtra cada recurso con `desde`/`hasta`. */
const CAMPO_FECHA: Record<RutaDatos, string> = { liquidaciones: 'de', peajes: 'fecha_posicion', viajes: 'Fecha Salida', posiciones: 'fecha' };

export interface ServidorTmsFalso {
  http: Http;
  fallas: ConfigFalla;
  /** Solicitudes de datos recibidas (incluye las que fallaron). */
  readonly solicitudesDatos: number;
  /** Logins emitidos. */
  readonly logins: number;
  reiniciarLimite(): void;
}

const aMs = (v: string): number => Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');

export function crearServidorTmsFalso(op: OpcionesServidor = {}): ServidorTmsFalso {
  const datos = op.datos ?? generarDatos();
  const usuario = op.usuario ?? 'usuario-sintetico';
  const clave = op.clave ?? 'clave-sintetica';
  const vigencia = op.vigenciaTokenMs ?? 60_000;
  const reloj = op.reloj ?? Date.now;
  const tamDef = op.tamPaginaDefecto ?? 5;
  const fallas: ConfigFalla = { ...(op.fallas ?? {}) };
  const tokens = new Map<string, number>(); // token -> expira (ms)
  let nDatos = 0; let nLogins = 0; let aceptadas = 0;

  const json = (status: number, cuerpo: unknown, headers: Record<string, string> = {}): RespuestaHttp =>
    ({ status, headers: { 'content-type': 'application/json', ...headers }, cuerpo });

  const http: Http = async (s) => {
    if (s.metodo === 'POST' && s.ruta === '/api/login') {
      const c = (s.cuerpo ?? {}) as { usuario?: unknown; clave?: unknown };
      if (c.usuario !== usuario || c.clave !== clave) return json(401, { error: 'credenciales inválidas' });
      nLogins++;
      const token = `tok-sintetico-${nLogins}`;
      const expira = reloj() + vigencia;
      tokens.set(token, expira);
      return json(200, { token, expira_en: expira });
    }
    const m = /^\/api\/([a-z_]+)$/.exec(s.ruta);
    if (s.metodo !== 'GET' || !m || !(RUTAS_DATOS as readonly string[]).includes(m[1])) return json(404, { error: 'ruta inexistente' });
    const recurso = m[1] as RutaDatos;
    nDatos++;

    if (fallas.htmlLogin) return { status: 200, headers: { 'content-type': 'text/html' }, cuerpo: HTML_LOGIN };

    const auth = s.headers?.authorization ?? s.headers?.Authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const exp = tokens.get(token);
    if (exp === undefined || reloj() >= exp) return json(401, { error: 'token inválido o vencido' }, { 'www-authenticate': 'Bearer' });

    if (fallas.cincoxxCada && nDatos % fallas.cincoxxCada === 0) return json(503, { error: 'servicio no disponible' });
    if (fallas.limite) {
      if (aceptadas >= fallas.limite.maximo) return json(429, { error: 'demasiadas solicitudes' }, { 'retry-after': String(fallas.limite.retryAfterSeg) });
      aceptadas++;
    }

    const q = s.query ?? {};
    const desde = q.desde !== undefined ? aMs(String(q.desde)) : -Infinity;
    const hasta = q.hasta !== undefined ? aMs(String(q.hasta)) : Infinity;
    const campo = CAMPO_FECHA[recurso];
    const filas = (datos[recurso] as unknown as Record<string, unknown>[]).filter((f) => {
      const t = aMs(String(f[campo]));
      return t >= desde && t <= hasta;
    });
    const tam = Math.max(1, Number(q.tam ?? tamDef) || tamDef);
    const pagina = Math.max(1, Number(q.pagina ?? 1) || 1);
    const totalPaginas = Math.max(1, Math.ceil(filas.length / tam));
    return json(200, { data: { items: filas.slice((pagina - 1) * tam, pagina * tam), pagina, total_paginas: totalPaginas, total: filas.length } });
  };

  return {
    http, fallas,
    get solicitudesDatos() { return nDatos; },
    get logins() { return nLogins; },
    reiniciarLimite() { aceptadas = 0; },
  };
}
