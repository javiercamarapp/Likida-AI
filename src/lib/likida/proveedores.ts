import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { traerTodo, conteo } from './pg';
import type { CfdiXmlData } from './intake/cfdi_xml';
import { consultarCFDI, type EstadoSat } from './intake/sat';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAS DE PROVEEDOR (0091 + 0108, F6 del plan) — el ciclo que Transportes
// Innovativos captura a mano en su ERP: llega la factura del taller o la
// refaccionaria (XML por correo/panel, o FOTO), un humano la aprueba o
// rechaza, y lo aprobado sale en un layout importable a SAP B1/CONTPAQi.
//
// Las DOS vías de entrada no pesan lo mismo, y la diferencia se guarda:
//   · XML (parseCfdiXml) — dato duro del CFDI. `ocr_confianza` queda NULL.
//   · FOTO (extraerComprobante) — cifra LEÍDA por visión. `ocr_confianza`
//     marca la fila para que la cola la priorice a revisión: una cifra de
//     OCR jamás se enseña como si fuera dato duro.
// El escalón 3 (escritura directa al Service Layer de SAP B1) NO vive aquí:
// espera credenciales de un cliente y está documentado en
// docs/conocimiento/diagrama-flujo-sap-b1.md — ninguna función lo afirma.
// ═══════════════════════════════════════════════════════════════════════════

export interface FacturaProveedor {
  id: string;
  cfdiUuid: string;
  emisorRfc: string | null;
  emisorNombre: string | null;
  receptorRfc: string | null;
  /** ¿El receptor era el RFC de la flota AL INGERIR? null = la flota no
   *  tenía RFC capturado ese día y no se pudo validar — se dice, no se asume. */
  receptorEsFlota: boolean | null;
  fecha: string | null;
  subTotal: number | null;
  iva: number | null;
  total: number;
  descripcion: string | null;
  conceptos: number;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  decididoPor: string | null;
  decididoEn: string | null;
  creadoEn: string;
  /** null = fila anterior a la 0108: el origen no se rastreaba y no se adivina. */
  origen: 'correo' | 'subida' | null;
  /** Confianza 0-1 de la extracción por visión. null = entró por XML (dato duro). */
  ocrConfianza: number | null;
  /** ConsultaCFDIService al ingerir. null = no se consultó (filas pre-0108);
   *  'pendiente' = SE INTENTÓ y el SAT no contestó — son cosas distintas. */
  estadoSat: EstadoSat | null;
  /** Primera vez que salió en un export CSV. Marca anti-doble-import. */
  exportadaEn: string | null;
}

export type ResultadoIngesta =
  | { ok: true; facturaId: string; receptorEsFlota: boolean | null }
  | { ok: false; motivo: 'duplicada' | 'error' };

/** La Descripcion del PRIMER Concepto, directo del XML crudo — el parser de
 *  cfdi_xml.ts no la extrae (su ciclo no la necesita) y es el campo más
 *  humano de la bandeja. Regex sobre atributo, con las cinco entidades XML
 *  básicas decodificadas. null = el XML no la trae. */
export function leerDescripcionPrimerConcepto(xmlCrudo: string): string | null {
  const m = /<(?:cfdi:)?Concepto\b[^>]*\bDescripcion="([^"]*)"/i.exec(xmlCrudo);
  if (!m) return null;
  const texto = m[1]
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
  return texto ? texto.slice(0, 200) : null;
}

/** ¿El receptor del CFDI es el RFC de la flota? `null` cuando falta
 *  cualquiera de los dos: un `false` afirmaría "no es tuya" sin haber
 *  podido comparar. */
export function compararReceptor(rfcReceptor: string | null | undefined, rfcFlota: string | null): boolean | null {
  if (!rfcFlota || !rfcReceptor) return null;
  return rfcReceptor.trim().toUpperCase() === rfcFlota.trim().toUpperCase();
}

/** Lo MÍNIMO que un CFDI necesita para entrar a la bandeja: folio fiscal
 *  (la llave del dedup) y total (la cifra que se aprueba). PURA para que la
 *  prueba fije el contrato sin tocar la base. */
