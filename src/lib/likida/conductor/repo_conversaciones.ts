import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerPorIds } from '../pg';
import { cargarContactosTrafico } from './repo';
import { telefonoAlcanzable } from './preflight_piloto';
import { TIPOS_HITO, type TipoHito } from './tipos';
import type { AvisoHilo, ContactoAtencion, EscalacionHilo, EventoHilo, HitoEstadoConv, HitoHilo, ValidacionHilo, ViajeConv } from './conversaciones';
import { contactosDeAtencion } from './conversaciones';

// ═══════════════════════════════════════════════════════════════════════════
// LECTORES DE «CONVERSACIONES». Solo LEEN, siempre de UN tenant, y LANZAN si la base no contesta (una base caída no es «no hay
// conversaciones»). Sin tablas nuevas: viaje, viaje_hito, viaje_hito_aviso, viaje_hito_validacion, viaje_hito_evento,
// orquestador_escalacion y conductor_contacto_trafico.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIVOS = ['abierto', 'en_cuadre'];
const esTipo = (v: unknown): v is TipoHito => (TIPOS_HITO as readonly string[]).includes(String(v));

/** Techo de cada lectura de la lista. Si se rebasa, la pantalla lo dice (no esconde el resto). */
export const TOPE_CONVERSACIONES = 300;
const TOPE_SIN_AVISO = 200;

const COLUMNAS = 'id, folio, origen, destino, operador_id, terminal_id, avisado_en, aceptado_en, aceptado_origen, escalado_en, avisos_enviados, cita_origen_en, cita_destino_en, operador:operador_id(nombre, telefono), terminal:terminal_id(nombre)';

const nombreDe = (rel: unknown): string | null => {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return r && typeof r === 'object' && typeof (r as { nombre?: unknown }).nombre === 'string' ? (r as { nombre: string }).nombre : null;
};
function sinTelefonoDe(rel: unknown): boolean | null {
  const r = Array.isArray(rel) ? rel[0] : rel;
  if (!r || typeof r !== 'object' || !('telefono' in r)) return null;
  const tel = (r as { telefono?: unknown }).telefono;
  return typeof tel !== 'string' || !telefonoAlcanzable(tel);
}

export function filaAViajeConv(f: Fila): ViajeConv {
  return {
    id: String(f.id), folio: s(f.folio), origen: s(f.origen), destino: s(f.destino), operadorId: String(f.operador_id),
    operadorNombre: nombreDe(f.operador), terminalId: s(f.terminal_id), terminalNombre: nombreDe(f.terminal),
    avisadoEn: s(f.avisado_en), aceptadoEn: s(f.aceptado_en), aceptadoOrigen: s(f.aceptado_origen), escaladoEn: s(f.escalado_en),
    avisosEnviados: num(f.avisos_enviados) ?? 0, citaOrigenEn: s(f.cita_origen_en), citaDestinoEn: s(f.cita_destino_en),
    operadorSinTelefono: sinTelefonoDe(f.operador),
  };
}

export interface FiltrosConv { terminalId?: string; operadorId?: string }

export interface DatosLista { viajes: ViajeConv[]; hitos: HitoEstadoConv[]; hayMas: boolean }

/**
 * Los viajes vivos a los que el agente ya les escribió (`avisado_en`), más los vivos sin aviso cuyo operador no tiene un
 * teléfono al que escribir (esos nunca se avisan y son justo los que tráfico debe ver). Con sus hitos (solo estado).
 */
export async function leerListaConversaciones(tenantId: string, f: FiltrosConv = {}): Promise<DatosLista> {
  const base = () => {
    let q = supabaseAdmin().from('viaje').select(COLUMNAS).eq('tenant_id', tenantId).in('estatus', VIVOS);
    if (f.terminalId && UUID.test(f.terminalId)) q = q.eq('terminal_id', f.terminalId);
    if (f.operadorId && UUID.test(f.operadorId)) q = q.eq('operador_id', f.operadorId);
    return q;
  };
  const [avisados, sinAviso] = await Promise.all([
    acotada(base().not('avisado_en', 'is', null).order('avisado_en', { ascending: true }).order('id').limit(TOPE_CONVERSACIONES + 1), 'conversaciones.avisados'),
    acotada(base().is('avisado_en', null).order('id').limit(TOPE_SIN_AVISO + 1), 'conversaciones.sin_aviso'),
  ]);
  const a = (exigir(avisados as never, 'conversaciones.avisados') ?? []) as unknown as Fila[];
  const b = (exigir(sinAviso as never, 'conversaciones.sin_aviso') ?? []) as unknown as Fila[];
  const hayMas = a.length > TOPE_CONVERSACIONES || b.length > TOPE_SIN_AVISO;
  const viajes = [...a.slice(0, TOPE_CONVERSACIONES), ...b.slice(0, TOPE_SIN_AVISO)].map(filaAViajeConv);
  const ids = viajes.map((v) => v.id);
  const hs = ids.length === 0 ? [] : await traerPorIds<Fila>(ids, (t) => acotada(supabaseAdmin()
    .from('viaje_hito').select('viaje_id, tipo, estado').eq('tenant_id', tenantId).in('viaje_id', t), 'conversaciones.hitos') as never, 'conversaciones.hitos');
  const hitos: HitoEstadoConv[] = hs.filter((h) => esTipo(h.tipo)).map((h) => ({ viajeId: String(h.viaje_id), tipo: h.tipo as TipoHito, estado: String(h.estado) }));
  return { viajes, hitos, hayMas };
}

export interface DatosConversacion {
  viaje: ViajeConv;
  hitos: HitoHilo[];
  avisos: AvisoHilo[];
  validaciones: ValidacionHilo[];
  eventos: EventoHilo[];
  escalaciones: EscalacionHilo[];
  atencion: ContactoAtencion[];
}

