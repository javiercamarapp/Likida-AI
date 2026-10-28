// ═══════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN MASIVA DE OPERADORES (auditoría 24, ADM-2 / faltante 3).
//
// El cliente de demo tiene cientos de choferes y hasta hoy el alta era uno por uno
// (`crearOperador`) o SQL a mano. Este módulo es UN motor con dos puertas:
// la carga desde Excel/CSV de `/dashboard/operadores` (bloque «Cargar operadores») y el lote de
// `POST /v1/operadores`. Las dos validan con las MISMAS funciones que el alta
// unitaria (`normalizarTelefonoOperador`, `normalizarRfcOperador`,
// `normalizarFechaLicencia`) — un número que el alta acepta y el importador
// rechaza sería un chofer que nadie puede dar de alta.
//
// ── IDEMPOTENTE POR TELÉFONO ─────────────────────────────────────────────
// El mismo archivo dos veces no duplica: la primera corrida crea y la segunda
// reporta cada fila como «ya estaba» con el id que ya tiene. El candado real
// vive en la base (`uq_operador_tenant_telefono_norm`, 0024): la lectura
// previa es para REPORTAR con nombre; si dos submits concurrentes chocan en
// el insert, la tanda se reintenta fila por fila y cada choque se clasifica.
//
// ── EL AVISO DE PRIVACIDAD NO SE MANDA AQUÍ, y se dice ───────────────────
// Likida no puede iniciar una conversación de WhatsApp con quien nunca le ha
// escrito: fuera de la ventana de 24 h Meta solo entrega plantillas aprobadas
// y no existe una del aviso. Mandar 800 `sendText` desde un import sería
// 800 rechazos 131047 —o, encolados en `wa_outbox`, 800 × 8 reintentos y 800
// alertas de «salida muerta»—. El mecanismo real del alta unitaria es el
// mismo: la ficha nace con `aviso_privacidad_en = NULL` y el aviso se le pone
// a disposición en su PRIMER mensaje, antes de tratar nada
// (`ponerAvisoADisposicion`, processor.ts, LFPDPPP 16-II). El reporte del
// import y el KPI del registro lo enseñan como «aviso pendiente» — visible,
// que es lo que la auditoría pedía, sin fingir una entrega que no ocurrió.
//
// ── LO QUE NO HACE ───────────────────────────────────────────────────────
// No manda WhatsApp, no crea viajes, no reactiva fichas dadas de baja (eso se
// dice, con el nombre, y se hace desde el registro).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/ratelimit';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { destinatarioWhatsApp } from '@/lib/meta/client';
import { acotada } from '../presupuesto';
import { variantesTelefono } from '../conv';
import { DatoInvalido } from '../errores';
import {
  normalizarTelefonoOperador, normalizarRfcOperador, normalizarFechaLicencia, TELEFONO_NO_DISPONIBLE,
} from '../administracion';
import { resolverTerminalDeFlota } from '../terminales';
import { nuevoMarcadorSinTelefono, correoDeOperador, esMarcadorSinTelefono } from '../operador_sin_telefono';
import { leerFechaImportada } from '../importar_viajes';
import {
  type Descartada, TOPE_FILAS_IMPORTACION, detectarColumnas, filaVacia, celdaTexto,
  encabezadosLeidos, avisoDeTope, plantillaCsv, MARCA_EJEMPLO, esFilaDeEjemplo, enTandas, chocaContra,
} from './archivo';

/** Lo que llega crudo de una fila del archivo o de un elemento del lote. */
export interface OperadorCrudo {
  nombre: string;
  telefono: string;
  numeroEmpleado?: string | null;
  rfc?: string | null;
  licencia?: string | null;
  licenciaTipo?: string | null;
  /** ISO AAAA-MM-DD (el archivo ya viene normalizado por `leerFechaImportada`). */
  licenciaVence?: string | null;
  /** El patio como lo escribió el archivo (W2). Se resuelve contra los patios
   *  de la flota en `asignarPatios` (patios.ts); aquí solo viaja el texto. */
  patio?: string | null;
  /** Correo del operador (desglose por correo, 0785). Con teléfono es opcional; sin teléfono es obligatorio. */
  correo?: string | null;
}

