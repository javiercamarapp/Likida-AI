// ═══════════════════════════════════════════════════════════════════════════
// OPERACIÓN — lo que ve y hace el ENCARGADO (jefe de tráfico).
//
// El resto del panel mira DINERO: cuánto se comprobó, qué se deduce, qué
// falta facturar. El encargado no vive de eso. Vive de despachar: quién trae
// qué, qué viaje no tiene dueño, qué unidad está en el taller, qué entrega no
// llegó. Por eso este módulo no devuelve un solo peso — y no por olvido: la
// matriz de permisos (0044) le da al encargado exportar y asignar, no ver
// finanzas, y una cifra de dinero aquí sería una fuga por la vía más tonta.
//
// Las cuatro tablas que esto lee nacieron en la 0047. Antes de ella,
// `dashboard/viajes` declaraba en pantalla que no existían.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { notificarAsignacion } from './notificar';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { conteo, traerTodo } from './pg';

/** Los tres estatus que `viaje` de verdad admite (`viaje_estatus_dominio`,
 *  0025). Un cuarto valor no se traduce ni se esconde: se cuenta aparte. */
const SIN_CERRAR = new Set(['abierto', 'en_cuadre']);

// ── Carga por operador: "ve cuántos trae cada quien" ───────────────────────

export interface CargaOperador {
  operadorId: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
  /** Viajes que todavía no se liquidan — los que el encargado persigue. */
  enCurso: number;
  abiertos: number;
  enCuadre: number;
  liquidados: number;
  /** Viajes en curso sin evidencia de entrega subida. */
  sinPod: number;
  incidenciasAbiertas: number;
}

/**
 * La foto que el encargado necesita para repartir el trabajo del día.
 *
 * Ordena por carga descendente a propósito: el que trae más sale arriba,
 * porque la pregunta que se contesta aquí es "¿a quién NO le cargo otro?".
 */
