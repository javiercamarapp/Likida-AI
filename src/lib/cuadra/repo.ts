// Acceso a datos de Cuadra (service-role, scoping por tenant a mano).
// Mapea filas de Postgres ↔ tipos del dominio.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { DatosIntegral } from './privacidad';
import { acotada } from './presupuesto';
import type { Gasto, Liquidacion, Viaje, Operador } from '@/types/cuadra';
import type { CodigoPendiente } from './intake/emparejar';

// El tope de consulta vive en `presupuesto.ts`, con `TOPE_CONSULTA_MS` y el
// resto del presupuesto de la invocación. Estuvo aquí hasta la auditoría 8, y
// por eso solo protegía a este archivo: `costos.ts`, `conv.ts` y `config.ts`
// llamaban a `supabaseAdmin()` en crudo — once de los trece pasos del cierre.

/**
 * Conserva el XML CRUDO del CFDI (CFF art. 30). Best-effort: un fallo aquí NO
 * tumba la liquidación (el gasto ya está capturado). 1.8.
 */
export async function saveCfdiXmlRaw(tenantId: string, cfdiUuid: string, gastoId: string | null, xml: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('cfdi_xml')
    .upsert({ tenant_id: tenantId, cfdi_uuid: cfdiUuid, gasto_id: gastoId, xml }, { onConflict: 'tenant_id,cfdi_uuid' }), 'saveCfdiXmlRaw');
  if (error) logger.warn('cfdi_xml.save', { err: error.message });
}

// `getPolitica` VIVÍA AQUÍ y no la llamaba nadie. Leía `politica_gasto`, una
// tabla con `tope_monto` y `requiere_cfdi` que el motor NUNCA consulta: la
// política viva sale de `tenant.config.politica` (config.ts → cuadrarDesdeDB).
//
// Dos orígenes para el mismo hecho, y el muerto era el que MÁS parece el vivo:
// se llama "politica_gasto", tiene una columna por cada tope, y el seed afirmaba
// por escrito que "el motor de cuadre usa tope_monto y requiere_cfdi". Un
// contralor que le baje el tope de diésel ahí —que es el sitio obvio— ve cómo
// las liquidaciones lo siguen ignorando, sin un error en ningún lado.
//
// La 0025 ya lo había documentado en SQL; lo que faltaba era borrar el lector.
// La tabla se queda (tiene su check de dominio, por si alguien la revive) con un
// `comment on table` que lo dice, que es lo único que se ve desde Supabase.