export function cfdiIngresable(xml: Pick<CfdiXmlData, 'uuid' | 'total'>): boolean {
  return Boolean(xml.uuid) && typeof xml.total === 'number';
}

/**
 * El estatus del CFDI ante el SAT, para guardarse AL INGERIR. `consultarCFDI`
 * jamás lanza (timeout corto → 'pendiente'), así que esto no puede tumbar ni
 * al webhook del buzón ni a la subida por pantalla. `null` = sin UUID no hay
 * qué consultar — distinto de 'pendiente', que afirma que se intentó.
 */
export async function estadoSatDeCfdi(xml: CfdiXmlData): Promise<EstadoSat | null> {
  if (!xml.uuid) return null;
  const r = await consultarCFDI({ re: xml.rfcEmisor, rr: xml.rfcReceptor, tt: xml.total, id: xml.uuid });
  return r.estado;
}

/**
 * Aterriza un CFDI de proveedor en la bandeja. El dedup vive en la BASE
 * (unique tenant+uuid): la misma factura subida dos veces se dice
 * `duplicada`, nunca dos filas.
 *
 * `rfcFlota` viene del caller (la página ya lo resolvió); null = la flota no
 * tiene RFC capturado y la bandera queda null — un `false` afirmaría que el
 * receptor NO es la flota sin haber podido comparar.
 */
export async function guardarFacturaProveedor(
  tenantId: string,
  xml: CfdiXmlData,
  xmlCrudo: string,
  rfcFlota: string | null,
  /** De dónde vino el XML: 'correo' (buzón) o 'subida' (panel). El caller lo
   *  sabe con certeza; adivinarlo aquí sería inventar un dato. */
  origen: 'correo' | 'subida',
  /** Estatus SAT ya consultado por el caller (`estadoSatDeCfdi`). Va como
   *  parámetro y no como llamada interna para que este escritor siga siendo
   *  solo eso — un escritor — y el caller decida cuándo pagar la consulta. */
  estadoSat: EstadoSat | null = null,
): Promise<ResultadoIngesta> {
  if (!cfdiIngresable(xml)) return { ok: false, motivo: 'error' };

  const receptorEsFlota = compararReceptor(xml.rfcReceptor, rfcFlota);

  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .insert({
      tenant_id: tenantId,
      cfdi_uuid: xml.uuid,
      emisor_rfc: xml.rfcEmisor ?? null,
      emisor_nombre: null,
      receptor_rfc: xml.rfcReceptor ?? null,
      receptor_es_flota: receptorEsFlota,
      fecha: xml.fecha ? xml.fecha.slice(0, 10) : null,
      sub_total: typeof xml.subTotal === 'number' ? xml.subTotal : null,
      iva: xml.ivaTraslado || null,
      total: xml.total,
      descripcion: leerDescripcionPrimerConcepto(xmlCrudo),
      conceptos: Math.max(1, xml.conceptos.length),
      xml_crudo: xmlCrudo,
      origen,
      estado_sat: estadoSat,
    })
    .select('id')
    .single(), 'proveedores.guardar');

  if (error) {
    if (error.code === '23505') return { ok: false, motivo: 'duplicada' };
    logger.error('proveedores.guardar_fallo', { tenantId, err: error.message });
    return { ok: false, motivo: 'error' };
  }
  return { ok: true, facturaId: (data as { id: string }).id, receptorEsFlota };
}

// ── La vía de FOTO (0108) ──────────────────────────────────────────────────

export type MotivoFotoInvalida = 'ilegible' | 'sin_uuid' | 'sin_total';

export type ResultadoIngestaFoto =
  | { ok: true; facturaId: string; receptorEsFlota: boolean | null; ocrConfianza: number }
  | { ok: false; motivo: MotivoFotoInvalida | 'duplicada' | 'error' };