export async function getCargaOperadores(tenantId: string): Promise<CargaOperador[]> {
  const admin = supabaseAdmin();
  const [ops, viajes, pods, incidencias] = await Promise.all([
    traerTodo<{ id: unknown; nombre: unknown; telefono: unknown; activo: unknown }>(
      (d, h) => admin.from('operador').select('id, nombre, telefono, activo', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCargaOperadores.operador',
    ),
    traerTodo<{ id: unknown; operador_id: unknown; estatus: unknown }>(
      (d, h) => admin.from('viaje').select('id, operador_id, estatus', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCargaOperadores.viaje',
    ),
    traerTodo<{ viaje_id: unknown; estado: unknown }>(
      (d, h) => admin.from('pod').select('viaje_id, estado', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCargaOperadores.pod',
    ),
    traerTodo<{ viaje_id: unknown; estado: unknown }>(
      (d, h) => admin.from('incidencia').select('viaje_id, estado', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCargaOperadores.incidencia',
    ),
  ]);

  // Un POD 'rechazado' NO cuenta como entregado: la evidencia existe pero no
  // sirve, y es justo el caso que el encargado tiene que volver a pedir.
  const conPod = new Set(pods.filter((p) => p.estado === 'subido').map((p) => p.viaje_id as string));
  const incidenciaAbiertaPorViaje = new Set(
    incidencias.filter((i) => i.estado !== 'resuelta').map((i) => i.viaje_id as string),
  );

  const acum = new Map<string, Omit<CargaOperador, 'operadorId' | 'nombre' | 'telefono' | 'activo'>>();
  const vacio = () => ({ enCurso: 0, abiertos: 0, enCuadre: 0, liquidados: 0, sinPod: 0, incidenciasAbiertas: 0 });

  for (const v of viajes) {
    const op = v.operador_id as string | null;
    if (!op) continue;   // sin dueño: se cuenta en getViajesSinAsignar, no aquí
    const a = acum.get(op) ?? vacio();
    const estatus = v.estatus as string;
    if (estatus === 'abierto') a.abiertos += 1;
    else if (estatus === 'en_cuadre') a.enCuadre += 1;
    else if (estatus === 'liquidado') a.liquidados += 1;
    if (SIN_CERRAR.has(estatus)) {
      a.enCurso += 1;
      if (!conPod.has(v.id as string)) a.sinPod += 1;
    }
    if (incidenciaAbiertaPorViaje.has(v.id as string)) a.incidenciasAbiertas += 1;
    acum.set(op, a);
  }

  return ops
    .map((o) => ({
      operadorId: o.id as string,
      nombre: o.nombre as string,
      telefono: (o.telefono as string) || null,
      activo: Boolean(o.activo),
      ...(acum.get(o.id as string) ?? vacio()),
    }))
    .sort((x, y) => y.enCurso - x.enCurso || x.nombre.localeCompare(y.nombre));
}

// ── Viajes sin dueño ───────────────────────────────────────────────────────

export interface ViajeSinAsignar {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  fechaInicio: string | null;
  estatus: string;
}

/** Lo primero que el encargado abre en la mañana: qué está sin repartir. */
export async function getViajesSinAsignar(tenantId: string): Promise<ViajeSinAsignar[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => supabaseAdmin().from('viaje')
      .select('id, folio, origen, destino, fecha_inicio, estatus', conteo(d))
      .eq('tenant_id', tenantId).is('operador_id', null)
      .neq('estatus', 'liquidado')
      .order('id').range(d, h),
    'getViajesSinAsignar',
  );
  return filas.map((v) => ({
    id: v.id as string,
    folio: (v.folio as string) || null,
    origen: (v.origen as string) || null,
    destino: (v.destino as string) || null,
    fechaInicio: (v.fecha_inicio as string) || null,
    estatus: v.estatus as string,
  }));
}

// ── Unidades ───────────────────────────────────────────────────────────────

export interface UnidadRow {
  id: string;
  numeroEconomico: string;
  placas: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  estado: string;
  kmActual: number | null;
  /** Días para el vencimiento más próximo de los tres papeles, o `null` si
   *  ninguno está capturado. NEGATIVO significa vencido, y así se pinta. */
  diasAlVencimiento: number | null;
  queVence: string | null;
  ordenesAbiertas: number;
  activo: boolean;
}

const DIA_MS = 86_400_000;

export async function getUnidades(tenantId: string, hoy = new Date()): Promise<UnidadRow[]> {
  const admin = supabaseAdmin();
  const [unidades, ordenes] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('unidad')
        .select('id, numero_economico, placas, marca, modelo, anio, estado, km_actual, poliza_vence, permiso_sict_vence, verificacion_vence, activo', conteo(d))
        .eq('tenant_id', tenantId).order('numero_economico').range(d, h),
      'getUnidades.unidad',
    ),
    traerTodo<{ unidad_id: unknown; estado: unknown }>(
      (d, h) => admin.from('mantenimiento').select('unidad_id, estado', conteo(d))
        .eq('tenant_id', tenantId).neq('estado', 'cerrada').order('id').range(d, h),
      'getUnidades.mantenimiento',
    ),
  ]);

  const abiertasPorUnidad = new Map<string, number>();
  for (const o of ordenes) {
    const k = o.unidad_id as string;
    abiertasPorUnidad.set(k, (abiertasPorUnidad.get(k) ?? 0) + 1);
  }

  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());

  return unidades.map((u) => {
    // El vencimiento que importa es el MÁS PRÓXIMO de los tres, no el primero
    // que esté lleno: enseñar la póliza al día mientras el permiso SICT lleva
    // un mes vencido es peor que no enseñar nada.
    const papeles: Array<[string, unknown]> = [
      ['Póliza', u.poliza_vence],
      ['Permiso SICT', u.permiso_sict_vence],
      ['Verificación', u.verificacion_vence],
    ];
    let diasAlVencimiento: number | null = null;
    let queVence: string | null = null;
    for (const [nombre, valor] of papeles) {
      if (!valor) continue;
      const t = Date.parse(`${String(valor)}T00:00:00Z`);
      if (Number.isNaN(t)) continue;
      const dias = Math.round((t - base) / DIA_MS);
      if (diasAlVencimiento === null || dias < diasAlVencimiento) {
        diasAlVencimiento = dias;
        queVence = nombre;
      }
    }

    return {
      id: u.id as string,
      numeroEconomico: u.numero_economico as string,
      placas: (u.placas as string) || null,
      marca: (u.marca as string) || null,
      modelo: (u.modelo as string) || null,
      anio: u.anio == null ? null : Number(u.anio),
      estado: u.estado as string,
      kmActual: u.km_actual == null ? null : Number(u.km_actual),
      diasAlVencimiento,
      queVence,
      ordenesAbiertas: abiertasPorUnidad.get(u.id as string) ?? 0,
      activo: Boolean(u.activo),
    };
  });
}

// ── Incidencias ────────────────────────────────────────────────────────────

