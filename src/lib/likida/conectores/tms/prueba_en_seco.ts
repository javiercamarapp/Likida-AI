// ═══════════════════════════════════════════════════════════════════════════
// PRUEBA EN SECO DEL MAPEO TMS (R7-B1): antes de encender nada, lee una muestra ACOTADA del sistema de la flota con su credencial
// y su mapeo, la normaliza y dice, POR NOMBRE DE CAMPO, qué no cuadra. Es lo que se corre el día que llega la especificación real:
// se edita el mapeo (tabla `tms_mapeo` o un JSON) y se repite hasta que el reporte salga limpio.
//
// QUÉ NO HACE (cada punto tiene su prueba):
//  · No escribe NADA: ni en tablas de negocio, ni `tms_sincronizacion`/`tms_ingesta`, ni la credencial. Solo lee (login + GETs/POST de
//    lectura que el propio mapeo declara) y, en `pruebaEnSecoDeFlota`, lee `tms_mapeo` y la credencial.
//  · No registra ni devuelve VALORES de los datos: el reporte lleva nombres de campo (del mapeo y de las llaves de la respuesta),
//    tipos (texto/número/…) y conteos. Los motivos de `aplicarMapeo` citan valores («“12abc” no es un número»): aquí NO se copian.
//  · No pagina: pide UNA página (≤ `maxFilas` registros por recurso; `MAX_FILAS_EN_SECO` por defecto) de los últimos
//    `VENTANA_EN_SECO_DIAS` días. No avanza ningún cursor.
//
// QUÉ REPORTA por mapeo (`ReporteMapeoEnSeco`): campos requeridos que faltan (con el nombre de la fuente que se esperaba), llaves de la
// respuesta que el mapeo no usa (se ignoran), valores cuyo tipo/forma no cuadra con la transformación declarada (incluye «ambiguo»:
// «1.234» sin `decimal` declarado) y los conteos de filas leídas / mapeables / rechazadas / con clave repetida.
// ═══════════════════════════════════════════════════════════════════════════
import { logger } from '@/lib/logger';
import { httpsPublico } from '@/lib/http/https_publico';
import { ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import type { Http, ValoresCredencial } from '../tipos';
import { jsonCualquiera } from '../posiciones_comun';
import {
  aBooleano, aFechaLocal, aNumero, aplicarMapeo, leerRuta, parsearRuta, validarMapeo,
  type CampoDetallado, type MapeoTms, type Transformacion,
} from './mapeo';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { CONFIG_API_DESGLOSE, type ConfigApiDesglose } from '../../liquidacion_externa/desglose_tms_supuesto';
import { leerRuta as leerRutaDesglose, mapearBitacoraTms } from '../../liquidacion_externa/desglose_mapeo_tms';
import { instanteDeCursor } from './lector_desgloses';
import {
  CONFIG_PULL_MUESTRA_TMS, fechaDeParametro, type ConfigPullMuestraTms,
} from '../../liquidacion_externa/desglose_muestra_pull_config';
import { convertirBitacoraMuestra, listaDeMuestra, EnvoltorioInvalido, normalizarNombre } from '../../liquidacion_externa/desglose_muestra_tms';
import { SesionTms } from './sesion';
import { loginDe, RECURSOS_SINCRONIZABLES, urlBaseHttps, type RecursoSincronizable } from './acceso';

/** Tope de registros que se analizan por mapeo. */
export const MAX_FILAS_EN_SECO = 20;
/** Cuántos días hacia atrás se pide la muestra (la misma ventana inicial que el sincronizador). */
export const VENTANA_EN_SECO_DIAS = 2;
const DIA_MS = 86_400_000;
const MAX_NOMBRES = 50;
const MAX_LARGO_NOMBRE = 60;

export interface FaltanteRequerido {
  /** Nombre del campo destino del mapeo. */
  campo: string;
  /** Ruta de la respuesta de donde se esperaba. */
  fuente: string;
  /** En cuántas de las filas de la muestra faltó. */
  filas: number;
}
export interface CampoDesconocido { campo: string; filas: number }
export interface TipoQueNoCuadra {
  campo: string;
  fuente: string;
  esperado: Transformacion | 'valor_simple';
  /** Tipo observado (nunca el valor): texto, numero, booleano, objeto, lista. */
  recibido: 'texto' | 'numero' | 'booleano' | 'objeto' | 'lista';
  /** Solo numero: el texto tiene un separador que no se puede interpretar sin declarar `decimal` en el mapeo. */
  ambiguo?: true;
  filas: number;
}

export type EstadoMapeoEnSeco = 'limpio' | 'con_hallazgos' | 'error' | 'sin_mapeo';

export interface ReporteMapeoEnSeco {
  /** `viajes`, `peajes`, `posiciones` o `liquidaciones.nomina|operadores|conceptos`. */
  mapeo: string;
  estado: EstadoMapeoEnSeco;
  /** Frase propia (sin valores del origen) cuando el estado es `error`. */
  error?: string;
  filasLeidas: number;
  filasMapeables: number;
  filasRechazadas: number;
  /** Filas con la misma clave externa que otra de la muestra. */
  clavesRepetidas: number;
  faltantesRequeridos: FaltanteRequerido[];
  /** Campos NO obligatorios que no vinieron (nombre y cuántas filas): puede ser correcto, pero conviene mirarlo. */
  opcionalesAusentes: Array<{ campo: string; fuente: string; filas: number }>;
  camposDesconocidos: CampoDesconocido[];
  tiposQueNoCuadran: TipoQueNoCuadra[];
  /** Solo `desgloses`: campos del contrato interno que el mapeo de desgloses no pudo leer de la fila (nombre del campo y filas). */
  camposInvalidos: Array<{ campo: string; filas: number }>;
}

export interface ReporteEnSeco {
  /** Falso si no se pudo ni empezar (sin credencial, dirección inválida, login rechazado…). */
  accesoOk: boolean;
  /** Frase propia cuando `accesoOk` es falso. */
  error?: string;
  maxFilas: number;
  peticiones: number;
  mapeos: ReporteMapeoEnSeco[];
  /** Todo limpio: acceso ok, al menos un mapeo y ninguno con hallazgos ni error. */
  limpio: boolean;
}

const vacio = (mapeo: string, estado: EstadoMapeoEnSeco, extra: Partial<ReporteMapeoEnSeco> = {}): ReporteMapeoEnSeco => ({
  mapeo, estado, filasLeidas: 0, filasMapeables: 0, filasRechazadas: 0, clavesRepetidas: 0,
  faltantesRequeridos: [], opcionalesAusentes: [], camposDesconocidos: [], tiposQueNoCuadran: [], camposInvalidos: [], ...extra,
});

const corto = (s: string): string => s.slice(0, MAX_LARGO_NOMBRE);
const tipoDe = (v: unknown): TipoQueNoCuadra['recibido'] =>
  typeof v === 'string' ? 'texto' : typeof v === 'number' ? 'numero' : typeof v === 'boolean' ? 'booleano' : Array.isArray(v) ? 'lista' : 'objeto';
const ausente = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Misma regla que `aplicarMapeo`: un importe de liquidaciones/peajes sin transformar se lee como número. */
const CAMPOS_DINERO: ReadonlySet<string> = new Set(['cargo', 'abono', 'importe']);

/**
 * PURA. Analiza una muestra ya leída contra UN mapeo: nunca lanza, nunca copia valores. `respuesta` es el JSON completo del origen
 * (se busca la lista en `mapeo.raiz`); solo se miran las primeras `maxFilas`.
 */
export function analizarMuestra(nombre: string, mapeo: MapeoTms, respuesta: unknown, maxFilas = MAX_FILAS_EN_SECO): ReporteMapeoEnSeco {
  const problemas = validarMapeo(mapeo);
  if (problemas.length > 0) return vacio(nombre, 'error', { error: `el mapeo no es válido: ${corto(problemas[0])}` });

  let lista: unknown = respuesta;
  if (mapeo.raiz !== '') {
    lista = leerRuta(respuesta, mapeo.raiz);
    if (lista === undefined) return vacio(nombre, 'error', { error: `la respuesta no trae «${corto(mapeo.raiz)}» (revisa la «raiz» del mapeo)` });
  }
  if (!Array.isArray(lista)) return vacio(nombre, 'error', { error: `«${corto(mapeo.raiz || 'la respuesta')}» no es una lista` });
  const muestra = lista.slice(0, Math.max(1, Math.min(maxFilas, MAX_FILAS_EN_SECO * 5)));

  // Conteos de filas mapeables/rechazadas: lo hace el mismo `aplicarMapeo` de producción; de sus motivos solo se usa el número.
  const m = aplicarMapeo({ ...mapeo, raiz: '' }, muestra);
  if (m.error) return vacio(nombre, 'error', { error: 'no se pudo aplicar el mapeo a la muestra' });

  const requeridos = new Set([...mapeo.obligatorios, ...mapeo.clave_externa]);
  const plan = Object.entries(mapeo.campos).map(([destino, spec]) => {
    const base: CampoDetallado = typeof spec === 'string' ? { fuente: spec } : spec;
    const det: CampoDetallado = (mapeo.recurso === 'liquidaciones' || mapeo.recurso === 'peajes') && CAMPOS_DINERO.has(destino) && base.transformar === undefined
      ? { ...base, transformar: 'numero' } : base;
    const primer = parsearRuta(det.fuente);
    return { destino, det, primerSegmento: Array.isArray(primer) ? primer[0] : undefined };
  });
  const fuentesUsadas = new Set(plan.map((p) => p.primerSegmento).filter((s): s is string | number => s !== undefined).map(String));

  const faltan = new Map<string, FaltanteRequerido>();
  const opcionales = new Map<string, { campo: string; fuente: string; filas: number }>();
  const tipos = new Map<string, TipoQueNoCuadra>();
  const desconocidos = new Map<string, number>();
  let filasNoObjeto = 0;

  for (const fila of muestra) {
    if (!esObjeto(fila)) { filasNoObjeto += 1; continue; }
    for (const k of Object.keys(fila)) if (!fuentesUsadas.has(k)) desconocidos.set(corto(k), (desconocidos.get(corto(k)) ?? 0) + 1);
    for (const { destino, det } of plan) {
      const crudo = leerRuta(fila, det.fuente);
      if (ausente(crudo)) {
        const mapa = requeridos.has(destino) ? faltan : opcionales;
        const previo = mapa.get(destino) as { campo: string; fuente: string; filas: number } | undefined;
        if (previo) previo.filas += 1; else mapa.set(destino, { campo: corto(destino), fuente: corto(det.fuente), filas: 1 });
        continue;
      }
      const fallo = problemaDeTipo(det, crudo);
      if (!fallo) continue;
      const llave = `${destino}|${fallo.recibido}|${fallo.ambiguo ? 'a' : ''}`;
      const previo = tipos.get(llave);
      if (previo) previo.filas += 1;
      else tipos.set(llave, { campo: corto(destino), fuente: corto(det.fuente), esperado: det.transformar ?? 'valor_simple', recibido: fallo.recibido, ...(fallo.ambiguo ? { ambiguo: true as const } : {}), filas: 1 });
    }
  }

  const conClaveRepetida = m.rechazadas.filter((r) => r.motivo === 'clave externa repetida en la misma respuesta').length;
  const reporte = vacio(nombre, 'limpio', {
    filasLeidas: muestra.length,
    filasMapeables: m.filas.length,
    filasRechazadas: m.rechazadas.length,
    clavesRepetidas: conClaveRepetida,
    faltantesRequeridos: [...faltan.values()].sort((a, b) => a.campo.localeCompare(b.campo)),
    opcionalesAusentes: [...opcionales.values()].sort((a, b) => a.campo.localeCompare(b.campo)),
    camposDesconocidos: [...desconocidos].map(([campo, filas]) => ({ campo, filas })).sort((a, b) => b.filas - a.filas || a.campo.localeCompare(b.campo)).slice(0, MAX_NOMBRES),
    tiposQueNoCuadran: [...tipos.values()].sort((a, b) => a.campo.localeCompare(b.campo)),
  });
  if (muestra.length === 0) return { ...reporte, estado: 'con_hallazgos', error: 'la muestra vino vacía: no hay nada que comprobar (amplía la ventana o revisa los filtros del origen)' };
  if (filasNoObjeto > 0) reporte.error = `${filasNoObjeto} fila(s) de la muestra no son objetos`;
  const hay = reporte.faltantesRequeridos.length > 0 || reporte.tiposQueNoCuadran.length > 0 || reporte.filasRechazadas > 0 || filasNoObjeto > 0;
  return { ...reporte, estado: hay ? 'con_hallazgos' : 'limpio' };
}

/** ¿El valor presente cuadra con la transformación declarada? Devuelve solo el TIPO observado, nunca el valor. */
function problemaDeTipo(det: CampoDetallado, crudo: unknown): { recibido: TipoQueNoCuadra['recibido']; ambiguo?: true } | null {
  const recibido = tipoDe(crudo);
  switch (det.transformar) {
    case 'numero': {
      const r = aNumero(crudo, det.decimal);
      if (!('error' in r)) return null;
      return { recibido, ...(typeof crudo === 'string' && /ambiguo/.test(r.error) ? { ambiguo: true as const } : {}) };
    }
    case 'fecha_local':
      return 'error' in aFechaLocal(crudo, det.formato, det.zona ?? ZONA_POR_OMISION) ? { recibido } : null;
    case 'booleano':
      return 'error' in aBooleano(crudo) ? { recibido } : null;
    case 'texto':
      return recibido === 'texto' || recibido === 'numero' || recibido === 'booleano' ? null : { recibido };
    default:
      return recibido === 'objeto' || recibido === 'lista' ? { recibido } : null;
  }
}

// ── Lectura de la muestra ───────────────────────────────────────────────────

export interface EntradaEnSeco {
  valores: ValoresCredencial;
  /** Mapeo por recurso tal como está en `tms_mapeo.mapeo` (o un borrador). `liquidaciones` = `{ nomina, operadores, conceptos }`. */
  mapeos: Partial<Record<RecursoSincronizable, unknown>>;
  http?: Http;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  maxFilas?: number;
  /**
   * También prueba la lectura de DESGLOSES POR BITÁCORA que usa el pull de `liquidaciones-externas` (su forma vive en
   * `liquidacion_externa/desglose_tms_supuesto.ts`, no en `tms_mapeo`). `true` = la configuración vigente; o una propia (pruebas/borrador).
   */
  desgloses?: boolean | ConfigApiDesglose;
  /**
   * r13p: prueba la lectura por consulta del contrato `muestra-tms` (UNA página, sin valores). `true` = la configuración por omisión
   * (`CONFIG_PULL_MUESTRA_TMS`, todo SUPUESTO); o una propia (la de plataforma, un borrador). El operador NO se compara con el padrón
   * (la prueba no toca la base): solo la forma, los montos, las fechas y los conceptos.
   */
  muestra?: boolean | ConfigPullMuestraTms;
}

const SUBMAPEOS_LIQUIDACIONES = ['nomina', 'operadores', 'conceptos'] as const;

interface Pendiente { nombre: string; mapeo: unknown }

function pendientes(mapeos: EntradaEnSeco['mapeos']): Pendiente[] {
  const out: Pendiente[] = [];
  for (const rec of RECURSOS_SINCRONIZABLES) {
    const m = mapeos[rec];
    if (m === undefined || m === null) { out.push({ nombre: rec, mapeo: undefined }); continue; }
    if (rec === 'liquidaciones') {
      const o = esObjeto(m) ? m : {};
      for (const sub of SUBMAPEOS_LIQUIDACIONES) out.push({ nombre: `liquidaciones.${sub}`, mapeo: o[sub] });
    } else out.push({ nombre: rec, mapeo: m });
  }
  return out;
}

/** La petición de UNA página con el tamaño de la muestra, igual que la primera de `paginar` (nunca avanza ni guarda cursor). */
function consulta(mapeo: MapeoTms, desde: string, hasta: string, maxFilas: number): Record<string, string | number> {
  const q: Record<string, string | number> = { [mapeo.params.desde]: desde, [mapeo.params.hasta]: hasta };
  if (mapeo.params.pagina !== undefined) q[mapeo.params.pagina] = 1;
  if (mapeo.params.tam !== undefined) q[mapeo.params.tam] = maxFilas;
  return q;
}

export async function pruebaEnSecoTms(e: EntradaEnSeco): Promise<ReporteEnSeco> {
  const maxFilas = Math.max(1, Math.min(Math.trunc(e.maxFilas ?? MAX_FILAS_EN_SECO), MAX_FILAS_EN_SECO));
  const base: ReporteEnSeco = { accesoOk: false, maxFilas, peticiones: 0, mapeos: [], limpio: false };
  const url = urlBaseHttps(e.valores.base_url);
  if (url === null) return { ...base, error: 'la dirección de la API no es una URL https válida: no se llamó a nadie' };

  const ahora = e.ahora ?? Date.now;
  const transporte = e.http ?? ((p) => httpsPublico(p, 15_000));
  let peticiones = 0;
  const sesion = new SesionTms({
    http: async (p) => { peticiones += 1; return transporte(p); },
    base: url,
    login: loginDe(e.valores),
    credenciales: { usuario: (e.valores.usuario ?? '').trim(), clave: e.valores.clave ?? '' },
    reloj: { ahora, ...(e.dormir ? { dormir: e.dormir } : {}) },
  });
  const hasta = new Date(ahora()).toISOString();
  const desde = new Date(ahora() - VENTANA_EN_SECO_DIAS * DIA_MS).toISOString();

  const mapeos: ReporteMapeoEnSeco[] = [];
  let accesoOk = true;
  let errorAcceso: string | undefined;
  for (const p of pendientes(e.mapeos)) {
    if (!accesoOk) { mapeos.push(vacio(p.nombre, p.mapeo === undefined ? 'sin_mapeo' : 'error', p.mapeo === undefined ? {} : { error: 'no se intentó: el acceso falló antes' })); continue; }
    if (p.mapeo === undefined || p.mapeo === null) { mapeos.push(vacio(p.nombre, 'sin_mapeo')); continue; }
    const problemas = validarMapeo(p.mapeo);
    if (problemas.length > 0) { mapeos.push(vacio(p.nombre, 'error', { error: `el mapeo no es válido: ${corto(problemas[0])}` })); continue; }
    const mapeo = p.mapeo as MapeoTms;
    const q = consulta(mapeo, desde, hasta, maxFilas);
    const r = await sesion.peticion({ ruta: mapeo.ruta, metodo: mapeo.metodo, query: mapeo.metodo === 'GET' ? q : undefined, cuerpo: mapeo.metodo === 'POST' ? q : undefined });
    if (!r.ok) {
      // `SesionTms` ya redacta secretos de sus mensajes y son frases propias.
      mapeos.push(vacio(p.nombre, 'error', { error: r.motivo.slice(0, 200) }));
      if (r.falla === 'credencial') { accesoOk = false; errorAcceso = r.motivo.slice(0, 200); }
      continue;
    }
    if (r.r.estado < 200 || r.r.estado >= 300) { mapeos.push(vacio(p.nombre, 'error', { error: `el sistema contestó ${r.r.estado}, que no es lo esperado` })); continue; }
    const crudo = jsonCualquiera(r.r.cuerpo);
    if (crudo === undefined) { mapeos.push(vacio(p.nombre, 'error', { error: 'el sistema contestó 200 con un cuerpo que no es JSON' })); continue; }
    mapeos.push(analizarMuestra(p.nombre, mapeo, crudo, maxFilas));
  }

  if (accesoOk && e.desgloses) {
    const cfg = e.desgloses === true ? CONFIG_API_DESGLOSE : e.desgloses;
    mapeos.push(await probarDesgloses(sesion, cfg, desde, hasta, maxFilas));
  }

  if (accesoOk && e.muestra) {
    const cfg = e.muestra === true ? CONFIG_PULL_MUESTRA_TMS : e.muestra;
    mapeos.push(await probarMuestra(sesion, cfg, desde, hasta, maxFilas));
  }

  const hubo = mapeos.some((m) => m.estado !== 'sin_mapeo');
  const reporte: ReporteEnSeco = {
    accesoOk, maxFilas, peticiones, mapeos,
    ...(errorAcceso ? { error: errorAcceso } : {}),
    limpio: accesoOk && hubo && mapeos.every((m) => m.estado === 'limpio' || m.estado === 'sin_mapeo'),
  };
  // SOLO nombres de mapeo/campo y conteos (ver cabecera): nada de valores del origen.
  logger.info('tms.prueba_en_seco', {
    peticiones, limpio: reporte.limpio,
    mapeos: mapeos.map((m) => ({
      mapeo: m.mapeo, estado: m.estado, leidas: m.filasLeidas, mapeables: m.filasMapeables,
      faltantes: m.faltantesRequeridos.map((f) => f.campo), desconocidos: m.camposDesconocidos.length, tipos: m.tiposQueNoCuadran.map((t) => t.campo),
    })),
  });
  return reporte;
}

/** Las rutas (strings) de una configuración de desgloses: de ahí se sabe qué llaves de la fila se usan. */
function rutasDeDesgloses(cfg: ConfigApiDesglose): string[] {
  const out: string[] = [cfg.campoCursor];
  const recorre = (o: unknown): void => {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'tiposViatico') continue; // códigos de tipo, no rutas
      if (typeof v === 'string') out.push(v);
      else if (v !== null && typeof v === 'object' && !Array.isArray(v)) recorre(v);
    }
  };
  recorre(cfg.mapeo);
  return out;
}