/**
 * ¿Lo que la visión leyó alcanza para entrar a la bandeja? PURA y separada
 * del escritor para que la prueba fije las tres puertas:
 *
 *   · `ilegible` — el modelo mismo dijo que no pudo leer el papel.
 *   · `sin_uuid` — sin folio fiscal no hay llave de dedup NI factura que
 *     importar al ERP. La representación impresa de un CFDI SIEMPRE trae el
 *     QR con el UUID, así que exigirlo no recorta el caso real: recorta las
 *     fotos donde el QR salió movido — y ahí lo honesto es pedir otra foto
 *     o el XML, no inventar una llave.
 *   · `sin_total` — una factura de $0 leída por OCR no es una cifra, es la
 *     ausencia de una.
 */
export function validarFotoParaIngreso(
  g: Pick<Gasto, 'cfdiUuid' | 'monto'>,
  legible: boolean,
): { ok: true } | { ok: false; motivo: MotivoFotoInvalida } {
  if (!legible) return { ok: false, motivo: 'ilegible' };
  if (!g.cfdiUuid) return { ok: false, motivo: 'sin_uuid' };
  if (!(g.monto > 0)) return { ok: false, motivo: 'sin_total' };
  return { ok: true };
}

/**
 * Aterriza una factura de proveedor desde su FOTO. Mismo dedup de base que la
 * vía XML (unique tenant+uuid: una foto de la factura cuyo XML ya entró por
 * el buzón rebota como `duplicada`, no como segunda fila).
 *
 * Lo que se guarda es SOLO lo leído — sub_total si la visión lo leyó, `iva`
 * NUNCA (el desglose de impuestos exige el XML; un IVA "leído" de un ticket
 * alimentaría el acreditamiento con una adivinanza) — y `ocr_confianza`
 * marca la fila entera como cifra-por-revisar.
 *
 * `extraerComprobante` entra por import dinámico a propósito: carga el
 * cliente de visión y el decodificador de códigos, que ni la bandeja ni las
 * pruebas de este módulo necesitan.
 */
export async function ingresarFacturaDesdeFoto(
  tenantId: string,
  imagenes: string | string[],
  rfcFlota: string | null,
): Promise<ResultadoIngestaFoto> {
  const { extraerComprobante } = await import('./intake/ocr');
  const r = await extraerComprobante(imagenes);
  const puerta = validarFotoParaIngreso(r.gasto, r.legible);
  if (!puerta.ok) return puerta;

  const g = r.gasto;
  const receptorEsFlota = compararReceptor(g.rfcReceptor, rfcFlota);
  // 0 = "el modelo no declaró confianza". Es el piso, no un promedio: deja la
  // fila en lo más urgente de revisar — fallar cerrado, nunca inventar un 0.9.
  const ocrConfianza = typeof g.ocrConfianza === 'number' ? g.ocrConfianza : 0;
  const producto = g.ocrExtra && typeof g.ocrExtra.producto === 'string' ? g.ocrExtra.producto : null;

  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .insert({
      tenant_id: tenantId,
      cfdi_uuid: g.cfdiUuid,
      emisor_rfc: g.rfcEmisor ?? null,
      emisor_nombre: null,
      receptor_rfc: g.rfcReceptor ?? null,
      receptor_es_flota: receptorEsFlota,
      fecha: g.fecha ? g.fecha.slice(0, 10) : null,
      sub_total: typeof g.subTotal === 'number' ? g.subTotal : null,
      iva: null,
      total: g.monto,
      descripcion: producto,
      conceptos: 1,
      xml_crudo: null,
      origen: 'subida',
      ocr_confianza: ocrConfianza,
      // `extraerComprobante` ya consultó al SAT con el UUID del QR; si el SAT
      // no contestó viene 'pendiente' — que es la verdad, no un hueco.
      estado_sat: g.estadoSat ?? null,
    })
    .select('id')
    .single(), 'proveedores.guardar_foto');

  if (error) {
    if (error.code === '23505') return { ok: false, motivo: 'duplicada' };
    logger.error('proveedores.guardar_foto_fallo', { tenantId, err: error.message });
    return { ok: false, motivo: 'error' };
  }
  return { ok: true, facturaId: (data as { id: string }).id, receptorEsFlota, ocrConfianza };
}

