import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { parseCfdiXml } from '@/lib/likida/intake/cfdi_xml';
import {
  guardarFacturaProveedor, listarBandejaProveedor, decidirFacturaProveedor,
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
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT('agentes')).t('proveedores.page.titulo') };
}

export const dynamic = 'force-dynamic';

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_FOTO_BYTES = MAX_ARCHIVO_SUBIDA_BYTES;
const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

type SpFlota = { vista?: string; tenant?: string; rol?: string };

/** El gateo de las actions — helper de módulo (una action solo captura
 *  valores serializables). */
async function exigirPermiso(sp: SpFlota, tenantId: string): Promise<{ error: string } | { quien: string }> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (el superadmin ya no se salta el cruce).
  const sesion = await resolverTenantAtadoAccion('/dashboard/agentes/proveedores', sp, tenantId);
  if (!sesion) return { error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerArea(sesion.rol, 'dinero')) return { error: tx('rest.tu_rol_no_puede_operar_facturas') };
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
async function exigirControlBuzon(sp: SpFlota, tenantId: string): Promise<{ error: string } | { userId: string }> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (el superadmin ya no se salta el cruce).
  const sesion = await resolverTenantAtadoAccion('/dashboard/agentes/proveedores', sp, tenantId);
  if (!sesion) return { error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerArea(sesion.rol, 'dinero')) return { error: tx('rest.tu_rol_no_puede_operar_facturas') };
  if (!puedeAdministrar(sesion.rol)) return { error: tx('rest.solo_el_dueno_de_la_flota_7') };
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
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; orden?: string; dir?: string; pag?: string }>;
}) {
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const tr = await getT('agentes');
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
    // A37-S15-02: las 100 más recientes MÁS todas las pendientes (hasta 500).
    listarBandejaProveedor(tenantId, 100, 500),
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
    const permiso = await exigirPermiso(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: tx('rest.elige_el_xml_de_la_factura') };
    if (archivo.size > MAX_XML_BYTES) return { error: tx('rest.ese_archivo_pesa_demasiado_para_ser') };

    const texto = await archivo.text();
    const xml = parseCfdiXml(texto);
    if (!xml?.uuid || typeof xml.total !== 'number') {
      return { error: tx('rest.no_pude_leerlo_como_cfdi_xml') };
    }

    const rfc = (await getFiscalDeFlota(tenantId).catch(() => null))?.flota?.rfc || null;
    // El estatus SAT se consulta al ingerir (jamás lanza; SAT caído → 'pendiente').
    const estadoSat = await estadoSatDeCfdi(xml);
    const r = await guardarFacturaProveedor(tenantId, xml, texto, rfc, 'subida', estadoSat);
    if (!r.ok) {
      if (r.motivo === 'no_es_compra') {
        return { error: tx('rest.ese_cfdi_no_es_una_factura') };
      }
      if (r.motivo === 'moneda_no_mxn') {
        return { error: tx('rest.ese_cfdi_no_esta_en_pesos') };
      }
      return r.motivo === 'duplicada'
        ? { error: tx('rest.esa_factura_ya_esta_en_la') }
        : { error: tx('rest.no_se_pudo_guardar_la_factura') };
    }
    logger.info('proveedores.subida', { tenantId, factura: r.facturaId });
    return {
      aviso: r.receptorEsFlota === false
        ? tx('rest.guardada_ojo_el_receptor_del_cfdi')
        : estadoSat === 'cancelado'
          ? tx('rest.guardada_ojo_el_sat_reporta_este')
          : tx('rest.guardada_esta_en_la_bandeja_esperando'),
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
    const permiso = await exigirPermiso(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: tx('rest.elige_la_foto_de_la_factura') };
    if (!TIPOS_FOTO.has(archivo.type)) return { error: tx('rest.eso_no_es_una_foto_jpg') };
    if (archivo.size > MAX_FOTO_BYTES) return { error: MENSAJE_ARCHIVO_GRANDE };

    const dataUrl = `data:${archivo.type};base64,${Buffer.from(await archivo.arrayBuffer()).toString('base64')}`;
    const rfc = (await getFiscalDeFlota(tenantId).catch(() => null))?.flota?.rfc || null;
    const r = await ingresarFacturaDesdeFoto(tenantId, dataUrl, rfc);
    if (!r.ok) {
      const mensajes: Record<typeof r.motivo, string> = {
        ilegible: tx('rest.no_pude_leer_la_foto_como'),
        sin_uuid: tx('rest.no_se_alcanzo_a_leer_el'),
        sin_total: tx('rest.no_pude_leer_el_total_de'),
        duplicada: tx('rest.esa_factura_ya_esta_en_la'),
        error: tx('rest.no_se_pudo_guardar_la_factura'),
      };
      return { error: mensajes[r.motivo] };
    }
    logger.info('proveedores.subida_foto', { tenantId, factura: r.facturaId, confianza: r.ocrConfianza });
    return {
      aviso: r.receptorEsFlota === false
        ? tx('rest.guardada_desde_la_foto_ojo_el')
        : tx('rest.guardada_desde_la_foto_las_cifras'),
    };
  }

  async function decidir(_prev: { error?: string; confirmar?: boolean } | null, fd: FormData): Promise<{ error?: string; confirmar?: boolean } | null> {
    'use server';
    const permiso = await exigirPermiso(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const facturaId = typeof fd.get('facturaId') === 'string' ? (fd.get('facturaId') as string).trim().slice(0, 64) : '';
    const decision = fd.get('decision');
    if (!facturaId || (decision !== 'aprobada' && decision !== 'rechazada')) return { error: tx('rest.decision_incompleta') };

    const r = await decidirFacturaProveedor(tenantId, facturaId, decision, permiso.quien, { confirmarAdvertencias: fd.get('confirmar') === '1' });
    if (r.error) return { error: r.error, ...(r.requiereConfirmacion ? { confirmar: true } : {}) };
    logger.info('proveedores.decidida', { tenantId, facturaId, decision });
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  // Sin parámetros a propósito: la action no lee nada del formulario (el
  // tenant va por closure desde la sesión) y `useActionState` acepta una
  // función de menor aridad.
  async function generarBuzonAccion(): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirControlBuzon(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      await generarBuzonDeFlota(tenantId, { id: permiso.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, tx('rest.generar_la_direccion_del_buzon')) };
    }
    // El redirect va FUERA del try: lanza NEXT_REDIRECT y un catch encima lo
    // convertiría en "falla del sistema" sobre una operación que sí ocurrió.
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  async function rotarBuzonAccion(): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirControlBuzon(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      await rotarBuzonDeFlota(tenantId, { id: permiso.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, tx('rest.rotar_la_direccion_del_buzon')) };
    }
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  type Estado = { error?: string; aviso?: string } | null;
  const idDelForm = (fd: FormData, campo: string) => (typeof fd.get(campo) === 'string' ? (fd.get(campo) as string).trim().slice(0, 64) : '');

  /** La configuración de la entrega: CONTROL (a dónde se manda el dinero-papel de la flota), solo el dueño. */
  async function guardarEntrega(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirControlBuzon(sp, tenantId);
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
    return { aviso: config.activo ? tx('rest.guardado_la_entrega_al_contador_esta') : tx('rest.guardado_la_entrega_al_contador_esta_2') };
  }

  /** «Enviar ahora»: arma el lote con lo aprobado sin entregar y lo manda en el acto (el cron reintenta si falla). */
  async function enviarAhora(): Promise<Estado> {
    'use server';
    const permiso = await exigirPermiso(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      const deps = depsEntregaReales();
      const a = await armarLote(deps, tenantId, 'manual', permiso.quien);
      if (!a.armado) {
        const motivos = {
          apagada: tx('rest.la_entrega_al_contador_esta_apagada'),
          sin_destinatarios: tx('rest.captura_el_correo_del_contador_primero'),
          sin_facturas: tx('rest.no_hay_aprobadas_pendientes_de_entregar'),
          bajo_minimo: tx('rest.no_hay_suficientes_facturas_para_un'),
          no_disponible: tx('rest.la_entrega_al_contador_aun_no'),
          carrera: tx('rest.otra_persona_acaba_de_enviarlas_recarga'),
        } as const;
        return { error: motivos[a.motivo] };
      }
      const lote = (await listarLotes(tenantId, 5)).find((l) => l.id === a.entregaId);
      const r = lote ? await enviarLote(deps, lote) : null;
      logger.info('proveedores.entrega_manual', { tenantId, entrega: a.entregaId, facturas: a.nFacturas, resultado: r?.estado });
      if (r?.estado === 'enviada') return { aviso: tx('rest.enviado_factura_s_al_contador_aparece', { nFacturas: a.nFacturas }) };
      return { aviso: tx('rest.el_lote_de_factura_s_quedo', { nFacturas: a.nFacturas, v: r?.detalle ?? 'no salió al primer intento' }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, tx('rest.enviar_las_facturas_al_contador')) };
    }
  }

  async function reintentarEntrega(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirControlBuzon(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const id = idDelForm(fd, 'id');
    if (!id) return { error: tx('rest.falta_el_lote') };
    try {
      return (await reintentarLote(tenantId, id, new Date())) ? { aviso: tx('rest.se_reintenta_en_la_siguiente_pasada') } : { error: tx('rest.ese_lote_ya_no_esta_en') };
    } catch (e) { return { error: mensajeParaPantalla(e, tx('rest.reintentar_el_envio')) }; }
  }

  async function cancelarEntrega(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirControlBuzon(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const id = idDelForm(fd, 'id');
    if (!id) return { error: tx('rest.falta_el_lote') };
    try {
      return (await cancelarLote(tenantId, id)) ? { aviso: tx('rest.lote_cancelado_sus_facturas_vuelven_a') } : { error: tx('rest.ese_lote_ya_salio_o_ya') };
    } catch (e) { return { error: mensajeParaPantalla(e, 'cancelar el lote') }; }
  }

  async function descartarArchivo(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirPermiso(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const id = idDelForm(fd, 'id');
    if (!id) return { error: tx('rest.falta_el_archivo') };
    const r = await descartarRecepcion(tenantId, id, permiso.quien);
    return r.error ? { error: r.error } : { aviso: tx('rest.archivo_descartado') };
  }

  /** «Ver PDF» de una factura o de una recepción: URL firmada de 5 min del bucket privado, siempre por tenant. */
  async function verPdf(_prev: Estado, fd: FormData): Promise<Estado> {
    'use server';
    const permiso = await exigirPermiso(sp, tenantId);
    if ('error' in permiso) return { error: permiso.error };
    const facturaId = idDelForm(fd, 'facturaId');
    const recepcionId = idDelForm(fd, 'recepcionId');
    if (!facturaId && !recepcionId) return { error: tx('rest.falta_el_archivo') };
    let url: string | null;
    try {
      url = facturaId ? await urlPdfDeFactura(tenantId, facturaId) : await urlPdfDeRecepcion(tenantId, recepcionId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el PDF') };
    }
    if (!url) return { error: tx('rest.ese_archivo_no_tiene_pdf_guardado') };
    redirect(url);
  }

  return (
    <VistaAgenteProveedores
      tr={tr}
      facturas={facturas}
      rfcFlota={rfcFlota}
      sufijo={sufijo}
      params={sp}
      buzon={buzon}
      dominioConfigurado={dominioConfigurado}
      puedeAdministrarBuzon={puedeAdministrarBuzon}
      acciones={{ subirFactura, subirFoto, decidir, generarBuzon: generarBuzonAccion, rotarBuzon: rotarBuzonAccion, verPdf }}
      recepcion={<SeccionRecepcion tr={tr} recepciones={recepciones} conteo={conteo} acciones={{ descartar: descartarArchivo, verPdf }} />}
      entrega={
        <SeccionEntrega tr={tr}
          config={entregaCfg?.config ?? null} disponible={entregaCfg?.disponible ?? true}
          lotes={lotes} sinEntregar={sinEntregar} puedeAdministrar={puedeAdministrarBuzon}
          acciones={{ guardar: guardarEntrega, enviar: enviarAhora, reintentar: reintentarEntrega, cancelar: cancelarEntrega }}
        />
      }
      // ReactNode y no datos, como las notificaciones: la vista no debe
      // importar el módulo de corridas, que trae supabaseAdmin.
      ficha={<FichaCorridas corridas={corridas} />}
      notificaciones={<SeccionNotificaciones tenantId={tenantId} sp={sp} agenteId="proveedores" />}
    />
  );
}
