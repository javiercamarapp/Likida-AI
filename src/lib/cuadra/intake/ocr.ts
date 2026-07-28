// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — INTAKE / OCR de comprobantes.
//
// Fusiona visión + extracción JSON en UNA llamada (Gemini Flash con schema).
// Estrategia de precisión (de la investigación):
//   1. Pedir confianza por documento + "legible": bool → alimenta el umbral.
//   2. Decodificar el QR del CFDI y SOBRESCRIBIR uuid/rfc/total del OCR con el
//      del QR (0% de error vs leer 36 chars con visión).
//   3. Validar RFC/UUID por regex (el JSON válido no garantiza el valor).
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { generateStructured, StructuredError, TruncatedError } from '@/lib/llm/openrouter';
import { decodeCodigosFromImage, bufferFromDataUrl, esRfcValido, esUuidValido, rfcChecksumOk } from './cfdi';
import { normalizarFecha } from './fecha';
import { sanitizarFolio, sanitizarTexto } from './sanitizar';
import { consultarCFDI } from './sat';
import type { Gasto, ConceptoGasto, EstadoSat } from '@/types/cuadra';

const ExtraccionSchema = z.object({
  concepto: z.enum(['diesel', 'caseta', 'factura', 'viaticos', 'otro']),
  producto: z.string().nullable(),        // "Diesel", "Regular", "Premium", "GSuper", "Magna"
  monto: z.number().nullable(),           // TOTAL
  subtotal: z.number().nullable(),        // si viene desglosado
  iva_monto: z.number().nullable(),       // IVA en pesos, TAL CUAL aparece (no lo calcules)
  iva_tasa: z.number().nullable(),        // tasa LEÍDA en el ticket (0.16, 0.08), o null si no aparece
  litros: z.number().nullable(),
  precio_unitario: z.number().nullable(),
  forma_pago: z.enum(['efectivo', 'tarjeta', 'otro']).nullable(),
  fecha: z.string().nullable(),
  folio: z.string().nullable(),           // CRUDO, tal cual (conserva ceros a la izquierda)
  web_id: z.string().nullable(),          // string (numérico o alfanumérico)
  estacion: z.string().nullable(),        // nombre/# de estación
  rfc_emisor: z.string().nullable(),
  cfdi_uuid: z.string().nullable(),
  // Liga de autofacturación impresa en el ticket. Un ticket de estación NO es
  // factura: hay que timbrarlo en el portal del emisor dentro del plazo, y cada
  // franquicia tiene el suyo. Leerla del ticket cubre cualquier marca; un
  // catálogo hardcodeado siempre va perdiendo (son cientos de franquicias).
  url_facturacion: z.string().nullable(),
  confianza: z.number().min(0).max(1),
  legible: z.boolean(),
});

const SYSTEM = `Eres un extractor de datos de comprobantes de gasto de transporte en México (tickets de gasolinera de diésel/gasolina, casetas, facturas CFDI). Extrae los campos de la imagen a JSON.

REGLAS DURAS:
- Si un campo NO es claramente legible, devuélvelo null. NUNCA inventes ni CALCULES: montos, folios, RFC, UUID, IVA ni tasas. Lee lo que está impreso.
- "confianza" = qué tan seguro estás de haber leído bien el monto y el folio (0 a 1).
- "legible": false si la foto está tan borrosa/cortada que no confías en el monto.
- concepto: diesel (combustible/gasolinera, sea diésel o gasolina), caseta (peaje/autopista), factura (CFDI fiscal), viaticos (comida/hospedaje), otro.
- monto: el TOTAL del comprobante, solo el número.

MAPEO DE ETIQUETAS (mapea el CONCEPTO, no la etiqueta literal; varían por estación):
- folio ← "FOLIO" / "NOTA" / "NUM VENTA" / "NUM. VENTA".
- web_id ← "WEB ID" / "WebID" (trátalo como string; puede ser numérico "65038155" o alfanumérico "006A").
- estacion ← "ESTACION" / "EST" / "EST.".
- litros ← "LITROS" / "CANTIDAD" / "CANT-LTS" / "CANT/LTS" / "U.M." (la cantidad en litros).
- forma_pago ← "FORMA DE PAGO" / "TIPO OPER" / "TIPO DE OPERACION" → 'efectivo' o 'tarjeta'.
- precio_unitario ← "PRECIO" (por litro).
- url_facturacion ← la dirección web impresa para FACTURAR el ticket ("INSTRUCCIONES PARA FACTURAR: Ingrese a www.ejemplo.com.mx", "Factura en: portal.ejemplo.mx", "DATOS PARA REIMPRESION DE FACTURA: www.ejemplo.com.mx"). Cópiala TAL CUAL, sin agregarle protocolo ni completarla. Si el ticket no trae ninguna, null. NO pongas aquí la web de publicidad ni el correo.

IMPUESTOS (crítico):
- iva_monto: el IVA en pesos TAL CUAL aparece ("IVA:", "IVA 16%:", "8% IVA:"). NO lo calcules.
- iva_tasa: la tasa que aparezca impresa (16% → 0.16; 8% → 0.08). Si el ticket NO muestra tasa ni desglose de IVA, devuelve null. En la franja fronteriza el IVA es 8%: respeta lo impreso.
- subtotal: el que aparezca; si no viene, null.

NO CONFUNDIR: "CLAVE PEMEX 32011" (o similar) es un código INTERNO de producto de la estación, NO el ClaveProdServ del SAT. No lo pongas como folio ni como clave fiscal.`;

