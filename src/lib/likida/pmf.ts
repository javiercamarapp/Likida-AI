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
//
// ── AGREGADO EN SQL DESDE EL 22-AGO-2026 (mig. 0162, ESC-9) ────────────────
//
// Las siete lecturas eran siete `count exact`, y `/admin/flotas` las lanzaba
// con un `Promise.all` sobre TODAS las flotas SIN pool: 7 × N consultas
// simultáneas contra el mismo pooler para pintar una tabla. Con 50 flotas son
// 350 — y cada `count exact` de `liquidacion`/`viaje` recorre el índice de esa
// flota entero, no lee una fila.
//
// Ahora es UNA consulta: `senales_pmf(p_tenant)` agrupa con `count(*) filter`
// por `tenant_id`. Con `p_tenant` en NULL trae todas las flotas de un golpe
// (`getSenalesPmfTodas`, lo que usa la tabla de /admin/flotas); con un tenant
// trae solo esa (`getSenalesPmf`, lo que usa la ficha de cliente), y también
// ahorra seis idas y vueltas.
//
// LO QUE NO CAMBIÓ, Y ES LO IMPORTANTE: la distinción entre "sin datos" y
// "cero" sigue viviendo aquí, en `deFila`. Una flota que la RPC no devuelve
// (porque no tiene NI UNA fila en las tres tablas) se lee como las tres
// señales `medida: false`, no como ceros.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';

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

/** Una fila de `senales_pmf()`: los siete conteos de UNA flota, ya agregados. */
interface FilaSenalesPmf {
  tenantId: string;
  liquidaciones: number;
  descargadas: number;
  porCliente: number;
  liquidados: number;
  sinRecordatorio: number;
  tickets: number;
  delCliente: number;
}

const LLAVES_FILA = [
  'liquidaciones', 'descargadas', 'porCliente',
  'liquidados', 'sinRecordatorio', 'tickets', 'delCliente',
] as const;

/**
 * Las tres señales de una flota SIN filas: nada que medir, y se dice.
 *
 * Se EXPORTA porque el llamador que pide todas las flotas de un golpe
 * (`getSenalesPmfTodas`) recibe un `Map` en el que las flotas sin una sola
 * fila NO aparecen — y "no aparece" tiene que leerse como "sin datos", nunca
 * como "no se pudo leer", que es lo que significa el `null`.
 */
export const SENALES_SIN_DATOS: SenalesPmf = {
  descargas: { medida: false },
  comprobacionSola: { medida: false },
  tickets: { medida: false },
};

/**
 * Llama a `senales_pmf()` y **falla cerrado**, con las dos comprobaciones de
 * siempre: el error POR VALOR (sin mirarlo, una base caída se leería como "esta
 * flota no usa el producto") y la FORMA (si la 0162 no está aplicada, `data`
 * llega como cualquier otra cosa y cada `?? 0` pintaría un cero que nadie midió).
 */
async function traerSenalesPmf(tenantId: string | null): Promise<FilaSenalesPmf[]> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('senales_pmf', { p_tenant: tenantId }),
    'senales_pmf',
  );
  if (error) throw new Error(`senales_pmf: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error(
      'senales_pmf: la respuesta no tiene la forma esperada (¿migración 0162 sin aplicar?). '
      + 'No se devuelven señales a medias: un cero aquí se lee como "el cliente no usa el producto".',
    );
  }
  return (data as unknown[]).map((f, i) => {
    const r = f as Partial<FilaSenalesPmf> | null;
    if (!r || typeof r.tenantId !== 'string' || LLAVES_FILA.some((k) => typeof r[k] !== 'number')) {
      throw new Error(`senales_pmf: la fila ${i} no trae los siete conteos (¿migración 0162 sin aplicar?)`);
    }
    return r as FilaSenalesPmf;
  });
}

/**
 * Los siete conteos de una flota → las tres señales, con su discriminante.
 * PURA: es aquí donde vive la regla de "cero no es sin datos".
 */
function deFila(f: FilaSenalesPmf): SenalesPmf {
  return {
    descargas: f.liquidaciones === 0
      ? { medida: false }
      : {
        medida: true,
        liquidaciones: f.liquidaciones,
        descargadas: f.descargadas,
        porCliente: f.porCliente,
        // Derivado y no un octavo conteo: el RPC de la 0114 escribe fecha
        // y rol juntos (coalesce), así que descargada sin rol no existe.
        soloDemo: Math.max(0, f.descargadas - f.porCliente),
      },
    comprobacionSola: f.liquidados === 0
      ? { medida: false }
      : { medida: true, liquidados: f.liquidados, sinRecordatorio: f.sinRecordatorio },
    tickets: f.tickets === 0
      ? { medida: false }
      : { medida: true, delCliente: f.delCliente, deLikida: Math.max(0, f.tickets - f.delCliente) },
  };
}

/**
 * Las tres señales de UNA flota. El tenant llega por parámetro porque quien
 * cruza flotas es la página de /admin (con su propio guard de superadmin);
 * este módulo solo sabe leer una.
 *
 * LANZA si la lectura falla — media señal pintada sobre una base caída
 * afirmaría que la flota no usa el producto.
 */
export async function getSenalesPmf(tenantId: string): Promise<SenalesPmf> {
  if (!tenantId) throw new Error('getSenalesPmf: falta tenantId');
  const filas = await traerSenalesPmf(tenantId);
  const fila = filas.find((f) => f.tenantId === tenantId);
  // Sin fila = la flota no tiene NI UNA liquidación, viaje liquidado ni ticket.
  // Eso es "sin datos" en las tres señales, no tres ceros.
  return fila ? deFila(fila) : SENALES_SIN_DATOS;
}

/**
 * Las tres señales de TODAS las flotas, en UNA consulta (ESC-9).
 *
 * Devuelve un `Map` para que el llamador pinte por flota; una flota que no
 * aparece en el mapa no tiene datos todavía (y su ficha lo dice así). Igual que
 * la de una flota: LANZA ante un error de lectura, para que la página pueda
 * distinguir "no se pudo leer" de "sin datos".
 *
 * CRUZA TODAS LAS FLOTAS A PROPÓSITO: solo la llama /admin (la consola de
 * superadmin). Ninguna pantalla de /dashboard puede usarla — la suya es
 * `getSenalesPmf(tenantId)`.
 */
export async function getSenalesPmfTodas(): Promise<Map<string, SenalesPmf>> {
  const filas = await traerSenalesPmf(null);
  return new Map(filas.map((f) => [f.tenantId, deFila(f)] as const));
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
