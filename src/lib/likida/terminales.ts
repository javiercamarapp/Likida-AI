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
// W2 «producto» (1-oct-2026) le suma lo que la pantalla de Patios necesita para
// que un tenant nuevo opere sin tocar la base: editar y borrar un patio,
// contarlo (operadores, unidades y jefes, en UNA consulta agrupada — 0461),
// asignar operadores y jefes de tráfico, y leer el patio de un registro para
// que el permiso del jefe («solo mi patio») se decida con el dato de la base y
// no con lo que mande el formulario.
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

  // La entidad es `terminal` desde W2 (antes firmaba como `tenant` porque
  // `EntidadBitacora` no conocía el patio); el id del patio es `entidadId`.
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'terminal.creada', entidad: 'terminal', entidadId: String(id),
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


// ═══════════════════════════════════════════════════════════════════════════
// W2 «producto»: editar, borrar, contar y asignar.
// ═══════════════════════════════════════════════════════════════════════════

export interface TerminalConConteos extends Terminal {
  /** Operadores ACTIVOS del patio. */
  operadores: number;
  /** Unidades ACTIVAS del patio. */
  unidades: number;
  /** Jefes de tráfico (usuarios activos) amarrados al patio. */
  jefes: number;
}

/** Cada patio con sus conteos, sobre la flota ENTERA (RPC 0461). Falla
 *  cerrado: unos conteos a medias dirían «patio vacío» de uno con 40 camiones. */
export async function getTerminalesConConteos(tenantId: string): Promise<TerminalConConteos[]> {
  const patios = await getTerminales(tenantId);
  if (patios.length === 0) return [];
  const { data, error } = await acotada(
    supabaseAdmin().rpc('terminales_conteos_tenant', { p_tenant: tenantId }),
    'getTerminalesConConteos',
  );
  if (error) throw new Error(`getTerminalesConConteos: ${error.message}`);
  const porId = new Map<string, { operadores: number; unidades: number; jefes: number }>();
  for (const f of (data ?? []) as Array<Record<string, unknown>>) {
    porId.set(String(f.terminal_id), {
      operadores: Number(f.operadores) || 0, unidades: Number(f.unidades) || 0, jefes: Number(f.jefes) || 0,
    });
  }
  return patios.map((p) => ({ ...p, ...(porId.get(p.id) ?? { operadores: 0, unidades: 0, jefes: 0 }) }));
}

/** Cambia nombre y ciudad de un patio de ESTA flota. El choque contra el único
 *  de nombre se dice en palabras de quien capturó. */
