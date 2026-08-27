// ═══════════════════════════════════════════════════════════════════════════
// EL FLUJO DE TIMBRE (0226) — quien lee, quien llama al PAC y quien persiste.
//
// El armado del CFDI es puro (carta_porte_cfdi.ts) y el transporte es la capa
// PAC (pac/); este módulo es el ÚNICO escritor de `flota_fiscal`, de los
// datos fiscales del receptor en `cliente` y de `ccp_timbre` — con bitácora.
//
// Las reglas que este archivo hace cumplir:
//   · UN humano aprieta el botón (el actor viaja a bitácora y a la fila);
//     ningún cron llama aquí.
//   · Idempotencia por BASE: el unique parcial (un timbre vigente por viaje)
//     resuelve el doble clic — el perdedor lee el timbre del ganador y lo
//     enseña, no duplica (estándar §7).
//   · Coherencia de ambiente: el `modo` del perfil (sandbox/produccion) debe
//     COINCIDIR con el ambiente del PAC configurado en el entorno. Un timbre
//     "de producción" contra el sandbox sería un papel que no ampara nada
//     con cara de fiscal; el cruce se rechaza con la verdad, en ambos
//     sentidos.
//   · 'red' (sin respuesta del PAC) NO persiste ni reintenta: el timbre pudo
//     emitirse del otro lado — se dice "verifica en el panel del PAC" (la
//     lección c5-3, aplicada aquí desde el día uno).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { getBorradorViaje } from './carta_porte_datos';
import { generarIdCcp } from './carta_porte';
import { armarCfdiTimbrable, type EmisorFiscal, type ReceptorFiscal, type ParametrosEmision } from './carta_porte_cfdi';
import { resolverPac, estadoPac } from './pac';

export interface TimbreVigente {
  uuidFiscal: string;
  fechaTimbrado: string;
  modo: 'sandbox' | 'produccion';
  proveedor: string;
  selloSat: string | null;
}

export interface ContextoTimbre {
  emisor: EmisorFiscal;
  receptor: ReceptorFiscal;
  clienteId: string | null;
  ingresoFlete: number | null;
  timbreVigente: TimbreVigente | null;
  pac: ReturnType<typeof estadoPac>;
}

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Todo lo que la pantalla y el botón necesitan, en una pasada. Lanza si la
 *  base no contesta (error boundary); null = el viaje no es de esta flota. */
export async function leerContextoTimbre(tenantId: string, viajeId: string): Promise<ContextoTimbre | null> {
  const admin = supabaseAdmin();

  const [viaje, perfil, timbre] = await Promise.all([
    acotada(admin.from('viaje')
      .select('id, ingreso_flete, cliente_id, cliente:cliente_id (id, rfc, razon_social, regimen_fiscal, uso_cfdi, cp_fiscal)')
      .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'timbre.viaje'),
    acotada(admin.from('flota_fiscal')
      .select('rfc, razon_social, regimen_fiscal, lugar_expedicion, serie, modo')
      .eq('tenant_id', tenantId).maybeSingle(), 'timbre.perfil'),
    acotada(admin.from('ccp_timbre')
      .select('uuid_fiscal, fecha_timbrado, modo, proveedor, sello_sat')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente').maybeSingle(), 'timbre.vigente'),
  ]);
  if (viaje.error) throw new Error(`leerContextoTimbre/viaje: ${viaje.error.message}`);
  if (perfil.error) throw new Error(`leerContextoTimbre/perfil: ${perfil.error.message}`);
  if (timbre.error) throw new Error(`leerContextoTimbre/timbre: ${timbre.error.message}`);
  if (viaje.data === null) return null;

  const p = (perfil.data ?? null) as Record<string, unknown> | null;
  const c = ((viaje.data as Record<string, unknown>).cliente ?? null) as Record<string, unknown> | null;
  const t = (timbre.data ?? null) as Record<string, unknown> | null;

  return {
    emisor: {
      rfc: txt(p?.rfc), razonSocial: txt(p?.razon_social), regimenFiscal: txt(p?.regimen_fiscal),
      lugarExpedicion: txt(p?.lugar_expedicion), serie: txt(p?.serie),
      modo: p?.modo === 'produccion' ? 'produccion' : 'sandbox',
    },
    receptor: {
      rfc: txt(c?.rfc), razonSocial: txt(c?.razon_social), regimenFiscal: txt(c?.regimen_fiscal),
      usoCfdi: txt(c?.uso_cfdi), cpFiscal: txt(c?.cp_fiscal),
    },
    clienteId: txt(c?.id),
    ingresoFlete: num((viaje.data as Record<string, unknown>).ingreso_flete),
    timbreVigente: t === null ? null : {
      uuidFiscal: String(t.uuid_fiscal),
      fechaTimbrado: String(t.fecha_timbrado),
      modo: t.modo === 'produccion' ? 'produccion' : 'sandbox',
      proveedor: String(t.proveedor),
      selloSat: txt(t.sello_sat),
    },
    pac: estadoPac(),
  };
}

/** El perfil del emisor. Enviar es declarar: cada campo es lo que la
 *  constancia fiscal de la flota dice, no una sugerencia. */
export async function guardarPerfilFiscal(
  tenantId: string,
  campos: { rfc: string | null; razonSocial: string | null; regimenFiscal: string | null; lugarExpedicion: string | null; serie: string | null; modo: 'sandbox' | 'produccion' },
  actor: { id?: string; email?: string },
): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await acotada(admin.from('flota_fiscal').upsert({
    tenant_id: tenantId,
    rfc: campos.rfc, razon_social: campos.razonSocial, regimen_fiscal: campos.regimenFiscal,
    lugar_expedicion: campos.lugarExpedicion, serie: campos.serie, modo: campos.modo,
    actualizado_en: new Date().toISOString(),
    actualizado_por: actor.id ?? null,
  }, { onConflict: 'tenant_id' }), 'timbre.guardarPerfil');
  if (error) {
    // Los CHECK de forma (RFC, régimen, CP) hablan por PostgREST; se traduce
    // al idioma del contador sin perder el original en el log.
    logger.warn('timbre.perfil_rechazado', { error: error.message });
    throw new DatoInvalido('Revisa el formato: RFC de 12-13, régimen de 3 dígitos, CP de 5 dígitos.');
  }
  await anotarBitacora(
    { tenantId, actor, accion: 'timbre.perfil_guardado', entidad: 'tenant', entidadId: tenantId,
      detalle: { rfc: campos.rfc, modo: campos.modo } },
    { evento: 'timbre.bitacora_no_escribio' },
  );
}