export interface IncidenciaRow {
  id: string;
  viajeId: string | null;
  folio: string | null;
  unidadId: string | null;
  numeroEconomico: string | null;
  tipo: string;
  prioridad: string;
  estado: string;
  descripcion: string | null;
  slaHoras: number | null;
  abiertaEn: string;
  resueltaEn: string | null;
  /** Horas transcurridas desde que se abrió, redondeadas. */
  horasAbierta: number;
  /** `true` solo si HAY SLA pactado y ya se pasó. Sin SLA es `false`, no
   *  `true`: una incidencia sin compromiso no está vencida, está sin pactar. */
  slaVencido: boolean;
}

export async function getIncidencias(tenantId: string, ahora = new Date()): Promise<IncidenciaRow[]> {
  const admin = supabaseAdmin();
  const [incidencias, viajes, unidades] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('incidencia')
        .select('id, viaje_id, unidad_id, tipo, prioridad, estado, descripcion, sla_horas, abierta_en, resuelta_en', conteo(d))
        // `id` DESEMPATA. `abierta_en` sola no es única —dos incidencias
        // abiertas en el mismo segundo empatan— y `range` pagina por posición:
        // ante un empate en la frontera de página, Postgres puede devolver la
        // misma fila dos veces y saltarse otra. Era la única consulta paginada
        // de este módulo sin desempate.
        .eq('tenant_id', tenantId).order('abierta_en', { ascending: false }).order('id').range(d, h),
      'getIncidencias.incidencia',
    ),
    traerTodo<{ id: unknown; folio: unknown }>(
      (d, h) => admin.from('viaje').select('id, folio', conteo(d)).eq('tenant_id', tenantId).order('id').range(d, h),
      'getIncidencias.viaje',
    ),
    traerTodo<{ id: unknown; numero_economico: unknown }>(
      (d, h) => admin.from('unidad').select('id, numero_economico', conteo(d)).eq('tenant_id', tenantId).order('id').range(d, h),
      'getIncidencias.unidad',
    ),
  ]);

  const folioPorViaje = new Map(viajes.map((v) => [v.id as string, (v.folio as string) || null]));
  const ecoPorUnidad = new Map(unidades.map((u) => [u.id as string, u.numero_economico as string]));

  return incidencias.map((i) => {
    const abiertaEn = String(i.abierta_en);
    const fin = i.resuelta_en ? Date.parse(String(i.resuelta_en)) : ahora.getTime();
    const horas = Math.max(0, Math.round((fin - Date.parse(abiertaEn)) / 3_600_000));
    const sla = i.sla_horas == null ? null : Number(i.sla_horas);
    return {
      id: i.id as string,
      viajeId: (i.viaje_id as string) || null,
      folio: i.viaje_id ? folioPorViaje.get(i.viaje_id as string) ?? null : null,
      unidadId: (i.unidad_id as string) || null,
      numeroEconomico: i.unidad_id ? ecoPorUnidad.get(i.unidad_id as string) ?? null : null,
      tipo: i.tipo as string,
      prioridad: i.prioridad as string,
      estado: i.estado as string,
      descripcion: (i.descripcion as string) || null,
      slaHoras: sla,
      abiertaEn,
      resueltaEn: (i.resuelta_en as string) || null,
      horasAbierta: horas,
      slaVencido: sla !== null && i.estado !== 'resuelta' && horas > sla,
    };
  });
}

// ── POD (evidencia de entrega) ─────────────────────────────────────────────

export interface PodRow {
  viajeId: string;
  folio: string | null;
  operadorId: string | null;
  operadorNombre: string | null;
  telefono: string | null;
  /** `null` cuando NADIE ha creado el registro — el caso más común y el que
   *  más se persigue. No es lo mismo que 'pendiente', que ya se pidió. */
  estado: string | null;
  podId: string | null;
  nota: string | null;
  capturadoEn: string | null;
}

/**
 * Los viajes EN CURSO y qué evidencia de entrega traen.
 *
 * Se parte de los VIAJES y no de la tabla `pod`: un viaje del que nadie creó
 * el registro es exactamente el que hay que perseguir, y recorrer `pod` lo
 * dejaría fuera. Es el mismo error que `getTableroOperacion` evita al contar.
 */