export async function editarTerminal(
  tenantId: string,
  terminalId: string,
  t: { nombre: string; ciudad?: string | null },
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(terminalId)) throw new DatoInvalido('No se reconoce ese patio. Vuelve a abrir la pantalla.');
  const nombre = normalizarNombreTerminal(t.nombre);
  const ciudad = t.ciudad?.replace(/\s+/g, ' ').trim() || null;
  if (ciudad && ciudad.length > 80) throw new DatoInvalido('La ciudad no puede pasar de 80 caracteres.');

  const { data, error } = await acotada(
    supabaseAdmin().from('terminal').update({ nombre, ciudad })
      .eq('id', terminalId).eq('tenant_id', tenantId).select('id'),
    'editarTerminal',
  );
  if (error) {
    if (error.message.includes('uq_terminal_tenant_nombre')) {
      throw new DatoInvalido(`Ya tienes otro patio llamado «${nombre}». Usa un nombre distinto.`);
    }
    throw new Error(`editarTerminal: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró ese patio en tu flota. Recarga la pantalla.');
  }
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'terminal.editada', entidad: 'terminal', entidadId: terminalId,
    detalle: { nombre, ciudad },
  });
}

/**
 * Borra un patio de ESTA flota. Las FKs son `on delete set null`: los
 * operadores, unidades y viajes que lo tenían quedan SIN patio (nunca se
 * borran) y los jefes quedan sin patio (= ven toda la flota). Por eso el
 * llamador enseña los conteos ANTES de confirmar y la bitácora los guarda.
 */
export async function eliminarTerminal(
  tenantId: string,
  terminalId: string,
  actor?: { id?: string; email?: string },
): Promise<{ operadores: number; unidades: number; jefes: number }> {
  if (!esUuidValido(terminalId)) throw new DatoInvalido('No se reconoce ese patio. Vuelve a abrir la pantalla.');
  const antes = (await getTerminalesConConteos(tenantId)).find((p) => p.id === terminalId);
  if (!antes) throw new DatoInvalido('No se encontró ese patio en tu flota. Recarga la pantalla.');
  // Un jefe de tráfico SIN patio ve y corrige TODA la flota. Si se borra un patio
  // con jefes adentro, esos jefes ampliarían su alcance sin que nadie lo decidiera:
  // es el efecto de seguridad que esta comprobación impide.
  if (antes.jefes > 0) {
    throw new DatoInvalido(
      `El patio «${antes.nombre}» tiene ${antes.jefes} ${antes.jefes === 1 ? 'jefe de tráfico asignado' : 'jefes de tráfico asignados'}. ` +
      'Asígnales otro patio (o «toda la flota») antes de borrarlo: si no, pasarían a ver y corregir toda la flota sin que nadie lo decidiera.',
    );
  }

  const { data, error } = await acotada(
    supabaseAdmin().from('terminal').delete().eq('id', terminalId).eq('tenant_id', tenantId).select('id'),
    'eliminarTerminal',
  );
  if (error) throw new Error(`eliminarTerminal: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró ese patio en tu flota. Recarga la pantalla.');
  }
  const soltados = { operadores: antes.operadores, unidades: antes.unidades, jefes: antes.jefes };
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'terminal.eliminada', entidad: 'terminal', entidadId: terminalId,
    detalle: { nombre: antes.nombre, quedaronSinPatio: soltados },
  });
  return soltados;
}

/** El patio de un registro de ESTA flota, o `encontrado: false` si no es de la
 *  flota. Es la lectura con que el permiso del jefe («solo mi patio») se decide
 *  con la base, no con lo que mande el formulario. Lanza si no pudo leer. */