/** UNA página de desgloses por bitácora con la configuración del pull; mismo reporte, sin valores. */
async function probarDesgloses(sesion: SesionTms, cfg: ConfigApiDesglose, desde: string, hasta: string, maxFilas: number): Promise<ReporteMapeoEnSeco> {
  const nombre = 'desgloses';
  const r = await sesion.peticion({
    ruta: cfg.ruta,
    query: { [cfg.params.desde]: desde, [cfg.params.hasta]: hasta, [cfg.params.pagina]: 1, [cfg.params.tam]: Math.min(cfg.tamano, maxFilas) },
  });
  if (!r.ok) return vacio(nombre, 'error', { error: r.motivo.slice(0, 200) });
  if (r.r.estado < 200 || r.r.estado >= 300) return vacio(nombre, 'error', { error: `el sistema contestó ${r.r.estado}, que no es lo esperado` });
  const crudo = jsonCualquiera(r.r.cuerpo);
  if (crudo === undefined) return vacio(nombre, 'error', { error: 'el sistema contestó 200 con un cuerpo que no es JSON' });
  const lista = leerRutaDesglose(crudo, cfg.rutaItems);
  if (!Array.isArray(lista)) return vacio(nombre, 'error', { error: `la respuesta no trae la lista en «${corto(cfg.rutaItems)}» (revisa «rutaItems»)` });
  const muestra = lista.slice(0, maxFilas);

  const usadas = new Set(rutasDeDesgloses(cfg).map((ruta) => ruta.split(/[.[]/)[0]));
  const invalidos = new Map<string, number>();
  const desconocidos = new Map<string, number>();
  let buenas = 0;
  for (const fila of muestra) {
    if (esObjeto(fila)) for (const k of Object.keys(fila)) if (!usadas.has(k)) desconocidos.set(corto(k), (desconocidos.get(corto(k)) ?? 0) + 1);
    if (instanteDeCursor(leerRutaDesglose(fila, cfg.campoCursor)) === null) {
      invalidos.set(corto(cfg.campoCursor), (invalidos.get(corto(cfg.campoCursor)) ?? 0) + 1);
      continue;
    }
    try {
      mapearBitacoraTms(fila, cfg.mapeo);
      buenas += 1;
    } catch (err) {
      // Solo el NOMBRE del campo: el mensaje del error puede citar el valor.
      const campo = err instanceof CampoInvalido ? corto(err.campo) : '(error inesperado del mapeo)';
      invalidos.set(campo, (invalidos.get(campo) ?? 0) + 1);
    }
  }
  const rechazadas = muestra.length - buenas;
  const reporte = vacio(nombre, muestra.length === 0 || rechazadas > 0 ? 'con_hallazgos' : 'limpio', {
    filasLeidas: muestra.length, filasMapeables: buenas, filasRechazadas: rechazadas,
    camposInvalidos: [...invalidos].map(([campo, filas]) => ({ campo, filas })).sort((a, b) => b.filas - a.filas || a.campo.localeCompare(b.campo)),
    camposDesconocidos: [...desconocidos].map(([campo, filas]) => ({ campo, filas })).sort((a, b) => b.filas - a.filas || a.campo.localeCompare(b.campo)).slice(0, MAX_NOMBRES),
  });
  if (muestra.length === 0) reporte.error = 'la muestra vino vacía: no hay nada que comprobar (amplía la ventana o revisa los filtros del origen)';
  return reporte;
}

const LLAVES_MUESTRA: ReadonlySet<string> = new Set([
  'BitacoraID', 'Operador', 'Unidad', 'Fecha', 'Percepciones', 'Deducciones',
  // Opcionales del piloto (11-nov-2026): se leen si vienen. `NumeroLiquidacion` NO se lee a propósito y sigue saliendo como campo desconocido.
  'NumeroEmpleado', 'TipoOperador', 'Poliza', 'NumeroPago', 'Neto', 'Folio',
]);
/** Los campos que la muestra NO trae y que hay que pedirle al cliente (nombres, no valores). */
const PIDE_AL_CLIENTE = ['numeroLiquidacion', 'numeroPago', 'poliza', 'tipoOperador', 'terminal', 'numeroEmpleado'];

/** UNA página del contrato `muestra-tms` con la configuración del pull; mismo reporte, sin valores ni nombres de operador. */
async function probarMuestra(sesion: SesionTms, cfg: ConfigPullMuestraTms, desde: string, hasta: string, maxFilas: number): Promise<ReporteMapeoEnSeco> {
  const nombre = 'desgloses-muestra-tms';
  const query: Record<string, string | number> = {
    [cfg.params.desde]: fechaDeParametro(desde, cfg.formatoFechaParam), [cfg.params.hasta]: fechaDeParametro(hasta, cfg.formatoFechaParam),
  };
  if (cfg.params.pagina !== null && cfg.params.tam !== null) { query[cfg.params.pagina] = 1; query[cfg.params.tam] = Math.min(cfg.tamano, maxFilas); }
  const r = await sesion.peticion({ ruta: cfg.ruta, query });
  if (!r.ok) return vacio(nombre, 'error', { error: r.motivo.slice(0, 200) });
  if (r.r.estado < 200 || r.r.estado >= 300) return vacio(nombre, 'error', { error: `el sistema contestó ${r.r.estado}, que no es lo esperado` });
  const crudo = jsonCualquiera(r.r.cuerpo);
  if (crudo === undefined) return vacio(nombre, 'error', { error: 'el sistema contestó 200 con un cuerpo que no es JSON' });
  let lista: unknown[];
  try {
    lista = listaDeMuestra(crudo, { envoltorio: cfg.envoltorio, rutaLista: cfg.rutaLista });
  } catch (err) {
    if (!(err instanceof EnvoltorioInvalido)) throw err;
    return vacio(nombre, 'error', { error: `la respuesta no trae la lista como se configuró (envoltorio «${cfg.envoltorio}», ruta «${corto(cfg.rutaLista)}»)` });
  }
  const muestra = lista.slice(0, maxFilas);
  // El padrón se arma con los propios nombres de la muestra: así solo se juzga la FORMA (el nombre jamás sale de aquí).
  // Si la fila trae `NumeroEmpleado`, ese número es el del padrón de juguete (el cruce por número manda); si no, uno consecutivo.
  const padron = muestra.flatMap((f) => {
    if (!esObjeto(f) || typeof f.Operador !== 'string' || f.Operador.trim() === '') return [];
    const n = typeof f.NumeroEmpleado === 'string' && f.NumeroEmpleado.trim() !== '' ? f.NumeroEmpleado.trim()
      : typeof f.NumeroEmpleado === 'number' && Number.isSafeInteger(f.NumeroEmpleado) ? String(f.NumeroEmpleado) : null;
    return [{ numero: n, nombre: f.Operador }];
  }).filter((o, k, a) => a.findIndex((m) => normalizarNombre(m.nombre) === normalizarNombre(o.nombre) && m.numero === o.numero) === k)
    .map((o, k) => ({ numeroEmpleado: o.numero ?? String(k + 1), nombre: o.nombre }));
  const invalidos = new Map<string, number>();
  const desconocidos = new Map<string, number>();
  let buenas = 0;
  for (const fila of muestra) {
    if (esObjeto(fila)) for (const k of Object.keys(fila)) if (!LLAVES_MUESTRA.has(k)) desconocidos.set(corto(k), (desconocidos.get(corto(k)) ?? 0) + 1);
    const motivos: string[] = [];
    if (instanteDeCursor(leerRutaDesglose(fila, cfg.campoCursor)) === null) motivos.push(corto(cfg.campoCursor));
    const c = convertirBitacoraMuestra(fila, { padron });
    for (const m of c.revision) motivos.push(corto(m.campo));
    if (motivos.length === 0 && c.desglose !== null) buenas += 1;
    // Solo la ruta del campo (`Percepciones[0].Monto`): nunca el valor.
    for (const campo of new Set(motivos)) invalidos.set(campo, (invalidos.get(campo) ?? 0) + 1);
  }
  const rechazadas = muestra.length - buenas;
  const reporte = vacio(nombre, muestra.length === 0 || rechazadas > 0 ? 'con_hallazgos' : 'limpio', {
    filasLeidas: muestra.length, filasMapeables: buenas, filasRechazadas: rechazadas,
    camposInvalidos: [...invalidos].map(([campo, filas]) => ({ campo, filas })).sort((a, b) => b.filas - a.filas || a.campo.localeCompare(b.campo)),
    camposDesconocidos: [...desconocidos].map(([campo, filas]) => ({ campo, filas })).sort((a, b) => b.filas - a.filas || a.campo.localeCompare(b.campo)).slice(0, MAX_NOMBRES),
    opcionalesAusentes: PIDE_AL_CLIENTE.map((campo) => ({ campo, fuente: '(el contrato no lo trae)', filas: muestra.length })),
  });
  if (muestra.length === 0) reporte.error = 'la muestra vino vacía: no hay nada que comprobar (amplía la ventana o revisa los filtros del origen)';
  return reporte;
}

/**
 * Con la credencial y el mapeo ACTIVO de una flota (o un `borrador` de mapeos que se quiere probar antes de activarlo). Solo lee.
 * `sin credencial` ⇒ reporte con `accesoOk: false`: nunca se inventa una.
 */
export async function pruebaEnSecoDeFlota(
  tenantId: string,
  opciones: { borrador?: EntradaEnSeco['mapeos']; maxFilas?: number } & Pick<EntradaEnSeco, 'http' | 'ahora' | 'dormir' | 'desgloses' | 'muestra'> = {},
  deps: {
    credencial?: (tenantId: string) => Promise<ValoresCredencial | null>;
    mapeosActivos?: (tenantId: string) => Promise<EntradaEnSeco['mapeos']>;
  } = {},
): Promise<ReporteEnSeco> {
  const maxFilas = opciones.maxFilas ?? MAX_FILAS_EN_SECO;
  const leerCred = deps.credencial ?? (async (t: string) => (await import('../credenciales')).leerCredencial(t, 'tms_api_lectura'));
  const leerMapeos = deps.mapeosActivos ?? mapeosActivosReales;
  const valores = await leerCred(tenantId);
  if (valores === null) return { accesoOk: false, maxFilas, peticiones: 0, mapeos: [], limpio: false, error: 'la flota no tiene la credencial «tms_api_lectura» activa: no se llamó a nadie' };
  const mapeos = opciones.borrador ?? await leerMapeos(tenantId);
  return pruebaEnSecoTms({ valores, mapeos, maxFilas, http: opciones.http, ahora: opciones.ahora, dormir: opciones.dormir, desgloses: opciones.desgloses, muestra: opciones.muestra });
}

async function mapeosActivosReales(tenantId: string): Promise<EntradaEnSeco['mapeos']> {
  const [{ supabaseAdmin }, { acotada }] = await Promise.all([import('@/lib/supabase/admin'), import('../../presupuesto')]);
  const { data, error } = await acotada(supabaseAdmin().from('tms_mapeo').select('recurso, mapeo').eq('tenant_id', tenantId).eq('activo', true), 'tms.en_seco.mapeos');
  if (error) throw new Error(`tms.en_seco.mapeos: ${error.message}`);
  const out: Partial<Record<RecursoSincronizable, unknown>> = {};
  for (const f of (data ?? []) as Array<{ recurso: string; mapeo: unknown }>) {
    if ((RECURSOS_SINCRONIZABLES as readonly string[]).includes(f.recurso)) out[f.recurso as RecursoSincronizable] = f.mapeo;
  }
  return out;
}

/** El reporte en líneas de texto para terminal o documento: SOLO nombres de campo, tipos y conteos (lo que ya trae el reporte). */
export function lineasDeReporteEnSeco(r: ReporteEnSeco): string[] {
  const L: string[] = [];
  L.push(`acceso: ${r.accesoOk ? 'ok' : `FALLÓ${r.error ? ` (${r.error})` : ''}`}; peticiones: ${r.peticiones}; muestra de hasta ${r.maxFilas} registros por mapeo`);
  for (const m of r.mapeos) {
    if (m.estado === 'sin_mapeo') { L.push(`[${m.mapeo}] sin mapeo: no se probó`); continue; }
    L.push(`[${m.mapeo}] ${m.estado}${m.error ? ` — ${m.error}` : ''}; leídas ${m.filasLeidas}, mapeables ${m.filasMapeables}, rechazadas ${m.filasRechazadas}${m.clavesRepetidas > 0 ? `, claves repetidas ${m.clavesRepetidas}` : ''}`);
    for (const c of m.camposInvalidos) L.push(`  el mapeo no pudo leer «${c.campo}» en ${c.filas} fila(s)`);
    for (const f of m.faltantesRequeridos) L.push(`  falta requerido «${f.campo}» (fuente «${f.fuente}») en ${f.filas} fila(s)`);
    for (const t of m.tiposQueNoCuadran) L.push(`  tipo no cuadra en «${t.campo}» (fuente «${t.fuente}», se esperaba ${t.esperado}, llegó ${t.recibido}${t.ambiguo ? ', AMBIGUO: declara «decimal»' : ''}) en ${t.filas} fila(s)`);
    if (m.camposDesconocidos.length > 0) L.push(`  campos del origen que el mapeo no usa (se ignoran): ${m.camposDesconocidos.map((c) => c.campo).join(', ')}`);
    if (m.opcionalesAusentes.length > 0) L.push(`  opcionales ausentes: ${m.opcionalesAusentes.map((c) => `«${c.campo}»`).join(', ')}`);
  }
  L.push(r.limpio ? 'RESULTADO: limpio' : 'RESULTADO: con pendientes (ver arriba)');
  return L;
}
