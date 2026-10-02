import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { enviarConFallback } from '@/lib/meta/enviar_con_fallback';
import { enviarCorreo } from '@/lib/correo/enviar';
import { destinatariosEscalacion } from '../conductor/escalamiento';
import { asientosDeJornada, leerPolitica } from './repo';
import type {
  ConfigAlerta, PuertosAlerta, FilaCandidata, NivelAlerta, CanalEncargado, CanalOperador,
} from './alerta_tope';

// ═══════════════════════════════════════════════════════════════════════════
// LOS PUERTOS REALES DE LA ALERTA DE TOPE (base, WhatsApp y correo) y la
// configuración por flota. Cada consulta por flota lleva `.eq('tenant_id')`; la
// única que cruza flotas es la RPC `jornadas_en_curso_para_alerta` (solo las
// flotas con la alerta ENCENDIDA).
// ═══════════════════════════════════════════════════════════════════════════

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function aConfig(f: Record<string, unknown>): ConfigAlerta {
  return {
    tenantId: String(f.tenant_id),
    topeHoras: num(f.tope_horas),
    umbralAvisoPct: Number(f.umbral_aviso_pct ?? 80),
    umbralCriticoPct: Number(f.umbral_critico_pct ?? 95),
    canalEncargado: (f.canal_encargado as CanalEncargado) ?? 'whatsapp',
    canalOperador: (f.canal_operador as CanalOperador) ?? 'whatsapp',
    correoEncargado: (f.correo_encargado as string | null) ?? null,
  };
}