export async function getPods(tenantId: string): Promise<PodRow[]> {
  const admin = supabaseAdmin();
  const [viajes, pods, operadores] = await Promise.all([
    traerTodo<{ id: unknown; folio: unknown; operador_id: unknown; estatus: unknown }>(
      (d, h) => admin.from('viaje').select('id, folio, operador_id, estatus', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getPods.viaje',
    ),
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('pod').select('id, viaje_id, estado, nota, capturado_en', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getPods.pod',
    ),
    traerTodo<{ id: unknown; nombre: unknown; telefono: unknown }>(
      (d, h) => admin.from('operador').select('id, nombre, telefono', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getPods.operador',
    ),
  ]);

  const porViaje = new Map(pods.map((p) => [p.viaje_id as string, p]));
  const opPorId = new Map(operadores.map((o) => [o.id as string, o]));

  return viajes
    .filter((v) => SIN_CERRAR.has(v.estatus as string))
    .map((v) => {
      const p = porViaje.get(v.id as string);
      const op = v.operador_id ? opPorId.get(v.operador_id as string) : undefined;
      return {
        viajeId: v.id as string,
        folio: (v.folio as string) || null,
        operadorId: (v.operador_id as string) || null,
        operadorNombre: op ? (op.nombre as string) : null,
        telefono: op ? ((op.telefono as string) || null) : null,
        estado: p ? (p.estado as string) : null,
        podId: p ? (p.id as string) : null,
        nota: p ? ((p.nota as string) || null) : null,
        capturadoEn: p ? ((p.capturado_en as string) || null) : null,
      };
    })
    // Primero lo que falta: sin registro, luego pedido, luego rechazado, y al
    // final lo que ya llegó. El encargado abre esto para ver qué perseguir.
    .sort((a, b) => orden(a.estado) - orden(b.estado));
}

function orden(estado: string | null): number {
  if (estado === null) return 0;
  if (estado === 'pendiente') return 1;
  if (estado === 'rechazado') return 2;
  return 3;
}

/**
 * Deja constancia de que ya se pidió la evidencia.
 *
 * NO manda el mensaje: el envío por WhatsApp fuera de la ventana de 24 h
 * necesita una plantilla aprobada, y hoy la cuenta no tiene ninguna propia.
 * Registrar aquí que se pidió sirve igual —distingue "nadie lo ha pedido" de
 * "ya se pidió y no ha llegado"—, que es la diferencia que el encargado
 * necesita para saber a quién insistirle.
 */
export async function marcarPodPedido(tenantId: string, viajeId: string, operadorId: string | null): Promise<void> {
  // AUDITORÍA 12, MEDIO (backend): misma familia que crearViaje — el viaje y el
  // operador tienen que ser DE ESTA FLOTA antes de escribir el POD. La UI solo
  // ofrece los de la flota, pero el server action recibe los ids tal cual del
  // POST; un POST directo con el viaje u operador de OTRA flota escribía un
  // POD con tenant_id = A y viaje_id/operador_id de B.
  if (!(await viajePropio(tenantId, viajeId))) {
    throw new Error('marcarPodPedido: el viaje no pertenece a esta flota');
  }
  if (operadorId && !(await operadorPropio(tenantId, operadorId))) {
    throw new Error('marcarPodPedido: el operador no pertenece a esta flota');
  }
  const { error } = await acotada(supabaseAdmin().from('pod').insert({
    tenant_id: tenantId,
    viaje_id: viajeId,
    operador_id: operadorId,
    estado: 'pendiente',
  }), 'marcarPodPedido');
  if (error) throw new Error(`marcarPodPedido: ${error.message}`);
}

/**
 * Rechazar una evidencia que llegó pero no sirve (ilegible, del viaje
 * equivocado, sin sello). El archivo NO se borra: sigue siendo lo que el
 * chofer mandó, y borrarlo dejaría la discusión sin prueba.
 */
export async function rechazarPod(tenantId: string, podId: string, nota: string | null): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('pod')
    .update({ estado: 'rechazado', nota })
    .eq('id', podId).eq('tenant_id', tenantId), 'rechazarPod');
  if (error) throw new Error(`rechazarPod: ${error.message}`);
}

// ── Tablero de operación ───────────────────────────────────────────────────

export interface TableroOperacion {
  viajesActivos: number;
  porAsignar: number;
  unidadesDisponibles: number;
  unidadesEnTaller: number;
  incidenciasAbiertas: number;
  podPendientes: number;
}

/**
 * Los seis números de arriba del tablero. Ninguno es dinero.
 *
 * `podPendientes` cuenta viajes EN CURSO sin POD subido, no filas de la tabla
 * `pod`: un viaje del que nadie creó el registro es exactamente el caso que se
 * está persiguiendo, y contar filas lo dejaría fuera — el peor tipo de cero,
 * el que se lee como "no falta ninguno".
 */
