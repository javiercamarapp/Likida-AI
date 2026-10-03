import dns from 'node:dns';
import { isIP } from 'node:net';
import { esIpPublica } from '@/lib/http/destino_publico';
import { ErrorTablaPropia } from './contrato';
import type { Registro } from './filas';

// ═══════════════════════════════════════════════════════════════════════════
// MODO sql_solo_lectura — la flota nos habilita un usuario de SOLO LECTURA sobre
// una VISTA (o réplica) y Likida lee de ahí. El SQL NO es libre. Capas, de
// afuera hacia adentro:
//   1. La flota NO escribe SQL: declara la VISTA y el MAPEO de columnas
//      (unidad, lat, lon, fecha_hora, velocidad, ignición). El texto de la
//      sentencia lo arma ESTE archivo con una sola forma: un SELECT.
//   2. Los identificadores (vista, esquema, columnas) pasan una lista cerrada de
//      forma (letras, dígitos, `_`, `$`; máx. 63; esquemas de sistema vetados) y
//      van entrecomillados. Los VALORES van SIEMPRE como parámetros ($1, $2).
//   3. `afirmarSelectSeguro` revisa el texto final antes de enviarlo: una sola
//      sentencia, empieza en SELECT, sin `;`, sin comentarios, sin palabras de
//      escritura/administración, sin `into`/`for update`. Si algo no cuadra, NO
//      se envía (defensa en profundidad: la capa 1 ya lo hace imposible).
//   4. La conexión corre en `SET TRANSACTION READ ONLY` con `statement_timeout` e `idle_in_transaction_session_timeout`,
//      un `LIMIT` en la consulta y, además, un tope de filas y de BYTES al traerlas (cursor del servidor: nunca se
//      carga en memoria más de lo permitido).
//   5. SSRF: el host se resuelve y se rechaza si CUALQUIER dirección es
//      privada/loopback/enlace local/metadatos; el socket se abre contra la IP
//      ya validada (sin segunda resolución) con TLS verificado contra el host.
//   6. Los errores que salen hacia el panel son frases NUESTRAS, nunca el texto
//      del servidor (puede traer el usuario, la base o la dirección).
// ═══════════════════════════════════════════════════════════════════════════

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const ESQUEMAS_VETADOS = new Set(['pg_catalog', 'information_schema', 'pg_toast', 'pg_temp', 'auth', 'vault', 'storage', 'supabase_functions', 'extensions']);
const PROHIBIDAS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|execute|do|vacuum|reindex|refresh|lock|listen|notify|set|reset|begin|commit|rollback|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|into)\b/i;

export const LIMITE_FILAS_POR_OMISION = 50_000;
export const LIMITE_FILAS_MAXIMO = 200_000;
export const TIMEOUT_SQL_MS = 20_000;
/** Tope de bytes de datos (suma de los valores de texto) que una lectura puede traer: 32 MiB. */
export const MAX_BYTES_SQL = 32 * 1024 * 1024;
const LOTE_CURSOR = 1_000;

export type ColumnasPosicion = { unidad: string; lat: string; lon: string; fecha_hora: string; velocidad_kmh?: string; ignicion?: string };
export type ColumnasGeocerca = { codigo: string; nombre: string; lat_centro?: string; lon_centro?: string; radio_m?: string; poligono_wkt?: string; cliente?: string };

export type ColumnasCurso = { codigo: string; nombre: string; unidad?: string; convenio?: string; casetas?: string; corredor_wkt?: string; buffer_m?: string; vigente_desde?: string; vigente_hasta?: string };

export function identificadorValido(n: unknown): n is string {
  return typeof n === 'string' && IDENT.test(n);
}

export function vistaValida(vista: unknown): { ok: string[] } | { error: string } {
  if (typeof vista !== 'string' || vista.trim() === '') return { error: 'falta la vista' };
  const partes = vista.trim().split('.');
  if (partes.length > 2 || !partes.every(identificadorValido)) return { error: 'la vista debe ser «nombre» o «esquema.nombre» (letras, dígitos y guion bajo)' };
  if (partes.length === 2 && ESQUEMAS_VETADOS.has(partes[0].toLowerCase())) return { error: `el esquema «${partes[0]}» no se puede leer` };
  if (/^pg_/i.test(partes[partes.length - 1])) return { error: 'las vistas del sistema no se pueden leer' };
  return { ok: partes };
}

const q = (n: string) => `"${n}"`;

export interface ConsultaSql { text: string; values: unknown[] }

