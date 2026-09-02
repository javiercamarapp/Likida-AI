// ═══════════════════════════════════════════════════════════════════════════
// LA VENTANA DE UN EXPORT — vive fuera del route handler a propósito.
//
// Next.js prohíbe exports que no sean los suyos (`GET`, `runtime`, …) en un
// `route.ts`: dejarlos ahí rompe el typecheck del build, no del lint. Y la
// regla del periodo la necesitan tanto la ruta como quien arme el enlace en
// una pantalla, así que tiene que ser importable.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope del periodo de un export: 3 meses. A 50k viajes/mes son ~150k
 *  liquidaciones como máximo por archivo — lo que un ERP importa de una
 *  sentada; más que eso se pide en dos archivos. */
export const MESES_MAXIMO = 3;

/** `YYYY-MM-DD` de calendario real (el `Date` de JS acepta 2026-02-31). */
function diaValido(v: string | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Lee `?desde=&hasta=` (ambos obligatorios, días de México, inclusivos) y los
 * vuelve el rango `[desde 00:00, hasta+1 00:00)` en horario de México.
 *
 * El offset va fijo en -06:00: México no tiene horario de verano desde 2022
 * (`TZ_MX` en lib/formato.ts es America/Mexico_City por el mismo motivo).
 */
export function leerPeriodo(q: URLSearchParams):
  | { ok: true; desde: string; hastaExclusivo: string; etiqueta: string }
  | { ok: false; motivo: string } {
  const desde = q.get('desde');
  const hasta = q.get('hasta');
  if (!diaValido(desde) || !diaValido(hasta)) {
    return { ok: false, motivo: `Indica el periodo: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (ambos obligatorios, máximo ${MESES_MAXIMO} meses).` };
  }
  if (hasta < desde) return { ok: false, motivo: '`hasta` no puede ser anterior a `desde`.' };

  const tope = new Date(`${desde}T00:00:00Z`);
  tope.setUTCMonth(tope.getUTCMonth() + MESES_MAXIMO);
  const diaSiguiente = new Date(`${hasta}T00:00:00Z`);
  diaSiguiente.setUTCDate(diaSiguiente.getUTCDate() + 1);
  if (diaSiguiente.getTime() > tope.getTime()) {
    return { ok: false, motivo: `El periodo no puede pasar de ${MESES_MAXIMO} meses. Pide el histórico en varios archivos.` };
  }

  return {
    ok: true,
    desde: `${desde}T00:00:00-06:00`,
    hastaExclusivo: `${diaSiguiente.toISOString().slice(0, 10)}T00:00:00-06:00`,
    etiqueta: `${desde}..${hasta}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ REVISIONES ENTRAN AL ARCHIVO (auditoría 24, bloqueante 6 — mig. 0299).
//
// Desde la 0299 una liquidación tiene dos estados: el del MOTOR (`estatus`) y
// el de la PERSONA (`revision`). Este CSV es con lo que tesorería arma la
// dispersión al chofer (`producto-completitud.md` §19), así que una
// liquidación RECHAZADA —cuyas cifras el motor va a recalcular en cuanto
// llegue el comprobante bueno— no puede entrar por omisión: se pagaría sobre
// un total que ya se sabe equivocado.
//
// Por omisión entra todo MENOS lo rechazado. Se puede pedir explícito otra
// cosa; lo que NO se puede es que el archivo salga sin decir cuál fue el
// corte, así que el filtro viaja en el nombre del archivo y en un encabezado.
// Las columnas del CSV no cambian (el ERP del contador ya las lee).
// ═══════════════════════════════════════════════════════════════════════════

export const FILTROS_REVISION = ['sin_rechazadas', 'firmadas', 'pendiente', 'aprobada', 'ajustada', 'rechazada', 'todas'] as const;
export type FiltroRevisionExport = (typeof FILTROS_REVISION)[number];
export const FILTRO_REVISION_DEFECTO: FiltroRevisionExport = 'sin_rechazadas';

export function leerFiltroRevision(q: URLSearchParams):
  | { ok: true; filtro: FiltroRevisionExport }
  | { ok: false; motivo: string } {
  const crudo = q.get('revision');
  if (crudo === null || crudo === '') return { ok: true, filtro: FILTRO_REVISION_DEFECTO };
  if (!(FILTROS_REVISION as readonly string[]).includes(crudo)) {
    return { ok: false, motivo: `\`revision\` solo acepta: ${FILTROS_REVISION.join(', ')}.` };
  }
  return { ok: true, filtro: crudo as FiltroRevisionExport };
}

/** Cómo se le explica el corte a quien abra el archivo. */
export const LEYENDA_REVISION: Record<FiltroRevisionExport, string> = {
  sin_rechazadas: 'todas menos las rechazadas',
  firmadas: 'solo las aprobadas o ajustadas',
  pendiente: 'solo las que esperan firma',
  aprobada: 'solo las aprobadas',
  ajustada: 'solo las ajustadas',
  rechazada: 'solo las rechazadas',
  todas: 'todas, firmadas o no',
};
