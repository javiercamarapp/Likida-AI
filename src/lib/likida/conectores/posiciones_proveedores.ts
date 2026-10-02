// ═══════════════════════════════════════════════════════════════════════════
// LECTORES DE POSICIONES: Wialon, Geotab, Navixy y el genérico configurable.
//
// Hasta la ola 2 solo Samsara traía posiciones; los otros tres solo validaban la
// credencial (`gps.ts`). Aquí están sus lectores, escritos contra la
// documentación oficial de cada fabricante y probados con FIXTURES DE CONTRATO
// (`posiciones_proveedores.test.ts`): las respuestas de ejemplo salen de la doc,
// no de una instancia viva. NINGUNO se ha ejecutado contra una cuenta real —
// no existe una — y eso está declarado en docs/operacion/gps-proveedores.md como
// bloqueo externo. Lo que sí garantiza esta capa: una respuesta que no tenga la
// forma documentada termina en ERROR con nombre (`falla: 'formato'`), jamás en
// «0 posiciones, todo bien».
//
// Fuentes (consultadas el 1-oct-2026):
//   · Wialon — formato de unidad, flags y `pos`:
//     https://sdk.wialon.com/wiki/en/sidebar/remoteapi/apiref/format/unit
//     búsqueda: https://sdk.wialon.com/wiki/en/sidebar/remoteapi/apiref/core/search_items
//     login: https://help.wialon.com/en/api/user-guide/api-reference/token/login
//   · Geotab — `Get` + `DeviceStatusInfo`:
//     https://developers.geotab.com/myGeotab/apiReference/objects/DeviceStatusInfo
//     https://developers.geotab.com/myGeotab/apiReference/methods/Get
//     https://developers.geotab.com/myGeotab/guides/concepts/index.html
//   · Navixy — `tracker/list` y `tracker/get_states`:
//     https://navixy.com/docs/navixy-api/user-api/resources/tracking/tracker.md
// ═══════════════════════════════════════════════════════════════════════════
import { z } from 'zod';
import type { Http, ValoresCredencial } from './tipos';
import {
  MAX_PAGINAS_DEFENSIVO, aNumero, coordenadaValida, isoConZona, isoDeEpoch, jsonCualquiera, jsonObjeto,
  llamar, redondear1, relojDe,
  type OpcionesLecturaPaginada, type PosicionLeida, type ResultadoPosiciones,
} from './posiciones_comun';

const sinSlash = (v: string | undefined, porDefecto: string) => ((v ?? '').trim() || porDefecto).replace(/\/+$/, '');
const rumboSano = (v: unknown): number | null => {
  const n = aNumero(v);
  return n !== null && n >= 0 && n < 360 ? n : null;
};

// ═══ WIALON ═════════════════════════════════════════════════════════════════
// Sesión: `token/login` → `eid`. Muere a los 5 min sin actividad: se abre una
// por corrida y se cierra con `core/logout`.
// Lectura: `core/search_items` con flags 0x1 (base) + 0x400 (último mensaje y
// posición) = 1025, paginado con from/to. `pos` = {t: UNIX UTC s, y: lat,
// x: lon, s: km/h, c: rumbo}. Una unidad sin mensajes no trae `pos`.
// Códigos de error del Remote API (referencia general de Wialon, sin re-verificar
// contra instancia): 1 sesión inválida, 4 entrada inválida, 7 acceso denegado,
// 8 usuario/token inválido, 9 servidor de autorización no disponible, 10 límite
// de peticiones concurrentes. Un código desconocido se trata como fallo de
// formato, no como «sin datos».
const WIALON_PAGINA = 200;
const WIALON_FLAGS = 1 | 0x400;
const WIALON_TRANSITORIOS = new Set([9, 10]);