/** Una sola forma de sentencia: SELECT <columnas con alias> FROM <vista> [WHERE …] ORDER BY … LIMIT n. */
export function construirSelect(
  vista: string,
  columnas: Readonly<Record<string, string | undefined>>,
  opciones: {
    /** Columna (alias) con la que se ordena y se filtra por ventana; sus valores salen como texto. */
    columnaFecha?: string;
    desdeLocal?: string;
    /** Columna (alias) y valores permitidos. */
    columnaUnidad?: string;
    unidades?: readonly string[];
    limite?: number;
  } = {},
): ConsultaSql {
  const v = vistaValida(vista);
  if ('error' in v) throw new ErrorTablaPropia(`vista inválida: ${v.error}`, 'formato');
  const asignadas = Object.entries(columnas).filter(([, c]) => c !== undefined && c !== '') as Array<[string, string]>;
  if (asignadas.length === 0) throw new ErrorTablaPropia('el mapeo de columnas está vacío', 'formato');
  for (const [alias, col] of asignadas) {
    if (!identificadorValido(alias)) throw new ErrorTablaPropia(`alias inválido: ${alias}`, 'formato');
    if (!identificadorValido(col)) throw new ErrorTablaPropia(`columna inválida «${String(col).slice(0, 40)}» para ${alias}`, 'formato');
  }
  const colDe = (alias: string | undefined): string | null => {
    if (!alias) return null;
    const c = columnas[alias];
    return c ? q(c) : null;
  };
  // Todo sale como texto: `timestamp` sin zona jamás se reinterpreta con la zona del servidor de la app,
  // y un `numeric` no pierde precisión por el camino.
  const lista = asignadas.map(([alias, col]) => `${q(col)}::text as ${q(alias)}`).join(', ');
  const values: unknown[] = []; const donde: string[] = [];
  const cf = colDe(opciones.columnaFecha);
  if (opciones.desdeLocal && cf) {
    values.push(opciones.desdeLocal);
    donde.push(`${cf} >= $${values.length}::timestamp`);
  }
  const cu = colDe(opciones.columnaUnidad);
  if (opciones.unidades?.length && cu) {
    values.push([...opciones.unidades]);
    donde.push(`${cu}::text = any($${values.length}::text[])`);
  }
  const limite = Math.min(Math.max(Math.trunc(opciones.limite ?? LIMITE_FILAS_POR_OMISION), 1), LIMITE_FILAS_MAXIMO);
  const text = `select ${lista} from ${v.ok.map(q).join('.')}${donde.length ? ` where ${donde.join(' and ')}` : ''}${cf ? ` order by ${cf} desc` : ''} limit ${limite}`;
  afirmarSelectSeguro(text);
  return { text, values };
}

