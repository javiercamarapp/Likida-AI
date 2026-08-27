import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL DIRECTORIO DE EMERGENCIA (0198, Fase 5 — paso 3 del plano).
//
// Los teléfonos NO viven en el prompt de ningún modelo: viven aquí, con quién
// los verificó y cuándo. El guardia de salida del agente (fase posterior)
// rechazará cualquier número que no salga de estas tablas — por eso la captura
// es una pantalla y no una llamada al modelo.
//
// La PÓLIZA es el dato que más vale en un siniestro: el 800 de siniestros de
// la aseguradora. Likida NUNCA marca por su cuenta (una llamada automática
// abre un siniestro, que es dinero y acto jurídico) — el escalamiento le pone
// el número en la mano a quien SÍ puede marcar.
//
// El CONTACTO DE EMERGENCIA del operador guarda a un familiar que nunca
// aceptó ningún aviso de privacidad: `avisar_si_lesionados` nace en false y
// solo la flota lo activa, contacto por contacto. Likida tampoco le marca al
// familiar — con lesionados, el dato viaja al DUEÑO, que decide.
// ═══════════════════════════════════════════════════════════════════════════

export const TIPOS_PROVEEDOR = ['grua', 'llantera', 'mecanico', 'medico', 'otro'] as const;
export type TipoProveedor = typeof TIPOS_PROVEEDOR[number];

export interface ProveedorEmergencia {
  id: string;
  tipo: TipoProveedor;
  nombre: string;
  telefono: string;
  /** Posición del proveedor (Capa C): con ella y la del incidente, la cascada
   *  mide cercanía real. NULL = sin capturar — se lista sin ordenar y se dice. */
  lat: number | null;
  lng: number | null;
  radioKm: number | null;
  /** NULL = capturado pero SIN confirmar por teléfono — el rótulo lo dice. */
  verificadoEn: string | null;
  notas: string | null;
}

export interface FlotaPoliza {
  id: string;
  aseguradora: string;
  numeroPoliza: string;
  telefonoSiniestros: string;
  vigenciaHasta: string | null;
}

export interface ContactoEmergencia {
  id: string;
  operadorId: string;
  nombre: string;
  telefono: string;
  parentesco: string | null;
  avisarSiLesionados: boolean;
}

/** E.164 laxa: 10 a 15 dígitos, `+` opcional. No se corrige ni se adivina —
 *  un teléfono de emergencia mal capturado se rechaza en la captura, no se
 *  descubre a las 3 a.m. cuando el gruero no contesta. */
export function telefonoValido(t: unknown): t is string {
  return typeof t === 'string' && /^\+?\d{10,15}$/.test(t.replace(/[\s-]/g, ''));
}

const limpiarTel = (t: string): string => t.replace(/[\s-]/g, '');

// ── Proveedores ────────────────────────────────────────────────────────────