/** Las columnas que leen la bandeja y el export — UNA lista para que no se
 *  separen. */
const COLUMNAS_FACTURA = 'id, cfdi_uuid, emisor_rfc, emisor_nombre, receptor_rfc, receptor_es_flota, fecha, sub_total, iva, total, descripcion, conceptos, estado, decidido_por, decidido_en, created_at, origen, ocr_confianza, estado_sat, exportada_en';

function aFactura(f: Record<string, unknown>): FacturaProveedor {
  return {
    id: f.id as string,
    cfdiUuid: f.cfdi_uuid as string,
    emisorRfc: (f.emisor_rfc as string) ?? null,
    emisorNombre: (f.emisor_nombre as string) ?? null,
    receptorRfc: (f.receptor_rfc as string) ?? null,
    receptorEsFlota: typeof f.receptor_es_flota === 'boolean' ? f.receptor_es_flota : null,
    fecha: (f.fecha as string) ?? null,
    subTotal: f.sub_total === null ? null : Number(f.sub_total),
    iva: f.iva === null ? null : Number(f.iva),
    total: Number(f.total),
    descripcion: (f.descripcion as string) ?? null,
    conceptos: Number(f.conceptos ?? 1),
    estado: f.estado as FacturaProveedor['estado'],
    decididoPor: (f.decidido_por as string) ?? null,
    decididoEn: (f.decidido_en as string) ?? null,
    creadoEn: f.created_at as string,
    origen: (f.origen as FacturaProveedor['origen']) ?? null,
    ocrConfianza: f.ocr_confianza === null || f.ocr_confianza === undefined ? null : Number(f.ocr_confianza),
    estadoSat: (f.estado_sat as EstadoSat) ?? null,
    exportadaEn: (f.exportada_en as string) ?? null,
  };
}

/** La bandeja, lo más nuevo arriba. `estado` opcional: el export solo quiere
 *  las aprobadas y filtrarlas en la BASE es más honesto que traer todo y
 *  recortar en memoria contra el tope de `limite`. */
export async function listarFacturasProveedor(
  tenantId: string,
  limite = 100,
  estado?: FacturaProveedor['estado'],
): Promise<FacturaProveedor[]> {
  let consulta = supabaseAdmin()
    .from('factura_proveedor')
    .select(COLUMNAS_FACTURA)
    .eq('tenant_id', tenantId);
  if (estado) consulta = consulta.eq('estado', estado);
  const { data, error } = await acotada(
    consulta.order('created_at', { ascending: false }).limit(limite),
    'proveedores.listar',
  );
  if (error) throw new Error(`listarFacturasProveedor: ${error.message}`);
  return (data ?? []).map(aFactura);
}

/**
 * La decisión del humano. El `.eq('estado', 'pendiente')` es el candado
 * anti-carrera: dos personas decidiendo la misma factura — el segundo clic
 * se entera, no pisa al primero.
 */
export async function decidirFacturaProveedor(
  tenantId: string,
  facturaId: string,
  decision: 'aprobada' | 'rechazada',
  decididoPor: string,
): Promise<{ error?: string }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .update({ estado: decision, decidido_por: decididoPor, decidido_en: new Date().toISOString() })
    .eq('id', facturaId)
    .eq('tenant_id', tenantId)
    .eq('estado', 'pendiente')
    .select('id'), 'proveedores.decidir');
  if (error) {
    logger.error('proveedores.decidir_fallo', { tenantId, facturaId, err: error.message });
    return { error: 'No se pudo guardar la decisión. Inténtalo de nuevo.' };
  }
  if (!data || data.length === 0) {
    return { error: 'Esa factura ya no está pendiente — alguien más la decidió. Recarga la página.' };
  }
  return {};
}

