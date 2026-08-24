// ═══════════════════════════════════════════════════════════════════════════
// EL POLLER — el que convierte «conector configurado» en «fuente sincronizada».
//
// Hasta hoy `posicion` tenía UN escritor: el pin que un chofer manda a mano por
// WhatsApp. Los conectores de GPS existían, probaban su credencial y declaraban
// `leer_posiciones`, pero nadie los llamaba. La landing dice «el GPS de tu
// flota» entre las fuentes de dato, y esto es lo que faltaba para que lo sea.
//
// ── LO QUE NO HACE, Y ESO ES EL DISEÑO ────────────────────────────────────
// No da de alta unidades. Una posición llega con el id del dispositivo en el
// sistema del proveedor, y si NINGUNA unidad de la flota lo reclama
// (`unidad.gps_device_id`), la lectura se cuenta como huérfana y se REPORTA —
// no se inventa un camión. Dar de alta flota desde un feed ajeno es cómo se
// llena una base de vehículos fantasma que nadie mandó crear.
//
// ── LA IDEMPOTENCIA ───────────────────────────────────────────────────────
// El proveedor devuelve la ÚLTIMA posición conocida: dos corridas seguidas con
// el camión parado traen la misma lectura, con la misma `medida_en`. El único
// `uq_posicion_lectura` (0176) las colapsa, y aquí se hace `upsert` con
// `ignoreDuplicates` para que eso no cuente como error.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { descifrar } from './cofre';
import { lectorDe, LECTORES_POSICION } from './posiciones';
import type { Http } from './tipos';
import { conPool } from '../lotes';

/** Cuántas lecturas se escriben por corrida y flota. */
const TOPE_POR_FLOTA = 500;
/** Evita que una instalación con muchas flotas abra una ráfaga ilimitada de
 * conexiones contra proveedores y PostgREST. */
const ANCHO_FANOUT_FLOTAS = 4;

export interface ResultadoSync {
  tenantId: string;
  proveedor: string;
  leidas: number;
  guardadas: number;
  /** Lecturas cuyo dispositivo no lo reclama ninguna unidad. Se reportan. */
  huerfanas: number;
  error?: string;
}

/** La frontera entre un proveedor ajeno y nuestra tabla es estricta: un id
 * vacío, una fecha inválida o números fuera de dominio no llegan a Postgres.
 * El lector valida su JSON, pero esta segunda barrera protege adaptadores
 * futuros y evita escribir NaN/fechas locales ambiguas. */
function posicionValida(p: { deviceId: string; lat: number; lng: number; medidaEn: string; velocidad: number | null; rumbo: number | null }): boolean {
  const fecha = Date.parse(p.medidaEn);
  return p.deviceId.trim().length > 0 && p.deviceId.length <= 200 &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180 &&
    !(p.lat === 0 && p.lng === 0) && Number.isFinite(fecha) &&
    (p.velocidad === null || (Number.isFinite(p.velocidad) && p.velocidad >= 0 && p.velocidad <= 300)) &&
    (p.rumbo === null || (Number.isFinite(p.rumbo) && p.rumbo >= 0 && p.rumbo < 360));
}

/** El `Http` real. Se inyecta para poder probar sin red. */
export const httpReal: Http = async (p) => {
  const r = await fetch(p.url, {
    method: p.metodo,
    headers: p.encabezados,
    body: p.cuerpo,
    signal: AbortSignal.timeout(15_000),
  });
  return { estado: r.status, cuerpo: await r.text() };
};

/**
 * Sincroniza las posiciones de UNA flota con UN proveedor.
 *
 * Devuelve el conteo en vez de lanzar: una flota cuyo GPS falla no puede tumbar
 * la corrida de las demás — es el mismo criterio que las purgas nocturnas
 * aprendieron a golpes en la 0165.
 */