export const puertosAlertaReales: PuertosAlerta = {
  async candidatas(ahora, limite) {
    const { data, error } = await acotada(
      supabaseAdmin().rpc('jornadas_en_curso_para_alerta', { p_ahora: ahora.toISOString(), p_limite: limite }),
      'jornada.alerta.candidatas',
    );
    if (error) throw new Error(`jornada.alerta.candidatas: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('jornada.alerta.candidatas: respuesta inválida (¿migración 0502 sin aplicar?)');
    const filas: FilaCandidata[] = (data as Array<Record<string, unknown>>).map((f) => ({
      tenantId: String(f.tenant_id), jornadaId: String(f.jornada_id), operadorId: String(f.operador_id), dia: String(f.dia),
      config: aConfig(f),
    }));
    return { filas, hayMas: filas.length >= limite };
  },
  asientos: asientosDeJornada,
  politica: leerPolitica,
  async operador(tenantId, operadorId) {
    const { data, error } = await acotada(
      supabaseAdmin().from('operador').select('nombre, telefono, terminal_id, activo')
        .eq('tenant_id', tenantId).eq('id', operadorId).maybeSingle(),
      'jornada.alerta.operador',
    );
    if (error) throw new Error(`jornada.alerta.operador: ${error.message}`);
    if (!data) return null;
    // Un operador dado de baja no recibe avisos (pero su expediente sigue siendo evaluable).
    return { nombre: String(data.nombre ?? ''), telefono: data.activo === false ? null : (data.telefono as string | null) ?? null, terminalId: (data.terminal_id as string | null) ?? null };
  },
  encargados: (tenantId, terminalId) => destinatariosEscalacion(tenantId, terminalId, 1),
  async reclamar(a) {
    const { data, error } = await acotada(supabaseAdmin().rpc('reclamar_jornada_alerta', {
      p_tenant: a.tenantId, p_jornada: a.jornadaId, p_nivel: a.nivel, p_minutos: a.minutos, p_tope: a.topeMin,
      p_cota: a.cota, p_fuente: a.fuente, p_descanso_abierto: a.descansoSinCierre, p_ahora: a.ahora.toISOString(),
    }), 'jornada.alerta.reclamar');
    if (error) { logger.error('jornada.alerta_reclamar_fallo', { err: error.message }); return 'fallo'; }
    const fila = (Array.isArray(data) ? data[0] : data) as { alerta_id?: string; claim_token?: string } | null | undefined;
    return fila?.alerta_id && fila.claim_token ? { id: fila.alerta_id, token: fila.claim_token } : null;
  },
  async cerrar(a) {
    const { data, error } = await acotada(supabaseAdmin().rpc('cerrar_jornada_alerta', {
      p_tenant: a.tenantId, p_id: a.reclamo.id, p_claim: a.reclamo.token, p_estado: a.estado,
      p_enc_canal: a.encargado.canal, p_enc_estado: a.encargado.estado, p_enc_motivo: a.encargado.motivo,
      p_op_canal: a.operador.canal, p_op_estado: a.operador.estado, p_op_motivo: a.operador.motivo,
      p_ahora: a.ahora.toISOString(),
    }), 'jornada.alerta.cerrar');
    if (error) throw new Error(`jornada.alerta.cerrar: ${error.message}`);
    return data === true;
  },
  async liberar(tenantId, reclamo) {
    const { data, error } = await acotada(
      supabaseAdmin().rpc('liberar_jornada_alerta', { p_tenant: tenantId, p_id: reclamo.id, p_claim: reclamo.token }),
      'jornada.alerta.liberar',
    );
    if (error) { logger.error('jornada.alerta_liberar_fallo', { err: error.message }); return false; }
    return data === true;
  },
  async enviarWa(telefono, msg, tenantId, ahora, contexto) {
    const e = await enviarConFallback(telefono, { texto: msg.texto, plantilla: msg.plantilla, contexto, tenantId, ahora });
    return e.ok ? { ok: true, reintentable: false } : { ok: false, reintentable: e.reintentable, motivo: e.mensaje };
  },
  async enviarCorreo(para, correo) {
    const e = await enviarCorreo(para, correo);
    return e.ok ? { ok: true, reintentable: false } : { ok: false, reintentable: e.motivo === 'red', motivo: e.motivo === 'sin_configurar' ? 'el correo no está configurado en este entorno' : `correo ${e.motivo}` };
  },
  appUrl,
};

// ── Configuración por flota ────────────────────────────────────────────────

export async function leerConfigAlerta(tenantId: string): Promise<ConfigAlerta & { activa: boolean } | null> {
  const { data, error } = await acotada(
    supabaseAdmin().from('jornada_alerta_config')
      .select('tenant_id, activa, tope_horas, umbral_aviso_pct, umbral_critico_pct, canal_encargado, canal_operador, correo_encargado')
      .eq('tenant_id', tenantId).maybeSingle(),
    'jornada.alerta.config',
  );
  if (error) throw new Error(`jornada.alerta.config: ${error.message}`);
  return data ? { ...aConfig(data as Record<string, unknown>), activa: (data as { activa: boolean }).activa === true } : null;
}

export const EntradaConfigAlerta = z.object({
  activa: z.boolean(),
  topeHoras: z.number().gt(0).max(12).nullable(),
  umbralAvisoPct: z.number().int().min(1).max(98),
  umbralCriticoPct: z.number().int().min(2).max(99),
  canalEncargado: z.enum(['whatsapp', 'correo', 'ambos', 'ninguno']),
  canalOperador: z.enum(['whatsapp', 'ninguno']),
  correoEncargado: z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/).nullable(),
}).refine((v) => v.umbralAvisoPct < v.umbralCriticoPct, { message: 'El umbral de aviso debe ser menor que el crítico', path: ['umbralAvisoPct'] })
  .refine((v) => (v.canalEncargado !== 'correo' && v.canalEncargado !== 'ambos') || v.correoEncargado !== null, { message: 'Con canal de correo hace falta la dirección del encargado', path: ['correoEncargado'] });
export type EntradaConfigAlertaT = z.infer<typeof EntradaConfigAlerta>;

/** Valida y guarda (upsert por flota). Devuelve el primer motivo de rechazo en palabras, o `null` si guardó. */
export async function guardarConfigAlerta(tenantId: string, entrada: unknown, actor: { id?: string; email: string }): Promise<string | null> {
  const v = EntradaConfigAlerta.safeParse(entrada);
  if (!v.success) return v.error.issues[0]?.message ?? 'Configuración inválida';
  const c = v.data;
  const { error } = await acotada(
    supabaseAdmin().from('jornada_alerta_config').upsert({
      tenant_id: tenantId, activa: c.activa, tope_horas: c.topeHoras, umbral_aviso_pct: c.umbralAvisoPct,
      umbral_critico_pct: c.umbralCriticoPct, canal_encargado: c.canalEncargado, canal_operador: c.canalOperador,
      correo_encargado: c.correoEncargado, declarada_por: actor.id ?? null, declarada_por_email: actor.email,
      actualizada_en: new Date().toISOString(),
    }, { onConflict: 'tenant_id' }),
    'jornada.alerta.guardar_config',
  );
  if (error) { logger.error('jornada.alerta_config_no_guardada', { tenantId, err: error.message }); return 'No se pudo guardar la configuración. Vuelve a intentar.'; }
  return null;
}

// ── Lectura para el tablero y la exportación ───────────────────────────────

export interface AlertaDeJornada {
  jornadaId: string; nivel: NivelAlerta; minutos: number; topeMin: number; cotaInferior: boolean;
  fuente: string; estado: string; encargadoEstado: string; operadorEstado: string; creadaEn: string;
}

/** Las alertas de un conjunto de jornadas (por id), de ESTA flota. Lanza si la base no contesta. */
export async function alertasDeJornadas(tenantId: string, jornadaIds: readonly string[]): Promise<AlertaDeJornada[]> {
  const salida: AlertaDeJornada[] = [];
  for (let i = 0; i < jornadaIds.length; i += 150) {
    const { data, error } = await acotada(
      supabaseAdmin().from('jornada_alerta')
        .select('jornada_id, nivel, minutos_registrados, tope_minutos, cota_inferior, fuente, estado, encargado_estado, operador_estado, creada_en')
        .eq('tenant_id', tenantId).in('jornada_id', jornadaIds.slice(i, i + 150)).order('creada_en').range(0, 999),
      'jornada.alerta.de_jornadas',
    );
    if (error) throw new Error(`jornada.alerta.de_jornadas: ${error.message}`);
    for (const f of data ?? []) {
      salida.push({
        jornadaId: String(f.jornada_id), nivel: f.nivel as NivelAlerta, minutos: Number(f.minutos_registrados), topeMin: Number(f.tope_minutos),
        cotaInferior: f.cota_inferior === true, fuente: String(f.fuente), estado: String(f.estado),
        encargadoEstado: String(f.encargado_estado), operadorEstado: String(f.operador_estado), creadaEn: String(f.creada_en),
      });
    }
  }
  return salida;
}
