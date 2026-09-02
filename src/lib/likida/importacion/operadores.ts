// ═══════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN MASIVA DE OPERADORES (auditoría 24, ADM-2 / faltante 3).
//
// Innovativos tiene cientos de choferes y hasta hoy el alta era uno por uno
// (`crearOperador`) o SQL a mano. Este módulo es UN motor con dos puertas:
// el archivo CSV/XLSX de `/dashboard/operadores/importar` y el lote de
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
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { destinatarioWhatsApp } from '@/lib/meta/client';
import { acotada } from '../presupuesto';
import { variantesTelefono } from '../conv';
import { DatoInvalido } from '../errores';
import {
  normalizarTelefonoOperador, normalizarRfcOperador, normalizarFechaLicencia,
} from '../administracion';
import { resolverTerminalDeFlota } from '../terminales';
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
}

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
}

/**
 * De lo crudo a lo válido. PURA: lanza `DatoInvalido` con el QUÉ corregir.
 * Es la misma validación que `crearOperador`, y las dos puertas la comparten.
 */
export function validarOperadorImportado(c: OperadorCrudo, fila: number): OperadorImportado {
  const nombre = (c.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 3) throw new DatoInvalido('el nombre necesita al menos 3 caracteres');
  if (nombre.length > 120) throw new DatoInvalido('el nombre no puede pasar de 120 caracteres');
  if (!(c.telefono ?? '').trim()) throw new DatoInvalido('sin teléfono — es la identidad del chofer para el bot');
  const telefono = normalizarTelefonoOperador(c.telefono);
  const numeroEmpleado = (c.numeroEmpleado ?? '').trim().slice(0, 40) || null;
  const licencia = (c.licencia ?? '').trim().slice(0, 40) || null;
  const licenciaTipo = (c.licenciaTipo ?? '').trim().slice(0, 10) || null;
  return {
    fila, nombre, telefono, numeroEmpleado,
    rfc: normalizarRfcOperador(c.rfc),
    licencia, licenciaTipo,
    licenciaVence: normalizarFechaLicencia(c.licenciaVence),
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
} as const;

/** La plantilla que se descarga. El orden es el que se lee. */
export const PLANTILLA_OPERADORES = {
  encabezados: ['nombre', 'telefono', 'numero de empleado', 'rfc', 'licencia', 'tipo de licencia', 'vence licencia'],
  ejemplo: [`Juan Pérez ${MARCA_EJEMPLO}`, '5512345678', 'E-104', '', 'MEX123456', 'E', '2027-03-15'],
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
export function interpretarFilasOperadores(matriz: unknown[][]): LecturaOperadores {
  if (!matriz.length) return { filas: [], descartadas: [], error: 'El archivo está vacío.' };
  const indice = detectarColumnas(matriz[0] ?? [], COLUMNAS_OPERADOR);
  if (indice.nombre === undefined || indice.telefono === undefined) {
    const falta = indice.nombre === undefined ? 'nombre' : 'teléfono';
    return {
      filas: [], descartadas: [],
      error: `No encontré la columna de ${falta}. Encabezados leídos: ${encabezadosLeidos(matriz)}. Descarga la plantilla, o renombra la columna a «nombre» / «telefono» y vuelve a subirlo.`,
    };
  }

  const filas: OperadorImportado[] = [];
  const descartadas: Descartada[] = [];
  const telefonosVistos = new Map<string, number>();

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
      }, numero);
      const repetida = telefonosVistos.get(v.telefono);
      if (repetida !== undefined) {
        descartadas.push({ fila: numero, motivo: `teléfono repetido en el archivo (ya viene en la fila ${repetida})` });
        continue;
      }
      telefonosVistos.set(v.telefono, numero);
      filas.push(v);
    } catch (e) {
      if (e instanceof DatoInvalido) { descartadas.push({ fila: numero, motivo: e.message }); continue; }
      throw e;
    }
  }

  const tope = avisoDeTope(matriz);
  if (tope) {
    descartadas.unshift(tope);
    return { filas, descartadas, error: tope.motivo };
  }
  return { filas, descartadas };
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
    return { tipo: 'error', e: { fila: f.fila, motivo: 'ese teléfono ya está registrado en OTRA flota; dos operadores con el mismo número anotarían sus comprobantes en la flota equivocada' } };
  }
  const propiaDeBaja = existentes.find((x) => x.tenant_id === tenantId);
  if (propiaDeBaja) {
    return { tipo: 'error', e: { fila: f.fila, motivo: `ese teléfono es de ${propiaDeBaja.nombre}, dado de baja en tu flota: reactívalo desde Operadores en vez de darlo de alta otra vez` } };
  }
  return null;
}

function filaParaInsertar(tenantId: string, f: OperadorImportado, terminalId: string | null): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    nombre: f.nombre,
    telefono: f.telefono,
    numero_empleado: f.numeroEmpleado,
    licencia: f.licencia,
    licencia_tipo: f.licenciaTipo,
    licencia_vence: f.licenciaVence,
    rfc: f.rfc,
    terminal_id: terminalId,
  };
}

const RESTRICCIONES_TELEFONO = ['uq_operador_tenant_telefono_norm', 'uq_operador_telefono_activo', 'operador_tenant_id_telefono_key'];

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
  // se importa nada (un `DatoInvalido` que la pantalla enseña tal cual).
  const terminalId = await resolverTerminalDeFlota(tenantId, opciones.terminalId);

  let existentes: Map<string, FilaExistente[]>;
  try {
    existentes = await buscarExistentes(filas.map((f) => f.telefono));
  } catch (e) {
    logger.error('importar_operadores.catalogo_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ...salida, error: 'No pude comprobar qué teléfonos ya existen — no importé nada. Vuelve a intentar.' };
  }

  const porEscribir: OperadorImportado[] = [];
  for (const f of filas) {
    const c = clasificar(tenantId, f, existentes.get(f.telefono) ?? []);
    if (!c) porEscribir.push(f);
    else if (c.tipo === 'duplicado') salida.duplicados.push(c.d);
    else salida.errores.push(c.e);
  }

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
        .map((r) => [destinatarioWhatsApp(String(r.telefono)), String(r.id)] as const));
      for (const f of tanda) {
        const id = idPorTelefono.get(f.telefono);
        if (id) salida.creados.push({ fila: f.fila, id, telefono: f.telefono });
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
        if (id) salida.creados.push({ fila: f.fila, id: String(id), telefono: f.telefono });
        else salida.errores.push({ fila: f.fila, motivo: 'la base no devolvió el id de esta fila' });
        continue;
      }
      if (RESTRICCIONES_TELEFONO.some((r) => chocaContra(uno.error.message, r))) {
        const gano = await buscarOperadorPorTelefono(tenantId, f.telefono).catch(() => null);
        if (gano) salida.duplicados.push({ fila: f.fila, id: gano.id, telefono: f.telefono, motivo: `ya estaba, a nombre de ${gano.nombre}` });
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