/** El hilo de UN viaje de la flota; `null` si el viaje no es de esta flota (o no existe). */
export async function leerConversacion(tenantId: string, viajeId: string): Promise<DatosConversacion | null> {
  if (!UUID.test(viajeId)) return null;
  // orden-no-importa: filtra por `id` exacto, la consulta ya deja una sola fila
  const rv = await acotada(supabaseAdmin().from('viaje').select(COLUMNAS).eq('tenant_id', tenantId).eq('id', viajeId).limit(1), 'conversaciones.viaje');
  const fv = ((exigir(rv as never, 'conversaciones.viaje') ?? []) as unknown as Fila[])[0];
  if (!fv) return null;
  const viaje = filaAViajeConv(fv);
  const [rh, ra, rval, rev, resc, contactos] = await Promise.all([
    acotada(supabaseAdmin().from('viaje_hito')
      .select('id, tipo, estado, fuente, mensaje_en, recibido_en, texto_chofer, lat, lng, evidencia_ruta, contacto_nombre, sin_contacto, validado_en, validado_por, omitido_motivo, escalado_en, escalacion_nivel, escalacion_atendida_en')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('created_at', { ascending: true }).order('id').limit(20), 'conversaciones.hitos_viaje'),
    acotada(supabaseAdmin().from('viaje_hito_aviso')
      .select('id, viaje_hito_id, clase, nivel, ok, canal, motivo, destinatario_ult4, created_at')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('created_at', { ascending: true }).order('id').limit(200), 'conversaciones.avisos'),
    acotada(supabaseAdmin().from('viaje_hito_validacion')
      .select('viaje_hito_id, resultado, motivo, fuente, distancia_m, tolerancia_m, radio_m, medida_en, created_at')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('created_at', { ascending: true }).order('id').limit(50), 'conversaciones.validaciones'),
    acotada(supabaseAdmin().from('viaje_hito_evento')
      .select('id, tipo_hito, evento, created_at')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('id').limit(200), 'conversaciones.eventos'),
    acotada(supabaseAdmin().from('orquestador_escalacion')
      .select('id, destino, motivo, estado, resumen, creada_en, atendida_en, nota_atencion')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('creada_en', { ascending: true }).order('id').limit(50), 'conversaciones.escalaciones'),
    cargarContactosTrafico(tenantId),
  ]);
  const filasHito = (exigir(rh as never, 'conversaciones.hitos_viaje') ?? []) as unknown as Fila[];
  const hitos: HitoHilo[] = filasHito.filter((h) => esTipo(h.tipo)).map((h) => ({
    id: String(h.id), tipo: h.tipo as TipoHito, estado: String(h.estado), fuente: s(h.fuente), mensajeEn: s(h.mensaje_en), recibidoEn: s(h.recibido_en),
    texto: s(h.texto_chofer), lat: num(h.lat), lng: num(h.lng), conFoto: s(h.evidencia_ruta) !== null, contacto: s(h.contacto_nombre), sinContacto: h.sin_contacto === true,
    validadoEn: s(h.validado_en), validadoPor: s(h.validado_por), omitidoMotivo: s(h.omitido_motivo), escaladoEn: s(h.escalado_en),
    escalacionNivel: num(h.escalacion_nivel) ?? 0, atendidaEn: s(h.escalacion_atendida_en),
  }));
  const tipoDe = new Map(hitos.map((h) => [h.id, h.tipo] as const));
  const avisos: AvisoHilo[] = ((exigir(ra as never, 'conversaciones.avisos') ?? []) as unknown as Fila[]).map((a) => ({
    id: String(a.id), hitoTipo: tipoDe.get(String(a.viaje_hito_id)) ?? null, clase: String(a.clase), nivel: num(a.nivel) ?? 0,
    ok: typeof a.ok === 'boolean' ? a.ok : null, canal: s(a.canal), motivo: s(a.motivo), ult4: s(a.destinatario_ult4), en: String(a.created_at),
  }));
  const validaciones: ValidacionHilo[] = ((exigir(rval as never, 'conversaciones.validaciones') ?? []) as unknown as Fila[]).map((x) => ({
    hitoId: String(x.viaje_hito_id), resultado: x.resultado === 'validado' || x.resultado === 'sin_coincidencia' ? x.resultado : 'sin_dato', motivo: s(x.motivo), fuente: s(x.fuente),
    distanciaM: num(x.distancia_m), toleranciaM: num(x.tolerancia_m) ?? 0, radioM: num(x.radio_m), medidaEn: s(x.medida_en), en: String(x.created_at),
  }));
  const eventos: EventoHilo[] = ((exigir(rev as never, 'conversaciones.eventos') ?? []) as unknown as Fila[]).filter((x) => esTipo(x.tipo_hito)).map((x) => ({
    id: Number(x.id), hitoTipo: x.tipo_hito as TipoHito, evento: String(x.evento), en: String(x.created_at),
  }));
  const escalaciones: EscalacionHilo[] = ((exigir(resc as never, 'conversaciones.escalaciones') ?? []) as unknown as Fila[]).map((x) => ({
    id: String(x.id), destino: String(x.destino), motivo: String(x.motivo), estado: x.estado === 'atendida' ? 'atendida' : 'abierta',
    resumen: String(x.resumen), en: String(x.creada_en), atendidaEn: s(x.atendida_en), nota: s(x.nota_atencion),
  }));
  const atencion = contactosDeAtencion(contactos.map((c) => ({ nombre: c.nombre, nivel: c.nivel, terminalId: c.terminalId, ult4: c.telefono.slice(-4) })), viaje.terminalId);
  return { viaje, hitos, avisos, validaciones, eventos, escalaciones, atencion };
}