/** Defensa en profundidad: el texto que se va a enviar es UN select de lectura, o no se envía. */
export function afirmarSelectSeguro(text: string): void {
  // Se quita el contenido de los identificadores entrecomillados (nombres legítimos pueden coincidir con una palabra).
  const sinIdent = text.replace(/"[^"]*"/g, '""');
  const fallo = (m: string) => { throw new ErrorTablaPropia(`consulta rechazada: ${m}`, 'formato'); };
  if (!/^\s*select\s/i.test(sinIdent)) fallo('no es un SELECT');
  if (sinIdent.includes(';')) fallo('más de una sentencia');
  if (/--|\/\*|\*\//.test(sinIdent)) fallo('trae comentarios');
  if (/'/.test(sinIdent)) fallo('trae literales de texto (los valores van como parámetros)');
  if (PROHIBIDAS.test(sinIdent)) fallo('trae palabras de escritura o administración');
  if (/\bfor\s+(update|share|no\s+key|key\s+share)\b/i.test(sinIdent)) fallo('pide bloqueo de filas');
}

// ── Puerto de ejecución ─────────────────────────────────────────────────────
export interface ConexionSql {
  host: string;
  puerto: number;
  base: string;
  usuario: string;
  clave: string;
  /** `verificar` (por omisión): TLS con certificado verificado (equivale a sslmode=verify-full). `sin_verificar`: cifrado pero acepta un certificado propio (sslmode=require). Nunca en claro. */
  ssl: 'verificar' | 'sin_verificar';
  /** CA del cliente en PEM (una o varias): con ella el certificado del servidor se verifica contra ESA CA. */
  ca?: string;
}

export interface EjecutorSql {
  ejecutar(c: ConsultaSql & { timeoutMs: number; zona: string }): Promise<Registro[]>;
}

/**
 * Una CA pegada en un campo de una sola línea llega sin saltos (o con «\n» literales). Se reconstruye cada certificado
 * (encabezado, cuerpo en base64 a 64 columnas y pie). Solo certificados públicos: una llave privada se rechaza.
 */
export function normalizarCaPem(texto: string): { ok: string } | { error: string } {
  const t = texto.trim().replace(/\\n/g, '\n').replace(/\r/g, '');
  if (t.length > 30_000) return { error: 'sql_ca es demasiado larga' };
  if (/PRIVATE KEY/.test(t)) return { error: 'sql_ca debe ser un certificado público (CA), nunca una llave privada' };
  const bloques = [...t.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (bloques.length === 0 || bloques.length > 5) return { error: 'sql_ca debe traer de 1 a 5 certificados PEM («-----BEGIN CERTIFICATE-----»)' };
  const salida: string[] = [];
  for (const b of bloques) {
    const cuerpo = b[1].replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cuerpo) || cuerpo.length < 100) return { error: 'sql_ca trae un certificado con cuerpo no válido' };
    salida.push(`-----BEGIN CERTIFICATE-----\n${(cuerpo.match(/.{1,64}/g) ?? []).join('\n')}\n-----END CERTIFICATE-----\n`);
  }
  return { ok: salida.join('') };
}

/** El host se resuelve y se descarta si CUALQUIER dirección no es pública. Devuelve la IP ya validada para abrir el socket. */
export async function resolverHostPublico(host: string, resolver: typeof dns.promises.lookup = dns.promises.lookup): Promise<string> {
  const h = host.trim().replace(/^\[|\]$/g, '');
  if (h === '' || h.length > 253) throw new ErrorTablaPropia('el servidor SQL no es una dirección válida', 'formato');
  if (isIP(h)) {
    if (!esIpPublica(h)) throw new ErrorTablaPropia('el servidor SQL debe tener una dirección pública (no se admiten direcciones internas)', 'formato');
    return h;
  }
  let direcciones: Array<{ address: string }>;
  try {
    direcciones = (await resolver(h, { all: true, verbatim: true })) as unknown as Array<{ address: string }>;
  } catch {
    throw new ErrorTablaPropia('no se pudo resolver el servidor SQL', 'proveedor');
  }
  if (direcciones.length === 0 || !direcciones.every((d) => esIpPublica(d.address))) {
    throw new ErrorTablaPropia('el servidor SQL resuelve a una dirección interna: no se admite', 'formato');
  }
  return direcciones[0].address;
}

type ClientePg = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Registro[] }>;
  end(): Promise<void>;
  on(ev: string, f: (e: unknown) => void): void;
};

const mensajeDe = (e: unknown): string => (typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '');

/** Del error del controlador a una frase NUESTRA y una clase (credencial, red/proveedor, formato). Nunca el texto del servidor. */
export const frasePorCodigo = (e: unknown): ErrorTablaPropia => {
  const codigo = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  const msg = mensajeDe(e);
  if (codigo === '28P01' || codigo === '28000') return new ErrorTablaPropia('el servidor SQL rechazó el usuario o la contraseña', 'credencial');
  if (codigo === '42501') return new ErrorTablaPropia('el usuario SQL no tiene permiso de lectura sobre esa vista', 'credencial');
  if (codigo === '3D000') return new ErrorTablaPropia('la base de datos configurada no existe en el servidor', 'formato');
  if (codigo === '42P01') return new ErrorTablaPropia('la vista configurada no existe (o no es visible para ese usuario)', 'formato');
  if (codigo === '42703') return new ErrorTablaPropia('una de las columnas configuradas no existe en la vista', 'formato');
  if (codigo === '57014') return new ErrorTablaPropia('la consulta superó el tiempo máximo; acota la vista o la ventana', 'proveedor');
  if (codigo === '25006') return new ErrorTablaPropia('la conexión SQL no es de solo lectura; se rechazó la operación', 'formato');
  // pg dice «The server does not support SSL connections» cuando el servidor no ofrece TLS: no hay modo en claro.
  if (/does not support ssl/i.test(msg)) return new ErrorTablaPropia('el servidor SQL no ofrece conexión cifrada (TLS); Likida no se conecta en claro', 'formato');
  if (/self[- ]signed|unable to verify|certificate|hostname|altnames|ssl|tls/i.test(msg)) {
    return new ErrorTablaPropia('no se pudo verificar el certificado del servidor SQL (usa la CA de tu servidor en sql_ca)', 'formato');
  }
  if (/^(08|53|57P)/.test(codigo) || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH'].includes(codigo)) {
    return new ErrorTablaPropia('el servidor SQL no contestó', 'proveedor');
  }
  if (/timeout|timed out|terminated/i.test(msg)) return new ErrorTablaPropia('el servidor SQL no contestó a tiempo', 'proveedor');
  return new ErrorTablaPropia('la consulta al servidor SQL falló', 'proveedor');
};

