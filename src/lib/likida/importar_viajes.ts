import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { traerTodo } from './pg';
import { resolverOperadorPorNombre, OperadorNombreAmbiguo } from './crear_viaje_wa';
import { ConsultaFallida } from './conv';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTADOR DE VIAJES (kit del PoC, 14-ago-2026) — el export del TMS del
// prospecto entra al Registro para que el conciliador tenga contra qué
// cruzar. Un PoC de peajes sin los viajes del periodo no cruza nada.
//
// ── LO QUE ESTE CAMINO NO HACE, A PROPÓSITO ────────────────────────────────
// NO manda WhatsApp. `crearViaje()` avisa al chofer en cuanto inserta — eso
// es correcto al despachar y sería un desastre al importar 200 viajes
// históricos de un TMS ajeno. Aquí se inserta directo, con `avisado_en`
// nulo: la escalación (que exige aviso previo) tampoco se dispara.
//
// ── EL DEDUP ES POR FOLIO, Y SE DICE ───────────────────────────────────────
// El mismo archivo subido dos veces no duplica viajes: los folios que ya
// existen en la flota se saltan y se REPORTAN. Un folio vacío no se puede
// dedupear — se rechaza la fila, no se adivina.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilaViajeImportada {
  folio: string;
  origen: string | null;
  destino: string | null;
  /** ISO AAAA-MM-DD, ya normalizada por `interpretarFilasViajes`. */
  fechaInicio: string | null;
  anticipo: number | null;
  /** El texto del TMS — se resuelve contra `operador` al importar. */
  operadorNombre: string | null;
}

