// ═══════════════════════════════════════════════════════════════════════════
// LA COLA DE APROBACIÓN GENÉRICA (`cola_aprobacion`, 0117) — el único módulo
// que la lee y escribe.
//
// LAS TRES ACCIONES, NI UNA MÁS (panel-de-adquisicion §3): aprobar tal cual,
// editar-y-aprobar (la versión editada es la que sale; el diff queda
// derivable de cuerpo vs cuerpo_final), rechazar con motivo obligatorio.
//
// TODA transición va ANCLADA a `estado = 'pendiente'` (patrón
// reclamarEscalacion): dos resoluciones simultáneas no se pisan — la segunda
// toca cero filas y SE DICE. Y "enviar" ni siquiera es decisión de este
// módulo: `marcarEnviada` solo estampa la fecha, y el CHECK
// `cola_enviado_solo_aprobado` de la base la rebota sobre cualquier fila no
// aprobada — el candado es de esquema, no de UI ni de este archivo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { DatoInvalido } from '../errores';
import { logger } from '@/lib/logger';

export type PrioridadPieza = 'normal' | 'urgente';

export interface PiezaNueva {
  tipo: string;
  prioridad: PrioridadPieza;
  /** El agente DECLARADO que la preparó (FK a agente_definicion). */
  agente: string;
  tenantId?: string | null;
  prospectoId?: string | null;
  titulo: string;
  cuerpo: string;
  /** Trazabilidad: de dónde salió cada dato. Sin datos personales de más. */
  fuentes?: Record<string, unknown> | null;
}

const TIPO_RE = /^[a-z0-9_]{2,40}$/;

/** Encola una pieza. LANZA con texto de pantalla en todo rechazo — el agente
 *  que no pudo encolar debe enterarse, no seguir como si hubiera entregado. */
export async function encolarPieza(p: PiezaNueva): Promise<string> {
  if (!TIPO_RE.test(p.tipo)) throw new DatoInvalido('El tipo de pieza va en minúsculas/números/guión bajo (2-40).');
  if (p.prioridad !== 'normal' && p.prioridad !== 'urgente') throw new DatoInvalido('La prioridad es normal o urgente.');
  const titulo = p.titulo.trim();
  const cuerpo = p.cuerpo.trim();
  if (!titulo || titulo.length > 200) throw new DatoInvalido('El título es obligatorio (máx. 200).');
  if (!cuerpo) throw new DatoInvalido('El cuerpo de la pieza es obligatorio — una pieza vacía no tiene qué aprobar.');

  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion').insert({
    tipo: p.tipo, prioridad: p.prioridad, agente: p.agente,
    tenant_id: p.tenantId ?? null, prospecto_id: p.prospectoId ?? null,
    titulo, cuerpo: cuerpo.slice(0, 20_000), fuentes: p.fuentes ?? null,
  }).select('id').single(), 'encolarPieza');
  if (error) {
    // 23503 = el agente no está declarado: la FK es la trazabilidad mínima.
    if (error.code === '23503') throw new DatoInvalido(`El agente "${p.agente}" no está en el catálogo — una pieza sin autor declarado no entra a la cola.`);
    throw new Error(`encolarPieza: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('encolarPieza: el insert no devolvió id');
  return id as string;
}

export interface PiezaEnCola {
  id: string;
  tipo: string;
  prioridad: PrioridadPieza;
  agente: string;
  tenantId: string | null;
  prospectoId: string | null;
  prospectoEmpresa: string | null;
  titulo: string;
  cuerpo: string;
  fuentes: Record<string, unknown> | null;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  cuerpoFinal: string | null;
  motivoRechazo: string | null;
  enviadoEn: string | null;
  creadoEn: string;
}

function desdeFila(f: Record<string, unknown>): PiezaEnCola {
  return {
    id: String(f.id),
    tipo: String(f.tipo),
    prioridad: f.prioridad as PrioridadPieza,
    agente: String(f.agente),
    tenantId: (f.tenant_id as string) ?? null,
    prospectoId: (f.prospecto_id as string) ?? null,
    prospectoEmpresa: ((f.prospecto as { empresa?: string } | null)?.empresa) ?? null,
    titulo: String(f.titulo),
    cuerpo: String(f.cuerpo),
    fuentes: (f.fuentes as Record<string, unknown> | null) ?? null,
    estado: f.estado as PiezaEnCola['estado'],
    cuerpoFinal: (f.cuerpo_final as string) ?? null,
    motivoRechazo: (f.motivo_rechazo as string) ?? null,
    enviadoEn: (f.enviado_en as string) ?? null,
    creadoEn: String(f.creado_en),
  };
}

const COLUMNAS = 'id, tipo, prioridad, agente, tenant_id, prospecto_id, titulo, cuerpo, fuentes, estado, cuerpo_final, motivo_rechazo, enviado_en, creado_en, prospecto:prospecto_id(empresa)';

/**
 * Las DOS bandejas de pendientes — separadas desde la consulta, no una lista
 * con etiqueta (la decisión de agente-respuesta-a-ads §5.5). LANZA ante
 * error: una bandeja vacía por base caída afirmaría "nada espera aprobación".
 */
export async function bandejasPendientes(): Promise<{ urgente: PiezaEnCola[]; normal: PiezaEnCola[] }> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('cola_aprobacion')
      .select(COLUMNAS, conteo(d))
      .eq('estado', 'pendiente')
      .order('creado_en', { ascending: true }).order('id').range(d, h), 'bandejasPendientes'),
    'bandejasPendientes',
  );
  const piezas = filas.map(desdeFila);
  return {
    urgente: piezas.filter((p) => p.prioridad === 'urgente'),
    normal: piezas.filter((p) => p.prioridad === 'normal'),
  };
}

/** Las últimas resueltas — el contexto de "qué ha estado saliendo". */
export async function ultimasResueltas(limite = 10): Promise<PiezaEnCola[]> {
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .select(COLUMNAS)
    .neq('estado', 'pendiente')
    .order('resuelto_en', { ascending: false })
    .limit(limite), 'ultimasResueltas');
  if (error) throw new Error(`ultimasResueltas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFila);
}

