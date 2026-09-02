// ═══════════════════════════════════════════════════════════════════════════
// TERMINALES (patios) — el escritor que la tabla nunca tuvo.
//
// `terminal` existe desde la 0001 y la referencian `operador` y `viaje` (y
// `unidad` desde la 0298), pero hasta la auditoría 24 NADA en `src/` la
// escribía: una flota con tres patios no tenía dónde decirlo, y el importador
// masivo de 800 unidades necesitaba a qué patio colgarlas.
//
// Alta MÍNIMA a propósito: nombre y ciudad. Lo que aquí no está (horarios,
// responsable, geocerca) es otra entrega; lo que sí está es lo que el
// selector de importar/editar necesita para que «Patio Norte» sea UNA fila y
// no ochocientas cadenas distintas.
//
// ESTE MÓDULO NO DECIDE PERMISOS: el server action que lo llama repite el
// chequeo de rol adentro (patrón de administracion.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { acotada } from './presupuesto';
import { traerTodo, conteo } from './pg';
import { DatoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';

export interface Terminal {
  id: string;
  nombre: string;
  ciudad: string | null;
}

/** Tope de patios por flota. No es técnico: con más de esto ya es un grupo
 *  corporativo y el selector deja de ser un selector. */
export const MAX_TERMINALES = 200;

/** Todas las terminales de la flota, en orden de nombre. Falla cerrado
 *  (`traerTodo` lanza `LecturaIncompleta`): un selector a medias mandaría
 *  unidades a «sin patio» sin que nadie lo note. */
export async function getTerminales(tenantId: string): Promise<Terminal[]> {
  const filas = await traerTodo<{ id: unknown; nombre: unknown; ciudad: unknown }>(
    (d, h) => acotada(
      supabaseAdmin().from('terminal').select('id, nombre, ciudad', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getTerminales',
    ),
    'getTerminales',
  );
  return filas
    .map((t) => ({ id: String(t.id), nombre: String(t.nombre), ciudad: (t.ciudad as string) || null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** El nombre como se guarda: sin espacios sobrantes. La unicidad de la base
 *  (`uq_terminal_tenant_nombre`, 0298) compara en minúsculas, así que «Patio
 *  Norte» y «patio norte» son el mismo patio y el segundo rebota. */
export function normalizarNombreTerminal(crudo: string): string {
  const nombre = crudo.replace(/\s+/g, ' ').trim();
  if (nombre.length < 2) throw new DatoInvalido('El nombre del patio necesita al menos 2 caracteres.');
  if (nombre.length > 80) throw new DatoInvalido('El nombre del patio no puede pasar de 80 caracteres.');
  return nombre;
}

/**
 * Crea una terminal. Devuelve su id.
 *
 * El choque contra `uq_terminal_tenant_nombre` se dice en palabras de quien
 * capturó: es el único error esperable y es de captura, no del sistema.
 */
export async function crearTerminal(
  tenantId: string,
  t: { nombre: string; ciudad?: string | null },
  actor?: { id?: string; email?: string },
): Promise<string> {
  const nombre = normalizarNombreTerminal(t.nombre);
  const ciudad = t.ciudad?.replace(/\s+/g, ' ').trim() || null;
  if (ciudad && ciudad.length > 80) throw new DatoInvalido('La ciudad no puede pasar de 80 caracteres.');

  const admin = supabaseAdmin();
  const { count, error: errCuenta } = await acotada(
    admin.from('terminal').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    'crearTerminal.cuenta',
  );
  if (errCuenta) throw new Error(`crearTerminal: no se pudo contar — ${errCuenta.message}`);
  if ((count ?? 0) >= MAX_TERMINALES) {
    throw new DatoInvalido(`Tu flota ya tiene ${MAX_TERMINALES} patios, que es el máximo aquí. Háblanos y lo montamos bien.`);
  }

  const { data, error } = await acotada(
    admin.from('terminal').insert({ tenant_id: tenantId, nombre, ciudad }).select('id').maybeSingle(),
    'crearTerminal',
  );
  if (error) {
    if (error.message.includes('uq_terminal_tenant_nombre')) {
      throw new DatoInvalido(`Ya tienes un patio llamado «${nombre}». Elígelo en la lista en vez de darlo de alta otra vez.`);
    }
    throw new Error(`crearTerminal: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearTerminal: el insert no devolvió id');

  // `entidad: 'tenant'` y no `'terminal'`: `EntidadBitacora` (bitacora_escritura.ts)
  // no conoce la terminal y ese archivo no es de esta entrega. El detalle
  // trae el id del patio, así que el rastro no pierde nada — solo el nombre
  // de la columna `entidad`. Queda anotado en CIERRE.md como cambio propuesto.
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'terminal.creada', entidad: 'tenant', entidadId: tenantId,
    detalle: { terminalId: String(id), nombre, ciudad },
  });
  return String(id);
}

/**
 * ¿Esta terminal es de esta flota? `null`/`''` = «sin patio», que siempre es
 * válido. Cualquier otra cosa se comprueba contra la base: un uuid con forma
 * correcta pero de OTRA flota es exactamente lo que la FK compuesta de la
 * 0298 rebota, y aquí se rebota antes, con un mensaje que dice qué pasó.
 */
export async function resolverTerminalDeFlota(tenantId: string, terminalId: string | null | undefined): Promise<string | null> {
  const id = (terminalId ?? '').trim();
  if (id === '') return null;
  if (!esUuidValido(id)) throw new DatoInvalido('No se reconoce ese patio. Vuelve a abrir la pantalla.');
  const { data, error } = await acotada(
    supabaseAdmin().from('terminal').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
    'resolverTerminalDeFlota',
  );
  if (error) throw new Error(`resolverTerminalDeFlota: ${error.message}`);
  if (!data) throw new DatoInvalido('Ese patio no existe en tu flota. Elige uno de la lista o déjalo vacío.');
  return id;
}

/**
 * Cuelga (o descuelga) una unidad de un patio. Vive aquí y no en
 * `operacion.ts` porque `editarUnidad` es de otra entrega; el UPDATE va
 * anclado al tenant y se mira cuántas filas tocó, como todo update del panel.
 */
export async function asignarTerminalUnidad(
  tenantId: string,
  unidadId: string,
  terminalId: string | null,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(unidadId)) throw new DatoInvalido('No se reconoce esa unidad. Vuelve a abrir la pantalla.');
  const terminal = await resolverTerminalDeFlota(tenantId, terminalId);
  const { data, error } = await acotada(
    supabaseAdmin().from('unidad').update({ terminal_id: terminal })
      .eq('id', unidadId).eq('tenant_id', tenantId).select('id'),
    'asignarTerminalUnidad',
  );
  if (error) throw new Error(`asignarTerminalUnidad: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró esa unidad en tu flota. Recarga la pantalla.');
  }
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'unidad.terminal', entidad: 'unidad', entidadId: unidadId,
    detalle: { terminalId: terminal },
  });
}
