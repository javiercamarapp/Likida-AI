// ═══════════════════════════════════════════════════════════════════════════
// EL ESCRITOR DE MANTENIMIENTO (Fase 9 del plan maestro, 26-ago-2026).
//
// La tabla `mantenimiento` existe desde la 0047 y hasta hoy NADIE escribía en
// ella — `getUnidades` contaba órdenes abiertas de una tabla a la que ninguna
// pluma llegaba. Este módulo es la pluma, con dos entradas:
//
//   a) La avería AUTORIZADA de talacha abre su orden correctiva. El jefe ya
//      firmó el dinero (0107); la orden es el rastro de taller de esa firma,
//      no una segunda autorización. Idempotente por la unique parcial de la
//      0209: una avería = a lo más UNA orden, aunque el webhook reintente.
//   b) Las rutinas preventivas (`rutina_mantenimiento`, 0209) se evalúan por
//      días y/o km y las vencidas se PROPONEN — la orden la abre un humano
//      con el botón del panel. Aquí no hay cron: el agente prepara la lista,
//      el encargado decide.
//
// Honestidad del odómetro: `unidad.km_actual` es DECLARADO (la forma de
// unidades), no telemetría. Una rutina por km sin odómetro declarado no se
// evalúa y LO DICE — jamás sale "al día" una unidad de la que no se sabe el
// kilometraje (sería afirmar mantenimiento con base en un dato que no existe).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { conteo, traerTodo } from './pg';
import { DatoInvalido } from './errores';

const DIA_MS = 86_400_000;

// ── a) La orden correctiva desde la avería firmada ─────────────────────────

export type ResultadoOrdenAveria = 'abierta' | 'ya_existia' | 'sin_unidad' | 'fallo';

/**
 * Abre la orden correctiva de una avería recién AUTORIZADA. La unidad sale de
 * la incidencia o, en su defecto, del viaje (la talacha de WhatsApp cuelga la
 * avería del viaje, no de la unidad). Sin unidad no hay orden — una orden de
 * taller sin unidad no le sirve a nadie — y se devuelve dicho, no callado.
 *
 * Nunca lanza: la firma del jefe YA quedó registrada cuando esto corre, y un
 * tropiezo aquí no debe leerse como "no se autorizó". El que llama decide qué
 * decir con el resultado.
 */
export async function abrirOrdenPorAveria(tenantId: string, incidenciaId: string): Promise<ResultadoOrdenAveria> {
  const admin = supabaseAdmin();
  try {
    const { data: inc, error } = await acotada(admin.from('incidencia')
      .select('id, viaje_id, unidad_id, descripcion')
      .eq('id', incidenciaId).eq('tenant_id', tenantId)
      .maybeSingle(), 'mantenimiento.leer_averia');
    if (error || !inc) {
      logger.error('mantenimiento.averia_ilegible', { incidencia: incidenciaId, err: error?.message ?? 'sin fila' });
      return 'fallo';
    }

    let unidadId = (inc.unidad_id as string | null) ?? null;
    if (!unidadId && inc.viaje_id) {
      const { data: v, error: errV } = await acotada(admin.from('viaje')
        .select('unidad_id').eq('id', inc.viaje_id as string).eq('tenant_id', tenantId)
        .maybeSingle(), 'mantenimiento.unidad_del_viaje');
      if (errV) {
        logger.error('mantenimiento.viaje_ilegible', { incidencia: incidenciaId, err: errV.message });
        return 'fallo';
      }
      unidadId = (v?.unidad_id as string | null) ?? null;
    }
    if (!unidadId) {
      // Sin unidad no hay orden que abrir — se deja rastro para el diagnóstico
      // (el jefe no recibe nota: mandarlo "al panel" a abrir una orden sin
      // unidad sería un callejón sin salida).
      logger.info('mantenimiento.averia_sin_unidad', { incidencia: incidenciaId });
      return 'sin_unidad';
    }

    const { error: errIns } = await acotada(admin.from('mantenimiento').insert({
      tenant_id: tenantId,
      unidad_id: unidadId,
      tipo: 'correctivo',
      descripcion: inc.descripcion ? `Avería autorizada: ${String(inc.descripcion).slice(0, 280)}` : 'Avería autorizada (talacha)',
      estado: 'abierta',
      incidencia_id: incidenciaId,
    }), 'mantenimiento.abrir_por_averia');
    if (errIns) {
      // El candado de la 0209 (una orden por avería) llega como 23505: no es
      // un fallo, es el reintento perdiendo la carrera contra sí mismo.
      if (errIns.code === '23505' || /mantenimiento_incidencia_unica/.test(errIns.message)) return 'ya_existia';
      logger.error('mantenimiento.abrir_fallo', { incidencia: incidenciaId, err: errIns.message });
      return 'fallo';
    }
    logger.info('mantenimiento.orden_por_averia', { incidencia: incidenciaId, unidad: unidadId });
    return 'abierta';
  } catch (e) {
    logger.error('mantenimiento.abrir_excepcion', { incidencia: incidenciaId, err: e instanceof Error ? e.message : String(e) });
    return 'fallo';
  }
}