export async function getViaje(viajeId: string, tenantId: string): Promise<Viaje | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje')
    // `demora_no_imputable` NO es opcional aquí: el PDF tiene una sección que
    // depende de él (LFT 263-I) y sin traerlo esa sección no se activa NUNCA.
    // Es el mismo patrón que ya costó dos rondas: el dato existe, el consumidor
    // existe, y nadie los conectó.
    .select('id, folio, origen, destino, anticipo, fecha_inicio, fecha_fin, demora_no_imputable')
    .eq('id', viajeId)
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'getViaje');
  if (error) throw new Error(`viaje: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    folio: (data.folio as string) || undefined,
    // `?? undefined` y no `|| false`: NULL significa "sin determinar", que no es
    // lo mismo que "la demora sí era imputable al operador".
    demoraNoImputable: (data.demora_no_imputable as boolean | null) ?? undefined,
    origen: (data.origen as string) || undefined,
    destino: (data.destino as string) || undefined,
    anticipo: Number(data.anticipo ?? 0),
    fechaInicio: (data.fecha_inicio as string) || undefined,
    fechaFin: (data.fecha_fin as string) || undefined,
  };
}

export async function getOperador(operadorId: string, tenantId: string): Promise<Operador | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('operador')
    .select('id, nombre, telefono, terminal:terminal_id(nombre)')
    .eq('id', operadorId)
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'getOperador');
  if (error) throw new Error(`operador: ${error.message}`);
  if (!data) return null;
  const terminal = data.terminal as { nombre?: string } | null;
  return {
    id: data.id as string,
    nombre: data.nombre as string,
    telefono: data.telefono as string,
    terminal: terminal?.nombre,
  };
}

/**
 * Choferes activos del tenant, para el selector de "Reasignar chofer" del
 * panel (docs/superpowers/plans/2026-08-02-roles-flota.md, Task 3). Solo
 * `nombre` — la vista de asignación no necesita el teléfono.
 */
export async function listOperadores(tenantId: string): Promise<Array<{ id: string; nombre: string }>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('operador')
    .select('id, nombre')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .order('nombre'), 'listOperadores');
  // Un error leído como lista vacía se pinta "no hay choferes" — falso, y
  // esconde justo la sección que decide si "Reasignar" tiene sentido mostrarse.
  if (error) throw new Error(`listOperadores: ${error.message}`);
  return (data ?? []) as Array<{ id: string; nombre: string }>;
}

/**
 * Mueve un viaje de un chofer a otro. Acotado por tenant en el propio UPDATE
 * (no solo en la página que lo llama): con RLS activa esto es cinturón y
 * tirantes, no el único candado.
 */
export async function reasignarOperador(tenantId: string, viajeId: string, operadorId: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('viaje')
    .update({ operador_id: operadorId })
    .eq('id', viajeId)
    .eq('tenant_id', tenantId), 'reasignarOperador');
  if (error) throw new Error(`reasignarOperador: ${error.message}`);
}

export async function addGasto(tenantId: string, viajeId: string, g: Gasto): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('gasto').insert({
    id: g.id,
    tenant_id: tenantId,
    viaje_id: viajeId,
    concepto: g.concepto,
    monto: g.monto,
    fecha: g.fecha ?? null,
    folio: g.folio ?? null,
    rfc_emisor: g.rfcEmisor ?? null,
    rfc_receptor: g.rfcReceptor ?? null,
    cfdi_uuid: g.cfdiUuid ?? null,
    imagen_url: g.imagenUrl ?? null,
    ocr_confianza: g.ocrConfianza ?? null,
    cfdi_valido: g.cfdiValido ?? null,
    estado_sat: g.estadoSat ?? null,
    efos: g.efos ?? null,
    efos_revisar: g.efosRevisar ?? null,
    clave_prod_serv: g.claveProdServ ?? null,
    clave_unidad: g.claveUnidad ?? null,
    tipo_comprobante: g.tipoComprobante ?? null,
    complemento_hidrocarburos: g.complementoHidrocarburos ?? null,
    cfdi_esquema_alterno: g.cfdiEsquemaAlterno ?? null,
    xml_verificado: g.xmlVerificado ?? null,
    forma_pago: g.formaPago ?? null,
    sub_total: g.subTotal ?? null,
    ieps_traslado: g.iepsTraslado ?? null,
    iva_traslado: g.ivaTraslado ?? null,
    folio_norm: g.folioNorm ?? null,
    ocr_extra: g.ocrExtra ?? null,
    img_hash: g.imgHash ?? null,
  }), 'addGasto');
  if (error) {
    // Se preserva el código de Postgres para que el caller distinga un duplicado
    // (23505, dedup de foto por índice único) de un error real. Ver processor.
    const e = new Error(`addGasto: ${error.message}`) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
}

/** FASE 2: ¿ya existe un gasto para este viaje con el mismo hash de imagen?
 *  Best-effort para dedup de fotos reenviadas; ante error de lectura devuelve
 *  false (no bloquea el intake — preferimos un raro duplicado a perder un gasto). */
export async function gastoExistePorHash(viajeId: string, imgHash: string, tenantId: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId)
    .eq('img_hash', imgHash)
    .limit(1), 'gastoExistePorHash');
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * ¿DÓNDE está ya esta foto? Busca en TODA la flota, no solo en un viaje.
 *
 * Existe por el desfase entre el pre-chequeo y el índice: `gastoExistePorHash`
 * mira un VIAJE, pero `uq_gasto_img_hash` es `unique(tenant_id, img_hash)` —
 * toda la flota—. Una foto ya registrada en OTRO viaje pasa el pre-chequeo, la
 * rechaza el índice con 23505, y el processor la tomaba por una carrera de
 * ráfaga y la descartaba en silencio.
 *
 * Medido el 1-ago con un operador que reenvió su fajo: diez fotos rechazadas,
 * cero mensajes. Desde su lado, las mandó y no pasó nada.
 */
export async function ubicarGastoPorHash(
  tenantId: string, imgHash: string,
): Promise<{ viajeId: string; folio?: string; monto: number } | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('viaje_id, monto, viaje:viaje_id(folio)')
    .eq('tenant_id', tenantId)
    .eq('img_hash', imgHash)
    .limit(1), 'ubicarGastoPorHash');
  const fila = !error ? data?.[0] : null;
  if (!fila) return null;
  return {
    viajeId: fila.viaje_id as string,
    folio: ((fila.viaje as { folio?: string } | null)?.folio) || undefined,
    monto: Number(fila.monto),
  };
}

/**
 * El gasto que ya tiene ese hash de imagen, con lo justo para hablar de él.
 *
 * Hermano de `gastoExistePorHash` y NO su sustituto: aquél es la compuerta y
 * corre en toda foto; éste solo corre cuando la compuerta ya dio positivo, que
 * es el caso raro del reenvío idéntico. Separarlos es lo que evita pagar esta
 * lectura en el camino normal.
 *
 * Existe por un fallo del ensayo del 1-ago: se le pidió al operador otra foto de
 * un ticket con la fecha mal leída, reenvió EL MISMO archivo, y el dedup por
 * contenido lo descartó antes del OCR — en silencio. Hizo lo que se le pidió y
 * no pasó nada, sin que nadie se lo dijera.
 */
export async function gastoPorHash(
  viajeId: string, imgHash: string, tenantId: string,
): Promise<{ id: string; fecha?: string; monto: number; concepto: string; folio?: string; ocrExtra?: Record<string, unknown> } | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('id, concepto, monto, fecha, folio, ocr_extra')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId)
    .eq('img_hash', imgHash)
    .limit(1), 'gastoPorHash');
  const fila = !error ? data?.[0] : null;
  if (!fila) return null;
  return {
    id: fila.id, concepto: fila.concepto, monto: Number(fila.monto),
    fecha: fila.fecha ?? undefined, folio: fila.folio ?? undefined,
    ocrExtra: (fila.ocr_extra ?? {}) as Record<string, unknown>,
  };
}

/** NIVEL 2: actualiza un gasto con los datos del XML del CFDI (por id). */
// ═══════════════════════════════════════════════════════════════════════════
// LA SALA DE ESPERA DE LOS COMPROBANTES SIN VIAJE (mig. 0040).
//
// Una foto NUNCA se rechaza. Si no hay viaje abierto —o si la liquidación ya se
// emitió— el comprobante queda aquí con su extracción hecha, y se le pregunta
// al operador si va cuando haya viaje al que ponerlo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POR QUÉ ese comprobante no aterrizó en una liquidación.
 *
 * `fallo_ocr` se agregó el 4-ago-2026 y NO trae migración: la columna es `text`
 * a secas (0040, línea 40) sin CHECK ni enum, y hoy NADIE la lee para decidir
 * nada — el ofrecimiento filtra por `gasto.monto`, no por esto. Se escribe para
 * que la fila diga la verdad de lo que pasó: las dos ramas de `fallo_tecnico`
 * del processor guardaban `sin_viaje`, que describe el efecto (no aterrizó en
 * ninguna liquidación) y esconde la causa (se cayó NUESTRO OCR). Con `sin_viaje`
 * en las dos, contar cuántos comprobantes perdió el proveedor de visión no se
 * podía hacer con esta tabla.
 */
export type MotivoHuerfano = 'sin_viaje' | 'tras_liquidar' | 'fallo_ocr';

export interface Huerfano {
  id: string;
  gasto: Gasto;
  motivo: MotivoHuerfano;
  creadoEn: string;
  rutaImagen?: string;
  /** Cuándo se le preguntó al operador si van. `undefined` = nunca. */
  ofrecidoEn?: string;
}

/** Best-effort: si esto falla, se le dice al operador que no se pudo guardar. */
export async function guardarHuerfano(
  tenantId: string, operadorId: string,
  h: { gasto: Gasto; motivo: MotivoHuerfano; rutaImagen?: string },
): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('comprobante_huerfano').insert({
    tenant_id: tenantId, operador_id: operadorId,
    gasto: h.gasto, motivo: h.motivo, ruta_imagen: h.rutaImagen ?? null,
  }), 'guardarHuerfano');
  if (error) logger.error('huerfano.guardar_error', { err: error.message });
  return !error;
}

/**
 * Los que siguen esperando. Devuelve `[]` ante un error de lectura, y eso es
 * deliberado: no poder leer la sala de espera no puede impedirle al operador
 * cerrar el viaje que sí tiene. Se pierde el ofrecimiento, no el comprobante —
 * las filas siguen ahí para el mensaje siguiente.
 */
export async function getHuerfanos(tenantId: string, operadorId: string): Promise<Huerfano[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('comprobante_huerfano')
    .select('id, gasto, motivo, creado_en, ruta_imagen, ofrecido_en')
    .eq('tenant_id', tenantId).eq('operador_id', operadorId)
    .is('resuelto_en', null)
    .order('creado_en', { ascending: true })
    .limit(50), 'getHuerfanos');
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    gasto: r.gasto as Gasto,
    motivo: r.motivo as MotivoHuerfano,
    creadoEn: r.creado_en as string,
    rutaImagen: (r.ruta_imagen as string) || undefined,
    ofrecidoEn: (r.ofrecido_en as string) || undefined,
  }));
}

/**
 * Deja constancia de que ya se le preguntó, para no repetir la oferta en cada
 * mensaje. Best-effort: si falla, el peor caso es preguntar de más.
 */
export async function marcarHuerfanosOfrecidos(tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await acotada(supabaseAdmin().from('comprobante_huerfano')
    .update({ ofrecido_en: new Date().toISOString() })
    .in('id', ids).eq('tenant_id', tenantId), 'marcarHuerfanosOfrecidos');
  if (error) logger.warn('huerfano.marcar_ofrecido_error', { err: error.message });
}

/**
 * Cierra las filas. `viajeId` solo cuando se adjuntaron.
 *
 * Se marca DESPUÉS de insertar los gastos, no antes: si el `addGasto` falla a
 * medias, lo que queda es una fila todavía pendiente —que se vuelve a ofrecer—
 * y no un comprobante marcado como puesto que no está en ningún lado.
 */
export async function resolverHuerfanos(
  tenantId: string, ids: string[],
  resolucion: 'adjuntado' | 'descartado', viajeId: string | null,
): Promise<void> {
  if (!ids.length) return;
  const { error } = await acotada(supabaseAdmin().from('comprobante_huerfano').update({
    resuelto_en: new Date().toISOString(), resolucion, viaje_id: viajeId,
  }).in('id', ids).eq('tenant_id', tenantId), 'resolverHuerfanos');
  if (error) logger.error('huerfano.resolver_error', { err: error.message });
}

/**
 * Re-fecha un gasto con lo que trajo la SEGUNDA foto del mismo ticket.
 *
 * Toca UNA columna. No `monto`, no `concepto`, no `folio`: si algo de eso
 * cambiara no sería el mismo papel, y `emparejarCorreccionDeFecha` ya lo habría
 * descartado. Dejar la escritura tan estrecha es lo que hace que un
 * emparejamiento equivocado —el riesgo real de este camino— cueste una fecha
 * movida y no un total alterado.
 *
 * El trigger de la 0037 sigue mandando: si la liquidación ya se emitió, esto
 * levanta `CU001` y el processor lo traduce, igual que en el alta.
 */
export async function corregirFechaGasto(
  tenantId: string,
  gastoId: string,
  fecha: string,
): Promise<void> {
  const { error } = await acotada(
    supabaseAdmin().from('gasto').update({ fecha })
      .eq('id', gastoId).eq('tenant_id', tenantId),
    'corregirFechaGasto',
  );
  if (error) {
    // `code` preservado por la misma razón que en `updateGastoCfdiXml`: sin él,
    // el `CU001` de la 0037 llega aquí indistinguible de un fallo cualquiera y
    // el operador recibiría "hubo un problema" en vez de "llegó tarde".
    const e = new Error(`corregirFechaGasto: ${error.message}`) as Error & { code?: string };
    if (error.code) e.code = error.code;
    throw e;
  }
}

export async function updateGastoCfdiXml(
  tenantId: string,
  gastoId: string,
  x: { claveProdServ?: string; claveUnidad?: string; tipoComprobante?: string; complementoHidrocarburos?: boolean; esquemaAlterno?: boolean; formaPago?: string; subTotal?: number; iepsTraslado?: number; ivaTraslado?: number;
       // Cuando el XML se pega a un TICKET (que no traía UUID), estos tres campos
       // pasan a ser autoritativos: vienen del comprobante timbrado, no del OCR.
       uuid?: string; rfcEmisor?: string; rfcReceptor?: string; total?: number; fecha?: string },
): Promise<void> {
  const extra: Record<string, unknown> = {};
  if (x.uuid) extra.cfdi_uuid = x.uuid;
  if (x.rfcEmisor) extra.rfc_emisor = x.rfcEmisor;
  if (x.rfcReceptor) extra.rfc_receptor = x.rfcReceptor;
  // El monto del CFDI gana sobre el que leyó la visión: no pasó por OCR.
  if (x.total != null && x.total > 0) extra.monto = x.total;
  if (x.fecha) extra.fecha = x.fecha;
  const { error } = await acotada(supabaseAdmin().from('gasto').update({
    ...extra,
    clave_prod_serv: x.claveProdServ ?? null,
    clave_unidad: x.claveUnidad ?? null,
    tipo_comprobante: x.tipoComprobante ?? null,
    complemento_hidrocarburos: x.complementoHidrocarburos ?? null,
    cfdi_esquema_alterno: x.esquemaAlterno ?? null,
    forma_pago: x.formaPago ?? null,
    sub_total: x.subTotal ?? null,
    ieps_traslado: x.iepsTraslado ?? null,
    iva_traslado: x.ivaTraslado ?? null,
    xml_verificado: true,
  }).eq('id', gastoId).eq('tenant_id', tenantId), 'updateGastoCfdiXml');
  if (error) {
    // SE PRESERVA `code`, igual que `addGasto` (auditoría 6, modelo de datos).
    // Antes era un `throw new Error(...)` liso, así que este camino no podía
    // distinguir una violación de CHECK (23514) ni un duplicado (23505) de un
    // fallo cualquiera, ni aunque alguien quisiera manejarlos: el código venía
    // borrado desde aquí. Una restricción nueva en la base es un error de
    // tiempo de ejecución nuevo, y sin el código no hay forma de traducirlo.
    const e = new Error(`updateGastoCfdiXml: ${error.message}`) as Error & { code?: string };
    if (error.code) e.code = error.code;
    throw e;
  }
}

/**
 * Le pega a un gasto ya registrado los identificadores que trajo el
 * ACERCAMIENTO (segunda foto, solo del código): folio del portal, código de
 * barras, liga de facturación y UUID.
 *
 * NO toca el monto: el emparejamiento se hizo justamente por total, así que ya
 * coinciden. Tocar dinero aquí solo abriría la puerta a moverlo por error.
 */
/**
 * Le pega a un gasto lo que salió del código: folio de portal, código de barras,
 * liga de facturación y —si no tenía— el UUID.
 *
 * Devuelve `true` si de verdad lo enriqueció, `false` si alguien llegó antes.
 * Que devuelva false NO es un error: es la respuesta a "ese gasto ya tiene su
 * acercamiento".
 *
 * El merge y el claim viven en SQL (mig. 0017), no aquí. Haciéndolo desde la
 * app era read-modify-write: las fotos de una ráfaga de WhatsApp corren en
 * paralelo, así que se mezclaba contra el `ocr_extra` que se había leído, no
 * contra el que está en la tabla, y la última escritura borraba lo que otra foto
 * hubiera añadido en medio (montoDiscrepante, textoSospechoso, rfcEmisorDudoso).
 * Y sin claim, el segundo acercamiento del mismo total pisaba el folio del
 * primero — el folio que la oficina teclea en el portal para timbrar.
 *
 * NO se toca `folio`: el impreso en el ticket y el que viaja dentro del QR son
 * cadenas DISTINTAS (comprobado contra el papel — 31 chars contra 30), no dos
 * lecturas del mismo dato. El impreso es el que una persona teclea; el del QR es
 * la llave del deep-link del portal y vive en `ocrExtra.folioPortal`.
 */
export async function enriquecerGastoConCodigo(
  tenantId: string,
  gasto: Gasto,
  datos: { folioPortal?: string; codigoBarras?: string; urlFacturacion?: string; cfdiUuid?: string },
): Promise<boolean> {
  // Solo lo que trae el código. El resto de ocr_extra lo conserva el `||` de SQL.
  const extra: Record<string, unknown> = {};
  if (datos.folioPortal) extra.folioPortal = datos.folioPortal;
  if (datos.codigoBarras) extra.codigoBarras = datos.codigoBarras;
  if (datos.urlFacturacion) extra.urlFacturacion = datos.urlFacturacion;

  const { data, error } = await acotada(supabaseAdmin().rpc('enriquecer_gasto_codigo', {
    p_gasto: gasto.id,
    p_tenant: tenantId,
    p_extra: extra,
    p_cfdi_uuid: datos.cfdiUuid ?? null,
  }), 'enriquecerGastoConCodigo');
  if (error) throw new Error(`enriquecerGastoConCodigo: ${error.message}`);
  return data === true;
}

// ── Bandeja de códigos pendientes (mig. 0016) ────────────────────────────────
// El acercamiento que llegó antes que su ticket. Espera aquí hasta que entre un
// comprobante de su mismo total.

/** Guarda un código que todavía no tiene comprobante al cual pegarse. */
export async function guardarCodigoPendiente(
  tenantId: string,
  viajeId: string,
  c: Omit<CodigoPendiente, 'id'>,
): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('codigo_pendiente').insert({
    tenant_id: tenantId,
    viaje_id: viajeId,
    monto: c.monto,
    folio_portal: c.folioPortal ?? null,
    codigo_barras: c.codigoBarras ?? null,
    url_facturacion: c.urlFacturacion ?? null,
    cfdi_uuid: c.cfdiUuid ?? null,
  }), 'guardarCodigoPendiente');
  if (error) throw new Error(`guardarCodigoPendiente: ${error.message}`);
}

export async function getCodigosPendientes(viajeId: string, tenantId: string): Promise<CodigoPendiente[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('codigo_pendiente')
    .select('id, monto, folio_portal, codigo_barras, url_facturacion, cfdi_uuid')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId), 'getCodigosPendientes');
  if (error) throw new Error(`getCodigosPendientes: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    monto: Number(r.monto),
    folioPortal: (r.folio_portal as string) || undefined,
    codigoBarras: (r.codigo_barras as string) || undefined,
    urlFacturacion: (r.url_facturacion as string) || undefined,
    cfdiUuid: (r.cfdi_uuid as string) || undefined,
  }));
}

