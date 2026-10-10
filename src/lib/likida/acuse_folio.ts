import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { sendDocument, esReintentableMeta } from '@/lib/meta/client';
import { avisarOficina, parametrosAvisoOficina, esFueraDeVentana } from '@/lib/meta/aviso_oficina';
import { appUrl } from '@/lib/env';
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
 * - IDEMPOTENCIA POR REGISTRO DE ENTREGA, no por existencia del upload (M1): el
 *   sello es el objeto `<tenant>/<viaje>-folio.enviado`, que se escribe SOLO
 *   cuando `sendDocument` fue aceptado o quedó en el outbox (o, fuera de la
 *   ventana de 24 h, cuando salió el aviso por plantilla). Si el PDF se subió
 *   pero el envío no consta —firma caída, 131047, fallo definitivo—, el
 *   reintento del «listo» REUTILIZA el PDF ya subido (no lo regenera) y vuelve
 *   a intentar el envío. Dos cierres simultáneos pueden duplicar un acuse de una
 *   página; perderlo para siempre era el defecto, y es el peor de los dos.
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

  const admin = supabaseAdmin();
  const storage = () => admin.storage.from('liquidaciones');
  const rutaPdf = `${args.tenantId}/${args.viajeId}-folio.pdf`;
  const rutaSello = `${args.tenantId}/${args.viajeId}-folio.enviado`;
  const noExiste = (msg?: string) => /not found|no existe|404/i.test(msg ?? '');

  // 1. ¿Consta el envío? El sello solo existe tras un envío aceptado/encolado.
  const sello = await acotada(storage().createSignedUrl(rutaSello, 60), 'acuseFolio.sello');
  if (!sello.error && sello.data?.signedUrl) return 'ya_enviado';
  if (sello.error && !noExiste(sello.error.message)) {
    // No se puede saber si ya salió: ni se manda (duplicaría) ni se sella.
    logger.warn('cierre.acuse_folio_sello_ilegible', { viaje: args.viajeId, err: sello.error.message });
    return 'fallo';
  }

  // 2. El PDF: se reutiliza si ya está subido (intento anterior); si no, se genera y se sube.
  let firma = await acotada(storage().createSignedUrl(rutaPdf, 3600), 'acuseFolio.firma');
  if (firma.error || !firma.data?.signedUrl) {
    if (firma.error && !noExiste(firma.error.message)) {
      logger.warn('cierre.acuse_folio_sin_url', { viaje: args.viajeId, err: firma.error.message });
      return 'fallo';
    }
    const bytes = await generarPdfSoloFolio({
      folio: args.resumen.folio, operador: args.resumen.operador,
      // La fecha REAL del cierre (B2), no la del momento del envío: un reintento tardío no la mueve.
      cerradaEn: args.resumen.cerradaEn ?? new Date().toISOString(), requiereRevisionDeOficina: args.requiereDecision,
    });
    const up = await acotada(storage().upload(rutaPdf, Buffer.from(bytes), { contentType: 'application/pdf', upsert: false }), 'acuseFolio.upload');
    // «Ya existe» = otro intento lo subió entre medias: se usa ese.
    if (up.error && !/already exists|duplicate|exists/i.test(up.error.message)) {
      logger.warn('cierre.acuse_folio_upload', { viaje: args.viajeId, err: up.error.message });
      return 'fallo';
    }
    firma = await acotada(storage().createSignedUrl(rutaPdf, 3600), 'acuseFolio.firma');
    if (firma.error || !firma.data?.signedUrl) {
      logger.warn('cierre.acuse_folio_sin_url', { viaje: args.viajeId, err: firma.error?.message });
      return 'fallo';
    }
  }

  // 3. El envío. Solo un envío aceptado/encolado (o la plantilla de respaldo) sella.
  const sellar = async () => {
    const r = await acotada(storage().upload(rutaSello, Buffer.from('enviado'), { contentType: 'text/plain', upsert: false }), 'acuseFolio.sellar');
    if (r.error && !/already exists|duplicate|exists/i.test(r.error.message)) logger.warn('cierre.acuse_folio_sello_no_escrito', { viaje: args.viajeId, err: r.error.message });
  };
  const r = await sendDocument(tel, firma.data.signedUrl, `cierre-${args.resumen.folio}.pdf`,
    `Cierre del viaje ${args.resumen.folio} — ${args.resumen.operador}`);
  if (r.ok || r.codigo === undefined || esReintentableMeta(r.codigo)) {
    // Sin código = la red cayó y `sendDocument` ya lo metió a wa_outbox; un código reintentable también.
    if (!r.ok) logger.warn('cierre.acuse_folio_no_enviado', { viaje: args.viajeId, err: r.error });
    else logger.info('cierre.acuse_folio_enviado', { viaje: args.viajeId });
    await sellar();
    return 'enviado';
  }
  logger.warn('cierre.acuse_folio_no_enviado', { viaje: args.viajeId, err: r.error, codigo: r.codigo });
  // Fuera de la ventana de 24 h el documento no entra (131047) y reintentarlo no lo arregla: se avisa
  // el folio por la plantilla de oficina (texto, sin cifras) para que el encargado se entere igual.
  if (esFueraDeVentana(r.codigo)) {
    const estado = args.requiereDecision ? 'con una decisión pendiente en la oficina' : 'cerrada y cuadrada';
    const liga = `${appUrl()}/dashboard/viajes`;
    const aviso = await avisarOficina(tel, `Cierre del viaje ${args.resumen.folio} — ${args.resumen.operador}: ${estado}. El acuse en PDF no pudo adjuntarse; el detalle lo tiene la oficina.`, {
      parametros: parametrosAvisoOficina(args.resumen.operador, `Cierre ${args.resumen.folio}: ${args.requiereDecision ? 'decisión pendiente' : 'cuadrada'}`, liga),
      contexto: { tenantId: args.tenantId, viaje: args.viajeId, evento: 'acuse_folio' },
    });
    if (aviso.ok || aviso.encolado) { await sellar(); return 'enviado'; }
  }
  return 'fallo';
}
