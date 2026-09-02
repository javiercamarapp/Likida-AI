// ═══════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN MASIVA DE UNIDADES (auditoría 24, ADM-2 / faltante 3).
//
// 800 tractocamiones no se capturan uno por uno. Mismo molde que el importador
// de operadores: UN motor, dos puertas (el archivo de `/dashboard/unidades/
// importar` y el lote de `POST /v1/unidades`), y la MISMA validación que el
// alta unitaria (`validarUnidad`, operacion.ts) para que ninguna puerta
// admita lo que la otra rechaza.
//
// ── LAS DOS LLAVES ───────────────────────────────────────────────────────
//  · `numero_economico` es la llave natural de la base
//    (`unidad_economico_unico`, 0047): el insert es un UPSERT que ignora
//    duplicados y cuenta SOLO lo que de verdad entró — el mismo archivo dos
//    veces (o dos submits a la vez) no crea dos veces el C2-08.
//  · La PLACA es obligatoria, va en MAYÚSCULAS y es única por flota (regla de
//    la auditoría 24): es el dato que el inspector, el seguro y el consolidado
//    de casetas ven; dos camiones con la misma placa son una captura mal
//    hecha, y se rebota con el número del que ya la tiene. La unicidad de la
//    placa se comprueba aquí (en el archivo y contra la base); la base solo
//    garantiza la del económico.
//
// ── SIN COLUMNA DE NÚMERO ECONÓMICO, LA PLACA HACE DE ECONÓMICO ─────────
// Muchas flotas identifican el camión solo por placa. Si el archivo NO trae
// la columna, se usa la placa como número económico y SE DICE en el reporte
// (`economicoDesdePlaca`); si la columna existe y una celda viene vacía, la
// fila se descarta — eso ya es un dato que faltó, no una convención.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { validarUnidad, type UnidadValida } from '../operacion';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { DatoInvalido } from '../errores';
import { resolverTerminalDeFlota } from '../terminales';
import { leerFechaImportada } from '../importar_viajes';
import {
  type Descartada, TOPE_FILAS_IMPORTACION, detectarColumnas, filaVacia, celdaTexto,
  encabezadosLeidos, avisoDeTope, plantillaCsv, MARCA_EJEMPLO, esFilaDeEjemplo, enTandas, chocaContra,
} from './archivo';

/** Lo que llega crudo de una fila del archivo o de un elemento del lote. */
export interface UnidadCrudaImportada {
  numeroEconomico?: string | null;
  placas: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: string | number | null;
  polizaVence?: string | null;
  permisoSictVence?: string | null;
  verificacionVence?: string | null;
}

/** Una fila ya válida, lista para escribir. */
export interface UnidadImportada extends UnidadValida {
  fila: number;
  /** La placa normalizada NUNCA es null aquí: es obligatoria. */
  placas: string;
}

/** La placa como se guarda: mayúsculas, sin espacios sobrantes ni guiones
 *  repetidos. «abc-123-4» y «ABC 123 4» son la misma placa. */
export function normalizarPlaca(cruda: string): string {
  return (cruda ?? '').toUpperCase().replace(/[\s-]+/g, '-').replace(/^-|-$/g, '').trim();
}

/**
 * De lo crudo a lo válido. PURA: lanza `DatoInvalido` con el QUÉ corregir.
 * Reusa `validarUnidad` (operacion.ts) —los mismos topes y las mismas fechas
 * que el formulario y que `POST /v1/unidades`— y le suma la regla de placa.
 */
export function validarUnidadImportada(c: UnidadCrudaImportada, fila: number, hoy = new Date()): UnidadImportada {
  const placas = normalizarPlaca(c.placas ?? '');
  if (placas === '') throw new DatoInvalido('sin placa — es obligatoria');
  if (placas.length > 20) throw new DatoInvalido('la placa no puede pasar de 20 caracteres');
  if (!/^[A-Z0-9-]+$/.test(placas)) throw new DatoInvalido(`la placa «${placas}» trae caracteres que no son letras, números ni guion`);

  const numeroEconomico = (c.numeroEconomico ?? '').replace(/\s+/g, ' ').trim();
  if (numeroEconomico === '') throw new DatoInvalido('sin número económico');

  const v = validarUnidad({
    numeroEconomico,
    placas,
    marca: c.marca ?? '',
    modelo: c.modelo ?? '',
    anio: c.anio == null ? '' : String(c.anio),
    polizaVence: c.polizaVence ?? '',
    permisoSictVence: c.permisoSictVence ?? '',
    verificacionVence: c.verificacionVence ?? '',
    gpsProveedor: '',
    gpsDeviceId: '',
  }, hoy);
  return { ...v, placas, fila };
}