/** Opciones de validación: `sinTelefono` = la flota entrega por correo y admite altas sin WhatsApp (ver `operador_sin_telefono.ts`). */
export interface OpcionesValidacionOperador { sinTelefono?: boolean }

/** Una fila ya válida, lista para escribir. `fila` es el renglón del archivo
 *  (o el índice del lote) para poder decir «fila 14: …». */
export interface OperadorImportado {
  fila: number;
  nombre: string;
  /** `52` + 10 dígitos, la forma que se guarda. */
  telefono: string;
  numeroEmpleado: string | null;
  rfc: string | null;
  licencia: string | null;
  licenciaTipo: string | null;
  licenciaVence: string | null;
  /** El patio como lo escribió el archivo, o null (W2). */
  patio?: string | null;
  /** El patio YA resuelto contra la flota por `asignarPatios`. Si viene, manda
   *  sobre el `terminalId` general de `importarOperadores`. */
  terminalId?: string | null;
  /** Correo normalizado, o null. */
  correo?: string | null;
  /** true = alta sin WhatsApp (migración 0932): `telefono` viene vacío y `importarOperadores` pone el marcador al escribir. */
  sinTelefono?: boolean;
}

/**
 * De lo crudo a lo válido. PURA: lanza `DatoInvalido` con el QUÉ corregir.
 * Es la misma validación que `crearOperador`, y las dos puertas la comparten.
 */
