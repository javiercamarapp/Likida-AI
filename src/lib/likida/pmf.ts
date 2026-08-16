// ═══════════════════════════════════════════════════════════════════════════
// LAS 3 SEÑALES DE PMF — el lector que la mig. 0114 dejó pendiente.
//
// La base ya guarda si el producto se usa DE VERDAD, no solo si se firmó:
//
//   1. El contador ABRIÓ el PDF → `liquidacion.primera_descarga_en` (0114).
//      El rol importa tanto como la fecha: `primera_descarga_rol =
//      'superadmin'` es Javier enseñando el producto en un demo, NO un
//      cliente usándolo. Un demo no cuenta como señal de PMF.
//   2. El chofer comprueba sin que se lo recuerden → un viaje `liquidado`
//      con `recordatorio_comprobacion_en` en NULL cerró solo (la columna la
//      escribe el Agente de Cobranza en el primer contacto).
//   3. El cliente se queja cuando algo se rompe → `ticket_soporte.abierto_por`
//      (NULL = lo abrió Likida a nombre de la flota, 0051). OJO con la
//      lectura a esta escala: CERO tickets del cliente no es buena señal,
//      es ausencia de dato — y hoy además NADA inserta en `ticket_soporte`
//      (documentado en admin/soporte/page.tsx), así que esta señal solo
//      puede decir "sin datos" hasta que exista el escritor.
//
// Módulo propio y no una función más de analytics.ts: aquel ya pasa de
// 1,800 líneas y estas tres lecturas comparten regla y destino (la ficha de
// cada flota en /admin/flotas), no el resto de la analítica.
//
// LAS DOS REGLAS QUE GOBIERNAN EL LECTOR:
//   · Sin dato se dice "sin datos", nunca un 0% con cara de medición — por
//     eso cada señal lleva el discriminante `medida` y el llamador no puede
//     pintar un porcentaje sin pasar por él.
//   · Fallar cerrado: cualquier error de lectura LANZA (patrón `contarFilas`
//     de analytics.ts). La página atrapa por flota y dice "no se pudo leer",
//     que no es lo mismo que "sin datos".
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

/** Señal 1 — el PDF llegó a manos de alguien (mig. 0114). */
export type SenalDescargas =
  | { medida: false }
  | {
    medida: true;
    /** Liquidaciones de la flota (todas generan PDF al cierre). */
    liquidaciones: number;
    /** Con al menos una descarga (`primera_descarga_en` no nulo). */
    descargadas: number;
    /** Primera descarga de un rol del CLIENTE (contador, flota_admin,
     *  encargado) — la señal de PMF real. */
    porCliente: number;
    /** Primera descarga de `superadmin` = Javier en un demo. NO es señal. */
    soloDemo: number;
  };

/** Señal 2 — el chofer comprobó sin recordatorio. */
export type SenalComprobacion =
  | { medida: false }
  | {
    medida: true;
    /** Viajes con estatus `liquidado` (los únicos que ya cerraron). */
    liquidados: number;
    /** De esos, los que cerraron con `recordatorio_comprobacion_en` NULL. */
    sinRecordatorio: number;
  };

/** Señal 3 — el cliente abre tickets por su cuenta. */
export type SenalTickets =
  | { medida: false }
  | {
    medida: true;
    /** `abierto_por` no nulo: lo abrió un usuario de la flota. */
    delCliente: number;
    /** `abierto_por` NULL: lo abrió Likida a nombre de la flota (0051). */
    deLikida: number;
  };

export interface SenalesPmf {
  descargas: SenalDescargas;
  comprobacionSola: SenalComprobacion;
  tickets: SenalTickets;
}

/**
 * Cuenta filas sin traer ninguna (`head: true` + `count: 'exact'`, el mismo
 * patrón que `contarFilas` en analytics.ts). LANZA ante error Y ante un
 * `count` nulo: PostgREST solo manda el conteo si pudo contar, y devolver 0
 * ahí sería inventar una medición.
 */
async function contar(
  armar: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  consulta: string,
): Promise<number> {
  const { count, error } = await armar();
  if (error) throw new Error(`${consulta}: ${error.message}`);
  if (typeof count !== 'number') {
    throw new Error(`${consulta}: la base no devolvió el conteo; no se inventa un 0`);
  }
  return count;
}