/**
 * Toma un código de la bandeja para usarlo, y devuelve si lo consiguió.
 *
 * Es un CLAIM, no un borrado: las fotos de una ráfaga corren en paralelo y no
 * toman el mutex del viaje, así que dos comprobantes del mismo total pueden ir
 * por el mismo código a la vez. El borrado con `.select()` es atómico — solo uno
 * recibe la fila — y el otro se entera de que llegó tarde en vez de pegar el
 * mismo folio dos veces.
 */
export async function reclamarCodigoPendiente(tenantId: string, id: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('codigo_pendiente')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id'), 'reclamarCodigoPendiente');
  if (error) throw new Error(`reclamarCodigoPendiente: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function getGastos(viajeId: string, tenantId: string): Promise<Gasto[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('id, concepto, monto, fecha, folio, folio_norm, ocr_extra, rfc_emisor, rfc_receptor, cfdi_uuid, imagen_url, ocr_confianza, cfdi_valido, estado_sat, efos, efos_revisar, clave_prod_serv, clave_unidad, tipo_comprobante, complemento_hidrocarburos, cfdi_esquema_alterno, xml_verificado, forma_pago, sub_total, ieps_traslado, iva_traslado')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId), 'getGastos');
  if (error) throw new Error(`getGastos: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    concepto: r.concepto as Gasto['concepto'],
    monto: Number(r.monto),
    fecha: (r.fecha as string) || undefined,
    folio: (r.folio as string) || undefined,
    folioNorm: (r.folio_norm as string) || undefined,
    ocrExtra: (r.ocr_extra as Record<string, unknown>) || undefined,
    rfcEmisor: (r.rfc_emisor as string) || undefined,
    rfcReceptor: (r.rfc_receptor as string) || undefined,
    cfdiUuid: (r.cfdi_uuid as string) || undefined,
    imagenUrl: (r.imagen_url as string) || undefined,
    ocrConfianza: r.ocr_confianza != null ? Number(r.ocr_confianza) : undefined,
    cfdiValido: r.cfdi_valido != null ? Boolean(r.cfdi_valido) : undefined,
    estadoSat: (r.estado_sat as Gasto['estadoSat']) || undefined,
    efos: r.efos != null ? Boolean(r.efos) : undefined,
    efosRevisar: r.efos_revisar != null ? Boolean(r.efos_revisar) : undefined,
    claveProdServ: (r.clave_prod_serv as string) || undefined,
    claveUnidad: (r.clave_unidad as string) || undefined,
    tipoComprobante: (r.tipo_comprobante as string) || undefined,
    complementoHidrocarburos: r.complemento_hidrocarburos != null ? Boolean(r.complemento_hidrocarburos) : undefined,
    cfdiEsquemaAlterno: r.cfdi_esquema_alterno != null ? Boolean(r.cfdi_esquema_alterno) : undefined,
    xmlVerificado: r.xml_verificado != null ? Boolean(r.xml_verificado) : undefined,
    formaPago: (r.forma_pago as string) || undefined,
    subTotal: r.sub_total != null ? Number(r.sub_total) : undefined,
    iepsTraslado: r.ieps_traslado != null ? Number(r.ieps_traslado) : undefined,
    ivaTraslado: r.iva_traslado != null ? Number(r.iva_traslado) : undefined,
  }));
}

