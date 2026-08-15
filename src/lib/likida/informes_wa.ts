import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { traerTodo, conteo } from './pg';
import { strip_accents } from './cuadre/util';
import { getTableroOperacion } from './operacion';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import type { RolOficina } from './contactos';
import { mxn } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// "¿CÓMO VAN?" — el informe del JEFE por WhatsApp (F4 del plan).
//
// El molde es `consulta_chofer.ts`, y por las mismas razones: contestar
// "3 viajes en curso, 1 sin unidad" no requiere razonar — requiere una
// consulta y una plantilla. Un modelo aquí costaría dinero, agregaría
// latencia y podría INVENTAR la cifra, que es la única regla que este
// producto no rompe. Patrones ANCLADOS al mensaje completo, nunca buscados
// dentro de él; lo que no case cae al saludo de siempre.
//
// ── LAS CIFRAS DE DINERO SOLO AL ROL QUE LAS VE ────────────────────────────
// `visibilidad.ts` decide qué área existe para cada rol EN EL PANEL, y este
// canal no puede ser la puerta trasera: el encargado (solo 'operacion') no
// ve pesos en /dashboard y tampoco los ve por WhatsApp. `puedeVerArea` se
// usa SOLO como lectura — la matriz vive allá.
//
// ── FALLAR CERRADO, POR SECCIÓN ────────────────────────────────────────────
// Si el tablero no se puede leer, se dice que no se pudo — nunca un cero que
// parezca medición. Y si SOLO el dinero falla, los conteos salen y la línea
// de pesos dice la verdad de que no se pudo leer: perder todo el informe por
// una sección sería castigar de más, inventar la sección sería mentir.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_LARGO = 50;

function normalizar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿El jefe está pidiendo el informe? `null` = no lo es, sigue su camino.
 *
 * Lista corta y anclada. "cuantos viajes llevo" NO está a propósito: en boca
 * de oficina es ambiguo (¿del mes? ¿míos?) y el informe contesta otra cosa.
 */
const PATRONES: RegExp[] = [
  /^(y )?como (van|vamos|va todo|va la flota|van los viajes|va la operacion)( hoy| ahorita)?$/,
  /^(el |un )?(resumen|informe|reporte)( de (hoy|la flota|la operacion|operacion))?$/,
  /^cuantos viajes (abiertos |en curso )?(hay|tenemos|traemos|van|siguen)( abiertos| en curso)?$/,
  /^(que )?pendientes( hay| tenemos)?$/,
  /^(el )?estado de la flota$/,
];

export function interpretarInforme(texto: string): boolean {
  const t = normalizar(texto);
  if (!t || t.length > MAX_LARGO) return false;
  return PATRONES.some((p) => p.test(t));
}

/**
 * Los anticipos vivos: la suma de `anticipo` de los viajes sin cerrar. Es
 * dinero que la flota ya soltó y todavía no se comprueba — la cifra que un
 * dueño pregunta primero. Lanza ante error: quien llama dice "no pude leer",
 * jamás un número a medias (PostgREST recorta a 1,000 filas en silencio, por
 * eso se pagina igual que `analytics.ts`).
 */
async function anticiposVivos(tenantId: string): Promise<{ suma: number; viajes: number }> {
  // `traerTodo` y no el bucle a mano que vivía aquí (auditoría de escala 15k):
  // aquel cortaba con `filas.length < PAGINA`, el criterio que pg.ts documenta
  // como defectuoso — da por hecho que el servidor entrega la página completa,
  // y `max_rows` es un ajuste del proyecto: bajarlo a 500 habría convertido
  // este informe en una suma parcial mandada al dueño como total, sin aviso.
  const filas = await traerTodo<{ anticipo: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('viaje')
      .select('anticipo', conteo(d))
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .order('id')
      .range(d, h), 'informes.anticiposVivos'),
    'informes.anticiposVivos',
  );
  return {
    suma: filas.reduce((s, f) => s + Number(f.anticipo ?? 0), 0),
    viajes: filas.length,
  };
}

/**
 * El informe armado con datos reales, sección por sección.
 *
 * El plural/singular se cuida porque el mensaje se LEE: "1 viajes" delata un
 * template y hace dudar de la cifra.
 */
export async function armarInforme(tenantId: string, rol: RolOficina): Promise<string> {
  let tablero;
  try {
    tablero = await getTableroOperacion(tenantId);
  } catch (e) {
    logger.error('informes.tablero_ilegible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude leer las cifras de la operación ahorita 😕 — inténtalo en un momento, o revisa el panel.';
  }

  const n = (x: number, s: string, p: string) => `${x} ${x === 1 ? s : p}`;
  const lineas: string[] = ['📊 Tu flota ahorita:'];
  lineas.push(`• ${n(tablero.viajesActivos, 'viaje en curso', 'viajes en curso')}${
    tablero.sinUnidad > 0 ? ` (${n(tablero.sinUnidad, 'sin unidad asignada', 'sin unidad asignada')})` : ''}`);
  lineas.push(`• Unidades: ${tablero.unidadesDisponibles} disponibles, ${tablero.unidadesEnTaller} en taller`);
  lineas.push(`• ${n(tablero.incidenciasAbiertas, 'incidencia abierta', 'incidencias abiertas')}`);
  lineas.push(`• ${n(tablero.podPendientes, 'viaje sin evidencia de entrega (POD)', 'viajes sin evidencia de entrega (POD)')}`);

  // El dinero, solo para quien su rol se lo enseña también en el panel.
  if (puedeVerArea(rol, 'dinero')) {
    try {
      const a = await anticiposVivos(tenantId);
      lineas.push(a.viajes > 0
        ? `💰 Anticipos en la calle: ${mxn(a.suma)} en ${n(a.viajes, 'viaje sin liquidar', 'viajes sin liquidar')}`
        : '💰 Anticipos en la calle: no hay viajes sin liquidar');
    } catch (e) {
      logger.error('informes.anticipos_ilegibles', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      lineas.push('💰 Los anticipos no los pude leer ahorita — revísalos en el panel.');
    }
  }

  lineas.push('\nEl detalle vive en tu panel. Por aquí también puedes despachar: «nuevo viaje para Juan, Silao a Nuevo Laredo, anticipo 8000».');
  return lineas.join('\n');
}

/** El atajo completo: interpreta y contesta. `null` = no era el informe. */
export async function atenderInformeOficina(
  cuenta: { tenantId: string | null; rol: RolOficina },
  texto: string,
): Promise<string | null> {
  if (!cuenta.tenantId) return null;   // superadmin sin flota: no hay flota que resumir
  if (!interpretarInforme(texto)) return null;
  return armarInforme(cuenta.tenantId, cuenta.rol);
}