// ═══════════════════════════════════════════════════════════════════════════
// EL EXPORT (escalón 2 de F6) — el archivo que TODOS pueden importar.
//
// Tres layouts, los tres PUROS para que la prueba fije el contrato: si una
// columna cambia de nombre, el import del cliente se rompe y eso debe fallar
// aquí primero.
//
// LA REGLA DE HONESTIDAD DE LOS TRES: son el layout ESTÁNDAR de importación,
// no una compatibilidad certificada — el rótulo en pantalla manda a validarlo
// con el contador o el consultor SAP antes del primer import. Y ningún campo
// que viva en el sistema del CLIENTE se adivina: `CardCode` (su catálogo de
// proveedores), `TaxCode` (su catálogo fiscal) y `DocDueDate` (su condición
// de pago) salen VACÍOS a propósito, porque un valor inventado no falla
// ruidosamente — importa mal y ensucia un cierre contable (la misma doctrina
// escrita en `conectores/erp.ts`).
// ═══════════════════════════════════════════════════════════════════════════

export type FormatoExport = 'generico' | 'sap_b1' | 'contpaqi';

/** El layout genérico (Excel / cualquier sistema) — el de la 0091, intacto:
 *  ya hay quien lo descarga y renombrarle una columna rompería su import. */
export function aFilaExportProveedor(f: FacturaProveedor): Record<string, string | number> {
  return {
    fecha: f.fecha ?? '',
    uuid: f.cfdiUuid,
    rfc_emisor: f.emisorRfc ?? '',
    rfc_receptor: f.receptorRfc ?? '',
    descripcion: f.descripcion ?? '',
    conceptos: f.conceptos,
    subtotal: f.subTotal ?? '',
    iva: f.iva ?? '',
    total: f.total,
    aprobada_por: f.decididoPor ?? '',
    aprobada_en: f.decididoEn ?? '',
  };
}

/**
 * Layout SAP Business One — los nombres de campo del import estándar de
 * facturas de compra (Excel/DTW: cabecera OPCH + línea PCH1), UNA fila por
 * factura porque la bandeja guarda cabecera + primer concepto:
 *
 *   DocDate         fecha del documento, AAAAMMDD (el formato del DTW)
 *   DocDueDate      VACÍO — la define la condición de pago del cliente
 *   CardCode        VACÍO — el código del proveedor vive en SU SAP
 *   CardName        razón social del emisor (si el XML la trajo)
 *   FederalTaxID    RFC del emisor (localización MX)
 *   NumAtCard       referencia del proveedor: el UUID del CFDI
 *   Comments        el concepto de la factura
 *   DocTotal        total con impuestos
 *   ItemDescription descripción de la línea 1
 *   LineTotal       subtotal (sin impuestos) — vacío si el dato no está
 *   TaxCode         VACÍO — catálogo fiscal del cliente
 */
export function aFilaSapB1(f: FacturaProveedor): Record<string, string | number> {
  return {
    DocDate: f.fecha ? f.fecha.replace(/-/g, '') : '',
    DocDueDate: '',
    CardCode: '',
    CardName: f.emisorNombre ?? '',
    FederalTaxID: f.emisorRfc ?? '',
    NumAtCard: f.cfdiUuid,
    Comments: f.descripcion ?? '',
    DocTotal: f.total,
    ItemDescription: f.descripcion ?? '',
    LineTotal: f.subTotal ?? '',
    TaxCode: '',
  };
}

/**
 * Variante CONTPAQi SIMPLE — columnas en español y fecha dd/mm/aaaa, que es
 * como captura el contador mexicano. NO es el TXT de pólizas de CONTPAQi:
 * ese formato lo define el esquema (`CT_EST_Poliza_WIN_*.xls`) que vive en la
 * máquina de CADA contador, y la decisión del repo (`conectores/erp.ts`) es
 * escribirlo contra el archivo de ejemplo de la primera flota que lo pida —
 * nunca adivinado. Esta hoja es el paso previo: todo lo que la póliza
 * necesita, listo para que su esquema lo mapee.
 *
 *   fecha · rfc_proveedor · nombre_proveedor · uuid_fiscal · concepto ·
 *   subtotal · iva · total
 */