export async function saveLiquidacion(
  tenantId: string,
  liq: Omit<Liquidacion, 'id' | 'creadaEn'>,
  pdfUrl?: string,
): Promise<string> {
  const admin = supabaseAdmin();
  // CR-1 / AUDIT_V3 money-path CRÍTICO: cierre ATÓMICO e idempotente. Antes eran
  // dos statements (upsert liquidacion + update viaje) y el error del segundo se
  // IGNORABA → liquidacion sin cerrar el viaje. Ahora una sola función plpgsql
  // (guardar_liquidacion_tx, migración 0013) hace ambos en UNA transacción: si el
  // update de viaje falla, la liquidacion hace rollback. Con unique(viaje_id) dos
  // cierres concurrentes producen UN registro (el motor es determinístico).
  const { data, error } = await acotada(admin.rpc('guardar_liquidacion_tx', {
    p_tenant: tenantId,
    p_viaje: liq.viajeId,
    p_total_comprobado: liq.totalComprobado,
    p_total_anticipo: liq.totalAnticipo,
    p_diferencia: liq.diferencia,
    p_estatus: liq.estatus,
    p_diferencias: liq.diferencias,
    p_ieps: liq.iepsAcreditable,
    p_litros_diesel: liq.litrosDieselAcreditables ?? 0,
    p_iva: liq.ivaAcreditable,
    p_peaje: liq.peajeAcreditable,
    p_pdf_url: pdfUrl ?? null,
  }), 'saveLiquidacion');
  if (error) throw new Error(`saveLiquidacion: ${error.message}`);
  return data as string;
}

