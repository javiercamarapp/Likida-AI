import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from './bitacora_escritura';
import { DatoInvalido } from './errores';

// ═══════════════════════════════════════════════════════════════════════════
// LAS GUARDAS DEL DESPACHO ANTES DE MANDARLE UN WHATSAPP AL CHOFER
// (A37-S18-04 y A37-S18-05).
//
// «Reavisar» y «Asignar» mandan una plantilla de Meta (con costo) a una PERSONA con
// el anticipo y los botones de aceptar. La UI solo oculta «Reavisar» cuando el chofer
// ya aceptó (`vista.tsx`), y eso es una pestaña que puede estar vieja: la acción
// tiene que volver a comprobarlo. Aquí viven las comprobaciones, aparte de la página
// (`page.tsx` es una pantalla con acciones del servidor, no un lugar testeable):
//
//   · el viaje existe en ESTA flota y sigue `abierto` (no en cuadre ni liquidado);
//   · tiene operador, ese operador sigue ACTIVO, y no ha aceptado ya el viaje;
//   · no se le avisó hace menos de `COOLDOWN_REAVISO_MS` (clics espaciados = una
//     plantilla de Meta cada vez, con costo);
//   · FAIL-CLOSED: si no se puede LEER cualquiera de esas cosas, no se manda nada.
//
// El «cuándo fue el último aviso» sale de `bitacora_auditoria` (entidad `viaje`, acción
// `despacho.aviso_chofer`): `viaje.avisado_en` es solo el PRIMER aviso (el reloj de la
// escalación de las 5 h) y no se toca. La bitácora se escribe a mejor esfuerzo; si
// esa escritura falla el cooldown simplemente no se aplica a ese aviso — el lado
// que se cierra es el de LEER, que es donde se decide mandar o no.
// ═══════════════════════════════════════════════════════════════════════════

export const COOLDOWN_REAVISO_MS = 10 * 60_000;
export const ACCION_AVISO_CHOFER = 'despacho.aviso_chofer';

export type Guarda<T> = ({ ok: true } & T) | { ok: false; motivo: string };

const NO_SE_PUDO_LEER = 'No pude comprobar el estado del viaje — no se mandó nada. Inténtalo de nuevo en un momento.';

interface EstadoViaje {
  estatus: string | null;
  operadorId: string | null;
  aceptadoEn: string | null;
  avisadoEn: string | null;
  avisosEnviados: number;
}

async function leerViaje(tenantId: string, viajeId: string): Promise<EstadoViaje | 'no_existe' | 'ilegible'> {
  const { data, error } = await acotada(supabaseAdmin().from('viaje')
    .select('estatus, operador_id, aceptado_en, avisado_en, avisos_enviados')
    .eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(), 'despacho.leer_viaje');
  if (error) { logger.error('despacho.leer_viaje_fallo', { viajeId, err: error.message }); return 'ilegible'; }
  if (!data) return 'no_existe';
  const f = data as Record<string, unknown>;
  return {
    estatus: (f.estatus as string | null) ?? null,
    operadorId: (f.operador_id as string | null) ?? null,
    aceptadoEn: (f.aceptado_en as string | null) ?? null,
    avisadoEn: (f.avisado_en as string | null) ?? null,
    avisosEnviados: Number(f.avisos_enviados ?? 0),
  };
}

const MOTIVO_ESTATUS = (estatus: string | null) =>
  `Ese viaje ya está ${estatus === 'liquidado' ? 'liquidado' : estatus === 'en_cuadre' ? 'en cuadre' : 'cerrado'}: ya no se le avisa al chofer. Recarga la pantalla.`;

/** ¿Hay un aviso al chofer de este viaje más nuevo que el cooldown? `'ilegible'` = no se pudo saber. */
async function avisadoRecientemente(tenantId: string, viajeId: string, ahora: Date): Promise<boolean | 'ilegible'> {
  const desde = new Date(ahora.getTime() - COOLDOWN_REAVISO_MS).toISOString();
  const { data, error } = await acotada(supabaseAdmin().from('bitacora_auditoria')
    .select('id')
    .eq('tenant_id', tenantId).eq('entidad', 'viaje').eq('entidad_id', viajeId).eq('accion', ACCION_AVISO_CHOFER)
    .gte('ocurrio_en', desde)
    .order('id', { ascending: false })
    .limit(1), 'despacho.cooldown_aviso');
  if (error) { logger.error('despacho.cooldown_fallo', { viajeId, err: error.message }); return 'ilegible'; }
  return Array.isArray(data) && data.length > 0;
}

/** El operador está activo. `'ilegible'` = no se pudo saber. */
async function operadorActivo(tenantId: string, operadorId: string): Promise<boolean | 'ilegible'> {
  const { data, error } = await acotada(supabaseAdmin().from('operador')
    .select('activo').eq('id', operadorId).eq('tenant_id', tenantId).maybeSingle(), 'despacho.operador_activo');
  if (error) { logger.error('despacho.operador_activo_fallo', { operadorId, err: error.message }); return 'ilegible'; }
  if (!data) return false;
  return (data as { activo?: boolean | null }).activo !== false;
}

/**
 * ¿Se le puede REAVISAR a quien tiene hoy el viaje? Devuelve el operador al que se
 * le avisa (se resuelve AQUÍ, anclado a la flota: el cliente no elige a quién).
 */
export async function guardaReaviso(
  tenantId: string, viajeId: string, ahora: Date = new Date(),
): Promise<Guarda<{ operadorId: string; contarReaviso: boolean; avisosEnviados: number }>> {
  const v = await leerViaje(tenantId, viajeId);
  if (v === 'ilegible') return { ok: false, motivo: NO_SE_PUDO_LEER };
  if (v === 'no_existe') return { ok: false, motivo: 'Ese viaje no existe en tu flota.' };
  return guardaSobreViaje(tenantId, viajeId, v, ahora);
}