/**
 * Aprueba (tal cual o con edición). El UPDATE va anclado a `pendiente`: si
 * otra sesión ya la resolvió, cero filas y SE DICE. `cuerpoFinal` solo se
 * guarda si de verdad difiere del original — un "editado" idéntico mentiría
 * en el aprendizaje de ediciones.
 */
export async function aprobarPieza(id: string, actorId: string, cuerpoEditado?: string): Promise<void> {
  const edicion = cuerpoEditado?.trim();
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({
      estado: 'aprobado',
      cuerpo_final: edicion || null,
      resuelto_por: actorId,
      resuelto_en: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', 'pendiente')
    .select('id, cuerpo'), 'aprobarPieza');
  if (error) throw new Error(`aprobarPieza: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa pieza ya no está pendiente — alguien la resolvió antes. Recarga la bandeja.');
  }
  // Si la "edición" quedó idéntica al original, se limpia: no hubo edición.
  const original = String((data[0] as Record<string, unknown>).cuerpo ?? '');
  if (edicion && edicion === original.trim()) {
    const { error: errLimpia } = await supabaseAdmin().from('cola_aprobacion')
      .update({ cuerpo_final: null }).eq('id', id);
    if (errLimpia) logger.warn('cola.edicion_identica_no_limpiada', { pieza: id, err: errLimpia.message });
  }
  await anotar('cola.aprobado', id, actorId, { editada: Boolean(edicion && edicion !== original.trim()) });
}

/** Rechaza con motivo OBLIGATORIO (la base también lo exige — CHECK 0117). */
export async function rechazarPieza(id: string, actorId: string, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new DatoInvalido('Rechazar exige un motivo: sin él, la misma pieza se vuelve a proponer igual la próxima vez.');
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({
      estado: 'rechazado', motivo_rechazo: m,
      resuelto_por: actorId, resuelto_en: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', 'pendiente')
    .select('id'), 'rechazarPieza');
  if (error) throw new Error(`rechazarPieza: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa pieza ya no está pendiente — alguien la resolvió antes. Recarga la bandeja.');
  }
  await anotar('cola.rechazado', id, actorId, { motivo: m.slice(0, 300) });
}

/**
 * Estampa el envío REAL de una pieza aprobada y, si pertenece a un
 * prospecto, deja el contacto en su historial (0118) — es el eslabón que
 * impide que la cadencia se duplique. El CHECK de la base rebota el sello
 * sobre una fila no aprobada aunque este código tuviera un bug.
 */
export async function marcarEnviada(id: string, actorId: string | null, canal: 'correo' | 'linkedin' | 'llamada' | 'whatsapp' | 'presencial' | 'otro' = 'correo'): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({ enviado_en: new Date().toISOString() })
    .eq('id', id).eq('estado', 'aprobado').is('enviado_en', null)
    .select('id, prospecto_id, titulo, agente'), 'marcarEnviada');
  if (error) throw new Error(`marcarEnviada: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Solo una pieza APROBADA y aún no enviada se puede marcar como enviada.');
  }
  const fila = data[0] as Record<string, unknown>;
  const prospectoId = (fila.prospecto_id as string) ?? null;
  if (prospectoId) {
    const { error: errContacto } = await supabaseAdmin().from('prospecto_contacto').insert({
      prospecto_id: prospectoId, canal, direccion: 'salida', pieza_id: id,
      resumen: `Salió «${String(fila.titulo).slice(0, 120)}» (${String(fila.agente)}, aprobada en cola).`,
      actor_id: actorId,
    });
    // El envío YA ocurrió: perder el rastro es malo y se GRITA, pero deshacer
    // un envío real por un insert fallido sería peor.
    if (errContacto) logger.error('cola.contacto_no_registrado', { pieza: id, prospecto: prospectoId, err: errContacto.message });
  }
}

/** Bitácora best-effort (criterio interruptores.ts): la acción ya quedó. */
async function anotar(accion: 'cola.aprobado' | 'cola.rechazado', piezaId: string, actorId: string, detalle: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: null, actor_id: actorId, accion,
    entidad: 'cola_aprobacion', entidad_id: piezaId, detalle,
  });
  if (error) logger.warn('cola.bitacora_no_escribio', { accion, pieza: piezaId, err: error.message });
}
