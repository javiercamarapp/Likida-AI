import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { sendDocument, esReintentableMeta } from '@/lib/meta/client';
import { variantesTelefono } from './conv';
import { telefonoJefeDe } from './contactos';
import { generarPdfSoloFolio } from './liquidacion/pdf_folio';
import type { ResumenLiquidacion } from './cierre_aviso';

export type ResultadoAcuseFolio = 'enviado' | 'sin_encargado' | 'mismo_numero' | 'ya_enviado' | 'fallo';

/**
 * El acuse «solo folio» para el ENCARGADO (E1-B, P0-7; decisión de Javier,
 * default sí): el cierre le llega con folio, operador y fecha —nunca cifras—,
 * porque el encargado no ve dinero y el ejemplar completo no es suyo.
 *
 * - Va al contacto de operación (`telefonoJefeDe`, el primero de su orden de
 *   aviso). Si ese número es el mismo que el de dinero o el del chofer, ya
 *   recibió el papel completo o el suyo: no se le manda otro (misma regla del
 *   dueño-operador de arriba).
 * - IDEMPOTENCIA SIN COLUMNA NUEVA: el PDF se sube a una ruta determinista
 *   (`<tenant>/<viaje>-folio.pdf`) con `upsert:false`. Si ya existe, el acuse ya
 *   salió en un intento anterior y el reintento del «listo» no lo duplica.
 * - Falla hacia adelante: nunca lanza ni cambia el resultado del aviso al jefe.
 */
export async function acuseSoloFolioAlEncargado(args: {
  tenantId: string;
  viajeId: string;
  resumen: ResumenLiquidacion;
  requiereDecision: boolean;
  telefonoDinero: string;
  telefonoOperador?: string | null;
}): Promise<ResultadoAcuseFolio> {
  const tel = await telefonoJefeDe(args.tenantId);
  if (!tel) return 'sin_encargado';
  const mios = new Set([...variantesTelefono(args.telefonoDinero), ...(args.telefonoOperador ? variantesTelefono(args.telefonoOperador) : [])]);
  if (variantesTelefono(tel).some((v) => mios.has(v))) return 'mismo_numero';

  const bytes = await generarPdfSoloFolio({
    folio: args.resumen.folio, operador: args.resumen.operador,
    cerradaEn: new Date().toISOString(), requiereRevisionDeOficina: args.requiereDecision,
  });
  const ruta = `${args.tenantId}/${args.viajeId}-folio.pdf`;
  const admin = supabaseAdmin();
  const up = await acotada(admin.storage.from('liquidaciones').upload(ruta, Buffer.from(bytes), { contentType: 'application/pdf', upsert: false }), 'acuseFolio.upload');
  if (up.error) {
    // «Ya existe» = ya se mandó. Cualquier otro error: se avisa y no se manda.
    if (/already exists|duplicate|exists/i.test(up.error.message)) return 'ya_enviado';
    logger.warn('cierre.acuse_folio_upload', { viaje: args.viajeId, err: up.error.message });
    return 'fallo';
  }
  const firma = await acotada(admin.storage.from('liquidaciones').createSignedUrl(ruta, 3600), 'acuseFolio.firma');
  if (firma.error || !firma.data?.signedUrl) {
    logger.warn('cierre.acuse_folio_sin_url', { viaje: args.viajeId, err: firma.error?.message });
    return 'fallo';
  }
  const r = await sendDocument(tel, firma.data.signedUrl, `cierre-${args.resumen.folio}.pdf`,
    `Cierre del viaje ${args.resumen.folio} — ${args.resumen.operador}`);
  if (!r.ok) {
    logger.warn('cierre.acuse_folio_no_enviado', { viaje: args.viajeId, err: r.error });
    // Sin código = la red cayó y `sendDocument` ya lo metió a wa_outbox; un código
    // reintentable también. Solo un rechazo definitivo de Meta es fallo.
    return r.codigo === undefined || esReintentableMeta(r.codigo) ? 'enviado' : 'fallo';
  }
  logger.info('cierre.acuse_folio_enviado', { viaje: args.viajeId });
  return 'enviado';
}