export async function terminalDeRegistro(
  tabla: 'operador' | 'unidad',
  tenantId: string,
  id: string,
): Promise<{ encontrado: boolean; terminalId: string | null }> {
  if (!esUuidValido(id)) return { encontrado: false, terminalId: null };
  const { data, error } = await acotada(
    supabaseAdmin().from(tabla).select('id, terminal_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
    `terminalDeRegistro.${tabla}`,
  );
  if (error) throw new Error(`terminalDeRegistro(${tabla}): ${error.message}`);
  if (!data) return { encontrado: false, terminalId: null };
  const t = (data as { terminal_id?: unknown }).terminal_id;
  return { encontrado: true, terminalId: typeof t === 'string' && t ? t : null };
}

/** El patio de cada registro de una página (un `in(...)`, no una consulta por
 *  fila). Los ids que no son de la flota no aparecen. */
export async function terminalesDeRegistros(
  tabla: 'operador' | 'unidad',
  tenantId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const validos = [...new Set(ids.filter(esUuidValido))];
  const salida = new Map<string, string | null>();
  if (validos.length === 0) return salida;
  const { data, error } = await acotada(
    supabaseAdmin().from(tabla).select('id, terminal_id').eq('tenant_id', tenantId).in('id', validos),
    `terminalesDeRegistros.${tabla}`,
  );
  if (error) throw new Error(`terminalesDeRegistros(${tabla}): ${error.message}`);
  for (const f of (data ?? []) as Array<{ id: unknown; terminal_id: unknown }>) {
    salida.set(String(f.id), typeof f.terminal_id === 'string' && f.terminal_id ? f.terminal_id : null);
  }
  return salida;
}

/** El patio de un usuario del panel. `undefined` = no se pudo leer (el llamador
 *  falla CERRADO: no saber el patio de un jefe no es «ve toda la flota»). */
export async function terminalDeUsuario(tenantId: string, userId: string): Promise<string | null | undefined> {
  if (!esUuidValido(userId)) return undefined;
  const { data, error } = await acotada(
    supabaseAdmin().from('app_user').select('terminal_id').eq('id', userId).eq('tenant_id', tenantId).maybeSingle(),
    'terminalDeUsuario',
  );
  if (error || !data) return undefined;
  const t = (data as { terminal_id?: unknown }).terminal_id;
  return typeof t === 'string' && t ? t : null;
}

/** Cuelga (o descuelga) un operador de un patio. Mismo molde que
 *  `asignarTerminalUnidad`: UPDATE anclado al tenant, filas contadas. */
export async function asignarTerminalOperador(
  tenantId: string,
  operadorId: string,
  terminalId: string | null,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(operadorId)) throw new DatoInvalido('No se reconoce ese operador. Vuelve a abrir la pantalla.');
  const terminal = await resolverTerminalDeFlota(tenantId, terminalId);
  const { data, error } = await acotada(
    supabaseAdmin().from('operador').update({ terminal_id: terminal })
      .eq('id', operadorId).eq('tenant_id', tenantId).select('id'),
    'asignarTerminalOperador',
  );
  if (error) throw new Error(`asignarTerminalOperador: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró ese operador en tu flota. Recarga la pantalla.');
  }
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'operador.terminal', entidad: 'operador', entidadId: operadorId,
    detalle: { terminalId: terminal },
  });
}

export interface JefeDeTrafico {
  userId: string;
  nombre: string | null;
  email: string;
  terminalId: string | null;
}

/** Los jefes de tráfico (rol encargado, activos) de la flota con su patio. */
export async function getJefesDeTrafico(tenantId: string): Promise<JefeDeTrafico[]> {
  const filas = await traerTodo<{ id: unknown; nombre: unknown; email: unknown; terminal_id: unknown }>(
    (d, h) => acotada(
      supabaseAdmin().from('app_user').select('id, nombre, email, terminal_id', conteo(d))
        .eq('tenant_id', tenantId).eq('rol', 'encargado').neq('activo', false).order('id').range(d, h),
      'getJefesDeTrafico',
    ),
    'getJefesDeTrafico',
  );
  return filas.map((f) => ({
    userId: String(f.id),
    nombre: typeof f.nombre === 'string' && f.nombre ? f.nombre : null,
    email: String(f.email ?? ''),
    terminalId: typeof f.terminal_id === 'string' && f.terminal_id ? f.terminal_id : null,
  })).sort((a, b) => (a.nombre ?? a.email).localeCompare(b.nombre ?? b.email, 'es'));
}

/** Amarra (o suelta) a un jefe de tráfico de un patio. Solo el rol encargado
 *  lleva patio: asignárselo a un dueño o a un contador no limitaría nada y
 *  confundiría a quien lea la ficha. */
export async function asignarTerminalJefe(
  tenantId: string,
  userId: string,
  terminalId: string | null,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(userId)) throw new DatoInvalido('No se reconoce a ese usuario. Vuelve a abrir la pantalla.');
  const terminal = await resolverTerminalDeFlota(tenantId, terminalId);
  const { data, error } = await acotada(
    supabaseAdmin().from('app_user').update({ terminal_id: terminal })
      .eq('id', userId).eq('tenant_id', tenantId).eq('rol', 'encargado').select('id'),
    'asignarTerminalJefe',
  );
  if (error) throw new Error(`asignarTerminalJefe: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró a ese jefe de tráfico en tu flota. Solo los usuarios con rol «Encargado» llevan patio.');
  }
  await anotarBitacora({
    tenantId, actor: actor ?? {}, accion: 'app_user.terminal', entidad: 'app_user', entidadId: userId,
    detalle: { terminalId: terminal },
  });
}

/** Cuántos operadores y unidades ACTIVOS no tienen patio — lo que la pantalla de
 *  Patios ofrece asignar de una vez. Falla cerrado (lanza). */
