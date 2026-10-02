import { z } from 'zod';
import type { ValoresCredencial } from '../tipos';
import { RUTA } from '../posiciones_proveedores';
import { jsonCualquiera } from '../posiciones_comun';
import { MODOS_TABLA_PROPIA, type ModoTablaPropia } from './contrato';
import { LIMITE_FILAS_MAXIMO, LIMITE_FILAS_POR_OMISION, identificadorValido, vistaValida, type ColumnasGeocerca, type ColumnasPosicion, type ConexionSql } from './sql';
import { ZONA_POR_OMISION, zonaValida } from './tiempo';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN POR FLOTA del lector de tabla propia. Vive en la credencial
// del conector `tabla_propia` (cifrada con el cofre, igual que las demás): el
// usuario/clave SQL y el token del endpoint NUNCA se guardan en claro. Todo se
// valida AQUÍ, al guardar/probar y otra vez en cada lectura: lo que no cuadra
// no se lee, y se dice por qué.
// ═══════════════════════════════════════════════════════════════════════════

export const PATRONES_HTTP = ['ninguna', 'bearer', 'cabecera', 'query', 'basic'] as const;

const CAMPOS_POSICION = z.object({
  unidad: RUTA, lat: RUTA, lon: RUTA, fecha_hora: RUTA, velocidad_kmh: RUTA.optional(), ignicion: RUTA.optional(),
}).strict();
const CAMPOS_GEOCERCA = z.object({
  codigo: RUTA, nombre: RUTA, lat_centro: RUTA.optional(), lon_centro: RUTA.optional(), radio_m: RUTA.optional(), poligono_wkt: RUTA.optional(), cliente: RUTA.optional(),
}).strict();
const PAGINACION = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('cursor'), param: RUTA, ruta_siguiente: RUTA }),
  z.object({ tipo: z.literal('pagina'), param: RUTA, inicio: z.number().int().min(0).max(1).default(1), tamano_param: RUTA.optional(), tamano: z.number().int().min(10).max(1000).default(200) }),
]);
export const MapeoEndpointPosiciones = z.object({
  lista: RUTA.optional(),
  campos: CAMPOS_POSICION,
  formato_fecha: z.enum(['texto', 'epoch_s', 'epoch_ms']).default('texto'),
  unidad_velocidad: z.enum(['kmh', 'mph', 'ms', 'nudos']).default('kmh'),
  paginacion: PAGINACION.optional(),
}).strict();
export const MapeoEndpointGeocercas = z.object({ lista: RUTA.optional(), campos: CAMPOS_GEOCERCA, paginacion: PAGINACION.optional() }).strict();
export type MapeoEndpointPosicionesT = z.infer<typeof MapeoEndpointPosiciones>;
export type MapeoEndpointGeocercasT = z.infer<typeof MapeoEndpointGeocercas>;

const COLUMNAS_POSICION_SQL = z.object({
  unidad: z.string(), lat: z.string(), lon: z.string(), fecha_hora: z.string(), velocidad_kmh: z.string().optional(), ignicion: z.string().optional(),
}).strict();
const COLUMNAS_GEOCERCA_SQL = z.object({
  codigo: z.string(), nombre: z.string(), lat_centro: z.string().optional(), lon_centro: z.string().optional(), radio_m: z.string().optional(), poligono_wkt: z.string().optional(), cliente: z.string().optional(),
}).strict();

export interface Autenticacion { patron: (typeof PATRONES_HTTP)[number]; nombreCampo: string; token: string }

export interface ConfigComun {
  zona: string;
  ventanaMinutos: number;
  limiteFilas: number;
  /**
   * M2: el barrido LARGO. Un tractor que reaparece tras un tramo sin señal sube su búfer de golpe, con la `fecha_hora` de
   * cuando se midió cada punto: la ventana corta de cada vuelta ya pasó de largo y esos puntos no se leerían nunca. Con este
   * valor (minutos, 0 = apagado) la vuelta de los primeros 5 minutos de cada hora lee hacia atrás tanto tiempo. Es seguro
   * repetir lectura (el asentador es idempotente por unidad + instante + proveedor); el costo es volumen, por eso nace apagado.
   */
  barridoLargoMinutos: number;
}
export type ConfigTablaPropia = ConfigComun & (
  | {
      modo: 'sql_solo_lectura'; conexion: ConexionSql; vista: string; columnas: ColumnasPosicion;
      vistaGeocercas?: string; columnasGeocercas?: ColumnasGeocerca;
    }
  | {
      modo: 'endpoint'; url: string; auth: Autenticacion; mapeo: MapeoEndpointPosicionesT;
      urlGeocercas?: string; mapeoGeocercas?: MapeoEndpointGeocercasT;
    }
  | { modo: 'csv_sftp'; url: string; auth: Autenticacion; urlGeocercas?: string }
);