/** Los datos fiscales del receptor, sobre el cliente del viaje. */
export async function guardarReceptorFiscal(
  tenantId: string,
  clienteId: string,
  campos: { razonSocial: string | null; regimenFiscal: string | null; usoCfdi: string | null; cpFiscal: string | null },
  actor: { id?: string; email?: string },
): Promise<void> {
  const admin = supabaseAdmin();
  const { data, error } = await acotada(admin.from('cliente').update({
    razon_social: campos.razonSocial, regimen_fiscal: campos.regimenFiscal,
    uso_cfdi: campos.usoCfdi, cp_fiscal: campos.cpFiscal,
  }).eq('tenant_id', tenantId).eq('id', clienteId).select('id'), 'timbre.guardarReceptor');
  if (error) {
    logger.warn('timbre.receptor_rechazado', { error: error.message });
    throw new DatoInvalido('Revisa el formato: régimen de 3 dígitos, uso CFDI tipo G03/S01, CP de 5 dígitos.');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese cliente no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  }
  await anotarBitacora(
    { tenantId, actor, accion: 'timbre.receptor_guardado', entidad: 'cliente', entidadId: clienteId,
      detalle: { usoCfdi: campos.usoCfdi } },
    { evento: 'timbre.bitacora_no_escribio' },
  );
}

export type ResultadoTimbrado =
  | { ok: true; uuid: string; fechaTimbrado: string; modo: 'sandbox' | 'produccion'; yaExistia: boolean }
  | { ok: false; motivo: string; faltantes?: string[] };

/**
 * EL BOTÓN. Lee todo de nuevo (el estado de la pantalla pudo envejecer),
 * arma, llama al PAC y persiste — en ese orden, con la ambigüedad dicha.
 */
