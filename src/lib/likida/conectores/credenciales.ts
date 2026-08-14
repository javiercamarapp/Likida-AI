import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { cifrar, pistasDe, cofreConfigurado } from './cofre';
import { conectorPorId } from './registro';
import { faltantes, type ValoresCredencial } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// CREDENCIALES DE CONECTOR — la escritura que la 0094 dejó prometida.
//
// El cofre (`cofre.ts`) sabía cifrar y la tabla `conector_credencial` sabía
// guardar, pero hasta este archivo (hallazgo C2, auditoría 4) NADIE los
// conectaba: los 14 conectores con `claveAlmacen: null` —los 8 de ERP y los 6
// de peaje— no tenían forma de recibir un solo acceso aunque su adaptador
// estuviera completo. Este módulo es el puente, y lo llama la pantalla de
// /dashboard/conexiones.
//
// Las reglas que NO se negocian aquí:
//   · El secreto viaja UNA vez, del formulario al cifrado. No vuelve al
//     panel (`listarCredenciales` jamás selecciona `valores_cifrados`), no
//     entra a un log, no entra a la bitácora.
//   · Sin `LIKIDA_COFRE_LLAVE` NO se guarda — y se dice qué falta. El modo de
//     falla aceptable es "no se pudo guardar", nunca "se guardó en claro"
//     (el CHECK `conector_credencial_no_en_claro` es el segundo candado).
//   · Guardar NO es conectar: la fila nace con `probada_en: null` y la
//     pantalla lo dice — "guardada, sin probar contra el sistema real".
// ═══════════════════════════════════════════════════════════════════════════

/** Bitácora best-effort — patrón `anotar` de `clientes.ts`: si falla, la
 *  credencial YA se guardó y tirar la operación dejaría el sistema peor. Al
 *  detalle van NOMBRES de campos, jamás valores. */
async function anotar(
  tenantId: string,
  accion: string,
  entidadId: string,
  detalle: Record<string, unknown>,
  actor?: { id?: string; email?: string },
): Promise<void> {
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: tenantId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    accion,
    entidad: 'conector_credencial',
    entidad_id: entidadId,
    detalle,
  });
  if (error) logger.warn('conector_credencial.bitacora_no_escribio', { accion, err: error.message });
}

/**
 * Guarda (o reemplaza) los accesos de un conector para la flota.
 *
 * El `tenantId` viene por argumento desde la sesión del servidor, NUNCA del
 * formulario. UPSERT por `(tenant_id, conector_id)` porque la 0094 admite UNA
 * credencial por conector y flota: capturar de nuevo ES reemplazar, y la
 * fila reemplazada vuelve a `probada_en: null` — la credencial nueva no
 * hereda la prueba de la vieja, porque nadie la ha probado.
 */