// ── El archivo ─────────────────────────────────────────────────────────────

export const COLUMNAS_UNIDAD = {
  numeroEconomico: ['numero economico', 'no economico', 'no. economico', 'economico', 'unidad', 'camion', 'tracto', 'eco', 'num economico', 'n economico', 'numero'],
  placas: ['placas', 'placa', 'matricula'],
  marca: ['marca'],
  modelo: ['modelo'],
  anio: ['anio', 'ano', 'año', 'year', 'modelo anio'],
  polizaVence: ['poliza vence', 'vence poliza', 'poliza', 'vencimiento poliza', 'vigencia poliza', 'seguro vence', 'seguro'],
  permisoSictVence: ['permiso sict vence', 'vence permiso sict', 'permiso sict', 'sict', 'permiso', 'vencimiento permiso'],
  verificacionVence: ['verificacion vence', 'vence verificacion', 'verificacion', 'vencimiento verificacion', 'verificacion fisico mecanica'],
} as const;

export const PLANTILLA_UNIDADES = {
  encabezados: ['numero economico', 'placas', 'marca', 'modelo', 'anio', 'poliza vence', 'permiso sict vence', 'verificacion vence'],
  ejemplo: [`T-042 ${MARCA_EJEMPLO}`, 'ABC-123-4', 'Kenworth', 'T680', '2019', '2027-01-31', '2026-11-30', '2026-12-15'],
} as const;

export function plantillaUnidadesCsv(): string {
  return plantillaCsv(PLANTILLA_UNIDADES.encabezados, PLANTILLA_UNIDADES.ejemplo);
}

export interface LecturaUnidades {
  filas: UnidadImportada[];
  descartadas: Descartada[];
  /** `true` cuando el archivo NO trae columna de número económico y se usó
   *  la placa en su lugar — se dice en el reporte. */
  economicoDesdePlaca: boolean;
  error?: string;
}

/** La matriz cruda → filas válidas + descartadas. PURA. */
export function interpretarFilasUnidades(matriz: unknown[][], hoy = new Date()): LecturaUnidades {
  if (!matriz.length) return { filas: [], descartadas: [], economicoDesdePlaca: false, error: 'El archivo está vacío.' };
  const indice = detectarColumnas(matriz[0] ?? [], COLUMNAS_UNIDAD);
  if (indice.placas === undefined) {
    return {
      filas: [], descartadas: [], economicoDesdePlaca: false,
      error: `No encontré la columna de placas. Encabezados leídos: ${encabezadosLeidos(matriz)}. Descarga la plantilla, o renombra la columna a «placas» y vuelve a subirlo.`,
    };
  }
  const economicoDesdePlaca = indice.numeroEconomico === undefined;

  const filas: UnidadImportada[] = [];
  const descartadas: Descartada[] = [];
  const placasVistas = new Map<string, number>();
  const economicosVistos = new Map<string, number>();

  for (let f = 1; f < matriz.length && f <= TOPE_FILAS_IMPORTACION; f++) {
    const fila = matriz[f];
    if (filaVacia(fila)) continue;
    const numero = f + 1;
    if (esFilaDeEjemplo(fila)) { descartadas.push({ fila: numero, motivo: 'es la fila de ejemplo de la plantilla' }); continue; }

    const celda = (k: keyof typeof COLUMNAS_UNIDAD, max = 60): string =>
      indice[k] === undefined ? '' : celdaTexto(fila[indice[k] as number], max);
    const fecha = (k: 'polizaVence' | 'permisoSictVence' | 'verificacionVence', nombre: string): string | null => {
      const v = leerFechaImportada(indice[k] === undefined ? null : fila[indice[k] as number]);
      if (v === 'ilegible') throw new DatoInvalido(`la fecha de ${nombre} no se entiende (usa AAAA-MM-DD)`);
      return v;
    };

    try {
      const placaCruda = celda('placas', 30);
      const v = validarUnidadImportada({
        numeroEconomico: economicoDesdePlaca ? normalizarPlaca(placaCruda) : celda('numeroEconomico', 40),
        placas: placaCruda,
        marca: celda('marca'),
        modelo: celda('modelo'),
        anio: celda('anio', 10),
        polizaVence: fecha('polizaVence', 'la póliza') ?? '',
        permisoSictVence: fecha('permisoSictVence', 'el permiso SICT') ?? '',
        verificacionVence: fecha('verificacionVence', 'la verificación') ?? '',
      }, numero, hoy);

      const placaRepetida = placasVistas.get(v.placas);
      if (placaRepetida !== undefined) {
        descartadas.push({ fila: numero, motivo: `placa ${v.placas} repetida en el archivo (ya viene en la fila ${placaRepetida})` });
        continue;
      }
      const ecoRepetido = economicosVistos.get(v.numeroEconomico);
      if (ecoRepetido !== undefined) {
        descartadas.push({ fila: numero, motivo: `número económico ${v.numeroEconomico} repetido en el archivo (ya viene en la fila ${ecoRepetido})` });
        continue;
      }
      placasVistas.set(v.placas, numero);
      economicosVistos.set(v.numeroEconomico, numero);
      filas.push(v);
    } catch (e) {
      if (e instanceof DatoInvalido) { descartadas.push({ fila: numero, motivo: e.message }); continue; }
      throw e;
    }
  }

  const tope = avisoDeTope(matriz);
  if (tope) {
    descartadas.unshift(tope);
    return { filas, descartadas, economicoDesdePlaca, error: tope.motivo };
  }
  return { filas, descartadas, economicoDesdePlaca };
}