export async function leerPosicionesWialon(
  valores: ValoresCredencial, http: Http, opciones: OpcionesLecturaPaginada = {},
): Promise<ResultadoPosiciones> {
  const token = (valores.token ?? '').trim();
  if (!token) return { ok: false, motivo: 'falta el token de Wialon', falla: 'credencial' };
  const endpoint = `${sinSlash(valores.base_url, 'https://hst-api.wialon.com')}/wialon/ajax.html`;
  const reloj = relojDe(opciones);

  const pedir = async (svc: string, params: unknown, sid?: string) => {
    const cuerpo = new URLSearchParams({ svc, params: JSON.stringify(params) });
    if (sid) cuerpo.set('sid', sid);
    return llamar(http, {
      url: endpoint, metodo: 'POST',
      encabezados: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cuerpo: cuerpo.toString(),
    }, 'Wialon', reloj);
  };

  const abrirSesion = async (): Promise<{ ok: true; sid: string } | Extract<ResultadoPosiciones, { ok: false }>> => {
    const l = await pedir('token/login', { token });
    if (!l.ok) return { ok: false, motivo: l.motivo, falla: l.falla, backlog: l.backlog };
    if (l.r.estado !== 200) return { ok: false, motivo: `Wialon contestó ${l.r.estado} al abrir sesión.`, falla: 'proveedor' };
    const d = jsonObjeto(l.r.cuerpo);
    if (d === null) return { ok: false, motivo: 'Wialon contestó 200 con un cuerpo que no es JSON al abrir sesión.', falla: 'formato' };
    if (typeof d.error === 'number') {
      return WIALON_TRANSITORIOS.has(d.error)
        ? { ok: false, motivo: `Wialon no pudo abrir sesión por un problema transitorio (código ${d.error}).`, falla: 'proveedor', backlog: true }
        : { ok: false, motivo: `Wialon rechazó el token (código ${d.error}). Hay que generarlo de nuevo.`, falla: 'credencial' };
    }
    if (typeof d.eid !== 'string' || d.eid === '') return { ok: false, motivo: 'Wialon abrió sesión sin identificador (eid).', falla: 'formato' };
    return { ok: true, sid: d.eid };
  };

  let sesion = await abrirSesion();
  if (!sesion.ok) return sesion;
  let sid = sesion.sid;
  let relogins = 0;

  const posiciones: PosicionLeida[] = [];
  let invalidas = 0;
  let sinPosicion = 0;
  let paginas = 0;
  let desde = 0;
  try {
    while (paginas < MAX_PAGINAS_DEFENSIVO) {
      const l = await pedir('core/search_items', {
        spec: { itemsType: 'avl_unit', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
        force: 1, flags: WIALON_FLAGS, from: desde, to: desde + WIALON_PAGINA - 1,
      }, sid);
      if (!l.ok) return { ok: false, motivo: l.motivo, falla: l.falla, backlog: l.backlog, paginas };
      if (l.r.estado !== 200) return { ok: false, motivo: `Wialon contestó ${l.r.estado}.`, falla: 'proveedor', paginas };
      const d = jsonObjeto(l.r.cuerpo);
      if (d === null) return { ok: false, motivo: 'Wialon contestó 200 con un cuerpo que no es JSON.', falla: 'formato', paginas };
      if (typeof d.error === 'number') {
        if (d.error === 1 && relogins < 1) {
          // La sesión caducó a media lectura (5 min sin actividad): se renueva UNA vez.
          relogins += 1;
          sesion = await abrirSesion();
          if (!sesion.ok) return { ...sesion, paginas };
          sid = sesion.sid;
          continue;
        }
        if (WIALON_TRANSITORIOS.has(d.error)) return { ok: false, motivo: `Wialon respondió el código transitorio ${d.error}.`, falla: 'proveedor', backlog: true, paginas };
        return { ok: false, motivo: `Wialon rechazó la consulta de unidades (código ${d.error}).`, falla: d.error === 7 ? 'credencial' : 'formato', paginas };
      }
      if (!Array.isArray(d.items) || typeof d.totalItemsCount !== 'number') {
        return { ok: false, motivo: 'Wialon contestó 200 sin `items`/`totalItemsCount`: no es la respuesta documentada de core/search_items.', falla: 'formato', paginas };
      }
      paginas += 1;
      for (const it of d.items as Array<Record<string, unknown>>) {
        const id = it?.id;
        if (typeof id !== 'number' && typeof id !== 'string') { invalidas += 1; continue; }
        const pos = it.pos as Record<string, unknown> | null | undefined;
        if (!pos || typeof pos !== 'object') { sinPosicion += 1; continue; }
        const medidaEn = isoDeEpoch(pos.t, 's');
        if (!medidaEn || !coordenadaValida(pos.y, pos.x)) { invalidas += 1; continue; }
        const v = aNumero(pos.s);
        posiciones.push({
          deviceId: String(id), lat: pos.y as number, lng: pos.x as number, medidaEn,
          velocidad: v === null ? null : redondear1(v), rumbo: rumboSano(pos.c), ignicion: null,
        });
      }
      desde += WIALON_PAGINA;
      if (d.items.length === 0 || desde >= d.totalItemsCount) {
        return { ok: true, posiciones, paginas, completo: true, invalidas, sinPosicion };
      }
    }
    return { ok: false, motivo: 'Wialon excedió el fusible de 1,000 páginas; la lectura no se declaró completa.', falla: 'proveedor', backlog: true, paginas };
  } finally {
    // Higiene: cerrar la sesión para no acumular sesiones vivas en la cuenta del cliente.
    try { await http({ url: endpoint, metodo: 'POST', encabezados: { 'Content-Type': 'application/x-www-form-urlencoded' }, cuerpo: new URLSearchParams({ svc: 'core/logout', params: '{}', sid }).toString() }); } catch { /* best effort */ }
  }
}

// ═══ GEOTAB ═════════════════════════════════════════════════════════════════
// JSON-RPC sobre HTTPS en `https://[servidor]/apiv1`. `Authenticate` (máx. 10 por
// minuto) → `credentials` + `path`; si `path` ≠ "ThisServer" las consultas de
// datos van a ESE servidor. Lectura: `Get` typeName `DeviceStatusInfo` (tope de
// 50,000 registros; límite base de 100 Get por minuto): una fila por dispositivo
// con latitude/longitude/speed/bearing/dateTime. Los errores viajan DENTRO de un
// 200: `error.errors[0].name` = InvalidUserException, OverLimitException, …
// SUPUESTO NO VERIFICADO: la doc de DeviceStatusInfo no declara la unidad de
// `speed`; se toma km/h como el resto del modelo de Geotab (LogRecord). Está
// listado como bloqueo externo hasta verlo contra una base real.
const GEOTAB_LIMITE = 5_000;

function nombreErrorGeotab(d: Record<string, unknown>): string | null {
  const e = d.error;
  if (e === undefined || e === null) return null;
  const errs = (e as { errors?: Array<{ name?: unknown }> }).errors;
  const n = Array.isArray(errs) ? errs[0]?.name : (e as { name?: unknown }).name;
  return typeof n === 'string' ? n : 'error_desconocido';
}

export async function leerPosicionesGeotab(
  valores: ValoresCredencial, http: Http, opciones: OpcionesLecturaPaginada = {},
): Promise<ResultadoPosiciones> {
  const database = (valores.database ?? '').trim();
  const userName = (valores.usuario ?? '').trim();
  const password = valores.password ?? '';
  if (!database || !userName || !password) return { ok: false, motivo: 'faltan base de datos, usuario o contraseña de Geotab', falla: 'credencial' };
  const reloj = relojDe(opciones);
  const inicio = `${sinSlash(valores.base_url, 'https://my.geotab.com')}/apiv1`;
  const rpc = (url: string, cuerpo: unknown) => llamar(http, {
    url, metodo: 'POST', encabezados: { 'Content-Type': 'application/json' }, cuerpo: JSON.stringify(cuerpo),
  }, 'Geotab', reloj);

  const a = await rpc(inicio, { method: 'Authenticate', params: { database, userName, password } });
  if (!a.ok) return { ok: false, motivo: a.motivo, falla: a.falla, backlog: a.backlog };
  if (a.r.estado !== 200) return { ok: false, motivo: `Geotab contestó ${a.r.estado} al autenticar.`, falla: 'proveedor' };
  const da = jsonObjeto(a.r.cuerpo);
  if (da === null) return { ok: false, motivo: 'Geotab contestó 200 con un cuerpo que no es JSON al autenticar.', falla: 'formato' };
  const errA = nombreErrorGeotab(da);
  if (errA !== null) {
    return errA === 'OverLimitException' || errA === 'DbUnavailableException'
      ? { ok: false, motivo: `Geotab no pudo autenticar ahora (${errA}); se reintenta.`, falla: 'proveedor', backlog: true }
      : { ok: false, motivo: 'Geotab rechazó las credenciales (revisa base de datos, usuario y contraseña; si cambiaron la contraseña hay que recapturarla).', falla: 'credencial' };
  }
  const res = da.result as { credentials?: { sessionId?: unknown; database?: unknown; userName?: unknown }; path?: unknown } | undefined;
  const cred = res?.credentials;
  if (!cred || typeof cred.sessionId !== 'string' || cred.sessionId === '') {
    return { ok: false, motivo: 'Geotab autenticó sin `credentials.sessionId`: no es la respuesta documentada.', falla: 'formato' };
  }
  const ruta = typeof res?.path === 'string' ? res.path : 'ThisServer';
  const urlDatos = ruta === '' || ruta === 'ThisServer' ? inicio : `https://${ruta.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/apiv1`;

  const g = await rpc(urlDatos, {
    method: 'Get',
    params: {
      typeName: 'DeviceStatusInfo', resultsLimit: GEOTAB_LIMITE,
      credentials: { database: String(cred.database ?? database), userName: String(cred.userName ?? userName), sessionId: cred.sessionId },
    },
  });
  if (!g.ok) return { ok: false, motivo: g.motivo, falla: g.falla, backlog: g.backlog, paginas: 1 };
  if (g.r.estado !== 200) return { ok: false, motivo: `Geotab contestó ${g.r.estado} al leer estados.`, falla: 'proveedor', paginas: 1 };
  const dg = jsonObjeto(g.r.cuerpo);
  if (dg === null) return { ok: false, motivo: 'Geotab contestó 200 con un cuerpo que no es JSON al leer estados.', falla: 'formato', paginas: 1 };
  const errG = nombreErrorGeotab(dg);
  if (errG !== null) {
    return errG === 'OverLimitException' || errG === 'DbUnavailableException'
      ? { ok: false, motivo: `Geotab limitó la consulta (${errG}); se reintenta.`, falla: 'proveedor', backlog: true, paginas: 1 }
      : { ok: false, motivo: `Geotab rechazó la consulta de estados (${errG}).`, falla: errG === 'InvalidUserException' ? 'credencial' : 'formato', paginas: 1 };
  }
  if (!Array.isArray(dg.result)) return { ok: false, motivo: 'Geotab contestó 200 sin la lista `result` documentada.', falla: 'formato', paginas: 1 };
  if (dg.result.length >= GEOTAB_LIMITE) {
    return { ok: false, motivo: `Geotab devolvió ${GEOTAB_LIMITE} dispositivos (el tope de la consulta): la lectura puede estar truncada y no se declara completa.`, falla: 'formato', backlog: true, paginas: 1 };
  }
  const posiciones: PosicionLeida[] = [];
  let invalidas = 0;
  for (const s of dg.result as Array<Record<string, unknown>>) {
    const id = (s?.device as { id?: unknown } | undefined)?.id;
    const medidaEn = isoConZona(s?.dateTime);
    if (typeof id !== 'string' || id === '' || !medidaEn || !coordenadaValida(s.latitude, s.longitude)) { invalidas += 1; continue; }
    const v = aNumero(s.speed);
    posiciones.push({
      deviceId: id, lat: s.latitude as number, lng: s.longitude as number, medidaEn,
      velocidad: v === null || v < 0 ? null : redondear1(v), rumbo: rumboSano(s.bearing),
      // `isDriving` NO es ignición: un camión con motor encendido y parado no "maneja".
      ignicion: null,
    });
  }
  return { ok: true, posiciones, paginas: 1, completo: true, invalidas };
}

// ═══ NAVIXY ═════════════════════════════════════════════════════════════════
// `Authorization: NVX <api key>`; base REGIONAL obligatoria. `tracker/list` →
// ids; `tracker/get_states` (hasta 2,000 ids por petición; aquí 500) →
// `states[id].gps {updated, location{lat,lng}, heading, speed}` e `ignition`.
// Errores: `{success:false, status:{code, description}}`.
// SUPUESTO NO VERIFICADO: `gps.updated` viene como "YYYY-MM-DD HH:MM:SS" en la
// zona horaria DEL USUARIO (la respuesta trae `user_time` en esa zona). Se
// convierte a UTC con el desfase entre `user_time` y el reloj de Likida,
// redondeado a 15 min; un desfase fuera de ±14 h descarta la lectura.
const NAVIXY_LOTE = 500;

function utcDeNavixy(texto: unknown, desfaseMs: number): string | null {
  if (typeof texto !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const ingenuo = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const d = new Date(ingenuo - desfaseMs);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function leerPosicionesNavixy(
  valores: ValoresCredencial, http: Http, opciones: OpcionesLecturaPaginada = {},
): Promise<ResultadoPosiciones> {
  const key = (valores.api_key ?? '').trim();
  const baseUrl = (valores.base_url ?? '').trim().replace(/\/+$/, '');
  if (!key) return { ok: false, motivo: 'falta la API key de Navixy', falla: 'credencial' };
  if (!baseUrl) return { ok: false, motivo: 'falta el servidor regional de Navixy', falla: 'credencial' };
  const reloj = relojDe(opciones);
  const post = (ruta: string, cuerpo: unknown) => llamar(http, {
    url: `${baseUrl}/${ruta}`, metodo: 'POST',
    encabezados: { Authorization: `NVX ${key}`, 'Content-Type': 'application/json', accept: 'application/json' },
    cuerpo: JSON.stringify(cuerpo),
  }, 'Navixy', reloj);

  const revisar = (r: { estado: number; cuerpo: string }, paginas: number): { d: Record<string, unknown> } | Extract<ResultadoPosiciones, { ok: false }> => {
    if (r.estado === 401 || r.estado === 403) return { ok: false, motivo: `Navixy rechazó la API key (${r.estado}).`, falla: 'credencial', paginas };
    const d = jsonObjeto(r.cuerpo);
    if (d === null) return { ok: false, motivo: 'Navixy contestó con un cuerpo que no es JSON.', falla: 'formato', paginas };
    if (d.success !== true) {
      const code = (d.status as { code?: unknown } | undefined)?.code;
      // Códigos 3/4 = hash/clave inválida (referencia general de Navixy, sin re-verificar).
      return code === 3 || code === 4
        ? { ok: false, motivo: `Navixy rechazó la API key (código ${code}).`, falla: 'credencial', paginas }
        : { ok: false, motivo: `Navixy contestó sin éxito${typeof code === 'number' ? ` (código ${code})` : ''}.`, falla: r.estado >= 400 ? 'proveedor' : 'formato', paginas };
    }
    return { d };
  };

  const lista = await post('tracker/list', {});
  if (!lista.ok) return { ok: false, motivo: lista.motivo, falla: lista.falla, backlog: lista.backlog };
  const rl = revisar(lista.r, 0);
  if (!('d' in rl)) return rl;
  if (!Array.isArray(rl.d.list)) return { ok: false, motivo: 'Navixy contestó tracker/list sin `list`.', falla: 'formato', paginas: 1 };
  const ids: number[] = [];
  for (const t of rl.d.list as Array<Record<string, unknown>>) {
    const blocked = (t?.source as { blocked?: unknown } | undefined)?.blocked === true;
    if (typeof t?.id === 'number' && !blocked) ids.push(t.id);
  }

  const posiciones: PosicionLeida[] = [];
  let invalidas = 0;
  let sinPosicion = 0;
  let paginas = 1;
  for (let i = 0; i < ids.length; i += NAVIXY_LOTE) {
    const g = await post('tracker/get_states', { trackers: ids.slice(i, i + NAVIXY_LOTE), list_blocked: true, allow_not_exist: true });
    if (!g.ok) return { ok: false, motivo: g.motivo, falla: g.falla, backlog: g.backlog, paginas };
    const rg = revisar(g.r, paginas);
    if (!('d' in rg)) return rg;
    const states = rg.d.states;
    if (typeof states !== 'object' || states === null || Array.isArray(states)) {
      return { ok: false, motivo: 'Navixy contestó tracker/get_states sin `states`.', falla: 'formato', paginas };
    }
    paginas += 1;
    const userTime = typeof rg.d.user_time === 'string' ? rg.d.user_time : null;
    let desfase = 0;
    if (userTime) {
      const bruto = utcDeNavixy(userTime, 0);
      if (bruto) {
        const cuarto = 15 * 60_000;
        desfase = Math.round((Date.parse(bruto) - reloj.ahora()) / cuarto) * cuarto;
        if (Math.abs(desfase) > 14 * 3_600_000) { invalidas += Object.keys(states).length; continue; }
      }
    }
    for (const [id, st] of Object.entries(states as Record<string, { gps?: Record<string, unknown>; ignition?: unknown }>)) {
      const gps = st?.gps;
      if (!gps || gps.updated === null || gps.updated === undefined) { sinPosicion += 1; continue; }
      const loc = gps.location as { lat?: unknown; lng?: unknown } | undefined;
      const medidaEn = utcDeNavixy(gps.updated, desfase);
      if (!medidaEn || !loc || !coordenadaValida(loc.lat, loc.lng)) { invalidas += 1; continue; }
      const v = aNumero(gps.speed);
      posiciones.push({
        deviceId: id, lat: loc.lat as number, lng: loc.lng as number, medidaEn,
        velocidad: v === null || v < 0 ? null : redondear1(v), rumbo: rumboSano(gps.heading),
        ignicion: typeof st.ignition === 'boolean' ? st.ignition : null,
      });
    }
  }
  return { ok: true, posiciones, paginas, completo: true, invalidas, sinPosicion };
}

// ═══ GENÉRICO CONFIGURABLE ══════════════════════════════════════════════════
// Para el proveedor que no es ninguno de los de arriba: el cliente (o su
// integrador) declara en `mapeo_posiciones` DÓNDE está la lista y cómo se llama
// cada campo. Sin mapeo no hay lectura (no se adivina). Solo GET, solo el mismo
// origen que la dirección de prueba (el token no viaja a otro host), solo HTTPS
// público (el transporte rechaza IP privadas).
const PROHIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
const RUTA = z.string().min(1).max(200).regex(/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/, 'ruta con puntos')
  .refine((r) => !r.split('.').some((p) => PROHIBIDAS.has(p)), 'segmento no permitido');
export const MapeoGenerico = z.object({
  url: z.string().url().max(500).optional(),
  lista: RUTA.optional(),
  id: RUTA, lat: RUTA, lng: RUTA, fecha: RUTA,
  velocidad: RUTA.optional(), rumbo: RUTA.optional(), ignicion: RUTA.optional(),
  formato_fecha: z.enum(['iso', 'epoch_s', 'epoch_ms']).default('iso'),
  unidad_velocidad: z.enum(['kmh', 'mph', 'ms', 'nudos']).default('kmh'),
  paginacion: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('cursor'), param: RUTA, ruta_siguiente: RUTA }),
    z.object({ tipo: z.literal('pagina'), param: RUTA, inicio: z.number().int().min(0).max(1).default(1), tamano_param: RUTA.optional(), tamano: z.number().int().min(10).max(1000).default(200) }),
  ]).optional(),
}).strict();
export type MapeoGenericoT = z.infer<typeof MapeoGenerico>;