export async function contarSinPatio(tenantId: string): Promise<{ operadores: number; unidades: number }> {
  const contar = async (tabla: 'operador' | 'unidad') => {
    const { count, error } = await acotada(
      supabaseAdmin().from(tabla).select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('activo', true).is('terminal_id', null),
      `contarSinPatio.${tabla}`,
    );
    if (error) throw new Error(`contarSinPatio(${tabla}): ${error.message}`);
    return count ?? 0;
  };
  return { operadores: await contar('operador'), unidades: await contar('unidad') };
}

/**
 * Cuelga de un patio TODOS los operadores (o unidades) ACTIVOS que no tienen
 * patio: el arranque de una flota que ya cargó su gente y apenas creó sus
 * patios. Un solo UPDATE condicionado a «sin patio» —atómico e idempotente: dos
 * clics no mueven nada la segunda vez, y no pisa a quien ya tiene patio—, anclado
 * al tenant. Devuelve cuántos movió.
 */
export async function asignarSinPatio(
  tabla: 'operador' | 'unidad',
  tenantId: string,
  terminalId: string,
  actor?: { id?: string; email?: string },
): Promise<number> {
  const terminal = await resolverTerminalDeFlota(tenantId, terminalId);
  if (!terminal) throw new DatoInvalido('Elige el patio al que quieres asignarlos.');
  const { data, error } = await acotada(
    supabaseAdmin().from(tabla).update({ terminal_id: terminal })
      .eq('tenant_id', tenantId).eq('activo', true).is('terminal_id', null).select('id'),
    `asignarSinPatio.${tabla}`,
  );
  if (error) throw new Error(`asignarSinPatio(${tabla}): ${error.message}`);
  const movidos = Array.isArray(data) ? data.length : 0;
  if (movidos > 0) {
    await anotarBitacora({
      tenantId, actor: actor ?? {}, accion: `${tabla}.terminal_masivo`, entidad: 'terminal', entidadId: terminal,
      detalle: { tabla, movidos, ids: (data as Array<{ id: unknown }>).map((f) => String(f.id)) },
    });
  }
  return movidos;
}

/**
 * El patio del OPERADOR dueño de una jornada (o de una marca de jornada), leído de
 * la base: la corrección de una jornada es del jefe de SU patio (W2). Dos lecturas
 * encadenadas (marca → día → operador → patio), todas ancladas al tenant. Lanza si
 * no pudo leer; `encontrado: false` si la jornada/marca no es de la flota.
 */
export async function terminalDeJornada(
  tenantId: string,
  ref: { jornadaId: string } | { asientoId: string },
): Promise<{ encontrado: boolean; terminalId: string | null }> {
  let jornadaId: string | null = 'jornadaId' in ref ? ref.jornadaId : null;
  if ('asientoId' in ref) {
    if (!esUuidValido(ref.asientoId)) return { encontrado: false, terminalId: null };
    const { data, error } = await acotada(
      supabaseAdmin().from('jornada_asiento').select('jornada_id').eq('id', ref.asientoId).eq('tenant_id', tenantId).maybeSingle(),
      'terminalDeJornada.asiento',
    );
    if (error) throw new Error(`terminalDeJornada: ${error.message}`);
    const j = (data as { jornada_id?: unknown } | null)?.jornada_id;
    if (typeof j !== 'string') return { encontrado: false, terminalId: null };
    jornadaId = j;
  }
  if (!jornadaId || !esUuidValido(jornadaId)) return { encontrado: false, terminalId: null };
  const { data: dia, error: errDia } = await acotada(
    supabaseAdmin().from('jornada_dia').select('operador_id').eq('id', jornadaId).eq('tenant_id', tenantId).maybeSingle(),
    'terminalDeJornada.dia',
  );
  if (errDia) throw new Error(`terminalDeJornada: ${errDia.message}`);
  const operadorId = (dia as { operador_id?: unknown } | null)?.operador_id;
  if (typeof operadorId !== 'string') return { encontrado: false, terminalId: null };
  return terminalDeRegistro('operador', tenantId, operadorId);
}