// ── Aviso de privacidad (mig. 0018) ──────────────────────────────────────────
// El obligado es el RESPONSABLE, o sea la FLOTA (LFPDPPP art. 14). Likida es
// persona encargada y solo pone el mecanismo: sin él, la flota no puede cumplir
// aunque quiera. Detalle verificado en normas/lfpdppp-15-16.yaml.

/**
 * Datos de responsable de la flota, para armar el aviso. `null` en cualquiera
 * significa que el tenant no está configurado — y ahí NO se envía nada, porque
 * un aviso sin responsable no dice a quién reclamarle, que es para lo que sirve.
 */
export async function getDatosResponsable(
  tenantId: string,
): Promise<DatosIntegral | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('tenant')
    // `contacto_privacidad` (0034) es el art. 29 y solo lo usa el aviso
    // INTEGRAL. Se trae aquí, y no en una segunda consulta, porque es el mismo
    // renglón: pedirlo aparte sería otro viaje a la base para tres columnas que
    // ya vienen juntas — y la regla del repo es que el acceso a datos no se
    // duplique, que es el hallazgo que lleva cinco rondas subiendo.
    .select('razon_social, domicilio_fiscal, url_aviso_privacidad, contacto_privacidad')
    .eq('id', tenantId)
    .maybeSingle(), 'getDatosResponsable');
  if (error) throw new Error(`getDatosResponsable: ${error.message}`);
  if (!data) return null;
  const r = {
    razonSocial: (data.razon_social as string) ?? '',
    domicilio: (data.domicilio_fiscal as string) ?? '',
    urlAvisoIntegral: (data.url_aviso_privacidad as string) ?? '',
    contactoPrivacidad: (data.contacto_privacidad as string | null) ?? null,
  };
  // La URL del integral NO se exige aquí. Devolver `null` por su ausencia hacía
  // que el operador no recibiera NADA: el aviso simplificado sí se puede armar
  // sin ella —las fracciones I a IV del art. 15 caben enteras en el mensaje— y
  // callarse cumple menos que mandarlo diciendo que la empresa aún no lo publica.
  // Razón social y domicilio sí se exigen: son la fr. I y no se pueden fingir.
  return r.razonSocial && r.domicilio ? r : null;
}