export interface DepsEjecutorPg {
  cargarPg?: () => Promise<unknown>;
  resolver?: typeof dns.promises.lookup;
  /** Solo pruebas de integración (un Postgres en 127.0.0.1): sustituye TODA la resolución del host, incluido el guardián SSRF. */
  resolverHost?: (host: string) => Promise<string>;
  maxBytes?: number;
}

/**
 * El ejecutor REAL contra PostgreSQL, con `pg` (JavaScript puro, sin pg-native). UN cliente por pasada, siempre
 * cerrado (`finally`): compatible con funciones serverless (no hay pool que sobreviva a la invocación).
 * Orden: SSRF → TLS obligatorio → `begin` + `set transaction read only` + timeouts → cursor de solo lectura sobre el
 * SELECT ya validado → lotes con tope de filas y de bytes → rollback → cierre.
 */
export function crearEjecutorPg(conn: ConexionSql, deps: DepsEjecutorPg = {}): EjecutorSql {
  return {
    async ejecutar({ text, values, timeoutMs, zona }) {
      afirmarSelectSeguro(text);
      const ip = await (deps.resolverHost ? deps.resolverHost(conn.host) : resolverHostPublico(conn.host, deps.resolver));
      let pg: { Client: new (c: Record<string, unknown>) => ClientePg };
      try {
        const m = (await (deps.cargarPg ? deps.cargarPg() : import('pg'))) as { default?: unknown; Client?: unknown };
        pg = ((m.Client ? m : m.default) ?? m) as typeof pg;
        if (typeof pg.Client !== 'function') throw new Error('sin Client');
      } catch {
        throw new ErrorTablaPropia('El lector SQL no está habilitado en este despliegue (falta el controlador de PostgreSQL); usa CSV o endpoint mientras tanto.', 'formato');
      }
      const maxBytes = deps.maxBytes ?? MAX_BYTES_SQL;
      const cliente = new pg.Client({
        host: ip, port: conn.puerto, database: conn.base, user: conn.usuario, password: conn.clave,
        // TLS SIEMPRE (si el servidor no lo ofrece, pg falla: no hay retroceso a texto claro). La CA del cliente, si la dio.
        ssl: { ...(isIP(conn.host.replace(/^\[|\]$/g, '')) ? {} : { servername: conn.host }), rejectUnauthorized: conn.ssl === 'verificar', ...(conn.ca ? { ca: conn.ca } : {}) },
        connectionTimeoutMillis: Math.min(timeoutMs, 10_000),
        statement_timeout: timeoutMs, query_timeout: timeoutMs + 2_000, idle_in_transaction_session_timeout: timeoutMs + 5_000,
        application_name: 'likida_lector_tabla_propia',
        options: '-c default_transaction_read_only=on',
      });
      cliente.on('error', () => { /* un error de socket tras cerrar no debe tumbar el proceso */ });
      try {
        await cliente.connect();
        await cliente.query('begin');
        await cliente.query('set transaction read only');
        await cliente.query(
          'select set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true)',
          ['statement_timeout', String(timeoutMs), 'idle_in_transaction_session_timeout', String(timeoutMs + 5_000), 'TimeZone', zona],
        );
        await cliente.query(`declare likida_lectura no scroll cursor for ${text}`, values);
        const filas: Registro[] = [];
        let bytes = 0;
        for (;;) {
          const lote = (await cliente.query(`fetch forward ${LOTE_CURSOR} from likida_lectura`)).rows;
          if (lote.length === 0) break;
          for (const f of lote) {
            for (const v of Object.values(f)) bytes += typeof v === 'string' ? Buffer.byteLength(v) : 8;
            if (bytes > maxBytes) throw new ErrorTablaPropia(`la lectura superó el tope de ${Math.round(maxBytes / 1024 / 1024)} MB de datos; acota la ventana, la vista o limite_filas`, 'formato');
            filas.push(f);
          }
          if (filas.length > LIMITE_FILAS_MAXIMO) throw new ErrorTablaPropia(`la lectura superó el tope de ${LIMITE_FILAS_MAXIMO} filas`, 'formato');
          if (lote.length < LOTE_CURSOR) break;
        }
        await cliente.query('close likida_lectura');
        await cliente.query('rollback');
        return filas;
      } catch (e) {
        throw e instanceof ErrorTablaPropia ? e : frasePorCodigo(e);
      } finally {
        await cliente.end().catch(() => undefined);
      }
    },
  };
}
