// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PANTALLA MERECE EL CONTRALOR, dado lo que cargó y lo que no.
//
// Vivía como dos booleanos dentro del componente y por eso no se podía probar.
// El fallo que costó la nota (auditoría 5, frontend, CRÍTICO) no fue el diseño
// de esos booleanos sino su premisa: daban por hecho que una consulta caída
// llega como `null`, y supabase-js reporta por valor, así que llegaba como
// ceros. Aquí se separa la DECISIÓN de la carga para poder fijarla con pruebas.
//
// La regla que importa: "aún no hay liquidaciones" es una AFIRMACIÓN sobre el
// negocio del cliente, y solo se puede hacer cuando TODO cargó bien. Con una
// sola sección caída ya no se sabe si el panel está vacío o ciego.
// ═══════════════════════════════════════════════════════════════════════════

/** Secciones del panel; `null` significa "esta consulta falló". */
export interface SeccionesPanel {
  acreditables: unknown | null;
  kpis: { viajesLiquidados: number } | null;
  liquidaciones: unknown[] | null;
  anomalias: unknown[] | null;
}

export type EstadoPanel =
  | 'error'    // no cargó nada: no hay nada honesto que enseñar
  | 'parcial'  // cargó algo: se enseña con aviso de que está incompleto
  | 'vacio'    // cargó todo y de verdad no hay liquidaciones
  | 'datos';

export function estadoPanel(s: SeccionesPanel): EstadoPanel {
  const secciones = [s.acreditables, s.kpis, s.liquidaciones, s.anomalias];
  const caidas = secciones.filter((x) => x === null).length;
  if (caidas === secciones.length) return 'error';
  // Un fallo PARCIAL es peor que uno total si se calla: los KPIs dicen "12
  // viajes · $340,000 comprobados" y la tabla de abajo sale con encabezados y
  // cero filas. Dos cifras que se contradicen en la misma pantalla.
  if (caidas > 0) return 'parcial';
  if ((s.kpis?.viajesLiquidados ?? 0) === 0 && (s.liquidaciones?.length ?? 0) === 0) return 'vacio';
  return 'datos';
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, ALTO — el call site de `dashboard/page.tsx` le pasaba a
// `s.liquidaciones` el arreglo `porDia` (`getLiquidacionesPorDia`), que
// SIEMPRE tiene 7 o 30 elementos —uno por día, muchos en cero— así que
// `.length` nunca es 0 y la rama 'vacio' de arriba era código muerto: el
// panel pintaba "0% tasa de cuadre" como si fuera una medición.
//
// La función de arriba ya estaba bien probada con la forma correcta de dato
// (`estado.test.ts`); el bug vivía un escalón antes, en QUÉ arreglo se le
// manda. Esta función fija esa forma: recibe los VIAJES reales de la flota
// (ya se cargan en la página para `AvanceCierre`, mismo criterio — "no una
// consulta nueva") y cuenta los que de verdad están `liquidado`, igual que
// `avance-cierre.tsx` cuenta `cerrados`. Un arreglo con actividad
// (`abierto`/`en_cuadre`) pero CERO liquidados sigue dando `length === 0`
// aquí — a diferencia de `porDia`, que nunca puede.
// ═══════════════════════════════════════════════════════════════════════════

/** Los viajes reales, filtrados a los que ya están `liquidado` — la forma que
 *  `estadoPanel` necesita en `liquidaciones` para poder detectar un tenant de
 *  verdad vacío. `null` se propaga (consulta caída → sección caída). */
export function liquidacionesDeViajes(
  viajes: Array<{ estatus: string }> | null,
): unknown[] | null {
  if (viajes === null) return null;
  return viajes.filter((v) => v.estatus === 'liquidado');
}