export function aFilaContpaqi(f: FacturaProveedor): Record<string, string | number> {
  return {
    fecha: fechaDdMmAaaa(f.fecha),
    rfc_proveedor: f.emisorRfc ?? '',
    nombre_proveedor: f.emisorNombre ?? '',
    uuid_fiscal: f.cfdiUuid,
    concepto: f.descripcion ?? '',
    subtotal: f.subTotal ?? '',
    iva: f.iva ?? '',
    total: f.total,
  };
}

/** `2026-08-10` → `10/08/2026`. Local y no en `lib/formato.ts` a propósito:
 *  aquello formatea para PANTALLA (es-MX, TZ); esto es el contrato de un
 *  archivo de importación y debe ser estable aunque el display cambie. */
function fechaDdMmAaaa(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/**
 * TODAS las facturas aprobadas de la flota, demostrado.
 *
 * ESC-8 (escala 50k): el export pedía `listarFacturasProveedor(t, 5000)`, y
 * `.limit(5000)` NO trae 5,000 — PostgREST recorta a `max_rows` (1,000) sin
 * avisar, así que `recortado` (`length === 5000`) no se cumplía jamás y una
 * flota con 1,001+ aprobadas mandaba al ERP un archivo corto con cara de
 * completo. `traerTodo` pagina por `range` (cada página cabe bajo el techo)
 * con `count` exacto en la primera, y si no puede demostrar que trajo todo
 * LANZA `LecturaIncompleta` — el caller la convierte en un error que se dice.
 * Orden `created_at desc, id desc`: el desempate único que el cursor de
 * `range` exige (pg.ts).
 */
export async function listarAprobadasCompletas(tenantId: string): Promise<FacturaProveedor[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin()
      .from('factura_proveedor')
      .select(COLUMNAS_FACTURA, conteo(d))
      .eq('tenant_id', tenantId)
      .eq('estado', 'aprobada')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(d, h), 'proveedores.aprobadas'),
    'proveedores.aprobadas',
  );
  return filas.map(aFactura);
}

/**
 * Las filas del export en el layout pedido, con los ids para poder marcarlas
 * después. Trae TODAS las aprobadas — también las ya exportadas, porque el
 * archivo se pierde, el contador lo vuelve a pedir, y negárselo lo mandaría
 * a recapturar a mano. El anti-doble-import no es ocultarlas: es la marca
 * `exportada_en` visible en la bandeja.
 *
 * Lanza `LecturaIncompleta` (pg.ts) si no puede demostrar que trajo todas:
 * no existe la salida "archivo corto".
 */
export async function exportarAprobadas(
  tenantId: string,
  formato: FormatoExport,
): Promise<{ filas: Record<string, string | number>[]; ids: string[] }> {
  const aprobadas = await listarAprobadasCompletas(tenantId);
  const mapa = formato === 'sap_b1' ? aFilaSapB1 : formato === 'contpaqi' ? aFilaContpaqi : aFilaExportProveedor;
  return {
    filas: aprobadas.map(mapa),
    ids: aprobadas.map((f) => f.id),
  };
}

/**
 * Marca `exportada_en` en las que salieron por primera vez. Solo donde está
 * NULL: la fecha que importa es la del PRIMER export (después de esa, la
 * factura ya pudo entrar al ERP y re-marcar taparía cuándo). Reporta POR
 * VALOR: si el marcado falla, el CSV ya se generó y el caller decide cómo
 * decirlo — nunca se tumba una descarga por no poder anotar.
 */
export async function marcarExportadas(tenantId: string, ids: string[]): Promise<{ error?: string }> {
  if (ids.length === 0) return {};
  const { error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .update({ exportada_en: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('estado', 'aprobada')
    .is('exportada_en', null)
    .in('id', ids), 'proveedores.marcar_exportadas');
  if (error) {
    logger.error('proveedores.marcar_exportadas_fallo', { tenantId, err: error.message });
    return { error: error.message };
  }
  return {};
}