/**
 * RESERVA el envío del aviso. Devuelve `true` si ESTE llamado ganó la reserva —
 * o sea, si le toca enviarlo.
 *
 * NO deja constancia: eso es `confirmarEnvioAviso`, y solo tras un envío que
 * Meta acusó. Hasta la 0033 esta función escribía las dos cosas en la misma
 * fila, y de ahí salían los dos fallos: una constancia falsa cuando el envío no
 * salía, y la DESTRUCCIÓN de una constancia buena cuando el aviso cambiaba de
 * versión y el reenvío fallaba.
 *
 * La reserva vive en SQL (igual que en la 0017): el primer mensaje puede llegar
 * por dos caminos a la vez y sin ella el operador recibiría el aviso dos o tres
 * veces seguidas. Expira a los 5 minutos, para que un proceso que muera entre
 * reservar y confirmar no deje a un operador sin aviso para siempre.
 *
 * Se reenvía cuando la versión cambia: el art. 15 fr. VI obliga a comunicar los
 * cambios al aviso.
 */
export async function reclamarEnvioAviso(
  tenantId: string,
  operadorId: string,
  version: string,
): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin().rpc('marcar_aviso_privacidad', {
    p_operador: operadorId,
    p_tenant: tenantId,
    p_version: version,
  }), 'reclamarEnvioAviso');
  if (error) throw new Error(`reclamarEnvioAviso: ${error.message}`);
  return data === true;
}