/**
 * Las tres señales de UNA flota. El tenant llega por parámetro porque quien
 * cruza flotas es la página de /admin (con su propio guard de superadmin);
 * este módulo solo sabe leer una.
 *
 * LANZA si cualquiera de las siete lecturas falla — media señal pintada
 * sobre una base caída afirmaría que la flota no usa el producto.
 */
export async function getSenalesPmf(tenantId: string): Promise<SenalesPmf> {
  const admin = supabaseAdmin();
  const cabeza = { count: 'exact' as const, head: true };
  const [liquidaciones, descargadas, porCliente, liquidados, sinRecordatorio, tickets, delCliente] = await Promise.all([
    contar(() => admin.from('liquidacion').select('id', cabeza)
      .eq('tenant_id', tenantId), 'senalesPmf.liquidaciones'),
    contar(() => admin.from('liquidacion').select('id', cabeza)
      .eq('tenant_id', tenantId)
      .not('primera_descarga_en', 'is', null), 'senalesPmf.descargadas'),
    contar(() => admin.from('liquidacion').select('id', cabeza)
      .eq('tenant_id', tenantId)
      .not('primera_descarga_en', 'is', null)
      .neq('primera_descarga_rol', 'superadmin'), 'senalesPmf.porCliente'),
    contar(() => admin.from('viaje').select('id', cabeza)
      .eq('tenant_id', tenantId)
      .eq('estatus', 'liquidado'), 'senalesPmf.liquidados'),
    contar(() => admin.from('viaje').select('id', cabeza)
      .eq('tenant_id', tenantId)
      .eq('estatus', 'liquidado')
      .is('recordatorio_comprobacion_en', null), 'senalesPmf.sinRecordatorio'),
    contar(() => admin.from('ticket_soporte').select('id', cabeza)
      .eq('tenant_id', tenantId), 'senalesPmf.tickets'),
    contar(() => admin.from('ticket_soporte').select('id', cabeza)
      .eq('tenant_id', tenantId)
      .not('abierto_por', 'is', null), 'senalesPmf.delCliente'),
  ]);

  return {
    descargas: liquidaciones === 0
      ? { medida: false }
      : {
        medida: true,
        liquidaciones,
        descargadas,
        porCliente,
        // Derivado y no una octava consulta: el RPC de la 0114 escribe fecha
        // y rol juntos (coalesce), así que descargada sin rol no existe.
        soloDemo: Math.max(0, descargadas - porCliente),
      },
    comprobacionSola: liquidados === 0
      ? { medida: false }
      : { medida: true, liquidados, sinRecordatorio },
    tickets: tickets === 0
      ? { medida: false }
      : { medida: true, delCliente, deLikida: Math.max(0, tickets - delCliente) },
  };
}

/**
 * El agregado de varias flotas — pura, sin base, para poder probarla sola.
 * Una señal agregada está `medida` si AL MENOS una flota la tiene medida;
 * las flotas sin datos no aportan ceros (no hay ceros que aportar).
 */
export function agregarSenalesPmf(flotas: readonly SenalesPmf[]): SenalesPmf {
  const d = flotas.map((f) => f.descargas).filter((s): s is Extract<SenalDescargas, { medida: true }> => s.medida);
  const c = flotas.map((f) => f.comprobacionSola).filter((s): s is Extract<SenalComprobacion, { medida: true }> => s.medida);
  const t = flotas.map((f) => f.tickets).filter((s): s is Extract<SenalTickets, { medida: true }> => s.medida);
  const suma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

  return {
    descargas: d.length === 0
      ? { medida: false }
      : {
        medida: true,
        liquidaciones: suma(d.map((s) => s.liquidaciones)),
        descargadas: suma(d.map((s) => s.descargadas)),
        porCliente: suma(d.map((s) => s.porCliente)),
        soloDemo: suma(d.map((s) => s.soloDemo)),
      },
    comprobacionSola: c.length === 0
      ? { medida: false }
      : {
        medida: true,
        liquidados: suma(c.map((s) => s.liquidados)),
        sinRecordatorio: suma(c.map((s) => s.sinRecordatorio)),
      },
    tickets: t.length === 0
      ? { medida: false }
      : {
        medida: true,
        delCliente: suma(t.map((s) => s.delCliente)),
        deLikida: suma(t.map((s) => s.deLikida)),
      },
  };
}
