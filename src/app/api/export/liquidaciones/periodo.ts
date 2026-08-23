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
