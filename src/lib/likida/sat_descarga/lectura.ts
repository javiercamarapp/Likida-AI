// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LA PANTALLA DE «DESCARGA DEL SAT» NECESITA SABER (0231).
//
// Todo lo de aquí distingue NULL de CERO, porque en esta pantalla los dos
// existen y significan cosas opuestas: "no se ha descargado nunca" no es "se
// descargó y no había nada", y "no se pudo leer" no es "no hay". Colapsarlos
// haría que una conexión rota se leyera como un buzón vacío — el modo de falla
// más caro que tiene esta feature, porque nadie va a revisar lo que el panel
// declara en orden.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';

export interface ConfigFlotaVista {
  rfc: string;
  proveedor: string;
  modo: string;
  certificadoNumero: string | null;
  certificadoVenceEn: string | null;
  verificadaEn: string | null;
  ultimaDescargaHasta: string | null;
  peajeDiasAviso: number;
  activa: boolean;
}

export interface SolicitudVista {
  id: string;
  requestId: string | null;
  tipo: string;
  desde: string;
  hasta: string;
  estado: string;
  cfdisNuevos: number | null;
  mensaje: string | null;
  solicitadaEn: string;
}

export interface ConteosVista {
  descargados: number;
  casados: number;
  ambiguos: number;
  disponibles: number;
}

export interface VistaDescargaSat {
  /** `null` = esta flota NUNCA declaró su descarga; NO es "está apagada". */
  config: ConfigFlotaVista | null;
  solicitudes: SolicitudVista[];
  /** `null` cuando la consulta falló: la pantalla lo dice en vez de pintar 0. */
  conteos: ConteosVista | null;
  /** `true` si alguna lectura se cayó — la pantalla avisa que está incompleta. */
  incompleta: boolean;
}

export async function leerDescargaSat(tenantId: string): Promise<VistaDescargaSat> {
  let incompleta = false;

  let config: ConfigFlotaVista | null = null;
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from('sat_descarga_config')
      .select('rfc, proveedor, modo, certificado_numero, certificado_vence_en, verificada_en, ultima_descarga_hasta, peaje_dias_aviso, activa')
      .eq('tenant_id', tenantId)
      .maybeSingle(), 'sat_descarga.leer_config');
    if (error) throw new Error(error.message);
    config = data === null ? null : {
      rfc: data.rfc as string,
      proveedor: data.proveedor as string,
      modo: data.modo as string,
      certificadoNumero: (data.certificado_numero as string) || null,
      certificadoVenceEn: (data.certificado_vence_en as string) || null,
      verificadaEn: (data.verificada_en as string) || null,
      ultimaDescargaHasta: (data.ultima_descarga_hasta as string) || null,
      peajeDiasAviso: Number(data.peaje_dias_aviso),
      activa: Boolean(data.activa),
    };
  } catch (e) {
    // Un error de lectura NO es "sin configurar": confundirlos invita a
    // recapturar encima de una conexión que ya existe (patrón perfil-erp).
    incompleta = true;
    logger.warn('sat_descarga.config_no_leida', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  let solicitudes: SolicitudVista[] = [];
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from('sat_descarga_solicitud')
      .select('id, request_id, tipo, desde, hasta, estado, cfdis_nuevos, proveedor_mensaje, solicitada_en')
      .eq('tenant_id', tenantId)
      .order('solicitada_en', { ascending: false })
      .limit(12), 'sat_descarga.leer_solicitudes');
    if (error) throw new Error(error.message);
    solicitudes = (data ?? []).map((s) => ({
      id: s.id as string,
      requestId: (s.request_id as string) || null,
      tipo: s.tipo as string,
      desde: s.desde as string,
      hasta: s.hasta as string,
      estado: s.estado as string,
      // NULL = no se ha ingerido; 0 = se ingirió y no había nada.
      cfdisNuevos: s.cfdis_nuevos === null ? null : Number(s.cfdis_nuevos),
      mensaje: (s.proveedor_mensaje as string) || null,
      solicitadaEn: s.solicitada_en as string,
    }));
  } catch (e) {
    incompleta = true;
    logger.warn('sat_descarga.solicitudes_no_leidas', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  let conteos: ConteosVista | null = null;
  try {
    // SE CUENTA EN LA BASE, NO EN JAVASCRIPT (0236, c7-27). Antes se traían
    // hasta 20,000 `estatus` y se contaban aquí: una flota con 45,000
    // comprobantes —y la 0231 dice que el modo webservice trae 200,000 CFDI
    // por petición— leía las CUATRO cifras falsas, con `incompleta` en false
    // porque no había habido ningún error. Sólo un `.limit()`. Una cifra
    // truncada que no se declara truncada es una cifra inventada.
    const { data, error } = await acotada(supabaseAdmin()
      .rpc('sat_descarga_conteos', { p_tenant: tenantId }), 'sat_descarga.conteos');
    if (error) throw new Error(error.message);
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila === undefined || fila === null) throw new Error('la consulta de conteos no devolvió ninguna fila');
    conteos = {
      descargados: Number(fila.descargados),
      casados: Number(fila.casados),
      ambiguos: Number(fila.ambiguos),
      disponibles: Number(fila.disponibles),
    };
  } catch (e) {
    incompleta = true;
    logger.warn('sat_descarga.conteos_no_leidos', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  return { config, solicitudes, conteos, incompleta };
}