// ── b) Las rutinas preventivas y sus propuestas ────────────────────────────

export interface RutinaRow {
  id: string;
  nombre: string;
  cadaDias: number | null;
  cadaKm: number | null;
  activa: boolean;
}

export interface UnidadTaller {
  id: string;
  numeroEconomico: string;
  kmActual: number | null;
  activo: boolean;
}

/** La última orden CERRADA de una rutina en una unidad — la base del reloj. */
export interface UltimoServicio {
  rutinaId: string;
  unidadId: string;
  cerradaEn: string;      // ISO
  kmServicio: number | null;
}

export type MotivoPropuesta =
  | 'vencida_por_dias'
  | 'vencida_por_km'
  | 'sin_historial'       // nunca se le ha hecho esta rutina a esta unidad
  | 'sin_odometro'        // rutina SOLO por km y la unidad no declara km_actual
  // El km declarado de la unidad quedó ATRÁS del km del último servicio: el
  // reloj es contradictorio y no se puede leer. AUDITORÍA FABLE CICLO 3
  // (c3-3): este estado es el resultado NORMAL de cerrar una orden con la
  // lectura fresca del tablero cuando nadie vuelve a la forma de unidades —
  // callarlo dejaba la rutina "verde para siempre".
  | 'odometro_desactualizado';

export interface PropuestaRutina {
  rutinaId: string;
  rutinaNombre: string;
  unidadId: string;
  unidadEco: string;
  motivo: MotivoPropuesta;
  /** Días desde el último servicio (null si nunca hubo o no aplica). */
  diasDesdeServicio: number | null;
  /** Km recorridos desde el último servicio, si ambos extremos existen. */
  kmDesdeServicio: number | null;
}

/**
 * Qué rutina está vencida en qué unidad — PURA, para que la prueba diga la
 * verdad sin base de datos. Una rutina con días Y km vence cuando CUALQUIERA
 * de los dos relojes vence (el estándar de taller: "10,000 km o 6 meses, lo
 * que ocurra primero").
 *
 * `sin_odometro` solo aparece cuando la rutina NO tiene reloj de días que la
 * rescate: si tiene ambos, el reloj de días decide y la falta de km no se
 * grita por cada unidad (estaría en todas las filas de una flota sin GPS).
 */