export interface LecturaImportacion {
  viajes: FilaViajeImportada[];
  /** Filas que no se pudieron leer (sin folio, cifra ilegible) — se dicen. */
  descartadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

/** Encabezados que el mundo real usa. Minúsculas, sin acentos. */
const COLUMNAS: Record<keyof Omit<FilaViajeImportada, 'fechaInicio'> | 'fecha', string[]> = {
  folio: ['folio', 'viaje', 'no viaje', 'no. viaje', 'numero de viaje', 'id viaje', 'referencia'],
  origen: ['origen', 'de', 'sale de', 'ciudad origen'],
  destino: ['destino', 'a', 'hasta', 'llega a', 'ciudad destino'],
  fecha: ['fecha', 'fecha inicio', 'fecha de inicio', 'salida', 'fecha salida', 'inicio'],
  anticipo: ['anticipo', 'anticipo mxn', 'monto anticipo'],
  operadorNombre: ['operador', 'chofer', 'conductor', 'nombre operador', 'nombre del operador'],
};

function normalizarEncabezado(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "$8,000.50" / "8000,50" / 8000 → número, o null si no se puede leer con
 *  seguridad. La regla de siempre: una cifra dudosa no se adivina. */
export function leerCifraImportada(v: unknown): number | null | 'ilegible' {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 'ilegible';
  const limpio = String(v).replace(/[$\s]/g, '');
  if (!limpio) return null;
  // "1.234,56" europeo vs "1,234.56": si hay coma Y punto, el ÚLTIMO es el decimal.
  const normal = limpio.includes(',') && limpio.includes('.')
    ? (limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, ''))
    : limpio.replace(',', '.');
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'ilegible';
}

/** dd/mm/aaaa, aaaa-mm-dd o serial de Excel → ISO. null = vacía; 'ilegible'
 *  cuando trae algo que no se entiende. */
export function leerFechaImportada(v: unknown): string | null | 'ilegible' {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    // Serial de Excel (días desde 1899-12-30). Rango sano: 2000–2100.
    if (v < 36526 || v > 73415) return 'ilegible';
    const ms = Math.round((v - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) {
    const dia = Number(m[1]), mes = Number(m[2]);
    if (mes > 12 || dia > 31 || mes < 1 || dia < 1) return 'ilegible';
    return `${m[3]}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return 'ilegible';
}

/**
 * La matriz cruda del archivo (fila 0 = encabezados) → filas listas para
 * importar. PURA: la detección de columnas es por nombre de encabezado, y
 * sin columna de folio no hay importación — el dedup depende de él.
 */
export function interpretarFilasViajes(matriz: unknown[][]): LecturaImportacion {
  if (!matriz.length) return { viajes: [], descartadas: [], error: 'El archivo está vacío.' };

  const encabezados = matriz[0].map(normalizarEncabezado);
  const indice: Partial<Record<keyof typeof COLUMNAS, number>> = {};
  for (const clave of Object.keys(COLUMNAS) as Array<keyof typeof COLUMNAS>) {
    const i = encabezados.findIndex((e) => COLUMNAS[clave].includes(e));
    if (i >= 0) indice[clave] = i;
  }
  if (indice.folio === undefined) {
    return {
      viajes: [], descartadas: [],
      error: `No encontré la columna del folio. Encabezados leídos: ${matriz[0].map((c) => `«${String(c ?? '')}»`).join(', ')}. Renombra la columna a «folio» (o «viaje») y vuelve a subirlo.`,
    };
  }

  const viajes: FilaViajeImportada[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];
  const vistos = new Set<string>();

  for (let f = 1; f < matriz.length && f <= 2000; f++) {
    const fila = matriz[f];
    if (!fila || fila.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const celda = (clave: keyof typeof COLUMNAS): unknown =>
      indice[clave] === undefined ? null : fila[indice[clave] as number];

    const folio = String(celda('folio') ?? '').trim().slice(0, 40);
    if (!folio) { descartadas.push({ fila: f + 1, motivo: 'sin folio' }); continue; }
    if (vistos.has(folio)) { descartadas.push({ fila: f + 1, motivo: `folio repetido en el archivo (${folio})` }); continue; }
    vistos.add(folio);

    const anticipo = leerCifraImportada(celda('anticipo'));
    if (anticipo === 'ilegible') { descartadas.push({ fila: f + 1, motivo: `anticipo ilegible (${folio})` }); continue; }
    const fecha = leerFechaImportada(celda('fecha'));
    if (fecha === 'ilegible') { descartadas.push({ fila: f + 1, motivo: `fecha ilegible (${folio})` }); continue; }

    viajes.push({
      folio,
      origen: String(celda('origen') ?? '').trim().slice(0, 80) || null,
      destino: String(celda('destino') ?? '').trim().slice(0, 80) || null,
      fechaInicio: fecha,
      anticipo,
      operadorNombre: String(celda('operadorNombre') ?? '').trim().slice(0, 120) || null,
    });
  }

  if (matriz.length - 1 > 2000) {
    return { viajes, descartadas, error: `El archivo trae más de 2,000 filas — se leyeron las primeras 2,000. Pártelo y sube el resto aparte.` };
  }
  return { viajes, descartadas };
}

export interface ResultadoImportacion {
  creados: number;
  /** Folios que YA existían en la flota — el mismo archivo dos veces no duplica. */
  saltados: string[];
  /** Operadores del archivo que no se pudieron amarrar (no existe / ambiguo)
   *  — el viaje se crea SIN asignar y esto lo dice. */
  operadoresSinAmarrar: string[];
  error?: string;
}

/** Inserta los viajes SIN avisar a nadie (ver encabezado). Anclado al tenant. */
export async function importarViajes(tenantId: string, filas: FilaViajeImportada[]): Promise<ResultadoImportacion> {
  if (!tenantId) throw new Error('importarViajes: falta tenantId');
  if (!filas.length) return { creados: 0, saltados: [], operadoresSinAmarrar: [] };

  const existentes = new Set(
    (await traerTodo<{ folio: unknown }>(
      (d, h) => acotada(supabaseAdmin().from('viaje').select('folio')
        .eq('tenant_id', tenantId).not('folio', 'is', null).order('id').range(d, h), 'importarViajes.folios'),
      'importarViajes.folios',
    )).map((v) => String(v.folio)),
  );

  const saltados = filas.filter((f) => existentes.has(f.folio)).map((f) => f.folio);
  const nuevas = filas.filter((f) => !existentes.has(f.folio));

  // El amarre de operador es por nombre EXACTO (mismo motor del despacho por
  // WA); lo ambiguo o desconocido queda sin asignar y se reporta — importar
  // no es el momento de adivinar a quién se le carga un viaje.
  const operadorPorNombre = new Map<string, string | null>();
  const operadoresSinAmarrar = new Set<string>();
  for (const f of nuevas) {
    if (!f.operadorNombre || operadorPorNombre.has(f.operadorNombre)) continue;
    try {
      const c = await resolverOperadorPorNombre(tenantId, f.operadorNombre);
      operadorPorNombre.set(f.operadorNombre, c?.operadorId ?? null);
      if (!c) operadoresSinAmarrar.add(f.operadorNombre);
    } catch (e) {
      if (e instanceof OperadorNombreAmbiguo || e instanceof ConsultaFallida) {
        operadorPorNombre.set(f.operadorNombre, null);
        operadoresSinAmarrar.add(f.operadorNombre);
      } else throw e;
    }
  }

  let creados = 0;
  // Lotes de 100: un INSERT de 2,000 filas en una pasada es donde un timeout
  // deja mitad y mitad sin decir cuál mitad.
  for (let i = 0; i < nuevas.length; i += 100) {
    const lote = nuevas.slice(i, i + 100).map((f) => ({
      tenant_id: tenantId,
      folio: f.folio,
      origen: f.origen,
      destino: f.destino,
      fecha_inicio: f.fechaInicio,
      anticipo: f.anticipo ?? 0,
      operador_id: f.operadorNombre ? operadorPorNombre.get(f.operadorNombre) ?? null : null,
      estatus: 'abierto',
    }));
    const { data, error } = await acotada(
      supabaseAdmin().from('viaje').insert(lote).select('id'), 'importarViajes.insert',
    );
    if (error) {
      logger.error('importar_viajes.lote_fallo', { tenantId, desde: i, err: error.message });
      return {
        creados, saltados, operadoresSinAmarrar: [...operadoresSinAmarrar],
        error: `Se crearon ${creados} y el lote que empieza en la fila ${i + 1} falló — revisa y vuelve a subir el archivo: los ya creados se saltan solos.`,
      };
    }
    creados += data?.length ?? 0;
  }

  logger.info('importar_viajes.ok', { tenantId, creados, saltados: saltados.length });
  return { creados, saltados, operadoresSinAmarrar: [...operadoresSinAmarrar] };
}