export async function listarProveedoresEmergencia(tenantId: string): Promise<ProveedorEmergencia[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('proveedor_emergencia')
    .select('id, tipo, nombre, telefono, lat, lng, radio_km, verificado_en, notas')
    .eq('tenant_id', tenantId)
    .order('tipo').order('nombre'), 'emergencias.proveedores');
  if (error) throw new Error(`listarProveedoresEmergencia: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    tipo: f.tipo as TipoProveedor,
    nombre: f.nombre as string,
    telefono: f.telefono as string,
    lat: f.lat == null ? null : Number(f.lat),
    lng: f.lng == null ? null : Number(f.lng),
    radioKm: f.radio_km == null ? null : Number(f.radio_km),
    verificadoEn: (f.verificado_en as string) ?? null,
    notas: (f.notas as string) ?? null,
  }));
}

export async function crearProveedorEmergencia(tenantId: string, p: {
  tipo: string; nombre: string; telefono: string; lat?: number | null; lng?: number | null; radioKm?: number | null; notas?: string | null;
}): Promise<string> {
  if (!(TIPOS_PROVEEDOR as readonly string[]).includes(p.tipo)) {
    throw new Error('Ese tipo de proveedor no existe.');
  }
  const nombre = p.nombre.trim();
  if (!nombre || nombre.length > 120) throw new Error('El nombre es obligatorio (máx. 120 caracteres).');
  if (!telefonoValido(p.telefono)) throw new Error('El teléfono no se ve completo — 10 dígitos mínimo, solo números.');
  // La posición viaja en pareja o no viaja: una lat sin lng no ubica nada, y
  // guardarla a medias haría que la cascada "midiera" contra media coordenada.
  // Lo capturado-pero-ilegible se RECHAZA, no se descarta en silencio.
  if ((p.lat != null && !Number.isFinite(p.lat)) || (p.lng != null && !Number.isFinite(p.lng))) {
    throw new Error('La posición no se ve como números — usa decimales, ej. 19.4326 y -99.1332.');
  }
  const conLat = p.lat != null;
  const conLng = p.lng != null;
  if (conLat !== conLng) throw new Error('La posición necesita latitud Y longitud (o ninguna de las dos).');
  if (conLat && (Math.abs(p.lat as number) > 90 || Math.abs(p.lng as number) > 180)) {
    throw new Error('Esa posición no existe en el mapa — revisa latitud y longitud.');
  }
  const { data, error } = await acotada(supabaseAdmin().from('proveedor_emergencia').insert({
    tenant_id: tenantId,
    tipo: p.tipo,
    nombre,
    telefono: limpiarTel(p.telefono),
    lat: conLat ? p.lat : null,
    lng: conLng ? p.lng : null,
    radio_km: p.radioKm ?? null,
    notas: p.notas?.trim() || null,
    // `verificado_en` queda NULL a propósito: capturar no es verificar. La
    // verificación (marcar y confirmar que contestan) es un acto aparte.
  }).select('id').single(), 'emergencias.crearProveedor');
  if (error) throw new Error(`crearProveedorEmergencia: ${error.message}`);
  return (data as { id: string }).id;
}

/** Marca el proveedor como verificado POR ALGUIEN: quien aprieta el botón
 *  afirma que marcó y le contestaron. Sin ese acto el agente lo rotula
 *  "sin confirmar". */
export async function marcarProveedorVerificado(tenantId: string, proveedorId: string, porUserId: string | null): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('proveedor_emergencia')
    .update({ verificado_en: new Date().toISOString(), verificado_por: porUserId })
    .eq('id', proveedorId).eq('tenant_id', tenantId), 'emergencias.verificarProveedor');
  if (error) throw new Error(`marcarProveedorVerificado: ${error.message}`);
}

export async function borrarProveedorEmergencia(tenantId: string, proveedorId: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('proveedor_emergencia')
    .delete().eq('id', proveedorId).eq('tenant_id', tenantId), 'emergencias.borrarProveedor');
  if (error) throw new Error(`borrarProveedorEmergencia: ${error.message}`);
}

// ── Póliza ─────────────────────────────────────────────────────────────────

/** La póliza más reciente de la flota. Cada guardado inserta una fila nueva
 *  (la historia se conserva: en un siniestro, saber QUÉ póliza estaba
 *  capturada ese día importa); esta lee la vigente. */
export async function polizaVigenteDe(tenantId: string): Promise<FlotaPoliza | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('flota_poliza')
    .select('id, aseguradora, numero_poliza, telefono_siniestros, vigencia_hasta')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1), 'emergencias.poliza');
  if (error) throw new Error(`polizaVigenteDe: ${error.message}`);
  const f = (data ?? [])[0];
  if (!f) return null;
  return {
    id: f.id as string,
    aseguradora: f.aseguradora as string,
    numeroPoliza: f.numero_poliza as string,
    telefonoSiniestros: f.telefono_siniestros as string,
    vigenciaHasta: (f.vigencia_hasta as string) ?? null,
  };
}

export async function guardarPoliza(tenantId: string, p: {
  aseguradora: string; numeroPoliza: string; telefonoSiniestros: string; vigenciaHasta?: string | null;
}): Promise<void> {
  const aseguradora = p.aseguradora.trim();
  const numero = p.numeroPoliza.trim();
  if (!aseguradora || aseguradora.length > 120) throw new Error('La aseguradora es obligatoria.');
  if (!numero || numero.length > 80) throw new Error('El número de póliza es obligatorio.');
  if (!telefonoValido(p.telefonoSiniestros)) {
    throw new Error('El 800 de siniestros no se ve completo — es EL dato que se necesita en un siniestro, revísalo.');
  }
  const { error } = await acotada(supabaseAdmin().from('flota_poliza').insert({
    tenant_id: tenantId,
    aseguradora,
    numero_poliza: numero,
    telefono_siniestros: limpiarTel(p.telefonoSiniestros),
    vigencia_hasta: p.vigenciaHasta || null,
  }), 'emergencias.guardarPoliza');
  if (error) throw new Error(`guardarPoliza: ${error.message}`);
}

// ── Contactos de emergencia del operador ───────────────────────────────────

export async function listarContactosEmergencia(tenantId: string): Promise<Array<ContactoEmergencia & { operadorNombre: string }>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('contacto_emergencia')
    .select('id, operador_id, nombre, telefono, parentesco, avisar_si_lesionados, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId)
    .order('created_at'), 'emergencias.contactos');
  if (error) throw new Error(`listarContactosEmergencia: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    operadorId: f.operador_id as string,
    nombre: f.nombre as string,
    telefono: f.telefono as string,
    parentesco: (f.parentesco as string) ?? null,
    avisarSiLesionados: Boolean(f.avisar_si_lesionados),
    operadorNombre: ((f.operador as { nombre?: string } | null)?.nombre as string) ?? '(operador)',
  }));
}