export function validarOperadorImportado(c: OperadorCrudo, fila: number, opciones: OpcionesValidacionOperador = {}): OperadorImportado {
  const nombre = (c.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 3) throw new DatoInvalido('el nombre necesita al menos 3 caracteres');
  if (nombre.length > 120) throw new DatoInvalido('el nombre no puede pasar de 120 caracteres');
  const sinTelefono = !(c.telefono ?? '').trim();
  if (sinTelefono && !opciones.sinTelefono) throw new DatoInvalido('sin teléfono — es la identidad del chofer para el bot');
  const telefono = sinTelefono ? '' : normalizarTelefonoOperador(c.telefono);
  const numeroEmpleado = (c.numeroEmpleado ?? '').trim().slice(0, 40) || null;
  const correo = correoDeOperador(c.correo);
  if (correo === undefined) throw new DatoInvalido('el correo no tiene forma de correo (falta la @ o el dominio)');
  if (sinTelefono && (!numeroEmpleado || !correo)) {
    throw new DatoInvalido('sin teléfono: el operador necesita número de empleado y correo (es como se le encuentra y se le entrega el desglose)');
  }
  const licencia = (c.licencia ?? '').trim().slice(0, 40) || null;
  const licenciaTipo = (c.licenciaTipo ?? '').trim().slice(0, 10) || null;
  return {
    fila, nombre, telefono, numeroEmpleado,
    ...(correo ? { correo } : {}),
    ...(sinTelefono ? { sinTelefono: true } : {}),
    rfc: normalizarRfcOperador(c.rfc),
    licencia, licenciaTipo,
    licenciaVence: normalizarFechaLicencia(c.licenciaVence),
    patio: (c.patio ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null,
  };
}

// ── El archivo ─────────────────────────────────────────────────────────────

/** Encabezados que el mundo real usa. Minúsculas, sin acentos. */
export const COLUMNAS_OPERADOR = {
  nombre: ['nombre', 'operador', 'chofer', 'conductor', 'nombre operador', 'nombre del operador', 'nombre completo'],
  telefono: ['telefono', 'tel', 'celular', 'whatsapp', 'movil', 'telefono whatsapp', 'numero', 'cel'],
  numeroEmpleado: ['numero de empleado', 'numero empleado', 'no empleado', 'no. empleado', 'empleado', 'num empleado', 'n de empleado', 'no. de empleado', 'no de empleado', 'clave'],
  rfc: ['rfc'],
  licencia: ['licencia', 'no licencia', 'no. licencia', 'numero de licencia', 'licencia federal'],
  licenciaTipo: ['tipo de licencia', 'tipo licencia', 'categoria', 'tipo'],
  licenciaVence: ['vence licencia', 'licencia vence', 'vencimiento licencia', 'vigencia licencia', 'vence', 'vigencia'],
  patio: ['patio', 'terminal', 'base', 'sucursal', 'patio terminal'],
  correo: ['correo', 'correo electronico', 'email', 'e mail', 'mail', 'correo operador', 'correo del operador'],
} as const;

/** La plantilla que se descarga. El orden es el que se lee. */
export const PLANTILLA_OPERADORES = {
  encabezados: ['nombre', 'telefono', 'numero de empleado', 'rfc', 'licencia', 'tipo de licencia', 'vence licencia', 'patio'],
  ejemplo: [`Juan Pérez ${MARCA_EJEMPLO}`, '5512345678', 'E-104', '', 'MEX123456', 'E', '2027-03-15', 'Patio Norte'],
} as const;

export function plantillaOperadoresCsv(): string {
  return plantillaCsv(PLANTILLA_OPERADORES.encabezados, PLANTILLA_OPERADORES.ejemplo);
}

export interface LecturaOperadores {
  filas: OperadorImportado[];
  descartadas: Descartada[];
  /** Solo cuando NO se pudo leer nada útil (sin columnas, archivo vacío) o
   *  cuando el archivo rebasa el tope (y entonces `filas` trae las primeras). */
  error?: string;
}

/**
 * La matriz cruda del archivo → filas válidas + descartadas con su motivo.
 * PURA. Sin columna de nombre o de teléfono no hay importación: son las dos
 * únicas obligatorias, y el teléfono es el dedup.
 */
export function interpretarFilasOperadores(matriz: unknown[][], opciones: OpcionesValidacionOperador = {}): LecturaOperadores {
  if (!matriz.length) return { filas: [], descartadas: [], error: 'El archivo está vacío.' };
  const indice = detectarColumnas(matriz[0] ?? [], COLUMNAS_OPERADOR);
  // Con la flota en canal correo el teléfono puede faltar: entonces la llave es el número de empleado y se necesita el correo.
  const sinColumnaTelefonoPermitida = opciones.sinTelefono === true && indice.numeroEmpleado !== undefined && indice.correo !== undefined;
  if (indice.nombre === undefined || (indice.telefono === undefined && !sinColumnaTelefonoPermitida)) {
    const falta = indice.nombre === undefined ? 'nombre' : 'teléfono';
    return {
      filas: [], descartadas: [],
      error: `No encontré la columna de ${falta}. Encabezados leídos: ${encabezadosLeidos(matriz)}. Descarga la plantilla, o renombra la columna a «nombre» / «telefono» y vuelve a subirlo.${
        opciones.sinTelefono && indice.nombre !== undefined ? ' (Sin teléfono, el archivo necesita las columnas «numero de empleado» y «correo».)' : ''}`,
    };
  }

  const filas: OperadorImportado[] = [];
  const descartadas: Descartada[] = [];
  const telefonosVistos = new Map<string, number>();
  const empleadosVistos = new Map<string, number>();
  const correosVistos = new Map<string, number[]>();

  for (let f = 1; f < matriz.length && f <= TOPE_FILAS_IMPORTACION; f++) {
    const fila = matriz[f];
    if (filaVacia(fila)) continue;
    const numero = f + 1;
    if (esFilaDeEjemplo(fila)) { descartadas.push({ fila: numero, motivo: 'es la fila de ejemplo de la plantilla' }); continue; }

    const celda = (k: keyof typeof COLUMNAS_OPERADOR, max = 120): string =>
      indice[k] === undefined ? '' : celdaTexto(fila[indice[k] as number], max);

    const vence = leerFechaImportada(indice.licenciaVence === undefined ? null : fila[indice.licenciaVence]);
    if (vence === 'ilegible') { descartadas.push({ fila: numero, motivo: 'la fecha de vencimiento de la licencia no se entiende (usa AAAA-MM-DD)' }); continue; }

    try {
      const v = validarOperadorImportado({
        nombre: celda('nombre'),
        telefono: celda('telefono', 30),
        numeroEmpleado: celda('numeroEmpleado', 40),
        rfc: celda('rfc', 13),
        licencia: celda('licencia', 40),
        licenciaTipo: celda('licenciaTipo', 10),
        licenciaVence: vence,
        patio: celda('patio', 80),
        correo: celda('correo', 400),
      }, numero, opciones);
      if (v.sinTelefono) {
        const repetidoE = empleadosVistos.get((v.numeroEmpleado ?? '').toLowerCase());
        if (repetidoE !== undefined) {
          descartadas.push({ fila: numero, motivo: `número de empleado repetido en el archivo (ya viene en la fila ${repetidoE})` });
          continue;
        }
        empleadosVistos.set((v.numeroEmpleado ?? '').toLowerCase(), numero);
      } else {
        const repetida = telefonosVistos.get(v.telefono);
        if (repetida !== undefined) {
          descartadas.push({ fila: numero, motivo: `teléfono repetido en el archivo (ya viene en la fila ${repetida})` });
          continue;
        }
        telefonosVistos.set(v.telefono, numero);
      }
      if (v.correo) correosVistos.set(v.correo, [...(correosVistos.get(v.correo) ?? []), numero]);
      filas.push(v);
    } catch (e) {
      if (e instanceof DatoInvalido) { descartadas.push({ fila: numero, motivo: e.message }); continue; }
      throw e;
    }
  }

  // Dos operadores del archivo con el MISMO correo es casi siempre un copiar/pegar mal hecho y el desglose lleva sueldo y
  // deducciones (LFPDPPP; mismo criterio que `contactos_csv.ts`, A37-S48-06): ninguna de esas filas entra.
  const choque = new Set<number>();
  for (const numeros of correosVistos.values()) {
    if (numeros.length < 2) continue;
    for (const n of numeros) {
      choque.add(n);
      descartadas.push({ fila: n, motivo: `comparte el correo con las filas ${numeros.filter((o) => o !== n).join(', ')}: ese buzón recibiría el desglose de varios; corrige el archivo` });
    }
  }
  const aceptadas = choque.size ? filas.filter((x) => !choque.has(x.fila)) : filas;

  const tope = avisoDeTope(matriz);
  if (tope) {
    descartadas.unshift(tope);
    return { filas: aceptadas, descartadas, error: tope.motivo };
  }
  return { filas: aceptadas, descartadas };
}

// ── La escritura ───────────────────────────────────────────────────────────

export interface OperadorCreado { fila: number; id: string; telefono: string }
export interface OperadorDuplicado { fila: number; id: string | null; telefono: string; motivo: string }
export interface FilaConError { fila: number; motivo: string }

export interface ResultadoImportacionOperadores {
  creados: OperadorCreado[];
  /** Ya estaban en ESTA flota: el mismo archivo dos veces no duplica. */
  duplicados: OperadorDuplicado[];
  /** No se escribieron y se dice por qué (otra flota, de baja, la base). */
  errores: FilaConError[];
  /** Cuántos de los creados quedan con el aviso de privacidad por entregar
   *  (todos: se entrega en su primer mensaje al bot). */
  avisoPendiente: number;
  /** Solo cuando NO se importó nada porque no se pudo leer el catálogo. */
  error?: string;
}

type FilaExistente = { id: string; tenant_id: string; nombre: string; telefono: string; activo: boolean };

/** Cuántos teléfonos se preguntan por consulta: cada uno trae ~6 variantes y
 *  la lista viaja en la URL. */
const TELEFONOS_POR_CONSULTA = 40;

/** La llave con que se casa lo que devolvió la base con la fila: el teléfono normalizado, o el marcador tal cual. */
const claveDeTelefono = (t: string): string => (esMarcadorSinTelefono(t) ? t : destinatarioWhatsApp(t));

/** Las fichas de CUALQUIER flota con alguno de estos teléfonos. Falla cerrado. */
async function buscarExistentes(telefonos: string[]): Promise<Map<string, FilaExistente[]>> {
  const porTelefono = new Map<string, FilaExistente[]>();
  for (const tanda of enTandas(telefonos, TELEFONOS_POR_CONSULTA)) {
    const variantes = tanda.flatMap((t) => variantesTelefono(t));
    const { data, error } = await acotada(
      supabaseAdmin().from('operador').select('id, tenant_id, nombre, telefono, activo').in('telefono', variantes),
      'importarOperadores.existentes',
    );
    if (error) throw new Error(`importarOperadores: no se pudo comprobar los teléfonos — ${error.message}`);
    for (const f of (data ?? []) as FilaExistente[]) {
      const k = destinatarioWhatsApp(String(f.telefono));
      const lista = porTelefono.get(k) ?? [];
      lista.push(f);
      porTelefono.set(k, lista);
    }
  }
  return porTelefono;
}

type FilaPorEmpleado = { id: string; nombre: string; numero_empleado: string; activo: boolean };
type FilaPorCorreo = { id: string; correo: string };

/** Los operadores DE ESTA FLOTA con alguno de estos números de empleado (para las altas sin teléfono). Falla cerrado. */
async function buscarPorEmpleado(tenantId: string, numeros: string[]): Promise<Map<string, FilaPorEmpleado[]>> {
  const porNumero = new Map<string, FilaPorEmpleado[]>();
  for (const tanda of enTandas(numeros, 100)) {
    const { data, error } = await acotada(
      supabaseAdmin().from('operador').select('id, nombre, numero_empleado, activo').eq('tenant_id', tenantId).in('numero_empleado', tanda),
      'importarOperadores.por_empleado',
    );
    if (error) throw new Error(`importarOperadores: no se pudo comprobar los números de empleado — ${error.message}`);
    for (const f of (data ?? []) as FilaPorEmpleado[]) {
      const k = String(f.numero_empleado).toLowerCase();
      porNumero.set(k, [...(porNumero.get(k) ?? []), f]);
    }
  }
  return porNumero;
}

/** Los operadores DE ESTA FLOTA que ya usan alguno de estos correos (un buzón no recibe el desglose de dos personas). Falla cerrado. */
async function buscarPorCorreo(tenantId: string, correos: string[]): Promise<Map<string, FilaPorCorreo[]>> {
  const porCorreo = new Map<string, FilaPorCorreo[]>();
  for (const tanda of enTandas(correos, 100)) {
    const { data, error } = await acotada(
      supabaseAdmin().from('operador').select('id, correo').eq('tenant_id', tenantId).in('correo', tanda),
      'importarOperadores.por_correo',
    );
    if (error) throw new Error(`importarOperadores: no se pudo comprobar los correos — ${error.message}`);
    for (const f of (data ?? []) as FilaPorCorreo[]) {
      const k = String(f.correo).toLowerCase();
      porCorreo.set(k, [...(porCorreo.get(k) ?? []), f]);
    }
  }
  return porCorreo;
}

const MOTIVO_CORREO_EN_USO = 'ese correo ya lo usa otro operador de la flota: no se dio de alta para que el desglose no le llegue a otra persona; corrígelo o quítaselo al otro operador';

/**
 * Clasifica una fila contra lo que ya hay. `null` = libre, se escribe.
 * Misma regla que `comprobarTelefonoLibre` (administracion.ts), dicha por fila.
 */
function clasificar(tenantId: string, f: OperadorImportado, existentes: FilaExistente[]):
  | { tipo: 'duplicado'; d: OperadorDuplicado }
  | { tipo: 'error'; e: FilaConError }
  | null {
  const activa = existentes.find((x) => x.activo);
  if (activa && activa.tenant_id === tenantId) {
    return { tipo: 'duplicado', d: { fila: f.fila, id: activa.id, telefono: f.telefono, motivo: `ya estaba, a nombre de ${activa.nombre}` } };
  }
  if (activa) {
    return { tipo: 'error', e: { fila: f.fila, motivo: TELEFONO_NO_DISPONIBLE.charAt(0).toLowerCase() + TELEFONO_NO_DISPONIBLE.slice(1).replace(/\.$/, '') } };
  }
  const propiaDeBaja = existentes.find((x) => x.tenant_id === tenantId);
  if (propiaDeBaja) {
    return { tipo: 'error', e: { fila: f.fila, motivo: `ese teléfono es de ${propiaDeBaja.nombre}, dado de baja en tu flota: reactívalo desde Operadores en vez de darlo de alta otra vez` } };
  }
  return null;
}

function filaParaInsertar(tenantId: string, f: OperadorImportado, terminalGeneral: string | null): Record<string, unknown> {
  // El patio de la FILA (resuelto contra la flota) manda; si no trae, el general.
  const terminalId = f.terminalId !== undefined ? f.terminalId : terminalGeneral;
  return {
    tenant_id: tenantId,
    nombre: f.nombre,
    telefono: f.telefono,
    ...(f.correo ? { correo: f.correo } : {}),
    numero_empleado: f.numeroEmpleado,
    licencia: f.licencia,
    licencia_tipo: f.licenciaTipo,
    licencia_vence: f.licenciaVence,
    rfc: f.rfc,
    terminal_id: terminalId,
  };
}

export interface PlanOperadores {
  /** Las filas que SÍ se escribirían. */
  nuevas: OperadorImportado[];
  /** Ya estaban en ESTA flota. */
  duplicados: OperadorDuplicado[];
  /** No se escribirían, y por qué (otra flota, de baja). */
  errores: FilaConError[];
  /** Solo cuando no se pudo leer el catálogo y NO se puede afirmar nada. */
  error?: string;
}

/**
 * Qué pasaría con estas filas, SIN escribir nada: la misma lectura y la misma
 * clasificación que usa `importarOperadores` (una sola función, así la vista
 * previa no puede prometer algo que la escritura luego no hace). Falla cerrado:
 * sin poder leer los teléfonos existentes no se afirma nada.
 */
export async function planificarOperadores(tenantId: string, filas: OperadorImportado[]): Promise<PlanOperadores> {
  const plan: PlanOperadores = { nuevas: [], duplicados: [], errores: [] };
  if (!filas.length) return plan;
  const conTelefono = filas.filter((f) => !f.sinTelefono);
  const sinTelefono = filas.filter((f) => f.sinTelefono === true);
  // A37-L-seguridad-tenant-02: tope por flota a las consultas de duplicado (acota el barrido de números por lotes).
  if (!(await rateLimit(`tel-import:${tenantId}`, 60, 3_600_000))) {
    return { ...plan, error: 'Demasiadas importaciones de operadores en la última hora — no importé nada. Espera un rato e inténtalo de nuevo.' };
  }
  let existentes: Map<string, FilaExistente[]> = new Map();
  let porEmpleado: Map<string, FilaPorEmpleado[]> = new Map();
  let porCorreo: Map<string, FilaPorCorreo[]> = new Map();
  try {
    if (conTelefono.length) existentes = await buscarExistentes(conTelefono.map((f) => f.telefono));
    if (sinTelefono.length) porEmpleado = await buscarPorEmpleado(tenantId, sinTelefono.map((f) => f.numeroEmpleado ?? ''));
    const correos = [...new Set(filas.map((f) => f.correo).filter((c): c is string => !!c))];
    if (correos.length) porCorreo = await buscarPorCorreo(tenantId, correos);
  } catch (e) {
    logger.error('importar_operadores.catalogo_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ...plan, error: 'No pude comprobar qué operadores ya existen — no importé nada. Vuelve a intentar.' };
  }
  for (const f of filas) {
    let c: ReturnType<typeof clasificar>;
    let idExistente: string | null = null;
    if (f.sinTelefono) {
      // La alta sin teléfono se encuentra por número de empleado, DENTRO de la flota (activo o de baja).
      const ya = porEmpleado.get((f.numeroEmpleado ?? '').toLowerCase()) ?? [];
      const activa = ya.find((x) => x.activo);
      if (activa) { idExistente = activa.id; c = { tipo: 'duplicado', d: { fila: f.fila, id: activa.id, telefono: '', motivo: `ya estaba, a nombre de ${activa.nombre}` } }; }
      else if (ya.length) c = { tipo: 'error', e: { fila: f.fila, motivo: `ese número de empleado es de ${ya[0].nombre}, dado de baja en tu flota: reactívalo desde Operadores en vez de darlo de alta otra vez` } };
      else c = null;
    } else {
      const ex = existentes.get(f.telefono) ?? [];
      c = clasificar(tenantId, f, ex);
      if (c?.tipo === 'duplicado') idExistente = c.d.id;
    }
    // El correo nuevo no puede ser el de OTRO operador de la flota (el que ya estaba con ese teléfono/número sí es el mismo).
    if (!c && f.correo) {
      const otros = (porCorreo.get(f.correo) ?? []).filter((x) => x.id !== idExistente);
      if (otros.length) c = { tipo: 'error', e: { fila: f.fila, motivo: MOTIVO_CORREO_EN_USO } };
    }
    if (!c) plan.nuevas.push(f);
    else if (c.tipo === 'duplicado') plan.duplicados.push(c.d);
    else plan.errores.push(c.e);
  }
  return plan;
}

const RESTRICCIONES_TELEFONO = ['uq_operador_tenant_telefono_norm', 'uq_operador_telefono_activo', 'operador_tenant_id_telefono_key', 'uq_operador_tenant_numero_empleado_sin_tel'];

/**
 * Escribe los operadores en tandas de `FILAS_POR_TANDA`. Anclado al tenant.
 *
 * Una tanda es UN insert (atómico): si una fila choca contra el unique, la
 * tanda entera rebota y se reintenta FILA POR FILA para decir cuál fue —es la
 * carrera de dos submits del mismo archivo, y el perdedor reporta «ya
 * estaba», no un segundo «creados: 200»—. Cualquier otro error de la base
 * detiene el import y las filas que faltaban se reportan como no intentadas:
 * seguir escribiendo sobre una base que acaba de fallar reparte las fichas
 * por una página perdida.
 */
export async function importarOperadores(
  tenantId: string,
  filas: OperadorImportado[],
  opciones: { terminalId?: string | null; actor?: { id?: string; email?: string }; origen: 'panel' | 'api' },
): Promise<ResultadoImportacionOperadores> {
  if (!tenantId) throw new Error('importarOperadores: falta tenantId');
  const salida: ResultadoImportacionOperadores = { creados: [], duplicados: [], errores: [], avisoPendiente: 0 };
  if (!filas.length) return salida;

  // El patio se resuelve UNA vez: es de la flota o no lo es, y si no lo es no
  // se importa nada (un `DatoInvalido` que la pantalla enseña tal cual). Los
  // patios por FILA (columna «patio» del archivo, ya resueltos por `asignarPatios`)
  // se vuelven a comprobar aquí contra la flota: defensa en profundidad, la FK
  // compuesta de la 0298 es la última red.
  const terminalId = await resolverTerminalDeFlota(tenantId, opciones.terminalId);
  for (const t of new Set(filas.map((f) => f.terminalId).filter((t): t is string => typeof t === 'string' && t !== ''))) {
    await resolverTerminalDeFlota(tenantId, t);
  }

  const plan = await planificarOperadores(tenantId, filas);
  if (plan.error) return { ...salida, error: plan.error };
  salida.duplicados.push(...plan.duplicados);
  salida.errores.push(...plan.errores);
  // El marcador «sin WhatsApp» (0932) se genera aquí, al escribir: nunca viaja en la vista previa ni en el informe.
  const porEscribir = plan.nuevas.map((f) => (f.sinTelefono ? { ...f, telefono: nuevoMarcadorSinTelefono() } : f));

  const admin = supabaseAdmin();
  const tandas = enTandas(porEscribir);
  let detenido = false;
  for (const tanda of tandas) {
    if (detenido) {
      for (const f of tanda) salida.errores.push({ fila: f.fila, motivo: 'no se intentó: una tanda anterior falló' });
      continue;
    }
    const { data, error } = await acotada(
      admin.from('operador').insert(tanda.map((f) => filaParaInsertar(tenantId, f, terminalId))).select('id, telefono'),
      'importarOperadores.insert',
    );
    if (!error) {
      const idPorTelefono = new Map(((data ?? []) as Array<{ id: unknown; telefono: unknown }>)
        .map((r) => [claveDeTelefono(String(r.telefono)), String(r.id)] as const));
      for (const f of tanda) {
        const id = idPorTelefono.get(claveDeTelefono(f.telefono));
        if (id) salida.creados.push({ fila: f.fila, id, telefono: f.sinTelefono ? '' : f.telefono });
        else salida.errores.push({ fila: f.fila, motivo: 'la base no devolvió el id de esta fila' });
      }
      continue;
    }
    if (!RESTRICCIONES_TELEFONO.some((r) => chocaContra(error.message, r))) {
      logger.error('importar_operadores.tanda_fallo', { tenantId, filas: tanda.length, err: error.message });
      for (const f of tanda) salida.errores.push({ fila: f.fila, motivo: 'no se pudo escribir en la base; vuelve a subir el archivo (las filas ya creadas se saltan solas)' });
      detenido = true;
      continue;
    }
    // La carrera: alguien creó uno de estos teléfonos entre la lectura y el
    // insert. Fila por fila, para nombrar cuál.
    for (const f of tanda) {
      const uno = await acotada(
        admin.from('operador').insert(filaParaInsertar(tenantId, f, terminalId)).select('id').maybeSingle(),
        'importarOperadores.insert_uno',
      );
      if (!uno.error) {
        const id = (uno.data as { id?: unknown } | null)?.id;
        if (id) salida.creados.push({ fila: f.fila, id: String(id), telefono: f.sinTelefono ? '' : f.telefono });
        else salida.errores.push({ fila: f.fila, motivo: 'la base no devolvió el id de esta fila' });
        continue;
      }
      if (RESTRICCIONES_TELEFONO.some((r) => chocaContra(uno.error.message, r))) {
        const gano = f.sinTelefono
          ? await buscarPorEmpleado(tenantId, [f.numeroEmpleado ?? '']).then((m) => {
            const o = m.get((f.numeroEmpleado ?? '').toLowerCase())?.[0];
            return o ? { id: o.id, nombre: o.nombre } : null;
          }).catch(() => null)
          : await buscarOperadorPorTelefono(tenantId, f.telefono).catch(() => null);
        if (gano) salida.duplicados.push({ fila: f.fila, id: gano.id, telefono: f.sinTelefono ? '' : f.telefono, motivo: `ya estaba, a nombre de ${gano.nombre}` });
        else salida.errores.push({ fila: f.fila, motivo: 'ese teléfono ya está registrado (en otra flota o dado de baja)' });
      } else {
        salida.errores.push({ fila: f.fila, motivo: 'no se pudo escribir en la base; vuelve a subir el archivo' });
      }
    }
  }

  salida.avisoPendiente = salida.creados.length;

  // UNA línea por import en la bitácora (0053), con los ids creados: es lo que
  // contesta «¿quién metió a estos 300 choferes y cuándo?». Best-effort, como
  // toda anotación: el alta ya ocurrió.
  if (salida.creados.length > 0 || salida.errores.length > 0) {
    await anotarBitacora({
      tenantId, actor: opciones.actor ?? {}, accion: 'operador.importados', entidad: 'tenant', entidadId: tenantId,
      detalle: {
        origen: opciones.origen,
        creados: salida.creados.length,
        duplicados: salida.duplicados.length,
        errores: salida.errores.length,
        terminalId,
        ids: salida.creados.map((c) => c.id),
      },
    });
  }
  logger.info('operadores.importados', {
    tenantId, origen: opciones.origen, creados: salida.creados.length,
    duplicados: salida.duplicados.length, errores: salida.errores.length,
  });
  return salida;
}

/**
 * La ficha de ESTA flota con ese teléfono, o `null`. Es la llave natural que
 * vuelve durable la idempotencia de `POST /v1/operadores` (misma consulta que
 * `comprobarTelefonoLibre`, filtrada al tenant). Lanza si no pudo leer.
 */
export async function buscarOperadorPorTelefono(
  tenantId: string,
  telefono: string,
): Promise<{ id: string; nombre: string; numeroEmpleado: string | null; activo: boolean } | null> {
  const { data, error } = await acotada(
    supabaseAdmin().from('operador').select('id, nombre, numero_empleado, activo')
      // `activo` primero (si hay uno vivo con ese número, ÉSE es el que
      // responde) y `id` como desempate TOTAL: sin él, dos fichas con el
      // mismo `activo` —el mismo teléfono escrito en dos variantes, que es
      // justo lo que `variantesTelefono` va a buscar— devolverían una
      // cualquiera, y la idempotencia de `POST /v1/operadores` acusaría un id
      // distinto en cada reintento del mismo lote.
      .eq('tenant_id', tenantId).in('telefono', variantesTelefono(telefono))
      .order('activo', { ascending: false }).order('id').limit(1),
    'buscarOperadorPorTelefono',
  );
  if (error) throw new Error(`buscarOperadorPorTelefono: ${error.message}`);
  const f = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (!f) return null;
  return {
    id: String(f.id), nombre: String(f.nombre),
    numeroEmpleado: (f.numero_empleado as string) || null,
    activo: Boolean(f.activo),
  };
}