// ── La escritura ───────────────────────────────────────────────────────────

export interface UnidadCreada { fila: number; id: string; numeroEconomico: string; placas: string }
export interface UnidadDuplicada { fila: number; id: string | null; numeroEconomico: string; motivo: string }
export interface FilaConError { fila: number; motivo: string }

export interface ResultadoImportacionUnidades {
  creadas: UnidadCreada[];
  /** El número económico YA existía en la flota: no se toca lo que hay. */
  duplicadas: UnidadDuplicada[];
  /** No se escribieron y se dice por qué (placa de otra unidad, la base). */
  errores: FilaConError[];
  error?: string;
}

type UnidadExistente = { id: string; numero_economico: string; placas: string | null };

/** Todo el parque de la flota (económico + placa). Falla cerrado: sin
 *  poder leerlo entero NO se importa — «placa libre» sobre media lista es la
 *  forma de duplicar una placa sin que nadie lo vea. */
async function parqueDeLaFlota(tenantId: string): Promise<UnidadExistente[]> {
  return traerTodo<UnidadExistente>(
    (d, h) => acotada(
      supabaseAdmin().from('unidad').select('id, numero_economico, placas', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'importarUnidades.parque',
    ),
    'importarUnidades.parque',
  );
}

function filaParaInsertar(tenantId: string, u: UnidadImportada, terminalId: string | null): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    numero_economico: u.numeroEconomico,
    placas: u.placas,
    marca: u.marca,
    modelo: u.modelo,
    anio: u.anio,
    poliza_vence: u.polizaVence,
    permiso_sict_vence: u.permisoSictVence,
    verificacion_vence: u.verificacionVence,
    terminal_id: terminalId,
  };
}

/**
 * Escribe las unidades en tandas. Anclado al tenant.
 *
 * El insert es un UPSERT con `ignoreDuplicates` sobre `(tenant_id,
 * numero_economico)`: dos submits concurrentes del mismo archivo chocan ahí
 * y el perdedor cuenta ÚNICAMENTE lo que entró (patrón de `importarViajes`,
 * BE-A3). Lo que no volvió del `.select()` es que ya existía.
 */
