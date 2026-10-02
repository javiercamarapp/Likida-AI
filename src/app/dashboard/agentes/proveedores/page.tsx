import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { parseCfdiXml } from '@/lib/likida/intake/cfdi_xml';
import {
  guardarFacturaProveedor, listarFacturasProveedor, decidirFacturaProveedor,
  ingresarFacturaDesdeFoto, estadoSatDeCfdi,
} from '@/lib/likida/proveedores';
import { ultimasCorridas, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { FichaCorridas } from '../ficha-corridas';
import { getFiscalDeFlota } from '@/lib/likida/facturacion/flota_fiscal';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getBuzon, generarBuzon as generarBuzonDeFlota, rotarBuzon as rotarBuzonDeFlota,
} from '@/lib/correo/buzon_escritura';
import { dominioBuzon } from '@/lib/correo/buzon';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../../sufijo';
import {
  leerConfigEntrega, guardarConfigEntrega, listarLotes, contarSinEntregar, cancelarLote, reintentarLote,
} from '@/lib/likida/buzon/entrega_repo';
import { armarLote, enviarLote } from '@/lib/likida/buzon/entrega';
import { depsEntregaReales } from '@/lib/likida/buzon/servicio';
import { parsearDestinatarios, validarConfigEntrega, type ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';
import { listarRecepciones, conteoBuzon, descartarRecepcion, urlPdfDeRecepcion, urlPdfDeFactura } from '@/lib/likida/buzon/repo';
import { SeccionEntrega, SeccionRecepcion } from './seccion_buzon';
import { VistaAgenteProveedores } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { MAX_ARCHIVO_SUBIDA_BYTES, MENSAJE_ARCHIVO_GRANDE } from '@/lib/http/subidas_formulario';

export const dynamic = 'force-dynamic';

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_FOTO_BYTES = MAX_ARCHIVO_SUBIDA_BYTES;
const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** El gateo de las actions — helper de módulo (una action solo captura
 *  valores serializables). */
async function exigirPermiso(tenantId: string): Promise<{ error: string } | { quien: string }> {
  const sesion = await requireSessionTenant('/dashboard/agentes/proveedores');
  if (!puedeVerArea(sesion.rol, 'dinero')) return { error: 'Tu rol no puede operar facturas de proveedor.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Esta bandeja no es de tu flota.' };
  return { quien: sesion.nombre ?? sesion.userId };
}

/**
 * El gateo de las actions del BUZÓN: además del área, `puedeAdministrar`.
 *
 * La página es área `dinero` (el contador VE la bandeja), pero generar o rotar
 * el buzón es CONTROL: rota la credencial que decide a qué flota entra cada
 * factura. Misma pareja de puertas que las llaves de API — y se comprueba
 * DENTRO de la action de todos modos, porque una server action es un endpoint
 * alcanzable por POST directo, no un botón.
 */
async function exigirControlBuzon(tenantId: string): Promise<{ error: string } | { userId: string }> {
  const sesion = await requireSessionTenant('/dashboard/agentes/proveedores');
  if (!puedeVerArea(sesion.rol, 'dinero')) return { error: 'Tu rol no puede operar facturas de proveedor.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Esta bandeja no es de tu flota.' };
  if (!puedeAdministrar(sesion.rol)) return { error: 'Solo el dueño de la flota genera o rota el buzón.' };
  return { userId: sesion.userId };
}

/**
 * Agente de Proveedores (F6 del plan) — la factura del taller o la
 * refaccionaria que hoy se captura a mano en el ERP. Entra el XML (dato
 * duro del CFDI, sin OCR: la factura de proveedor en México siempre trae
 * XML), un HUMANO aprueba o rechaza (LFPDPPP 26-II), y lo aprobado sale en
 * el layout importable a SAP/CONTPAQi. La escritura DIRECTA a SAP B1 es la
 * fase siguiente, con credenciales del cliente — esta página no la promete.
 */
export default async function PaginaAgenteProveedores({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/proveedores', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/proveedores')) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  // FE-14 (22-ago-2026): estas cuatro lecturas iban EN SERIE, una tras otra,
  // sin que ninguna dependiera de la anterior — cuatro viajes a la base
  // sumados en el reloj de la página. Salen juntas y cada una conserva
  // exactamente el trato que tenía.
  const [facturas, fiscal, corridas, buzon, entregaCfg, lotes, sinEntregar, recepciones, conteo] = await Promise.all([
    // Primario sin catch: bandeja ciega = página caída, no "no hay facturas".
    // El tope va EXPLÍCITO y espeja `TOPE_FACTURAS` de la vista, que es quien
    // lo declara en pantalla (FE-13). Antes viajaba como default silencioso.
    listarFacturasProveedor(tenantId, 100),
    getFiscalDeFlota(tenantId).catch(() => null),
    // La ficha de corridas es SECUNDARIA: si su lectura falla, la bandeja sigue
    // y la ficha dice que no pudo leer — nunca "sin corridas" sobre una caída.
    ultimasCorridas(tenantId, 'proveedores').catch((): CorridaRegistrada[] | null => null),
    // El buzón es SECUNDARIO de esta página: si su lectura falla, la bandeja
    // sigue sirviendo, y la sección dice "no se pudo leer" — nunca "sin buzón",
    // que ofrecería generar (y rotar sin querer) encima del que quizá exista.
    getBuzon(tenantId).catch(() => null),
    // La entrega al contador y lo recibido por correo (Agente 9) también son SECUNDARIOS: una lectura caída
    // (`null`) se dice en su sección — nunca «sin envíos» ni «nada llegó» sobre una base ciega.
    leerConfigEntrega(tenantId).catch(() => null),
    listarLotes(tenantId, 15).catch(() => null),
    contarSinEntregar(tenantId).catch(() => null),
    listarRecepciones(tenantId, 30).catch(() => null),
    conteoBuzon(tenantId, new Date(), 30).catch(() => null),
  ]);
  const rfcFlota = fiscal?.flota?.rfc || null;
  const dominioConfigurado = dominioBuzon() !== null;
  const puedeAdministrarBuzon = puedeAdministrar(rol);

  async function subirFactura(
    _prev: { error?: string; aviso?: string } | null,
    fd: FormData,
  ): Promise<{ error?: string; aviso?: string } | null> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Elige el XML de la factura.' };
    if (archivo.size > MAX_XML_BYTES) return { error: 'Ese archivo pesa demasiado para ser el XML de una factura.' };

    const texto = await archivo.text();
    const xml = parseCfdiXml(texto);
    if (!xml?.uuid || typeof xml.total !== 'number') {
      return { error: 'No pude leerlo como CFDI (XML). El PDF solo es la representación — aquí va el XML que manda el proveedor.' };
    }

    const rfc = (await getFiscalDeFlota(tenantId).catch(() => null))?.flota?.rfc || null;
    // El estatus SAT se consulta al ingerir (jamás lanza; SAT caído → 'pendiente').
    const estadoSat = await estadoSatDeCfdi(xml);
    const r = await guardarFacturaProveedor(tenantId, xml, texto, rfc, 'subida', estadoSat);
    if (!r.ok) {
      return r.motivo === 'duplicada'
        ? { error: 'Esa factura ya está en la bandeja (mismo folio fiscal).' }
        : { error: 'No se pudo guardar la factura. Inténtalo de nuevo.' };
    }
    logger.info('proveedores.subida', { tenantId, factura: r.facturaId });
    return {
      aviso: r.receptorEsFlota === false
        ? 'Guardada — OJO: el receptor del CFDI NO es el RFC de tu flota; revísala antes de aprobar.'
        : estadoSat === 'cancelado'
          ? 'Guardada — OJO: el SAT reporta este CFDI como CANCELADO; revísalo antes de aprobar.'
          : 'Guardada. Está en la bandeja esperando tu decisión.',
    };
  }

  /**
   * La vía de FOTO (F6): la factura en papel de la que solo hay imagen. Las
   * cifras salen de VISIÓN, no del XML — por eso la fila queda marcada con
   * `ocr_confianza` y el aviso manda a revisar contra el papel, no afirma
   * que quedó lista.
   */
  async function subirFoto(
    _prev: { error?: string; aviso?: string } | null,
    fd: FormData,
  ): Promise<{ error?: string; aviso?: string } | null> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Elige la foto de la factura.' };
    if (!TIPOS_FOTO.has(archivo.type)) return { error: 'Eso no es una foto (JPG, PNG o WebP). Si tienes el XML, súbelo por el otro botón — es el dato duro.' };
    if (archivo.size > MAX_FOTO_BYTES) return { error: MENSAJE_ARCHIVO_GRANDE };

    const dataUrl = `data:${archivo.type};base64,${Buffer.from(await archivo.arrayBuffer()).toString('base64')}`;
    const rfc = (await getFiscalDeFlota(tenantId).catch(() => null))?.flota?.rfc || null;
    const r = await ingresarFacturaDesdeFoto(tenantId, dataUrl, rfc);
    if (!r.ok) {
      const mensajes: Record<typeof r.motivo, string> = {
        ilegible: 'No pude leer la foto como factura. Intenta con más luz y el papel plano — o sube el XML, que es el dato duro.',
        sin_uuid: 'No se alcanzó a leer el folio fiscal (el QR del CFDI). Toma un acercamiento del QR o sube el XML: sin esa llave no puedo evitar duplicados.',
        sin_total: 'No pude leer el total de la factura. Con el XML no pasa — súbelo si lo tienes.',
        duplicada: 'Esa factura ya está en la bandeja (mismo folio fiscal).',
        error: 'No se pudo guardar la factura. Inténtalo de nuevo.',
      };
      return { error: mensajes[r.motivo] };
    }
    logger.info('proveedores.subida_foto', { tenantId, factura: r.facturaId, confianza: r.ocrConfianza });
    return {
      aviso: r.receptorEsFlota === false
        ? 'Guardada desde la foto — OJO: el receptor del CFDI NO es el RFC de tu flota; revísala antes de aprobar.'
        : 'Guardada desde la foto. Las cifras las leyó la IA del papel, no del XML: revísalas contra la factura antes de aprobar.',
    };
  }

  async function decidir(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const facturaId = typeof fd.get('facturaId') === 'string' ? (fd.get('facturaId') as string).trim().slice(0, 64) : '';
    const decision = fd.get('decision');
    if (!facturaId || (decision !== 'aprobada' && decision !== 'rechazada')) return { error: 'Decisión incompleta.' };

    const r = await decidirFacturaProveedor(tenantId, facturaId, decision, permiso.quien);
    if (r.error) return { error: r.error };
    logger.info('proveedores.decidida', { tenantId, facturaId, decision });
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  // Sin parámetros a propósito: la action no lee nada del formulario (el
  // tenant va por closure desde la sesión) y `useActionState` acepta una
  // función de menor aridad.
  async function generarBuzonAccion(): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      await generarBuzonDeFlota(tenantId, { id: permiso.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'generar la dirección del buzón') };
    }
    // El redirect va FUERA del try: lanza NEXT_REDIRECT y un catch encima lo
    // convertiría en "falla del sistema" sobre una operación que sí ocurrió.
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  async function rotarBuzonAccion(): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      await rotarBuzonDeFlota(tenantId, { id: permiso.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'rotar la dirección del buzón') };
    }
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  type Estado = { error?: string; aviso?: string } | null;
  const idDelForm = (fd: FormData, campo: string) => (typeof fd.get(campo) === 'string' ? (fd.get(campo) as string).trim().slice(0, 64) : '');

  /** La configuración de la entrega: CONTROL (a dónde se manda el dinero-papel de la flota), solo el dueño. */
  async function guardarEntrega(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const crudo = typeof fd.get('destinatarios') === 'string' ? (fd.get('destinatarios') as string).slice(0, 600) : '';
    const lista = parsearDestinatarios(crudo);
    if (!lista.ok) return { error: lista.error };
    const formato = fd.get('formato');
    const config: ConfigEntrega = {
      activo: fd.get('activo') === 'on',
      destinatarios: lista.destinatarios,
      formato: formato === 'sap_b1' || formato === 'contpaqi' ? formato : 'generico',
      incluirZip: fd.get('incluirZip') === 'on',
      automatica: fd.get('automatica') === 'on',
      horaEnvio: Number(fd.get('horaEnvio') ?? 8),
      minFacturas: Number(fd.get('minFacturas') ?? 1),
    };
    const invalida = validarConfigEntrega(config);
    if (invalida) return { error: invalida };
    const r = await guardarConfigEntrega(tenantId, config);
    if (r.error) return { error: r.error };
    logger.info('proveedores.entrega_config', { tenantId, activo: config.activo, automatica: config.automatica });
    return { aviso: config.activo ? 'Guardado. La entrega al contador está encendida.' : 'Guardado. La entrega al contador está apagada.' };
  }

  /** «Enviar ahora»: arma el lote con lo aprobado sin entregar y lo manda en el acto (el cron reintenta si falla). */
  async function enviarAhora(): Promise<Estado> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      const deps = depsEntregaReales();
      const a = await armarLote(deps, tenantId, 'manual', permiso.quien);
      if (!a.armado) {
        const motivos = {
          apagada: 'La entrega al contador está apagada: enciéndela primero.',
          sin_destinatarios: 'Captura el correo del contador primero.',
          sin_facturas: 'No hay aprobadas pendientes de entregar.',
          bajo_minimo: 'No hay suficientes facturas para un lote.',
          no_disponible: 'La entrega al contador aún no está disponible en este entorno.',
          carrera: 'Otra persona acaba de enviarlas: recarga para ver el envío.',
        } as const;
        return { error: motivos[a.motivo] };
      }
      const lote = (await listarLotes(tenantId, 5)).find((l) => l.id === a.entregaId);
      const r = lote ? await enviarLote(deps, lote) : null;
      logger.info('proveedores.entrega_manual', { tenantId, entrega: a.entregaId, facturas: a.nFacturas, resultado: r?.estado });
      if (r?.estado === 'enviada') return { aviso: `Enviado: ${a.nFacturas} factura(s) al contador. Aparece como «enviada» hasta que el correo confirme la entrega.` };
      return { aviso: `El lote de ${a.nFacturas} factura(s) quedó en cola y se reintenta solo (${r?.detalle ?? 'no salió al primer intento'}).` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'enviar las facturas al contador') };
    }
  }

  async function reintentarEntrega(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const id = idDelForm(fd, 'id');
    if (!id) return { error: 'Falta el lote.' };
    try {
      return (await reintentarLote(tenantId, id, new Date())) ? { aviso: 'Se reintenta en la siguiente pasada (≤15 min).' } : { error: 'Ese lote ya no está en estado fallido.' };
    } catch (e) { return { error: mensajeParaPantalla(e, 'reintentar el envío') }; }
  }

  async function cancelarEntrega(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const id = idDelForm(fd, 'id');
    if (!id) return { error: 'Falta el lote.' };
    try {
      return (await cancelarLote(tenantId, id)) ? { aviso: 'Lote cancelado: sus facturas vuelven a la cola de entrega.' } : { error: 'Ese lote ya salió o ya no existe.' };
    } catch (e) { return { error: mensajeParaPantalla(e, 'cancelar el lote') }; }
  }

  async function descartarArchivo(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const id = idDelForm(fd, 'id');
    if (!id) return { error: 'Falta el archivo.' };
    const r = await descartarRecepcion(tenantId, id, permiso.quien);
    return r.error ? { error: r.error } : { aviso: 'Archivo descartado.' };
  }

  /** «Ver PDF» de una factura o de una recepción: URL firmada de 5 min del bucket privado, siempre por tenant. */
  async function verPdf(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const facturaId = idDelForm(fd, 'facturaId');
    const recepcionId = idDelForm(fd, 'recepcionId');
    if (!facturaId && !recepcionId) return { error: 'Falta el archivo.' };
    let url: string | null;
    try {
      url = facturaId ? await urlPdfDeFactura(tenantId, facturaId) : await urlPdfDeRecepcion(tenantId, recepcionId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el PDF') };
    }
    if (!url) return { error: 'Ese archivo no tiene PDF guardado (o ya se borró por retención).' };
    redirect(url);
  }

  return (
    <VistaAgenteProveedores
      facturas={facturas}
      rfcFlota={rfcFlota}
      sufijo={sufijo}
      buzon={buzon}
      dominioConfigurado={dominioConfigurado}
      puedeAdministrarBuzon={puedeAdministrarBuzon}
      acciones={{ subirFactura, subirFoto, decidir, generarBuzon: generarBuzonAccion, rotarBuzon: rotarBuzonAccion, verPdf }}
      recepcion={<SeccionRecepcion recepciones={recepciones} conteo={conteo} acciones={{ descartar: descartarArchivo, verPdf }} />}
      entrega={
        <SeccionEntrega
          config={entregaCfg?.config ?? null} disponible={entregaCfg?.disponible ?? true}
          lotes={lotes} sinEntregar={sinEntregar} puedeAdministrar={puedeAdministrarBuzon}
          acciones={{ guardar: guardarEntrega, enviar: enviarAhora, reintentar: reintentarEntrega, cancelar: cancelarEntrega }}
        />
      }
      // ReactNode y no datos, como las notificaciones: la vista no debe
      // importar el módulo de corridas, que trae supabaseAdmin.
      ficha={<FichaCorridas corridas={corridas} />}
      notificaciones={<SeccionNotificaciones tenantId={tenantId} agenteId="proveedores" />}
    />
  );
}