/**
 * Por qué no se pudo usar el comprobante. La distinción NO es cosmética: decide
 * si tiene sentido pedirle al operador que reenvíe la foto.
 * - `ilegible`      → la foto de verdad no se lee (borrosa, cortada, oscura).
 *                     Reenviarla con mejor luz SÍ arregla el problema.
 * - `fallo_tecnico` → falló nuestro lado (truncamiento, provider caído, timeout).
 *                     La MISMA foto reenviada vuelve a fallar igual: pedir
 *                     reenvío es echarle la culpa al chofer de un bug nuestro.
 * - `solo_codigo`   → NO es un fallo: es el ACERCAMIENTO del protocolo de dos
 *                     fotos. Trae el código (total y folio exactos) pero no el
 *                     cuerpo del ticket. No se le pide nada al operador —hizo lo
 *                     correcto— y sobre todo NO se da de alta como gasto: se
 *                     pega al comprobante que le corresponde, porque si entrara
 *                     solo, el mismo gasto se contaría dos veces.
 */
export type MotivoFallo = 'ilegible' | 'fallo_tecnico' | 'solo_codigo';

/**
 * Deja utilizable la liga que el modelo leyó del papel. NO inventa dominio: si
 * lo leído no parece una dirección (sin punto, con espacios, un correo), se
 * descarta — más vale sin liga que con una liga equivocada, porque el que la
 * abre es una persona de la oficina.
 */
