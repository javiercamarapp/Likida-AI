import { leerPoligono, type Punto } from './geo';

// ═══════════════════════════════════════════════════════════════════════════
// LEER EL POLÍGONO DE `geocerca` SIN ROMPER A UNA BASE QUE AÚN NO TIENE LA 0630.
//
// El código se despliega ANTES de que alguien aplique la migración (aplicar migraciones es
// una decisión de Javier, con respaldo). Pedir `poligono, aproximada` a una base sin la 0630
// revienta con «column … does not exist» (42703 / PGRST204); aquí se vuelve a pedir SIN esas
// columnas y la geocerca cae a lo que siempre fue: un círculo. Sin migración todo sigue
// funcionando como antes; con ella, el polígono manda.
//
// Se recuerda 5 minutos que la base no tiene las columnas: el cron no repite la consulta
// fallida en cada flota. Es memoria de instancia (como los demás cachés cortos): si aplican
// la migración, a lo sumo 5 minutos después empieza a leerse el polígono.
// ═══════════════════════════════════════════════════════════════════════════

export const COLUMNAS_POLIGONO = 'poligono, aproximada';

const RECUERDO_MS = 5 * 60_000;
let sinColumnasHasta = 0;

/** Solo pruebas. */
export function reiniciarMemoriaPoligono(): void { sinColumnasHasta = 0; }

interface ErrorPg { code?: string | null; message?: string | null }

/** El error es «las columnas de la 0630 no existen» (y no otro fallo cualquiera, que NO se traga). */
export function faltaColumnaPoligono(e: ErrorPg | null | undefined): boolean {
  if (!e) return false;
  const msg = e.message ?? '';
  if (!/poligono|aproximada/i.test(msg)) return false;
  return e.code === '42703' || e.code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(msg);
}

/**
 * Corre la consulta pidiendo las columnas del polígono y, si la base no las tiene, la repite sin ellas.
 * `consulta(true)` = con `poligono, aproximada`; `consulta(false)` = como antes de la 0630.
 */
export async function conPoligonoOCirculo<R extends { error: ErrorPg | null }>(consulta: (conPoligono: boolean) => PromiseLike<R>, ahora: number = Date.now()): Promise<R> {
  if (ahora < sinColumnasHasta) return consulta(false);
  const r = await consulta(true);
  if (r.error && faltaColumnaPoligono(r.error)) {
    sinColumnasHasta = ahora + RECUERDO_MS;
    return consulta(false);
  }
  return r;
}

/** Del registro de la base: el polígono (null si no hay o no es usable) y si el círculo es aproximado. */
export function geometriaDeFila(f: Record<string, unknown>): { poligono: Punto[] | null; aproximada: boolean } {
  const poligono = leerPoligono(f.poligono);
  return { poligono, aproximada: poligono === null && f.aproximada === true };
}