export async function guardarCredencial(
  tenantId: string,
  conectorId: string,
  valores: ValoresCredencial,
  actor?: { id?: string; email?: string },
): Promise<string> {
  if (!cofreConfigurado()) {
    // Se dice QUÉ falta, sin inventar un camino alterno: guardar en claro no
    // es una opción (ver `llave()` en cofre.ts).
    throw new DatoInvalido(
      'El cofre de credenciales no está configurado en este entorno (falta LIKIDA_COFRE_LLAVE, mínimo 32 caracteres). Sin él no se guardan accesos — guardarlos sin cifrar no es una opción.',
    );
  }

  const conector = conectorPorId(conectorId);
  if (!conector) throw new DatoInvalido('Ese sistema no está en el catálogo de conectores.');
  if (conector.credenciales.length === 0) {
    // Los `por_archivo` y los sin API no piden nada: aceptarles un guardado
    // fingiría una conexión que ese camino no usa.
    throw new DatoInvalido(`${conector.nombre} no pide credenciales — su camino de conexión no las usa.`);
  }

  // SOLO los campos declarados por el conector viajan al cofre. Un formulario
  // manipulado podría mandar claves extra, y cifrarlas las volvería carga
  // invisible que `probar()` nunca leería pero un descifrado sí devolvería.
  const limpios: Record<string, string> = {};
  for (const campo of conector.credenciales) {
    const v = (valores[campo.clave] ?? '').trim();
    if (v !== '') limpios[campo.clave] = v;
  }

  const falta = faltantes(conector, limpios);
  if (falta.length > 0) {
    throw new DatoInvalido(`Faltan datos para guardar ${conector.nombre}: ${falta.join(', ')}.`);
  }

  const { data, error } = await acotada(supabaseAdmin().from('conector_credencial').upsert({
    tenant_id: tenantId,
    conector_id: conector.id,
    valores_cifrados: cifrar(limpios),
    pistas: pistasDe(conector.credenciales, limpios),
    activo: true,
    // Reemplazar borra la historia de la prueba A PROPÓSITO: una fila con la
    // `probada_en` vieja y valores nuevos pintaría verde algo que nadie probó.
    probada_en: null,
    ultimo_error: null,
    creada_por: actor?.id ?? null,
  }, { onConflict: 'tenant_id,conector_id' }).select('id').single(), 'guardarCredencial');

  if (error) throw new Error(`guardarCredencial: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('guardarCredencial: el upsert no devolvió id');

  await anotar(tenantId, 'conector_credencial.guardada', String(id), {
    // Nombres de campos, no valores: la bitácora se lee del panel.
    conectorId: conector.id, campos: Object.keys(limpios),
  }, actor);

  return String(id);
}

export interface CredencialListada {
  conectorId: string;
  /** Lo ÚNICO de los valores que vuelve al panel: no-secretos en claro y los
   *  últimos 4 de cada secreto (ver `pistasDe`). */
  pistas: Record<string, string>;
  activo: boolean;
  /** `null` = guardada pero NUNCA probada contra el sistema real. La
   *  pantalla lo dice así, no lo pinta verde. */
  probadaEn: string | null;
  ultimoError: string | null;
  creadaEn: string;
}

/**
 * Las credenciales de la flota, nuevas primero.
 *
 * `valores_cifrados` NO se selecciona — ni cifrado tiene por qué viajar a la
 * capa de pantalla. Y un error de lectura LANZA en vez de devolver `[]`: una
 * base caída pintada como "no tienes credenciales" invitaría a capturarlas
 * de nuevo encima de las que sí existen.
 */
export async function listarCredenciales(tenantId: string): Promise<CredencialListada[]> {
  const { data, error } = await acotada(supabaseAdmin().from('conector_credencial')
    .select('conector_id, pistas, activo, probada_en, ultimo_error, creada_en')
    .eq('tenant_id', tenantId)
    .order('creada_en', { ascending: false }), 'listarCredenciales');

  if (error) throw new Error(`listarCredenciales: ${error.message}`);

  return (data ?? []).map((f) => ({
    conectorId: String(f.conector_id),
    pistas: (f.pistas ?? {}) as Record<string, string>,
    activo: Boolean(f.activo),
    probadaEn: f.probada_en == null ? null : String(f.probada_en),
    ultimoError: f.ultimo_error == null ? null : String(f.ultimo_error),
    creadaEn: String(f.creada_en),
  }));
}

/**
 * Desactiva la credencial de un conector: `activo = false`, NO se borra —
 * el cifrado se queda para poder auditar qué acceso existió y hasta cuándo
 * (mismo criterio que revocar una llave de API).
 *
 * El UPDATE va anclado a `tenant_id` Y comprueba las filas devueltas: con el
 * conector de otra flota —o uno ya desactivado— toca cero filas, y Postgres
 * no considera eso un error. Sin mirarlo, la pantalla diría "desactivada"
 * sobre una credencial que sigue viva.
 */
export async function desactivarCredencial(
  tenantId: string,
  conectorId: string,
  actor?: { id?: string; email?: string },
): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().from('conector_credencial')
    .update({ activo: false })
    .eq('tenant_id', tenantId)
    .eq('conector_id', conectorId)
    .eq('activo', true)
    .select('id'), 'desactivarCredencial');

  if (error) throw new Error(`desactivarCredencial: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No hay una credencial activa de ese sistema en tu flota. Puede que ya estuviera desactivada — recarga la pantalla.');
  }

  await anotar(tenantId, 'conector_credencial.desactivada', String((data[0] as { id: unknown }).id), { conectorId }, actor);
}