export async function importarUnidades(
  tenantId: string,
  filas: UnidadImportada[],
  opciones: { terminalId?: string | null; actor?: { id?: string; email?: string }; origen: 'panel' | 'api' },
): Promise<ResultadoImportacionUnidades> {
  if (!tenantId) throw new Error('importarUnidades: falta tenantId');
  const salida: ResultadoImportacionUnidades = { creadas: [], duplicadas: [], errores: [] };
  if (!filas.length) return salida;

  const terminalId = await resolverTerminalDeFlota(tenantId, opciones.terminalId);

  let parque: UnidadExistente[];
  try {
    parque = await parqueDeLaFlota(tenantId);
  } catch (e) {
    logger.error('importar_unidades.parque_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ...salida, error: 'No pude leer el parque actual para comprobar placas y números económicos — no importé nada. Vuelve a intentar.' };
  }
  const porEconomico = new Map(parque.map((u) => [u.numero_economico, u] as const));
  const porPlaca = new Map(parque.filter((u) => u.placas).map((u) => [normalizarPlaca(String(u.placas)), u] as const));

  const porEscribir: UnidadImportada[] = [];
  for (const f of filas) {
    const yaEco = porEconomico.get(f.numeroEconomico);
    if (yaEco) {
      salida.duplicadas.push({ fila: f.fila, id: yaEco.id, numeroEconomico: f.numeroEconomico, motivo: 'ya estaba (mismo número económico); no se tocó lo que hay' });
      continue;
    }
    const yaPlaca = porPlaca.get(f.placas);
    if (yaPlaca) {
      salida.errores.push({ fila: f.fila, motivo: `la placa ${f.placas} ya es de la unidad ${yaPlaca.numero_economico}; una placa es de un solo camión` });
      continue;
    }
    porEscribir.push(f);
  }

  const admin = supabaseAdmin();
  let detenido = false;
  for (const tanda of enTandas(porEscribir)) {
    if (detenido) {
      for (const f of tanda) salida.errores.push({ fila: f.fila, motivo: 'no se intentó: una tanda anterior falló' });
      continue;
    }
    const { data, error } = await acotada(
      admin.from('unidad')
        .upsert(tanda.map((f) => filaParaInsertar(tenantId, f, terminalId)), { onConflict: 'tenant_id,numero_economico', ignoreDuplicates: true })
        .select('id, numero_economico'),
      'importarUnidades.upsert',
    );
    if (error) {
      // Con `ignoreDuplicates` el económico no puede chocar; si llega un 23505
      // es otra restricción (p. ej. una placa que la base decida hacer única
      // más adelante) y se reporta por fila igual que un fallo cualquiera.
      logger.error('importar_unidades.tanda_fallo', { tenantId, filas: tanda.length, err: error.message });
      const esChoque = chocaContra(error.message, 'unidad');
      for (const f of tanda) salida.errores.push({ fila: f.fila, motivo: esChoque ? 'chocó con una unidad que ya existe; revisa placa y número económico' : 'no se pudo escribir en la base; vuelve a subir el archivo (las ya creadas se saltan solas)' });
      if (!esChoque) detenido = true;
      continue;
    }
    const idPorEco = new Map(((data ?? []) as Array<{ id: unknown; numero_economico: unknown }>)
      .map((r) => [String(r.numero_economico), String(r.id)] as const));
    for (const f of tanda) {
      const id = idPorEco.get(f.numeroEconomico);
      if (id) salida.creadas.push({ fila: f.fila, id, numeroEconomico: f.numeroEconomico, placas: f.placas });
      // No volvió: otra petición lo creó entre la lectura y el upsert (la
      // carrera de dos submits). Es un duplicado, no un error.
      else salida.duplicadas.push({ fila: f.fila, id: null, numeroEconomico: f.numeroEconomico, motivo: 'ya estaba (lo creó otra carga al mismo tiempo)' });
    }
  }

  if (salida.creadas.length > 0 || salida.errores.length > 0) {
    await anotarBitacora({
      tenantId, actor: opciones.actor ?? {}, accion: 'unidad.importadas', entidad: 'tenant', entidadId: tenantId,
      detalle: {
        origen: opciones.origen,
        creadas: salida.creadas.length,
        duplicadas: salida.duplicadas.length,
        errores: salida.errores.length,
        terminalId,
        ids: salida.creadas.map((c) => c.id),
      },
    });
  }
  logger.info('unidades.importadas', {
    tenantId, origen: opciones.origen, creadas: salida.creadas.length,
    duplicadas: salida.duplicadas.length, errores: salida.errores.length,
  });
  return salida;
}