export async function sincronizarGpsDeFlota(
  tenantId: string,
  conectorId: string,
  valoresCifrados: string,
  http: Http = httpReal,
): Promise<ResultadoSync> {
  const base: ResultadoSync = { tenantId, proveedor: conectorId, leidas: 0, guardadas: 0, huerfanas: 0 };

  const lector = lectorDe(conectorId);
  if (!lector) {
    return { ...base, error: `todavía no hay lector de posiciones para ${conectorId}` };
  }

  let valores;
  try {
    valores = descifrar(valoresCifrados);
  } catch (e) {
    return { ...base, error: `no se pudo descifrar la credencial: ${e instanceof Error ? e.message : String(e)}` };
  }

  const r = await lector(valores, http);
  if (!r.ok) return { ...base, error: r.motivo };
  const posiciones = r.posiciones.filter(posicionValida).slice(0, TOPE_POR_FLOTA);
  base.leidas = posiciones.length;
  if (posiciones.length === 0) return base;

  // ── DEVICE ID → UNIDAD, filtrando por flota ───────────────────────────
  // El `.eq('tenant_id', …)` no es decorativo: `supabaseAdmin` salta RLS, así
  // que sin él una lectura podría asentarse en la unidad de otra flota que
  // usara el mismo número de dispositivo con otro proveedor.
  const ids = [...new Set(posiciones.map((p) => p.deviceId))];
  const { data: unidades, error: errU } = await acotada(
    supabaseAdmin().from('unidad')
      .select('id, gps_device_id')
      .eq('tenant_id', tenantId)
      .eq('gps_proveedor', conectorId)
      .in('gps_device_id', ids),
    'gps.unidades',
  );
  if (errU) return { ...base, error: `no se pudieron leer las unidades: ${errU.message}` };

  const porDevice = new Map<string, string>();
  for (const u of unidades ?? []) {
    if (u.gps_device_id) porDevice.set(String(u.gps_device_id), String(u.id));
  }

  const filas: Array<Record<string, unknown>> = [];
  const unidadesVistas = new Set<string>();
  for (const p of posiciones) {
    const unidadId = porDevice.get(p.deviceId);
    if (!unidadId) { base.huerfanas += 1; continue; }
    unidadesVistas.add(unidadId);
    filas.push({
      tenant_id: tenantId,
      unidad_id: unidadId,
      lat: p.lat,
      lng: p.lng,
      velocidad: p.velocidad,
      rumbo: p.rumbo,
      medida_en: p.medidaEn,
      proveedor: conectorId,
    });
  }

  if (filas.length > 0) {
    // `ignoreDuplicates`: la misma última posición entre corridas no es un
    // error, es lo normal cuando el camión está parado.
    const { error: errIns } = await acotada(
      supabaseAdmin().from('posicion')
        .upsert(filas, { onConflict: 'tenant_id,unidad_id,medida_en', ignoreDuplicates: true }),
      'gps.guardar_posiciones',
    );
    if (errIns) return { ...base, error: `no se pudieron guardar las posiciones: ${errIns.message}` };
    base.guardadas = filas.length;

    // `gps_visto_en` es lo que distingue «credencial guardada» de «fuente que
    // de verdad está entrando». Sin esta marca, el panel no puede decir la
    // diferencia y la landing tampoco.
    const ahora = new Date().toISOString();
    await acotada(
      supabaseAdmin().from('unidad')
        .update({ gps_visto_en: ahora })
        .eq('tenant_id', tenantId)
        .in('id', [...unidadesVistas]),
      'gps.sellar_visto',
    );
  }

  if (base.huerfanas > 0) {
    // Se dice, no se calla: son camiones que el proveedor reporta y que nadie
    // ligó a una unidad. El dueño de la flota tiene que enterarse.
    logger.warn('gps.lecturas_huerfanas', { tenantId, proveedor: conectorId, huerfanas: base.huerfanas });
  }
  return base;
}

/** Sincroniza TODAS las flotas con credencial de GPS activa. */
export async function sincronizarGpsTodas(http: Http = httpReal): Promise<ResultadoSync[]> {
  const { data, error } = await acotada(
    supabaseAdmin().from('conector_credencial')
      .select('tenant_id, conector_id, valores_cifrados')
      .eq('activo', true)
      // Los proveedores que HOY tienen lector, tomados del registro: un
      // literal aquí se desactualiza en cuanto se añada Wialon.
      .in('conector_id', Object.keys(LECTORES_POSICION)),
    'gps.credenciales',
  );
  if (error) {
    // Esta lectura define el universo entero de la corrida. Devolver [] la
    // pintaba verde con «0 flotas», ocultando una base caída durante días.
    throw new Error(`gps.credenciales: ${error.message}`);
  }

  const credenciales = data ?? [];
  const resultados = await conPool(credenciales, ANCHO_FANOUT_FLOTAS, async (c) =>
    sincronizarGpsDeFlota(String(c.tenant_id), String(c.conector_id), String(c.valores_cifrados), http),
  );
  return resultados.map((r, i) => {
    if ('ok' in r) return r.ok;
    const c = credenciales[i];
    return {
      tenantId: String(c.tenant_id), proveedor: String(c.conector_id),
      leidas: 0, guardadas: 0, huerfanas: 0,
      error: r.error instanceof Error ? r.error.message : String(r.error),
    };
  });
}
