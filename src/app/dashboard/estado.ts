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