const FACTOR_KMH = { kmh: 1, mph: 1.609344, ms: 3.6, nudos: 1.852 } as const;

function porRuta(obj: unknown, ruta: string): unknown {
  let actual: unknown = obj;
  for (const p of ruta.split('.')) {
    if (PROHIBIDAS.has(p) || actual === null || typeof actual !== 'object' || !Object.hasOwn(actual as object, p)) return undefined;
    actual = (actual as Record<string, unknown>)[p];
  }
  return actual;
}

export function validarMapeoGenerico(texto: string | undefined): { ok: true; mapeo: MapeoGenericoT } | { ok: false; motivo: string } {
  if (!texto || texto.trim() === '') return { ok: false, motivo: 'falta el mapeo de campos (mapeo_posiciones)' };
  const crudo = jsonCualquiera(texto);
  if (crudo === undefined) return { ok: false, motivo: 'el mapeo de campos no es JSON válido' };
  const r = MapeoGenerico.safeParse(crudo);
  if (!r.success) return { ok: false, motivo: `mapeo de campos inválido: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'raíz'} ${i.message}`).join('; ')}` };
  return { ok: true, mapeo: r.data };
}

export async function leerPosicionesGenerico(
  valores: ValoresCredencial, http: Http, opciones: OpcionesLecturaPaginada = {},
): Promise<ResultadoPosiciones> {
  const v = validarMapeoGenerico(valores.mapeo_posiciones);
  if (!v.ok) return { ok: false, motivo: v.motivo, falla: 'formato' };
  const m = v.mapeo;
  const patron = (valores.patron ?? '').trim().toLowerCase();
  const campoAuth = (valores.nombre_campo ?? '').trim();
  const token = valores.token ?? '';
  if (!token) return { ok: false, motivo: 'falta el token del proveedor', falla: 'credencial' };
  if (!['bearer', 'cabecera', 'query'].includes(patron) || (patron !== 'bearer' && !campoAuth)) {
    return { ok: false, motivo: 'la forma de autenticación del proveedor está incompleta', falla: 'credencial' };
  }
  let origen: URL; let destino: URL;
  try {
    origen = new URL(valores.base_url ?? '');
    destino = new URL(m.url ?? valores.base_url ?? '');
  } catch { return { ok: false, motivo: 'la dirección del proveedor no es una URL válida', falla: 'formato' }; }
  if (destino.origin !== origen.origin) {
    return { ok: false, motivo: 'la dirección de posiciones debe ser del mismo servidor que la dirección de prueba: el token no se envía a otro host', falla: 'formato' };
  }
  const reloj = relojDe(opciones);
  const factor = FACTOR_KMH[m.unidad_velocidad];
  const posiciones: PosicionLeida[] = [];
  let invalidas = 0;
  let paginas = 0;
  let cursor: string | null = null;
  let pagina = m.paginacion?.tipo === 'pagina' ? m.paginacion.inicio : 0;
  const cursores = new Set<string>();

  while (paginas < MAX_PAGINAS_DEFENSIVO) {
    const url = new URL(destino.toString());
    const encabezados: Record<string, string> = { accept: 'application/json' };
    if (patron === 'bearer') encabezados.Authorization = `Bearer ${token}`;
    else if (patron === 'cabecera') encabezados[campoAuth] = token;
    else url.searchParams.set(campoAuth, token);
    if (m.paginacion?.tipo === 'cursor' && cursor) url.searchParams.set(m.paginacion.param, cursor);
    if (m.paginacion?.tipo === 'pagina') {
      url.searchParams.set(m.paginacion.param, String(pagina));
      if (m.paginacion.tamano_param) url.searchParams.set(m.paginacion.tamano_param, String(m.paginacion.tamano));
    }
    const l = await llamar(http, { url: url.toString(), metodo: 'GET', encabezados }, 'El proveedor', reloj);
    if (!l.ok) return { ok: false, motivo: l.motivo, falla: l.falla, backlog: l.backlog, paginas };
    if (l.r.estado === 401 || l.r.estado === 403) return { ok: false, motivo: `El proveedor rechazó la credencial (${l.r.estado}).`, falla: 'credencial', paginas };
    if (l.r.estado !== 200) return { ok: false, motivo: `El proveedor contestó ${l.r.estado}.`, falla: l.r.estado >= 400 && l.r.estado < 500 ? 'formato' : 'proveedor', paginas };
    const crudo = jsonCualquiera(l.r.cuerpo);
    if (crudo === undefined) return { ok: false, motivo: 'El proveedor contestó 200 con un cuerpo que no es JSON.', falla: 'formato', paginas };
    const lista = m.lista ? porRuta(crudo, m.lista) : crudo;
    if (!Array.isArray(lista)) return { ok: false, motivo: `La respuesta no trae la lista en «${m.lista ?? 'raíz'}»: el mapeo no corresponde a lo que contesta el proveedor.`, falla: 'formato', paginas };
    paginas += 1;
    for (const it of lista) {
      const idRaw = porRuta(it, m.id);
      const id = typeof idRaw === 'number' || typeof idRaw === 'string' ? String(idRaw).trim() : '';
      const lat = aNumero(porRuta(it, m.lat)); const lng = aNumero(porRuta(it, m.lng));
      const f = porRuta(it, m.fecha);
      const medidaEn = m.formato_fecha === 'iso' ? isoConZona(f) : isoDeEpoch(f, m.formato_fecha === 'epoch_s' ? 's' : 'ms');
      if (!id || lat === null || lng === null || !coordenadaValida(lat, lng) || !medidaEn) { invalidas += 1; continue; }
      const vel = m.velocidad ? aNumero(porRuta(it, m.velocidad)) : null;
      const ign = m.ignicion ? porRuta(it, m.ignicion) : undefined;
      posiciones.push({
        deviceId: id, lat, lng, medidaEn,
        velocidad: vel === null || vel < 0 ? null : redondear1(vel * factor),
        rumbo: m.rumbo ? rumboSano(porRuta(it, m.rumbo)) : null,
        ignicion: typeof ign === 'boolean' ? ign : null,
      });
    }
    if (!m.paginacion) return { ok: true, posiciones, paginas, completo: true, invalidas };
    if (m.paginacion.tipo === 'cursor') {
      const sig = porRuta(crudo, m.paginacion.ruta_siguiente);
      if (sig === null || sig === undefined || sig === '' || sig === false) return { ok: true, posiciones, paginas, completo: true, invalidas };
      const s = String(sig);
      if (s === cursor || cursores.has(s)) return { ok: false, motivo: 'El proveedor repitió un cursor: la lectura no es completa.', falla: 'formato', paginas, backlog: true };
      cursores.add(s); cursor = s;
    } else {
      if (lista.length < m.paginacion.tamano || lista.length === 0) return { ok: true, posiciones, paginas, completo: true, invalidas };
      pagina += 1;
    }
  }
  return { ok: false, motivo: 'El proveedor excedió el fusible de 1,000 páginas; la lectura no se declaró completa.', falla: 'proveedor', paginas, backlog: true };
}