/** El contacto marcado `avisar_si_lesionados` de UN operador — lo que el
 *  escalamiento le pone en la mano al dueño cuando hay lesionados. */
export async function contactoSiLesionadosDe(tenantId: string, operadorId: string): Promise<ContactoEmergencia | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('contacto_emergencia')
    .select('id, operador_id, nombre, telefono, parentesco, avisar_si_lesionados')
    .eq('tenant_id', tenantId).eq('operador_id', operadorId)
    .eq('avisar_si_lesionados', true)
    .limit(1), 'emergencias.contactoLesionados');
  if (error) throw new Error(`contactoSiLesionadosDe: ${error.message}`);
  const f = (data ?? [])[0];
  if (!f) return null;
  return {
    id: f.id as string,
    operadorId: f.operador_id as string,
    nombre: f.nombre as string,
    telefono: f.telefono as string,
    parentesco: (f.parentesco as string) ?? null,
    avisarSiLesionados: true,
  };
}

export async function crearContactoEmergencia(tenantId: string, c: {
  operadorId: string; nombre: string; telefono: string; parentesco?: string | null; avisarSiLesionados?: boolean;
}): Promise<string> {
  // El candado de tenant ANTES de insertar (patrón crearIncidencia): el
  // operador referido tiene que ser de ESTA flota — la FK compuesta de la
  // 0198 lo exige en base, pero rebotar aquí da un mensaje que una persona
  // entiende, no un error de constraint.
  const { data: op, error: errOp } = await acotada(supabaseAdmin()
    .from('operador').select('id')
    .eq('id', c.operadorId).eq('tenant_id', tenantId)
    .maybeSingle(), 'emergencias.operadorPropio');
  if (errOp) throw new Error(`crearContactoEmergencia: ${errOp.message}`);
  if (!op) throw new Error('Ese operador no pertenece a esta flota.');

  const nombre = c.nombre.trim();
  if (!nombre || nombre.length > 120) throw new Error('El nombre del contacto es obligatorio.');
  if (!telefonoValido(c.telefono)) throw new Error('El teléfono del contacto no se ve completo.');

  const { data, error } = await acotada(supabaseAdmin().from('contacto_emergencia').insert({
    tenant_id: tenantId,
    operador_id: c.operadorId,
    nombre,
    telefono: limpiarTel(c.telefono),
    parentesco: c.parentesco?.trim() || null,
    // false salvo activación EXPLÍCITA: el familiar nunca aceptó nada.
    avisar_si_lesionados: c.avisarSiLesionados === true,
  }).select('id').single(), 'emergencias.crearContacto');
  if (error) throw new Error(`crearContactoEmergencia: ${error.message}`);
  return (data as { id: string }).id;
}

export async function borrarContactoEmergencia(tenantId: string, contactoId: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('contacto_emergencia')
    .delete().eq('id', contactoId).eq('tenant_id', tenantId), 'emergencias.borrarContacto');
  if (error) throw new Error(`borrarContactoEmergencia: ${error.message}`);
}