function normalizarUrl(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim().replace(/[),.;:]+$/, '');
  if (!t || /\s/.test(t) || t.includes('@') || !t.includes('.')) return undefined;
  if (t.length > 200) return undefined;
  if (/^https?:\/\//i.test(t)) return t;
  if (!/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return undefined;
  return `https://${t}`;
}

export interface ExtraerResultado {
  gasto: Gasto;
  legible: boolean;
  /** Ausente cuando `legible` es true. */
  motivo?: MotivoFallo;
  // Costo de la llamada de visión (para el contador por liquidación).
  costo: { modelo: string; tokensIn: number; tokensOut: number; costoUsd: number };
}

/**
 * Extrae un comprobante de UNA o VARIAS fotos del mismo ticket.
 *
 * El protocolo de dos fotos sale de una medición, no de una preferencia: sobre
 * los tickets de campo del 27-jul-2026 la foto del ticket completo dio 0 códigos
 * legibles —doblez del papel, térmico moteado, código fuera de encuadre— y el
 * acercamiento al mismo código entró en ~100 ms. Aquí se aprovechan las dos sin
 * pedirle al operador que las etiquete:
 *
 *   - los códigos se buscan en TODAS las fotos (es barato y no cuesta LLM);
 *   - el OCR corre UNA sola vez, sobre la foto del ticket completo — que se
 *     reconoce por ser la que NO soltó código;
 *   - lo que venga de un código gana sobre lo leído por visión, y el OCR pasa a
 *     ser verificación del monto.
 */
export async function extraerComprobante(imagenes: string | string[]): Promise<ExtraerResultado> {
  const fotos = (Array.isArray(imagenes) ? imagenes : [imagenes]).filter(Boolean);

  // Los códigos, primero: son gratis frente a una llamada de visión y deciden
  // sobre CUÁL foto vale la pena gastar el OCR.
  // Sin try/catch alrededor: `decodeCodigosFromImage` ya devuelve [] ante
  // cualquier fallo, y un catch de más aquí se traga errores de programación
  // (se comió un import faltante y lo hizo pasar por "esta foto no traía código").
  const codigosPorFoto = await Promise.all(fotos.map((f) => decodeCodigosFromImage(bufferFromDataUrl(f))));
  const codigos = codigosPorFoto.flat();
  // La foto sin código es la del ticket completo (el acercamiento se tomó PARA
  // el código, así que trae poco texto). Si todas traen código, la primera.
  const iSinCodigo = codigosPorFoto.findIndex((c) => c.length === 0);
  const principal = fotos[iSinCodigo >= 0 ? iSinCodigo : 0];

  let res: Awaited<ReturnType<typeof generateStructured<z.infer<typeof ExtraccionSchema>>>>;
  try {
    res = await generateStructured({
      role: 'ocr',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Extrae los datos de este comprobante.' }],
      images: [principal],
      schema: ExtraccionSchema,
      schemaName: 'comprobante',
    });
  } catch (e) {
    // OJO: a este catch NO se llega por una foto mala. Un ticket ilegible sí
    // produce JSON válido, con `legible: false` — y sale por el camino de abajo.
    // Aquí solo caen fallos NUESTROS: respuesta truncada, provider caído,
    // timeout, schema roto. Por eso el motivo es 'fallo_tecnico' y el costo se
    // contabiliza (la llamada se cobró aunque no sirviera).
    const err = e as StructuredError;
    const truncado = e instanceof TruncatedError;
    logger.error('ocr.fallo_tecnico', {
      err: e instanceof Error ? e.message : String(e),
      truncado,
      ...(truncado ? { tope: (e as TruncatedError).tope, usados: (e as TruncatedError).tokensUsados } : {}),
    });
    const u = err?.usage;
    return {
      gasto: { id: randomUUID(), concepto: 'otro', monto: 0, ocrConfianza: 0 },
      legible: false,
      motivo: 'fallo_tecnico',
      costo: {
        modelo: u?.model ?? 'ocr',
        tokensIn: u?.tokensIn ?? 0,
        tokensOut: u?.tokensOut ?? 0,
        costoUsd: u?.cost ?? 0,
      },
    };
  }
  const { data } = res;

  // Cruce con el QR del CFDI (gana sobre el OCR para campos fiscales).
  let uuid = data.cfdi_uuid && esUuidValido(data.cfdi_uuid) ? data.cfdi_uuid.toLowerCase() : undefined;
  // Un RFC con forma válida pero dígito verificador roto está MAL LEÍDO. No se
  // asienta como emisor —saldríamos a consultar al SAT contra un contribuyente
  // que no existe, o a revisar EFOS del equivocado— pero se conserva aparte
  // para que la oficina vea qué se leyó en vez de un hueco sin explicación.
  const rfcLeido = data.rfc_emisor?.toUpperCase();
  const rfcFormaOk = esRfcValido(rfcLeido);
  const rfcDvOk = rfcFormaOk && rfcChecksumOk(rfcLeido);
  let rfc = rfcDvOk ? rfcLeido : undefined;
  const rfcDudoso = rfcFormaOk && !rfcDvOk ? rfcLeido : undefined;
  let rfcReceptor: string | undefined;
  let monto = data.monto ?? 0;
  let cfdiValido: boolean | undefined;

  // Lo que venga de un código gana sobre lo leído por visión: no pasó por OCR.
  // (El OCR confunde caracteres — se le vio devolver PER/PEX/PTE donde decía PEC.)
  let urlFacturacion: string | undefined;
  const montoOcr = data.monto ?? undefined;
  let montoCodigo: number | undefined;

  const fiscal = codigos.find((c) => c.cfdi)?.cfdi;
  if (fiscal) {
    if (fiscal.uuid) uuid = fiscal.uuid;
    if (fiscal.rfcEmisor) rfc = fiscal.rfcEmisor;
    if (fiscal.rfcReceptor) rfcReceptor = fiscal.rfcReceptor; // para validar RFC=empresa
    if (fiscal.total != null) montoCodigo = fiscal.total;
    cfdiValido = true; // QR presente y parseado = CFDI verificable
  }
  // QR de ticket (no fiscal): la liga del portal del emisor, y en varios
  // portales el folio y el total viajan codificados DENTRO de esa liga.
  const portal = codigos.find((c) => c.urlFacturacion);
  if (portal) {
    urlFacturacion = portal.urlFacturacion;
    if (montoCodigo === undefined && portal.totalPortal != null) montoCodigo = portal.totalPortal;
  }
  if (montoCodigo != null) monto = montoCodigo;
  urlFacturacion ??= normalizarUrl(data.url_facturacion);

  // El folio del portal y el código de barras son los identificadores EXACTOS
  // que la oficina teclea para timbrar, y son justo los campos que el OCR leyó
  // distinto en cada corrida sobre el mismo ticket.
  const folioPortal = codigos.find((c) => c.folioPortal)?.folioPortal;
  const codigoBarras = codigos.find((c) => c.formato !== 'QRCode')?.texto;

  // VERIFICACIÓN, no elección: si el total del código y el del OCR no coinciden,
  // el código manda —es exacto— pero la diferencia se asienta. Que no cuadren
  // significa que algo se leyó mal (foto de otro ticket, una propina, un renglón
  // que el OCR se comió) y eso lo tiene que ver una persona, no taparse.
  const montoDiscrepante =
    montoCodigo != null && montoOcr != null && Math.abs(montoCodigo - montoOcr) > 0.01;


  // Consulta al SAT (grácil: si no responde → 'pendiente', nunca lanza).
  let estadoSat: EstadoSat | undefined;
  let efos: boolean | null | undefined;
  let efosRevisar: boolean | undefined;
  if (uuid) {
    const sat = await consultarCFDI({ re: rfc, rr: rfcReceptor, tt: monto, id: uuid });
    estadoSat = sat.estado;
    efos = sat.efos;
    efosRevisar = sat.efosDesconocido;
  }

  // Forma de pago leída → c_FormaPago (para la regla de combustible en efectivo).
  const formaPago = data.forma_pago === 'efectivo' ? '01' : data.forma_pago === 'tarjeta' ? '04' : undefined;
  // Folio: SANEADO (dato no confiable de un ticket/CFDI) — charset + cap. Se
  // conserva el crudo y el normalizado sin ceros a la izquierda (portales).
  // El folio IMPRESO manda, y el del QR se guarda aparte (`folioPortal`).
  //
  // Se probó lo contrario y estaba mal. Comparado contra el papel del ticket
  // real: el impreso dice `ITU: 20260725004020110000207172POSA9` (31 chars) y
  // dentro del QR viaja `2026072500402011000207172POSA9` (30). El OCR NO se
  // equivocó — leyó exacto lo impreso—; son dos cadenas distintas, y la del QR
  // es la llave del deep-link del portal, no lo que una persona teclea en el
  // formulario. Pisar una con otra rompe justo el caso que se quería arreglar.
  const folioRaw = sanitizarFolio(data.folio);
  const folioNorm = folioRaw ? folioRaw.replace(/^0+(?=\d)/, '') : undefined;

  const gasto: Gasto = {
    id: randomUUID(),
    concepto: data.concepto as ConceptoGasto,
    monto,
    fecha: normalizarFecha(data.fecha),
    folio: folioRaw,
    folioNorm,
    rfcEmisor: rfc,
    rfcReceptor,
    cfdiUuid: uuid,
    imagenUrl: undefined,
    ocrConfianza: data.confianza,
    cfdiValido,
    estadoSat,
    efos,
    efosRevisar,
    formaPago,
    subTotal: data.subtotal ?? undefined,
    // Datos ricos del ticket (para el aviso de portal, rendimiento y validación).
    // El IVA/subtotal del TICKET NO alimentan el acreditamiento (eso exige XML).
    ocrExtra: {
      producto: sanitizarTexto(data.producto),
      fechaRaw: data.fecha ?? undefined,
      litros: data.litros ?? undefined,
      precioUnitario: data.precio_unitario ?? undefined,
      webId: sanitizarFolio(data.web_id),
      estacion: sanitizarTexto(data.estacion),
      ivaMonto: data.iva_monto ?? undefined,
      ivaTasa: data.iva_tasa ?? undefined,
      // Para el aviso de portal: con qué liga y con qué folio se timbra.
      urlFacturacion,
      // RFC con forma válida pero dígito verificador roto: mal leído, a revisión.
      rfcEmisorDudoso: rfcDudoso,
      // Identificadores que salieron de un código, no de visión.
      folioPortal,
      codigoBarras,
      // Verificación del monto: qué dijo cada fuente, y solo si se contradicen.
      montoOcr: montoDiscrepante ? montoOcr : undefined,
      montoDiscrepante: montoDiscrepante || undefined,
    },
  };

  // El cuerpo del ticket no se leyó y el monto salió SOLO de un código: es el
  // acercamiento, no un comprobante. Dejarlo pasar como gasto duplicaría el
  // dinero cuando llegue la foto del ticket completo.
  const soloCodigo = montoCodigo != null && montoOcr == null;
  // El modelo respondió bien; si dice que no se lee (o no encontró monto) el
  // problema SÍ es la foto y pedir reenvío con mejor luz sirve de algo.
  const legible = !soloCodigo && data.legible && monto > 0;
  return {
    gasto,
    legible,
    motivo: legible ? undefined : soloCodigo ? 'solo_codigo' : 'ilegible',
    costo: { modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.cost },
  };
}
