// Doble HOSTIL del TMS para la suite de contrato. Todo sintético; ninguna red. Reproduce, de forma determinista,
// los modos de falla que el contrato SUPUESTO debe tolerar: token revocado a mitad de lectura (401, 200+HTML, 200+JSON
// de error), 429 con Retry-After, orden inestable (fila insertada al inicio entre páginas), mojibake y un origen que
// ignora la ventana de fechas. SUPUESTO-API: nada de aquí describe al sistema real del cliente.
import type { Http, PeticionHttp, RespuestaHttp } from '../../tipos';

export type ModoSesionCaida = '401' | 'html' | 'json';

export interface OpcionesDoble {
  /** Filas crudas por ruta (`/api/viajes`…). Una ruta ausente responde 404. */
  tablas: Record<string, Record<string, unknown>[]>;
  usuario?: string;
  clave?: string;
  /** El login siempre rechaza. */
  loginMalo?: boolean;
  /** Cómo avisa el origen que la sesión cayó. */
  modoCaida?: ModoSesionCaida;
  /** En la petición de datos número N (1 = primera) se revocan todos los tokens. */
  revocarEn?: number[];
  /** Toda petición de datos se contesta como sesión caída, aun con token recién emitido. */
  rechazaTodo?: boolean;
  /** 429 en las peticiones de datos listadas (o en todas con `siempre`). */
  limite429?: { en?: number[]; siempre?: boolean; retryAfter: string };
  /** Antes de servir la página 2 por primera vez, se inserta esta fila AL INICIO de la tabla. */
  insertarAntesDePagina2?: { ruta: string; fila: Record<string, unknown> };
  /** Convierte todos los textos a «UTF-8 leído como Latin-1». */
  mojibake?: boolean;
  /** El origen no filtra por desde/hasta (manda todo). */
  ignoraVentana?: boolean;
  /** Respuesta fija 200 en las rutas de datos (p. ej. HTML sin marcadores). */
  respuestaFija?: { tipo: string; cuerpo: string };
}

export interface DobleTms {
  http: Http;
  readonly logins: number;
  readonly solicitudesDatos: number;
  readonly peticiones: PeticionHttp[];
  revocarTodos(): void;
}

const CAMPOS_FECHA = ['Fecha Salida', 'Fecha', 'fecha'];
const aMsUtc = (v: string): number => Date.parse(v.replace(' ', 'T') + 'Z') + 6 * 3_600_000; // hora de Ciudad de México (UTC-6)

export const HTML_LOGIN_DOBLE = '<!doctype html><html><body><form action="/login"><input name="usuario"></form></body></html>';

export function aMojibake(valor: unknown): unknown {
  if (typeof valor === 'string') return Buffer.from(valor, 'utf8').toString('latin1');
  if (Array.isArray(valor)) return valor.map(aMojibake);
  if (valor !== null && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, aMojibake(v)]));
  return valor;
}

export function crearDobleTms(o: OpcionesDoble): DobleTms {
  const usuario = o.usuario ?? 'usuario-sintetico';
  const clave = o.clave ?? 'clave-sintetica';
  const tokens = new Set<string>();
  const peticiones: PeticionHttp[] = [];
  let logins = 0; let datos = 0; let insertado = false;
  const json = (estado: number, cuerpo: unknown, encabezados: Record<string, string> = {}): RespuestaHttp =>
    ({ estado, cuerpo: JSON.stringify(cuerpo), encabezados: { 'content-type': 'application/json', ...encabezados } });
  const caida = (): RespuestaHttp => {
    if (o.modoCaida === 'html') return { estado: 200, cuerpo: HTML_LOGIN_DOBLE, encabezados: { 'content-type': 'text/html; charset=utf-8' } };
    if (o.modoCaida === 'json') return json(200, { error: 'Token expirado, inicie sesión de nuevo' });
    return json(401, { error: 'no autorizado' });
  };

  const http: Http = async (p) => {
    peticiones.push(p);
    const u = new URL(p.url);
    if (p.metodo === 'POST' && u.pathname === '/api/login') {
      const c = JSON.parse(p.cuerpo ?? '{}') as { usuario?: string; clave?: string };
      if (o.loginMalo || c.usuario !== usuario || c.clave !== clave) return json(401, { error: 'credenciales inválidas' });
      logins += 1;
      const token = `tok-${logins}`;
      tokens.add(token);
      return json(200, { token });
    }
    datos += 1;
    if (o.revocarEn?.includes(datos)) tokens.clear();
    const token = (p.encabezados?.Authorization ?? '').replace(/^Bearer /, '');
    if (o.rechazaTodo || !tokens.has(token)) return caida();
    if (o.respuestaFija) return { estado: 200, cuerpo: o.respuestaFija.cuerpo, encabezados: { 'content-type': o.respuestaFija.tipo } };
    const l = o.limite429;
    if (l && (l.siempre || l.en?.includes(datos))) return json(429, { error: 'demasiadas solicitudes' }, { 'retry-after': l.retryAfter });

    const tabla = o.tablas[u.pathname];
    if (!tabla) return json(404, { error: 'ruta inexistente' });
    const pagina = Math.max(1, Number(u.searchParams.get('pagina') ?? 1) || 1);
    if (pagina === 2 && !insertado && o.insertarAntesDePagina2?.ruta === u.pathname) {
      insertado = true;
      tabla.unshift(o.insertarAntesDePagina2.fila);
    }
    const tam = Math.max(1, Number(u.searchParams.get('tam') ?? 100) || 100);
    const desde = Date.parse(u.searchParams.get('desde') ?? '');
    const hasta = Date.parse(u.searchParams.get('hasta') ?? '');
    let filas = tabla;
    if (!o.ignoraVentana) {
      filas = tabla.filter((f) => {
        const campo = CAMPOS_FECHA.find((c) => typeof f[c] === 'string');
        if (!campo) return true;
        const t = aMsUtc(f[campo] as string);
        return (!Number.isFinite(desde) || t >= desde) && (!Number.isFinite(hasta) || t <= hasta);
      });
    }
    const items = filas.slice((pagina - 1) * tam, pagina * tam);
    return json(200, { data: { items: o.mojibake ? aMojibake(items) : items, total_paginas: Math.max(1, Math.ceil(filas.length / tam)) } });
  };

  return {
    http, peticiones,
    get logins() { return logins; },
    get solicitudesDatos() { return datos; },
    revocarTodos() { tokens.clear(); },
  };
}

/** `n` viajes crudos con la forma del mapeo SUPUESTO: uno por día de octubre de 2026, salida 08:00 hora de México. */
export function viajesCrudos(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    Icident: `IC-${100 + i}`, unidad: `U-${i % 3}`,
    'Fecha Salida': `2026-10-${String(i + 1).padStart(2, '0')} 08:00:00`, 'Fecha Llegada': `2026-10-${String(i + 1).padStart(2, '0')} 18:00:00`,
    origen: 'Origen A', destino: 'Destino B', estatus: 'cerrado', operador: 'Operador Sintético',
  }));
}