export type ResultadoConfig = { ok: true; config: ConfigTablaPropia } | { ok: false; motivo: string };

const entero = (v: string | undefined, def: number, min: number, max: number): number | null => {
  if (v === undefined || v.trim() === '') return def;
  return /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
};

function jsonCampo<T>(texto: string | undefined, esquema: z.ZodType<T>, nombre: string): { ok: T } | { error: string } {
  if (!texto || texto.trim() === '') return { error: `falta ${nombre}` };
  const crudo = jsonCualquiera(texto);
  if (crudo === undefined) return { error: `${nombre} no es JSON válido` };
  const r = esquema.safeParse(crudo);
  if (!r.success) return { error: `${nombre} inválido: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'raíz'} ${i.message}`).join('; ')}` };
  return { ok: r.data };
}

function urlHttps(v: string | undefined, nombre: string, permitirSftp = false): { ok: string } | { error: string } {
  const t = (v ?? '').trim();
  if (t === '') return { error: `falta ${nombre}` };
  let u: URL;
  try { u = new URL(t); } catch { return { error: `${nombre} no es una URL válida` }; }
  if (u.protocol === 'sftp:' && permitirSftp) return { ok: t };
  if (u.protocol !== 'https:') return { error: `${nombre} debe ser https:// (el token y los datos viajan cifrados)` };
  if (u.username || u.password) return { error: `${nombre} no debe llevar usuario ni contraseña dentro de la dirección` };
  return { ok: t };
}

function autenticacion(v: ValoresCredencial): { ok: Autenticacion } | { error: string } {
  const patron = (v.patron ?? 'ninguna').trim().toLowerCase() || 'ninguna';
  if (!(PATRONES_HTTP as readonly string[]).includes(patron)) return { error: `patron de autenticación desconocido; usa uno de: ${PATRONES_HTTP.join(', ')}` };
  const nombreCampo = (v.nombre_campo ?? '').trim();
  const token = v.token ?? '';
  if (patron !== 'ninguna' && token === '') return { error: 'falta el token o la clave del endpoint' };
  if (['cabecera', 'query', 'basic'].includes(patron) && !/^[A-Za-z0-9_.-]{1,64}$/.test(nombreCampo)) {
    return { error: patron === 'basic' ? 'con autenticación basic, nombre_campo es el usuario (letras, dígitos, . _ -)' : 'falta el nombre de la cabecera o del parámetro (letras, dígitos, . _ -)' };
  }
  return { ok: { patron: patron as Autenticacion['patron'], nombreCampo, token } };
}