export async function getTableroOperacion(tenantId: string): Promise<TableroOperacion> {
  const admin = supabaseAdmin();
  const [viajes, unidades, incidencias, pods] = await Promise.all([
    traerTodo<{ id: unknown; operador_id: unknown; estatus: unknown }>(
      (d, h) => admin.from('viaje').select('id, operador_id, estatus', conteo(d)).eq('tenant_id', tenantId).order('id').range(d, h),
      'getTableroOperacion.viaje',
    ),
    traerTodo<{ estado: unknown }>(
      (d, h) => admin.from('unidad').select('estado', conteo(d)).eq('tenant_id', tenantId).eq('activo', true).order('id').range(d, h),
      'getTableroOperacion.unidad',
    ),
    traerTodo<{ estado: unknown }>(
      (d, h) => admin.from('incidencia').select('estado', conteo(d)).eq('tenant_id', tenantId).neq('estado', 'resuelta').order('id').range(d, h),
      'getTableroOperacion.incidencia',
    ),
    traerTodo<{ viaje_id: unknown; estado: unknown }>(
      (d, h) => admin.from('pod').select('viaje_id, estado', conteo(d)).eq('tenant_id', tenantId).order('id').range(d, h),
      'getTableroOperacion.pod',
    ),
  ]);

  const conPod = new Set(pods.filter((p) => p.estado === 'subido').map((p) => p.viaje_id as string));
  const enCurso = viajes.filter((v) => SIN_CERRAR.has(v.estatus as string));

  return {
    viajesActivos: enCurso.length,
    porAsignar: enCurso.filter((v) => !v.operador_id).length,
    unidadesDisponibles: unidades.filter((u) => u.estado === 'disponible').length,
    unidadesEnTaller: unidades.filter((u) => u.estado === 'taller').length,
    incidenciasAbiertas: incidencias.length,
    podPendientes: enCurso.filter((v) => !conPod.has(v.id as string)).length,
  };
}

// ── Escrituras ─────────────────────────────────────────────────────────────
//
// Estas son las PRIMERAS escrituras administrativas de la app. Hasta aquí lo
// único que escribía en la base era el pipeline de WhatsApp (`repo.ts`,
// `conv.ts`), el propio perfil y el alta de usuario: crear un viaje o mover
// una unidad se hacía con SQL a mano. Por eso cada una comprueba el tenant en
// el WHERE además del id — un id de otro tenant no debe poder tocarse aunque
// alguien lo adivine.

export interface NuevoViaje {
  folio?: string | null;
  origen?: string | null;
  destino?: string | null;
  fechaInicio?: string | null;
  anticipo?: number;
  operadorId?: string | null;
  unidadId?: string | null;
}

/**
 * Comprueba que una unidad sea del tenant, ANTES de escribirla en `viaje`.
 *
 * ── LA UNIDAD TIENE QUE SER DE ESTA FLOTA (auditoría 10, MEDIO) ────────────
 *
 * Mismo patrón que `operadorId` (arriba): el `.eq('tenant_id', tenantId)` del
 * INSERT/UPDATE acota QUÉ VIAJE se toca, nunca A QUÉ UNIDAD se le asigna.
 * `unidad` no tiene ninguna policy de RLS que la exponga a un USUARIO de otro
 * tenant por su cuenta (no hay login de "operador de unidad" análogo al del
 * chofer) — por eso es MEDIO y no ALTO — pero el propio `flota_admin` de A,
 * que ya sabe o adivina el UUID de una unidad de B, podía hacer que su PROPIO
 * panel pintara número económico, placas, marca y modelo de esa unidad vía el
 * join que pinta `/dashboard/despacho`.
 */
async function unidadPropia(tenantId: string, unidadId: string): Promise<boolean> {
  const filas = await traerTodo<{ id: unknown }>(
    (d, h) => supabaseAdmin().from('unidad').select('id', conteo(d))
      .eq('tenant_id', tenantId).eq('id', unidadId).order('id').range(d, h),
    'unidadPropia',
  );
  return filas.length > 0;
}

/** Comprueba que un viaje sea del tenant (auditoría 12, MEDIO backend). */
async function viajePropio(tenantId: string, viajeId: string): Promise<boolean> {
  const filas = await traerTodo<{ id: unknown }>(
    (d, h) => supabaseAdmin().from('viaje').select('id', conteo(d))
      .eq('tenant_id', tenantId).eq('id', viajeId).order('id').range(d, h),
    'viajePropio',
  );
  return filas.length > 0;
}