export function rutinasVencidas(
  rutinas: RutinaRow[],
  unidades: UnidadTaller[],
  ultimos: UltimoServicio[],
  hoy: Date,
): PropuestaRutina[] {
  const ultimoDe = new Map<string, UltimoServicio>();
  for (const u of ultimos) {
    const k = `${u.rutinaId}|${u.unidadId}`;
    const previo = ultimoDe.get(k);
    if (!previo || Date.parse(u.cerradaEn) > Date.parse(previo.cerradaEn)) ultimoDe.set(k, u);
  }

  const out: PropuestaRutina[] = [];
  for (const r of rutinas) {
    if (!r.activa) continue;
    for (const u of unidades) {
      if (!u.activo) continue;
      const ult = ultimoDe.get(`${r.id}|${u.id}`) ?? null;
      const base = (motivo: MotivoPropuesta): PropuestaRutina => ({
        rutinaId: r.id, rutinaNombre: r.nombre, unidadId: u.id, unidadEco: u.numeroEconomico,
        motivo,
        diasDesdeServicio: ult ? Math.floor((hoy.getTime() - Date.parse(ult.cerradaEn)) / DIA_MS) : null,
        kmDesdeServicio: ult && ult.kmServicio !== null && u.kmActual !== null && u.kmActual >= ult.kmServicio
          ? u.kmActual - ult.kmServicio
          : null,
      });

      if (!ult) {
        // Nunca se ha hecho: no se afirma "vencida" (no hay reloj corriendo),
        // se propone como arranque — y el humano decide si aplica.
        out.push(base('sin_historial'));
        continue;
      }

      const dias = Math.floor((hoy.getTime() - Date.parse(ult.cerradaEn)) / DIA_MS);
      if (r.cadaDias !== null && dias >= r.cadaDias) {
        out.push(base('vencida_por_dias'));
        continue;
      }
      if (r.cadaKm !== null) {
        if (u.kmActual === null || ult.kmServicio === null) {
          // El reloj de km no se puede leer. Si no hay reloj de días que
          // cubra, se declara — jamás se calla como "al día".
          if (r.cadaDias === null) out.push(base('sin_odometro'));
          continue;
        }
        if (u.kmActual < ult.kmServicio) {
          // c3-3: la resta saldría negativa — el reloj no está "al día", está
          // ILEGIBLE (el km de la unidad es más viejo que el del servicio).
          // Mismo criterio que sin_odometro: se declara si no hay reloj de
          // días que rescate.
          if (r.cadaDias === null) out.push(base('odometro_desactualizado'));
          continue;
        }
        if (u.kmActual - ult.kmServicio >= r.cadaKm) out.push(base('vencida_por_km'));
      }
    }
  }
  return out;
}

// ── Lectura y escritura del taller ─────────────────────────────────────────

export interface OrdenTaller {
  id: string;
  unidadId: string;
  unidadEco: string;
  tipo: string;
  estado: string;
  descripcion: string | null;
  abiertaEn: string;
  deAveria: boolean;
  deRutina: string | null;  // nombre de la rutina, si nació de una
}

export interface Taller {
  ordenesAbiertas: OrdenTaller[];
  rutinas: RutinaRow[];
  propuestas: PropuestaRutina[];
}

/** El taller completo de la flota. SIN catch: una pantalla que existe para
 *  avisar de mantenimiento vencido no puede pintar "todo al día" porque la
 *  consulta falló (el criterio de la página de unidades). */