export function leerConfigTablaPropia(v: ValoresCredencial): ResultadoConfig {
  const no = (motivo: string): ResultadoConfig => ({ ok: false, motivo });
  const modo = (v.modo ?? '').trim() as ModoTablaPropia;
  if (!MODOS_TABLA_PROPIA.includes(modo)) return no(`modo desconocido; usa uno de: ${MODOS_TABLA_PROPIA.join(', ')}`);
  const zona = (v.zona ?? '').trim() || ZONA_POR_OMISION;
  if (!zonaValida(zona)) return no(`la zona horaria «${zona.slice(0, 40)}» no es válida (usa un nombre como Region/Ciudad)`);
  const ventana = entero(v.ventana_minutos, 30, 1, 1_440);
  if (ventana === null) return no('ventana_minutos debe ser un entero de 1 a 1,440');
  const limite = entero(v.limite_filas, LIMITE_FILAS_POR_OMISION, 1, LIMITE_FILAS_MAXIMO);
  if (limite === null) return no(`limite_filas debe ser un entero de 1 a ${LIMITE_FILAS_MAXIMO}`);
  const barrido = entero(v.barrido_largo_minutos, 0, 0, 1_440);
  if (barrido === null || (barrido !== 0 && barrido < 60)) return no('barrido_largo_minutos debe ser 0 (apagado) o un entero de 60 a 1,440');
  if (barrido !== 0 && barrido <= ventana) return no('barrido_largo_minutos debe ser mayor que ventana_minutos (o 0 para apagarlo)');
  const comun = { zona, ventanaMinutos: ventana, limiteFilas: limite, barridoLargoMinutos: barrido };

  if (modo === 'sql_solo_lectura') {
    const host = (v.sql_host ?? '').trim();
    if (host === '') return no('falta el servidor SQL (sql_host)');
    if (!/^[A-Za-z0-9.:_-]{1,253}$/.test(host)) return no('sql_host tiene caracteres no permitidos');
    const puerto = entero(v.sql_puerto, 5432, 1, 65_535);
    if (puerto === null) return no('sql_puerto inválido');
    const base = (v.sql_base ?? '').trim(); const usuario = (v.sql_usuario ?? '').trim(); const clave = v.sql_clave ?? '';
    if (!base || !usuario || clave === '') return no('faltan la base, el usuario o la clave SQL');
    if (/[\u0000-\u001f]/.test(base + usuario + clave) || base.length > 63 || usuario.length > 63) return no('la base o el usuario SQL tienen caracteres no permitidos');
    const ssl = (v.sql_ssl ?? 'verificar').trim();
    if (ssl !== 'verificar' && ssl !== 'sin_verificar') return no('sql_ssl debe ser «verificar» o «sin_verificar» (la conexión nunca va en claro)');
    const vista = vistaValida(v.vista);
    if ('error' in vista) return no(vista.error);
    const cols = jsonCampo(v.columnas, COLUMNAS_POSICION_SQL, 'el mapeo de columnas (columnas)');
    if ('error' in cols) return no(cols.error);
    for (const [k, c] of Object.entries(cols.ok)) if (!identificadorValido(c)) return no(`la columna de ${k} no es un nombre válido`);
    let vistaGeo: string | undefined; let colsGeo: ColumnasGeocerca | undefined;
    if ((v.vista_geocercas ?? '').trim() !== '') {
      const vg = vistaValida(v.vista_geocercas);
      if ('error' in vg) return no(`vista de geocercas: ${vg.error}`);
      const cg = jsonCampo(v.columnas_geocercas, COLUMNAS_GEOCERCA_SQL, 'el mapeo de columnas de geocercas (columnas_geocercas)');
      if ('error' in cg) return no(cg.error);
      for (const [k, c] of Object.entries(cg.ok)) if (!identificadorValido(c)) return no(`la columna de geocercas ${k} no es un nombre válido`);
      if (!cg.ok.poligono_wkt && !(cg.ok.lat_centro && cg.ok.lon_centro && cg.ok.radio_m)) return no('las geocercas necesitan centro y radio (lat_centro, lon_centro, radio_m) o poligono_wkt');
      vistaGeo = v.vista_geocercas!.trim(); colsGeo = cg.ok;
    }
    return { ok: true, config: { ...comun, modo, conexion: { host, puerto, base, usuario, clave, ssl }, vista: v.vista!.trim(), columnas: cols.ok, vistaGeocercas: vistaGeo, columnasGeocercas: colsGeo } };
  }

  const url = urlHttps(v.base_url, 'la dirección (base_url)', modo === 'csv_sftp');
  if ('error' in url) return no(url.error);
  const auth = autenticacion(v);
  if ('error' in auth) return no(auth.error);
  let urlGeo: string | undefined;
  if ((v.geocercas_url ?? '').trim() !== '') {
    const ug = urlHttps(v.geocercas_url, 'geocercas_url', modo === 'csv_sftp');
    if ('error' in ug) return no(ug.error);
    urlGeo = ug.ok;
  }
  if (modo === 'csv_sftp') return { ok: true, config: { ...comun, modo, url: url.ok, auth: auth.ok, urlGeocercas: urlGeo } };
  const mapeo = jsonCampo(v.mapeo_posiciones, MapeoEndpointPosiciones, 'el mapeo de campos (mapeo_posiciones)');
  if ('error' in mapeo) return no(mapeo.error);
  let mapeoGeo: MapeoEndpointGeocercasT | undefined;
  if (urlGeo) {
    const mg = jsonCampo(v.mapeo_geocercas, MapeoEndpointGeocercas, 'el mapeo de campos de geocercas (mapeo_geocercas)');
    if ('error' in mg) return no(mg.error);
    mapeoGeo = mg.ok;
  }
  return { ok: true, config: { ...comun, modo, url: url.ok, auth: auth.ok, mapeo: mapeo.ok, urlGeocercas: urlGeo, mapeoGeocercas: mapeoGeo } };
}