export async function timbrarViaje(
  tenantId: string,
  viajeId: string,
  emision: ParametrosEmision,
  actor: { id?: string; email?: string },
): Promise<ResultadoTimbrado> {
  const ctx = await leerContextoTimbre(tenantId, viajeId);
  if (ctx === null) return { ok: false, motivo: 'Ese viaje no está en tu flota.' };

  // Idempotencia de primera puerta (la de segunda es el unique de la base).
  if (ctx.timbreVigente !== null) {
    return { ok: true, uuid: ctx.timbreVigente.uuidFiscal, fechaTimbrado: ctx.timbreVigente.fechaTimbrado, modo: ctx.timbreVigente.modo, yaExistia: true };
  }

  const pac = resolverPac();
  if (pac === null || !ctx.pac.configurado) {
    return { ok: false, motivo: 'No hay PAC configurado (variables LIKIDA_PAC_*). Sin PAC no se timbra — y jamás se simula un timbre.' };
  }
  // Coherencia de ambiente, en ambos sentidos: papel de mentira, no.
  if (ctx.emisor.modo === 'produccion' && ctx.pac.pareceSandbox === true) {
    return { ok: false, motivo: 'Tu perfil de timbrado dice PRODUCCIÓN pero el PAC configurado es el ambiente de pruebas. Ese timbre no ampararía nada — corrige la configuración antes.' };
  }
  if (ctx.emisor.modo === 'sandbox' && ctx.pac.pareceSandbox === false) {
    return { ok: false, motivo: 'Tu perfil de timbrado dice SANDBOX pero el PAC configurado es el de PRODUCCIÓN. Timbrar de verdad exige cambiar el modo del perfil a producción — un timbre real no se dispara por accidente.' };
  }

  const v = await getBorradorViaje(tenantId, viajeId);
  if (v === null) return { ok: false, motivo: 'Ese viaje no está en tu flota.' };

  const idCcp = generarIdCcp();
  const cfdi = armarCfdiTimbrable(v, idCcp, ctx.emisor, ctx.receptor, ctx.ingresoFlete, emision);
  if (!cfdi.ok) return { ok: false, motivo: 'Faltan datos para armar el CFDI timbrable.', faltantes: cfdi.faltantes };

  const r = await pac.timbrar(cfdi.xml);
  if (!r.ok) {
    if (r.clase === 'red') {
      logger.error('timbre.ambiguo', { viajeId, proveedor: pac.nombre });
      return { ok: false, motivo: `SIN RESPUESTA DEL PAC — el timbre PUDO haberse emitido. NO vuelvas a intentar todavía: verifica en el panel del PAC si el CFDI existe; si existe, avisa a soporte para registrarlo; si no, reintenta. Detalle: ${r.mensaje}` };
    }
    // Rechazo/auth: el mensaje del PAC tal cual — es accionable.
    return { ok: false, motivo: r.mensaje, faltantes: r.codigo === null ? undefined : [`Código del PAC: ${r.codigo}`] };
  }

  const admin = supabaseAdmin();
  const fecha = r.fechaTimbrado !== '' ? r.fechaTimbrado : new Date().toISOString();
  const { error } = await acotada(admin.from('ccp_timbre').insert({
    tenant_id: tenantId, viaje_id: viajeId,
    uuid_fiscal: r.uuid, proveedor: pac.nombre, modo: ctx.emisor.modo,
    fecha_timbrado: fecha, sello_sat: r.selloSat, no_certificado_sat: r.noCertificadoSat,
    xml: r.xmlTimbrado, timbrado_por: actor.id ?? null,
  }), 'timbre.persistir');

  if (error) {
    // La carrera del doble clic: el unique habló. El timbre YA existe (el
    // del ganador, o este mismo uuid reinsertado) — leerlo y decir la verdad.
    const otra = await leerContextoTimbre(tenantId, viajeId);
    if (otra?.timbreVigente != null) {
      return { ok: true, uuid: otra.timbreVigente.uuidFiscal, fechaTimbrado: otra.timbreVigente.fechaTimbrado, modo: otra.timbreVigente.modo, yaExistia: true };
    }
    // Timbre emitido y NO persistido: la peor combinación — se grita con
    // todo lo necesario para registrarlo a mano, jamás se pierde en un log
    // silencioso.
    logger.error('timbre.emitido_sin_persistir', { viajeId, uuid: r.uuid, error: error.message });
    return { ok: false, motivo: `El PAC SÍ timbró (uuid ${r.uuid}) pero el registro en Likida falló: ${error.message}. Guarda ese uuid y avisa a soporte — NO vuelvas a timbrar este viaje.` };
  }

  await anotarBitacora(
    { tenantId, actor, accion: 'ccp.timbrado', entidad: 'viaje', entidadId: viajeId,
      detalle: { uuid: r.uuid, proveedor: pac.nombre, modo: ctx.emisor.modo, total: cfdi.total } },
    { evento: 'timbre.bitacora_no_escribio' },
  );
  logger.info('timbre.ok', { viajeId, uuid: r.uuid, modo: ctx.emisor.modo });
  return { ok: true, uuid: r.uuid, fechaTimbrado: fecha, modo: ctx.emisor.modo, yaExistia: false };
}

/** El XML timbrado para descarga. Null = no hay timbre vigente. */
export async function leerXmlTimbrado(tenantId: string, viajeId: string): Promise<{ xml: string; uuid: string } | null> {
  const admin = supabaseAdmin();
  const { data, error } = await acotada(admin.from('ccp_timbre')
    .select('xml, uuid_fiscal')
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente').maybeSingle(), 'timbre.xml');
  if (error) throw new Error(`leerXmlTimbrado: ${error.message}`);
  if (data === null) return null;
  return { xml: String((data as Record<string, unknown>).xml), uuid: String((data as Record<string, unknown>).uuid_fiscal) };
}