export async function getTaller(tenantId: string, hoy = new Date()): Promise<Taller> {
  const admin = supabaseAdmin();
  const [unidadesRaw, rutinasRaw, ordenesRaw, cerradasRaw] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('unidad')
        .select('id, numero_economico, km_actual, activo', conteo(d))
        .eq('tenant_id', tenantId).order('numero_economico').range(d, h), 'taller.unidades'),
      'taller.unidades',
    ),
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('rutina_mantenimiento')
        .select('id, nombre, cada_dias, cada_km, activa', conteo(d))
        .eq('tenant_id', tenantId).order('nombre').range(d, h), 'taller.rutinas'),
      'taller.rutinas',
    ),
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('mantenimiento')
        .select('id, unidad_id, tipo, estado, descripcion, abierta_en, incidencia_id, rutina_id', conteo(d))
        .eq('tenant_id', tenantId).neq('estado', 'cerrada')
        .order('abierta_en', { ascending: false }).range(d, h), 'taller.abiertas'),
      'taller.abiertas',
    ),
    // Solo las cerradas QUE NACIERON DE RUTINA alimentan el reloj — la
    // correctiva de una avería no "cuenta como servicio" de la preventiva.
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('mantenimiento')
        .select('rutina_id, unidad_id, cerrada_en, km_servicio', conteo(d))
        .eq('tenant_id', tenantId).eq('estado', 'cerrada').not('rutina_id', 'is', null)
        .order('cerrada_en', { ascending: false }).range(d, h), 'taller.cerradas'),
      'taller.cerradas',
    ),
  ]);

  const unidades: UnidadTaller[] = unidadesRaw.map((u) => ({
    id: u.id as string,
    numeroEconomico: u.numero_economico as string,
    kmActual: u.km_actual == null ? null : Number(u.km_actual),
    activo: Boolean(u.activo),
  }));
  const ecoDe = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));

  const rutinas: RutinaRow[] = rutinasRaw.map((r) => ({
    id: r.id as string,
    nombre: r.nombre as string,
    cadaDias: r.cada_dias == null ? null : Number(r.cada_dias),
    cadaKm: r.cada_km == null ? null : Number(r.cada_km),
    activa: Boolean(r.activa),
  }));
  const nombreRutina = new Map(rutinas.map((r) => [r.id, r.nombre]));

  const ultimos: UltimoServicio[] = cerradasRaw
    .filter((c) => c.cerrada_en != null)
    .map((c) => ({
      rutinaId: c.rutina_id as string,
      unidadId: c.unidad_id as string,
      cerradaEn: c.cerrada_en as string,
      kmServicio: c.km_servicio == null ? null : Number(c.km_servicio),
    }));

  const abiertasPorRutinaUnidad = new Set(
    ordenesRaw.filter((o) => o.rutina_id != null).map((o) => `${o.rutina_id}|${o.unidad_id}`),
  );

  return {
    ordenesAbiertas: ordenesRaw.map((o) => ({
      id: o.id as string,
      unidadId: o.unidad_id as string,
      unidadEco: ecoDe.get(o.unidad_id as string) ?? '(unidad borrada)',
      tipo: o.tipo as string,
      estado: o.estado as string,
      descripcion: (o.descripcion as string) || null,
      abiertaEn: o.abierta_en as string,
      deAveria: o.incidencia_id != null,
      deRutina: o.rutina_id == null ? null : nombreRutina.get(o.rutina_id as string) ?? '(rutina borrada)',
    })),
    rutinas,
    // Una propuesta con orden YA ABIERTA de esa rutina+unidad no se repite:
    // proponer lo que ya está en el taller sería ruido que entierra lo real.
    propuestas: rutinasVencidas(rutinas, unidades, ultimos, hoy)
      .filter((p) => !abiertasPorRutinaUnidad.has(`${p.rutinaId}|${p.unidadId}`)),
  };
}

export interface NuevaRutina {
  nombre: string;
  cadaDias: number | null;
  cadaKm: number | null;
}

/** Valida la captura de una rutina — la misma función que prueba el test. */
export function validarRutina(v: { nombre: string; cadaDias: string; cadaKm: string }): NuevaRutina {
  const nombre = v.nombre.replace(/\s+/g, ' ').trim();
  if (!nombre || nombre.length > 80) throw new DatoInvalido('El nombre de la rutina es obligatorio (máximo 80 caracteres).');
  const leerEntero = (crudo: string, etiqueta: string): number | null => {
    const t = crudo.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new DatoInvalido(`${etiqueta} tiene que ser un entero entre 1 y 100,000.`);
    return n;
  };
  const cadaDias = leerEntero(v.cadaDias, 'La cadencia en días');
  const cadaKm = leerEntero(v.cadaKm, 'La cadencia en kilómetros');
  if (cadaDias === null && cadaKm === null) {
    throw new DatoInvalido('Una rutina necesita al menos una cadencia: días, kilómetros o ambas.');
  }
  return { nombre, cadaDias, cadaKm };
}

export async function crearRutina(tenantId: string, r: NuevaRutina, creadaPor: string | null): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('rutina_mantenimiento').insert({
    tenant_id: tenantId,
    nombre: r.nombre,
    cada_dias: r.cadaDias,
    cada_km: r.cadaKm,
    creada_por: creadaPor,
  }), 'mantenimiento.crear_rutina');
  if (error) {
    if (error.code === '23505' || /rutina_mantenimiento_nombre_unico/.test(error.message)) {
      throw new DatoInvalido(`Ya existe una rutina llamada "${r.nombre}" — edítala o usa otro nombre.`);
    }
    throw new Error(`crearRutina: ${error.message}`);
  }
}