async function guardaSobreViaje(
  tenantId: string, viajeId: string, v: EstadoViaje, ahora: Date,
): Promise<Guarda<{ operadorId: string; contarReaviso: boolean; avisosEnviados: number }>> {
  if (v.estatus !== 'abierto') return { ok: false, motivo: MOTIVO_ESTATUS(v.estatus) };
  if (!v.operadorId) return { ok: false, motivo: 'Ese viaje no tiene operador asignado.' };
  if (v.aceptadoEn) return { ok: false, motivo: 'El chofer ya aceptó este viaje: no hace falta avisarle otra vez. Recarga la pantalla.' };
  const activo = await operadorActivo(tenantId, v.operadorId);
  if (activo === 'ilegible') return { ok: false, motivo: NO_SE_PUDO_LEER };
  if (!activo) return { ok: false, motivo: 'El operador de este viaje está dado de baja: asígnale otro chofer en vez de reavisar.' };
  const reciente = await avisadoRecientemente(tenantId, viajeId, ahora);
  if (reciente === 'ilegible') return { ok: false, motivo: NO_SE_PUDO_LEER };
  if (reciente) return { ok: false, motivo: `Ya se le avisó al chofer hace menos de ${COOLDOWN_REAVISO_MS / 60_000} minutos. Espera un momento antes de reavisar.` };
  // Si el viaje nunca se había avisado, `avisarAlChofer` pone `avisos_enviados = 1` solo; si ya se había avisado, esto es un reaviso y se cuenta.
  return { ok: true, operadorId: v.operadorId, contarReaviso: v.avisadoEn !== null, avisosEnviados: v.avisosEnviados };
}

/**
 * ¿Se puede ASIGNAR este viaje a `operadorId` y avisar? El viaje tiene que existir en la flota y seguir
 * abierto. Si ya es de ese mismo operador, "asignar" sería un reaviso disfrazado (clic repetido): pasa por
 * las mismas guardas que reavisar.
 */
export async function guardaAsignacion(
  tenantId: string, viajeId: string, operadorId: string, ahora: Date = new Date(),
): Promise<Guarda<{ reaviso: boolean; contarReaviso: boolean; avisosEnviados: number }>> {
  const v = await leerViaje(tenantId, viajeId);
  if (v === 'ilegible') return { ok: false, motivo: NO_SE_PUDO_LEER };
  if (v === 'no_existe') return { ok: false, motivo: 'Ese viaje no existe en tu flota.' };
  if (v.estatus !== 'abierto') return { ok: false, motivo: MOTIVO_ESTATUS(v.estatus) };
  if (v.operadorId !== operadorId) return { ok: true, reaviso: false, contarReaviso: false, avisosEnviados: v.avisosEnviados };
  const g = await guardaSobreViaje(tenantId, viajeId, v, ahora);
  if (!g.ok) return g;
  return { ok: true, reaviso: true, contarReaviso: g.contarReaviso, avisosEnviados: g.avisosEnviados };
}

/**
 * Deja constancia de un aviso que SÍ salió (ancla del cooldown) y, si fue un reaviso, lo cuenta en
 * `avisos_enviados`. Nunca lanza: el aviso ya salió.
 */
export async function anotarAvisoAlChofer(
  tenantId: string, viajeId: string, operadorId: string,
  opciones: { contarReaviso: boolean; avisosEnviados: number; actor: { id?: string | null; email?: string | null } },
): Promise<void> {
  if (opciones.contarReaviso) {
    // Optimista: solo suma si nadie más lo movió entre la lectura y ahora (un conteo de más no vale una carrera).
    const { error } = await acotada(supabaseAdmin().from('viaje')
      .update({ avisos_enviados: opciones.avisosEnviados + 1 })
      .eq('id', viajeId).eq('tenant_id', tenantId).eq('avisos_enviados', opciones.avisosEnviados), 'despacho.contar_reaviso');
    if (error) logger.warn('despacho.contar_reaviso_fallo', { viajeId, err: error.message });
  }
  await anotarBitacora(
    { tenantId, actor: opciones.actor, accion: ACCION_AVISO_CHOFER, entidad: 'viaje', entidadId: viajeId, detalle: { operadorId, reaviso: opciones.contarReaviso } },
    { evento: 'despacho.aviso_bitacora_no_escribio' },
  );
}

/**
 * El texto que se le enseña a quien asignó, para CUALQUIER error de reasignar o de asignar unidad. `DatoInvalido`
 * se enseña verbatim (ya está escrito para pantalla); los dos rechazos conocidos de `reasignarOperador` (operador
 * de otra flota o dado de baja) y el 23505 de `uq_viaje_abierto_por_*` se traducen; lo demás es el genérico.
 */
export function mensajeDeAsignacion(err: unknown, generico: string): string {
  if (err instanceof DatoInvalido) return err.message;
  const detalle = err instanceof Error ? err.message : String(err);
  if (/operador no pertenece a esta flota/i.test(detalle)) return 'Ese operador no es de tu flota. Recarga la pantalla y elígelo de la lista.';
  if (/operador está dado de baja/i.test(detalle)) return 'Ese operador está dado de baja en tu flota — elige otro chofer.';
  if (detalle.includes('uq_viaje_abierto_por_operador')) return 'Ese operador ya trae un viaje abierto — ciérralo o asígnale otro chofer.';
  if (detalle.includes('uq_viaje_abierto_por_unidad')) return 'Esa unidad ya está en otro viaje abierto — ciérralo o asígnale otra unidad.';
  return generico;
}