/**
 * Deja CONSTANCIA del art. 16 de la LFPDPPP: se le puso el aviso a disposición.
 *
 * Va DESPUÉS del envío y solo si Meta devolvió un id de mensaje. Es lo único en
 * todo el sistema que escribe `aviso_privacidad_en`.
 *
 * Que devuelva `false` es grave y por eso se registra como error: el mensaje SÍ
 * salió y la prueba no quedó escrita. El operador recibirá el aviso otra vez
 * cuando expire la reserva —molesto pero inocuo—; lo que no puede quedarse sin
 * mirar es que la constancia no se escribiera.
 */
export async function confirmarEnvioAviso(
  tenantId: string,
  operadorId: string,
  version: string,
): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().rpc('confirmar_aviso_privacidad', {
    p_operador: operadorId,
    p_tenant: tenantId,
    p_version: version,
  }), 'confirmarEnvioAviso');
  if (error) {
    logger.error('privacidad.constancia_no_escrita', { tenantId, operadorId, err: error.message });
    return;
  }
  // `false` es "no tocó ninguna fila": el operador no existe o es de otra flota.
  // Sin este ramo, un fallo de aislamiento entre tenants se vería igual que un
  // éxito. PostgREST devuelve el resultado POR VALOR, no lanzando.
  if (data !== true) logger.error('privacidad.constancia_sin_fila', { tenantId, operadorId });
}

/**
 * Suelta la RESERVA cuando el envío no salió, para que el siguiente mensaje
 * reintente. NO toca la constancia, y ahí está todo el asunto.
 *
 * Antes ponía `aviso_privacidad_en` y `aviso_privacidad_version` en NULL, porque
 * hasta la 0033 la reserva y la constancia eran la misma fila. Eso arreglaba la
 * constancia falsa del 28-jul —la base afirmó que un operador recibió su aviso
 * diez minutos antes del commit que arregló el destinatario que Meta rechazaba—
 * pero abría el fallo inverso, y peor:
 *
 *   El operador recibió el aviso v1 hace tres meses. La flota corrige la liga de
 *   su aviso integral → el texto cambia → v2. Llega un mensaje, la reserva gana
 *   porque la versión es distinta, el envío falla, y esta función borraba las dos
 *   columnas. La base pasa a decir que ese operador NUNCA recibió ningún aviso.
 *
 * Ante la autoridad la carga de probar el art. 16 es del responsable, así que
 * "no consta" es el peor estado posible — y se llegaba a él destruyendo una
 * prueba verdadera. Resolver la liga del aviso es una tarea abierta: el paso 1
 * de ese escenario está agendado.
 */
export async function liberarEnvioAviso(tenantId: string, operadorId: string): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().rpc('liberar_aviso_privacidad', {
    p_operador: operadorId,
    p_tenant: tenantId,
  }), 'liberarEnvioAviso');
  if (error) {
    logger.error('privacidad.liberar_falló', { tenantId, operadorId, err: error.message });
    return;
  }
  // No es error: la reserva pudo expirar sola por TTL entre el envío fallido y
  // esta llamada. Se registra porque significa que el siguiente mensaje reintenta
  // por otro motivo del esperado, y eso cambia cómo se lee el log.
  if (data !== true) logger.warn('privacidad.liberar_sin_reserva', { tenantId, operadorId });
}

// ── Acumulados del ejercicio (Fase 1: la capa de periodo) ────────────────────