/**
 * Abre la orden PROGRAMADA que una propuesta ofreció — la decisión del humano.
 * El candado real contra el doble clic es la unique parcial de la 0209 (una
 * orden no cerrada por rutina y unidad); aquí solo se traduce a palabras.
 */
export async function abrirOrdenProgramada(
  tenantId: string, rutinaId: string, unidadId: string,
): Promise<void> {
  const { data: rut, error: errR } = await acotada(supabaseAdmin().from('rutina_mantenimiento')
    .select('nombre').eq('id', rutinaId).eq('tenant_id', tenantId).maybeSingle(), 'mantenimiento.rutina_propia');
  if (errR) throw new Error(`abrirOrdenProgramada: ${errR.message}`);
  if (!rut) throw new DatoInvalido('Esa rutina no existe en tu flota.');

  const { error } = await acotada(supabaseAdmin().from('mantenimiento').insert({
    tenant_id: tenantId,
    unidad_id: unidadId,
    tipo: 'preventivo',
    descripcion: `Rutina: ${rut.nombre as string}`,
    estado: 'abierta',
    rutina_id: rutinaId,
  }), 'mantenimiento.abrir_programada');
  if (error) {
    if (error.code === '23505' || /mantenimiento_rutina_abierta_unica/.test(error.message)) {
      throw new DatoInvalido('Esa rutina ya tiene una orden abierta para esa unidad — ciérrala antes de abrir otra.');
    }
    // La FK compuesta de la 0145 rechaza una unidad ajena con foreign key.
    if (error.code === '23503') throw new DatoInvalido('Esa unidad no existe en tu flota.');
    throw new Error(`abrirOrdenProgramada: ${error.message}`);
  }
}

/**
 * Cierra una orden. Atómico por el WHERE (el molde de la firma de talacha):
 * exactamente un ganador; el segundo clic no encuentra fila y se le dice.
 * `kmServicio` es opcional y DECLARADO — null se queda null, jamás 0.
 */
export async function cerrarOrden(tenantId: string, ordenId: string, kmServicio: number | null): Promise<void> {
  if (kmServicio !== null && (!Number.isInteger(kmServicio) || kmServicio < 0 || kmServicio > 10_000_000)) {
    throw new DatoInvalido('El kilometraje del servicio tiene que ser un entero entre 0 y 10,000,000.');
  }
  const { data, error } = await acotada(supabaseAdmin().from('mantenimiento')
    .update({ estado: 'cerrada', cerrada_en: new Date().toISOString(), km_servicio: kmServicio })
    .eq('id', ordenId).eq('tenant_id', tenantId).neq('estado', 'cerrada')
    .select('id, unidad_id'), 'mantenimiento.cerrar');
  if (error) throw new Error(`cerrarOrden: ${error.message}`);
  const fila = (data ?? [])[0] as { id: string; unidad_id: string | null } | undefined;
  if (!fila) throw new DatoInvalido('Esa orden ya estaba cerrada o no existe en tu flota.');

  // c3-3 (segunda mitad): la lectura del tablero al cerrar es MÁS FRESCA que
  // el km declarado en la forma de unidades — que rara vez se vuelve a tocar.
  // Sin esto, el siguiente ciclo de la rutina nacía con el reloj contradictorio
  // (km_actual < km_servicio) que la propuesta ahora declara como ilegible.
  // Solo se ADELANTA (el WHERE deja fuera un km_actual ya mayor): un odómetro
  // jamás retrocede por cerrar una orden. Mejor esfuerzo con la falla dicha:
  // la orden ya quedó cerrada y eso no se revierte por no poder avanzar el km.
  if (kmServicio !== null && fila.unidad_id) {
    const { error: errKm } = await acotada(supabaseAdmin().from('unidad')
      .update({ km_actual: kmServicio })
      .eq('id', fila.unidad_id).eq('tenant_id', tenantId)
      .or(`km_actual.is.null,km_actual.lt.${kmServicio}`), 'mantenimiento.avanzar_odometro');
    if (errKm) logger.warn('mantenimiento.odometro_no_avanzo', { orden: ordenId, err: errKm.message });
  }
}