/** Comprueba que un operador sea del tenant (auditoría 12, MEDIO backend). */
async function operadorPropio(tenantId: string, operadorId: string): Promise<boolean> {
  const filas = await traerTodo<{ id: unknown }>(
    (d, h) => supabaseAdmin().from('operador').select('id', conteo(d))
      .eq('tenant_id', tenantId).eq('id', operadorId).order('id').range(d, h),
    'operadorPropio',
  );
  return filas.length > 0;
}

/** Devuelve el id del viaje creado. */
export async function crearViaje(tenantId: string, v: NuevoViaje): Promise<string> {
  // ── EL OPERADOR TIENE QUE SER DE ESTA FLOTA (auditoría 10, ALTO) ──────────
  //
  // El comentario de arriba del módulo afirma que "un id de otro tenant no
  // debe poder tocarse aunque alguien lo adivine" — cierto para el WHERE de
  // `reasignarOperador`/`asignarUnidad`, falso aquí: `operadorId` se escribía
  // tal cual en un INSERT nuevo, sin ningún WHERE que lo pudiera detener. El
  // `<select>` de /dashboard/despacho solo ofrece los de
  // `listOperadores(tenantId)`, pero eso es la UI, no el servidor: un POST
  // directo al server action con el `operadorId` de OTRA flota creaba un
  // viaje con `tenant_id = A` y `operador_id` de B. La RLS del chofer
  // (`0045_rls_operador.sql`) no vuelve a comprobar tenant — solo
  // `operador_id = get_user_operador_id()` —, así que el chofer de B vería
  // ese viaje (y sus gastos y su liquidación) de la flota A en /chofer.
  if (v.operadorId) {
    const propio = await traerTodo<{ id: unknown }>(
      (d, h) => supabaseAdmin().from('operador').select('id', conteo(d))
        .eq('tenant_id', tenantId).eq('id', v.operadorId).order('id').range(d, h),
      'crearViaje.operadorPropio',
    );
    if (propio.length === 0) throw new Error('crearViaje: el operador no pertenece a esta flota');
  }

  // Mismo candado, para `unidadId` (auditoría 10, MEDIO) — ver `unidadPropia`.
  if (v.unidadId && !(await unidadPropia(tenantId, v.unidadId))) {
    throw new Error('crearViaje: la unidad no pertenece a esta flota');
  }

  const { data, error } = await acotada(supabaseAdmin().from('viaje').insert({
    tenant_id: tenantId,
    folio: v.folio || null,
    origen: v.origen || null,
    destino: v.destino || null,
    fecha_inicio: v.fechaInicio || null,
    anticipo: v.anticipo ?? 0,
    operador_id: v.operadorId || null,
    unidad_id: v.unidadId || null,
    estatus: 'abierto',
  }).select('id').single(), 'crearViaje');
  if (error) throw new Error(`crearViaje: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearViaje: el insert no devolvió id');

  // AVISAR AL CHOFER, EN CUANTO EXISTE EL VIAJE.
  //
  // Hasta hoy el viaje se creaba y el chofer se enteraba por teléfono, o no se
  // enteraba: el jefe daba por hecho que había arrancado y se descubría cuando
  // no llegaban fotos.
  //
  // BEST-EFFORT A PROPÓSITO. Si WhatsApp está caído o la plantilla no está
  // aprobada, el viaje YA está creado y esa es la operación que el jefe pidió.
  // Tirarla porque no salió un mensaje cambiaría un problema de aviso por uno
  // de despacho. El fallo se loguea y el aviso se puede reintentar desde el
  // panel.
  if (v.operadorId) await avisarAlChofer(tenantId, v.operadorId, id as string).catch(() => {});

  return id as string;
}

/**
 * Le manda al chofer el aviso de su viaje. Resuelve el teléfono aquí para que
 * quien llame no tenga que conocer la tabla `operador`.
 */
export async function avisarAlChofer(tenantId: string, operadorId: string, viajeId: string): Promise<void> {
  const admin = supabaseAdmin();
  // SILENCIOSA POR PARTIDA DOBLE, hasta hoy. Estas dos lecturas desestructuraban
  // solo `data`, así que un fallo de Supabase se volvía `op = null` → `!op?.
  // telefono` → `return` limpio: el aviso no salía Y no quedaba una línea de
  // log. Y como `avisado_en` es lo ÚNICO que hace visible el viaje para la
  // escalación de las 5 h (`viajesSinAceptar` filtra por él), ese viaje no
  // escalaba NUNCA: nadie le dijo al chofer y nadie se iba a enterar.
  //
  // La segunda lectura además era asimétrica dentro de su propio `Promise.all`:
  // la de `operador` acotaba por `tenant_id` y la de `viaje` no. Hoy no había
  // fuga porque `viajeId` viene de un insert propio o de una consulta ya
  // acotada, pero el día que llegue de la entrada del usuario, un id de la flota
  // B le manda a un chofer de la flota A el anticipo de un viaje ajeno.
  const [{ data: op, error: errOp }, { data: viaje, error: errViaje }] = await Promise.all([
    admin.from('operador').select('telefono').eq('id', operadorId).eq('tenant_id', tenantId).maybeSingle(),
    admin.from('viaje').select('folio, origen, destino, fecha_inicio, anticipo, unidad_id')
      .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(),
  ]);
  const errLectura = errOp ?? errViaje;
  if (errLectura) {
    // Se LANZA en vez de volver en silencio: los dos llamadores ya saben qué
    // hacer con una excepción —`crearViaje` la traga a propósito (el viaje ya
    // existe) y `escalarViajesSinAceptar` la anota en `fallos`—, mientras que un
    // `return` los deja creyendo que el chofer fue avisado.
    logger.error('viaje.aviso_no_se_pudo_leer', { viajeId, operadorId, err: errLectura.message, escalaSolo: false });
    throw new Error(`avisarAlChofer: no se pudo leer a quién avisar — ${errLectura.message}`);
  }
  if (!op?.telefono || !viaje) {
    // Aquí sí es un dato: el operador no tiene teléfono capturado, o el viaje no
    // es de esta flota. No es un error del sistema, pero tampoco puede pasar sin
    // rastro — este viaje tampoco va a escalar solo.
    logger.warn('viaje.aviso_sin_destinatario', { viajeId, operadorId, hayViaje: !!viaje, hayTelefono: !!op?.telefono, escalaSolo: false });
    return;
  }

  let unidad: string | null = null;
  if (viaje.unidad_id) {
    const { data: u, error: errUnidad } = await admin.from('unidad').select('numero_economico')
      .eq('tenant_id', tenantId).eq('id', viaje.unidad_id).maybeSingle();
    // `unidad = null` imprime el aviso SIN número económico, o sea "no traes
    // unidad asignada" — y aquí se sabe que sí la trae, porque `viaje.unidad_id`
    // no es null. Mandar ese mensaje marcaría `avisado_en` (el viaje deja de
    // escalar) con un chofer que no sabe qué camión sacar. Se falla cerrado: sin
    // aviso, el panel lo sigue enseñando como no avisado, que es la verdad.
    if (errUnidad) {
      logger.error('viaje.aviso_unidad_ilegible', { viajeId, err: errUnidad.message, escalaSolo: false });
      throw new Error(`avisarAlChofer: no se pudo leer la unidad del viaje — ${errUnidad.message}`);
    }
    unidad = (u?.numero_economico as string) ?? null;
  }

  const r = await notificarAsignacion({
    telefono: op.telefono as string,
    tenantId,
    viaje: {
      folio: viaje.folio as string | null,
      origen: viaje.origen as string | null,
      destino: viaje.destino as string | null,
      fechaInicio: viaje.fecha_inicio as string | null,
      anticipo: viaje.anticipo === null ? null : Number(viaje.anticipo),
      unidad,
    },
  });
  if (!r.enviado) {
    // ERROR, no WARN, y la razón importa: `avisado_en` es lo ÚNICO que hace
    // visible este viaje para la escalación de las 5 h. Si el aviso no salió, no
    // se marca —el reloj mide "desde que se le dijo al chofer", y nadie le
    // dijo—, así que este viaje NO va a escalar solo. Queda en el panel y en
    // este log, que es de donde alguien lo tiene que sacar.
    logger.error('viaje.aviso_no_salio', { viajeId, motivo: r.motivo, escalaSolo: false });
    return;
  }

  // Marca el arranque del reloj. Sin esto, `viajesSinAceptar()` no lo ve nunca:
  // filtra por `avisado_en no es null`.
  const { error } = await admin
    .from('viaje')
    .update({ avisado_en: new Date().toISOString(), avisos_enviados: 1 })
    .eq('id', viajeId)
    .eq('tenant_id', tenantId)
    .is('avisado_en', null); // el primer aviso manda: un reaviso no reinicia el plazo
  if (error) logger.warn('viaje.avisado_en_no_se_marcó', { viajeId, err: error.message });
}

/**
 * Empatar viaje ↔ unidad. `null` la desasigna (no hay unidad que comprobar,
 * así que el candado de abajo se salta a propósito para ese caso).
 *
 * Mismo candado que `crearViaje` (auditoría 10, MEDIO): la unidad tiene que
 * ser de este tenant ANTES de escribirla — ver `unidadPropia`.
 */
export async function asignarUnidad(tenantId: string, viajeId: string, unidadId: string | null): Promise<void> {
  if (unidadId && !(await unidadPropia(tenantId, unidadId))) {
    throw new Error('asignarUnidad: la unidad no pertenece a esta flota');
  }

  const { error } = await acotada(supabaseAdmin().from('viaje')
    .update({ unidad_id: unidadId })
    .eq('id', viajeId).eq('tenant_id', tenantId), 'asignarUnidad');
  if (error) throw new Error(`asignarUnidad: ${error.message}`);
}

export async function cambiarEstadoUnidad(tenantId: string, unidadId: string, estado: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('unidad')
    .update({ estado })
    .eq('id', unidadId).eq('tenant_id', tenantId), 'cambiarEstadoUnidad');
  if (error) throw new Error(`cambiarEstadoUnidad: ${error.message}`);
}