/**
 * Pagos de combustible del ejercicio, separando efectivo del total.
 *
 * Es el denominador del 15% de la RFA 2026 regla 2.9, y por eso cuenta SOLO
 * combustible: la base es combustible contra combustible, no contra el gasto
 * total de la flota. Ese denominador equivocado haría parecer holgada a una
 * flota que ya se pasó.
 *
 * Se calcula desde `gasto` sin tabla nueva: `forma_pago` y `concepto` ya
 * existen. Los duplicados y los montos no positivos quedan fuera por el mismo
 * criterio que usa el motor — si no cuentan para el cuadre, tampoco para el
 * contador.
 *
 * `formaPago` '01' es efectivo en el catálogo del SAT. Un gasto SIN forma de
 * pago no se cuenta como efectivo: no se sabe, y suponerlo inflaría el
 * numerador contra la flota.
 *
 * ── POR QUÉ ESTO SE PAGINA Y NO SE PIDE DE UN JALÓN ─────────────────────────
 *
 * Esta consulta no llevaba `.limit()` ni `.range()`, y eso NO significaba "trae
 * todo": significaba "trae lo que PostgREST quiera darme". `max_rows` (Settings
 * → API en Supabase) recorta la respuesta EN SILENCIO —sin error, sin cabecera
 * que el cliente mire, sin nada— y el default de la plataforma son 1 000 filas.
 *
 * Una flota de 50 operadores hace ~18 000 cargas de diésel al año. Con el
 * recorte puesto, este contador leería el 5% de ellas y devolvería un acumulado
 * bajo, coherente y falso. Y no es un número de adorno: es el DENOMINADOR del
 * 15% de combustible en efectivo de la RFA 2026 regla 2.9. Un denominador
 * recortado hace parecer holgada a una flota que ya se pasó, que es justo el
 * error que el comentario de arriba dice venir a evitar.
 *
 * Se pide `count: 'exact'` en la primera página —que viene en la misma
 * respuesta, sin viaje de red extra— para saber cuántas filas hay DE VERDAD
 * frente a cuántas entregó el servidor. Con eso: si el tenant cabe en una
 * página (el caso normal hoy) se paga exactamente una consulta, igual que
 * antes; y si no cabe, se sabe y se sigue paginando en vez de suponer.
 *
 * El orden es `fecha, id` y no `id`: `idx_gasto_acumulado` (mig. 0023) es
 * `(tenant_id, concepto, fecha)`, así que ese orden sale del índice y la
 * paginación no le añade un sort. `id` desempata para que `range` sea estable.
 */
export async function getAcumuladoCombustible(
  tenantId: string,
  ejercicio: number,
): Promise<{ efectivo: number; totalCombustible: number }> {
  const PAGINA = 1_000;
  // 100 páginas son 100 000 cargas de diésel en un ejercicio. Un tenant que las
  // pase no necesita más vueltas, necesita que esto sea un `sum()` en SQL: cien
  // viajes de red no caben en el presupuesto del turno. Se corta y se dice.
  const MAX_PAGINAS = 100;

  let efectivo = 0;
  let totalCombustible = 0;
  let leidas = 0;
  let esperadas = 0;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error, count } = await acotada(supabaseAdmin()
      .from('gasto')
      // El `count` solo en la primera vuelta: viene en la misma respuesta, así
      // que saber cuántas filas hay DE VERDAD no cuesta un viaje de red extra,
      // pero pedirlo en cada página sí haría contar de más.
      .select('monto, forma_pago', pagina === 0 ? { count: 'exact' } : {})
      .eq('tenant_id', tenantId)
      .eq('concepto', 'diesel')
      .gte('fecha', `${ejercicio}-01-01`)
      .lte('fecha', `${ejercicio}-12-31`)
      .order('fecha')
      .order('id')
      .range(leidas, leidas + PAGINA - 1), 'getAcumuladoCombustible');
    if (error) throw new Error(`getAcumuladoCombustible: ${error.message}`);

    const filas = data ?? [];
    if (pagina === 0) esperadas = count ?? filas.length;

    for (const g of filas) {
      const monto = Number(g.monto);
      if (!Number.isFinite(monto) || monto <= 0) continue;
      totalCombustible += monto;
      if (g.forma_pago === '01') efectivo += monto;
    }
    leidas += filas.length;

    // Sin filas nuevas no hay progreso posible: cortar aquí es lo que impide que
    // un `max_rows` de 0 o una respuesta rara conviertan esto en un bucle infinito
    // dentro del presupuesto del turno.
    if (!filas.length || leidas >= esperadas) break;
  }

  if (leidas < esperadas) {
    // Fail-closed, igual que el resto del camino del dinero: devolver el
    // acumulado de la mitad de las cargas es afirmar una cifra fiscal que no se
    // midió, y a la baja es la dirección que nadie revisa.
    logger.error('gasto.acumulado_incompleto', { tenantId, ejercicio, leidas, esperadas });
    throw new Error(`getAcumuladoCombustible: solo se leyeron ${leidas} de ${esperadas} cargas del ejercicio ${ejercicio}`);
  }

  return { efectivo: Math.round(efectivo * 100) / 100, totalCombustible: Math.round(totalCombustible * 100) / 100 };
}