export interface NuevaUnidad {
  numeroEconomico: string;
  placas?: string | null;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
}

export async function crearUnidad(tenantId: string, u: NuevaUnidad): Promise<string> {
  const { data, error } = await acotada(supabaseAdmin().from('unidad').insert({
    tenant_id: tenantId,
    numero_economico: u.numeroEconomico,
    placas: u.placas || null,
    marca: u.marca || null,
    modelo: u.modelo || null,
    anio: u.anio ?? null,
  }).select('id').single(), 'crearUnidad');
  if (error) throw new Error(`crearUnidad: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearUnidad: el insert no devolvió id');
  return id as string;
}

export interface NuevaIncidencia {
  viajeId?: string | null;
  unidadId?: string | null;
  tipo: string;
  prioridad?: string;
  descripcion?: string | null;
  slaHoras?: number | null;
}

export async function crearIncidencia(tenantId: string, i: NuevaIncidencia): Promise<string> {
  // AUDITORÍA 12, MEDIO (backend): el viaje y la unidad referidos tienen que
  // ser de ESTA flota antes de insertar — mismo candado que crearViaje
  // (operadorPropio/unidadPropia), que la UI no puede sustituir porque el
  // server action recibe los ids tal cual del POST.
  if (i.viajeId && !(await viajePropio(tenantId, i.viajeId))) {
    throw new Error('crearIncidencia: el viaje no pertenece a esta flota');
  }
  if (i.unidadId && !(await unidadPropia(tenantId, i.unidadId))) {
    throw new Error('crearIncidencia: la unidad no pertenece a esta flota');
  }
  const { data, error } = await acotada(supabaseAdmin().from('incidencia').insert({
    tenant_id: tenantId,
    viaje_id: i.viajeId || null,
    unidad_id: i.unidadId || null,
    tipo: i.tipo,
    prioridad: i.prioridad || 'media',
    descripcion: i.descripcion || null,
    sla_horas: i.slaHoras ?? null,
  }).select('id').single(), 'crearIncidencia');
  if (error) throw new Error(`crearIncidencia: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearIncidencia: el insert no devolvió id');
  return id as string;
}

/**
 * Mover una incidencia de estado.
 *
 * `resuelta_en` NO es opcional cuando el estado es 'resuelta': el constraint
 * `incidencia_cierre_coherente` (0047) rechaza la fila si no cuadran, y esa
 * es la única razón por la que este helper existe en vez de un update suelto
 * — el llamador que olvide la fecha se entera con un error, no con una
 * incidencia "resuelta" que no se puede fechar.
 */
export async function cambiarEstadoIncidencia(
  tenantId: string, incidenciaId: string, estado: string, ahora = new Date(),
): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('incidencia')
    .update({ estado, resuelta_en: estado === 'resuelta' ? ahora.toISOString() : null })
    .eq('id', incidenciaId).eq('tenant_id', tenantId), 'cambiarEstadoIncidencia');
  if (error) throw new Error(`cambiarEstadoIncidencia: ${error.message}`);
}
