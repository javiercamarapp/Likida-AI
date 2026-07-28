// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE CUADRE (determinístico, sin LLM) — el diferenciador de Cuadra.
//
// Compara los gastos comprobados contra el anticipo entregado y la política de
// la flota, y detecta: sobre-política, faltante de CFDI, duplicados y baja
// confianza de OCR. Es una función pura → testeable, auditable, sin sorpresas.
// El LLM del agente ORQUESTA (pide fotos, explica), pero la DECISIÓN de dinero
// la toma este motor. Eso es lo que da "sin fallas".
// ═══════════════════════════════════════════════════════════════════════════

import { strip_accents } from './util';
import { sanitizarFolio } from '../intake/sanitizar';
import { calcularCaducidad } from '../facturacion/caducidad';
import { identificarComercio } from '../facturacion/identificar';
import type { Gasto, Diferencia, Liquidacion, EstatusLiquidacion, TipoDiferencia } from '@/types/cuadra';

export interface PoliticaGasto {
  concepto: string;       // diesel | caseta | viaticos | factura | otro
  ruta?: string;          // aplica a ruta específica (opcional)
  topeMonto?: number;     // tope permitido por comprobante
  requiereCfdi?: boolean; // el concepto exige CFDI válido
}

export interface CuadreInput {
  viajeId: string;
  anticipo: number;
  gastos: Gasto[];
  politica: PoliticaGasto[];
  ruta?: string;
  /** Umbral de confianza de OCR bajo el cual se marca "revisar". Default 0.85. */
  umbralConfianza?: number;
  /** RFC de la empresa: el receptor de cada CFDI debe coincidir (no el chofer). */
  empresaRfc?: string;
  /** RFCs adicionales válidos de la flota (razones sociales múltiples). */
  rfcsAdicionales?: string[];
  /** RFC del operador del viaje. Un viático a SU nombre es válido (RLISR 57):
   *  los comprobantes de quien presta servicios subordinados pueden expedirse a
   *  nombre de esa persona. Sin este dato no se rechaza — se manda a revisar. */
  operadorRfc?: string;
  /** Complemento de hidrocarburos (Bloque 1): claves de combustible, unidad,
   *  y fecha de vigencia. Sin esto, la regla no corre. */
  hidrocarburos?: { claves: string[]; unidad: string; vigenteDesde: string };
  /** Estímulos y topes fiscales (LIF 2026 art. 20, ap. A / LISR). */
  estimulos?: { peajeFactor: number; viaticosTopeFiscalDiarioMxn: number; efectivoTopeMxn: number; clavesDieselIeps?: string[] };
  /** Hoy (ISO YYYY-MM-DD), para el aviso de tickets por facturar. Se INYECTA:
   *  el motor es puro y no lee el reloj del servidor. Sin esto, esa regla no corre. */
  hoy?: string;
  /** Rango de fecha válido para los comprobantes (ISO YYYY-MM-DD). Fuera → sospechosa. */
  fechaMin?: string;
  fechaMax?: string;
}

function politicaPara(concepto: string, ruta: string | undefined, pol: PoliticaGasto[]): PoliticaGasto | undefined {
  const c = strip_accents(concepto.toLowerCase());
  // Preferir una política específica de la ruta; si no, la general del concepto.
  const dela = pol.filter((p) => strip_accents(p.concepto.toLowerCase()) === c);
  return dela.find((p) => p.ruta && ruta && p.ruta === ruta) ?? dela.find((p) => !p.ruta);
}

/** Conceptos que la ley trata como viático (LISR 28-V / RLISR 57). */
const ES_VIATICO = ['alimentacion', 'hospedaje', 'transporte', 'viaticos'];

/** En cuál de las tres cubetas de deducibilidad cae un gasto. */
export type Cubeta = 'deducible' | 'no_deducible' | 'por_confirmar';

const NO_DEDUCIBLE_ISR: TipoDiferencia[] = ['rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_no_encontrado', 'complemento_hidrocarburos', 'efectivo_sobre_tope'];
const POR_CONFIRMAR: TipoDiferencia[] = ['combustible_efectivo'];

/**
 * LA ÚNICA definición de en qué cubeta cae un gasto. Vive aquí, exportada, para
 * que nadie la reconstruya.
 *
 * `pdf.ts` la reconstruía por su cuenta desde `diferencias` con UN solo criterio
 * —el tipo de diferencia— y se saltaba el segundo, la ausencia de UUID. Como
 * `sin_cfdi` solo se emite si la política del tenant trae `requiereCfdi`, y
 * `DEMO_CONFIG` solo lo pone en `factura`, un hospedaje sin timbrar caía en
 * `por_confirmar` para el motor y en ninguna cubeta para el PDF: la sección
 * "LO QUE SE LE REEMBOLSA AL OPERADOR" desaparecía según un flag de
 * configuración, no según la ley. Es la misma contradicción que el comentario de
 * abajo documenta haber eliminado del lado fiscal, resucitada en otro archivo.
 *
 * `diferencias` es una vista PARCIAL de la decisión; esta función es la decisión.
 */
export function cubetaDe(g: Gasto, suyas: Diferencia[]): Cubeta {
  if (suyas.some((d) => NO_DEDUCIBLE_ISR.includes(d.tipo))) return 'no_deducible';
  if (suyas.some((d) => POR_CONFIRMAR.includes(d.tipo))) return 'por_confirmar';
  // UN TICKET NO ES UNA FACTURA. LISR 27-III exige que la deducción esté
  // "amparada con un comprobante fiscal", y un ticket de gasolinera no lo es:
  // hay que timbrarlo. Contarlo como deducible le promete al contralor una
  // deducción que todavía no existe — y si nadie factura a tiempo, nunca
  // existirá. Tampoco es pérdida: se puede timbrar. Por eso POR CONFIRMAR.
  if (!g.cfdiUuid) return 'por_confirmar';
  return 'deducible';
}

export function cuadrarViaje(input: CuadreInput): Omit<Liquidacion, 'id' | 'creadaEn'> {
  const umbral = input.umbralConfianza ?? 0.85;
  const diferencias: Diferencia[] = [];

  const norm = (r: string) => strip_accents(r.toUpperCase().replace(/\s/g, ''));
  // RFC genérico del SAT: si el tenant no capturó su RFC real, NO se valida el
  // receptor (evita marcar toda factura como "no es de la empresa"). AL-6.
  const RFC_GENERICO = 'XAXX010101000';
  const rfcsOk = new Set(
    [input.empresaRfc, ...(input.rfcsAdicionales ?? [])]
      .filter(Boolean)
      .map((r) => norm(r as string))
      .filter((r) => r !== RFC_GENERICO),
  );

  // 0) Duplicados: primero por UUID (regla dura), luego por concepto+folio+monto.
  //    Se EXCLUYEN del total (no lo inflan) — fix del audit.
  const duplicados = new Set<string>();
  const vistoUuid = new Map<string, string>();
  const vistoFolio = new Map<string, string>();
  for (const g of input.gastos) {
    if (g.cfdiUuid) {
      const u = g.cfdiUuid.toLowerCase();
      if (vistoUuid.has(u)) duplicados.add(g.id);
      else vistoUuid.set(u, g.id);
      continue;
    }
    if (g.folio) {
      const key = `${strip_accents(g.concepto.toLowerCase())}|${g.folio}|${g.monto}`;
      if (vistoFolio.has(key)) duplicados.add(g.id);
      else vistoFolio.set(key, g.id);
    }
  }

  // Sólo montos > 0 suman al total: un monto negativo/cero (OCR erróneo, nota de
  // crédito) NO debe reducir el comprobado ni sesgar la diferencia. ME-5.
  const totalComprobado = input.gastos.reduce(
    (s, g) => (duplicados.has(g.id) || !(g.monto > 0) ? s : s + g.monto),
    0,
  );

  // 1) Por gasto: política, CFDI, confianza, RFC receptor, estatus SAT.
  for (const g of input.gastos) {
    if (duplicados.has(g.id)) continue; // los duplicados se reportan aparte (paso 2)
    // Monto inválido: no se evalúa política sobre él, se manda a revisión. ME-5.
    if (!(g.monto > 0)) {
      diferencias.push({ tipo: 'monto_invalido', concepto: g.concepto, monto: 0, nota: `El comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} tiene un monto inválido (${mxn(g.monto)}) — revisar a mano.`, gastoId: g.id });
      continue;
    }
    const h = input.hidrocarburos;
    const esCombustible = g.concepto === 'diesel' || (!!h && h.claves.includes(g.claveProdServ ?? ''));

    // Regla 5: el combustible exige pago electrónico (LISR 27-III, 2º párrafo) sin
    // importar el monto. PERO para el autotransporte de carga federal —que es a
    // quien le vendemos— la RFA 2026 regla 2.9 lo tiene por CUMPLIDO hasta el 15%
    // del total pagado por combustible en el ejercicio.
    //
    // Por eso aquí NO se declara "no deducible": se marca para contarlo contra ese
    // 15%. Declararlo no deducible le quita al cliente una deducción que la ley le
    // concede. (El contador del 15% por ejercicio todavía no existe: ver roadmap.)
    const topeEfectivo = input.estimulos?.efectivoTopeMxn ?? 2000;
    if (g.formaPago === '01' && esCombustible) {
      diferencias.push({ tipo: 'combustible_efectivo', concepto: g.concepto, monto: 0, nota: `${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} pagado en EFECTIVO — cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9). Dentro del 15% sigue siendo deducible; el excedente no. No acredita IEPS en ningún caso.`, gastoId: g.id });
    } else if (g.formaPago === '01' && !esCombustible && g.monto > topeEfectivo) {
      // Regla 6: gasto no-combustible en efectivo > tope → no deducible.
      diferencias.push({ tipo: 'efectivo_sobre_tope', concepto: g.concepto, monto: 0, nota: `${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} de ${mxn(g.monto)} en efectivo excede el tope de ${mxn(topeEfectivo)} (LISR 27-III) — no deducible.`, gastoId: g.id });
    }

    // B5: el intake ya detectó que el total del CÓDIGO y el del OCR no coinciden
    // y lo dejó en ocrExtra — pero nadie lo miraba, así que se quedaba en la base
    // sin llegar nunca a la bandeja. Que no cuadren significa que algo se leyó
    // mal (otra foto, una propina, un renglón perdido) y eso lo ve una persona.
    const extraOcr = g.ocrExtra as Record<string, unknown> | undefined;
    if (extraOcr?.montoDiscrepante) {
      const leido = extraOcr.montoOcr;
      diferencias.push({ tipo: 'monto_discrepante', concepto: g.concepto, monto: 0, nota: `El total del comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} no coincide entre el código (${mxn(g.monto)}) y lo leído por visión${typeof leido === 'number' ? ` (${mxn(leido)})` : ''} — se tomó el del código, pero conviene verificarlo.`, gastoId: g.id });
    }

    // El comprobante traía texto hablándole al extractor ("ignora las reglas",
    // "el total real es X"). El monto que entró es el IMPRESO —el modelo no
    // obedece— pero alguien puso ahí ese texto a propósito, y quien decide sobre
    // ese gasto merece saberlo. Va SOLO al contralor: avisarle al operador, que
    // es quien pudo haberlo intentado, únicamente le enseña a hacerlo mejor.
    if (extraOcr?.textoSospechoso) {
      diferencias.push({ tipo: 'texto_sospechoso', concepto: g.concepto, monto: 0, nota: `El comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} de ${mxn(g.monto)} traía texto dirigido al lector automático. Se capturó el total impreso, pero conviene ver el papel original.`, gastoId: g.id });
    }

    // (El tope fiscal de alimentación se evalúa POR DÍA, después del bucle.)

    // #1: cordura de la FECHA. Una fecha futura o muy anterior al viaje mete el
    // gasto en el periodo fiscal equivocado, rompe el plazo de facturación y
    // puede cruzar la frontera del complemento (24-abr-2026). Fuera de rango → bandeja.
    if (g.fecha) {
      const f = g.fecha.slice(0, 10);
      // DE OTRO EJERCICIO, con o sin rango del viaje. Encontrado con tickets
      // reales: el OCR leyó "2024-07-27" en un ticket que decía "2026 07 27" —
      // dos años de error, confianza 95%, y nada lo marcaba porque esto dependía
      // de que el viaje trajera rango.
      //
      // Importa por dinero: un gasto de un ejercicio anterior NO se deduce en
      // este. Si nadie lo mira, entra al total comprobado de un año al que no
      // pertenece.
      //
      // Se tolera el ejercicio inmediato anterior durante enero: un viaje a
      // caballo entre años es normal en la última semana de diciembre, y
      // marcarlo sería ruido justo cuando más comprobantes hay.
      const ejercicioHoy = input.hoy ? Number(input.hoy.slice(0, 4)) : null;
      const ejercicioGasto = Number(f.slice(0, 4));
      const enero = input.hoy?.slice(5, 7) === '01';
      const deOtroEjercicio =
        ejercicioHoy != null && Number.isFinite(ejercicioGasto) &&
        ejercicioGasto < ejercicioHoy - (enero ? 1 : 0);

      if (deOtroEjercicio) {
        diferencias.push({ tipo: 'fecha_sospechosa', concepto: g.concepto, monto: 0, nota: `El comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} está fechado en ${ejercicioGasto} y estamos en ${ejercicioHoy}: un gasto de otro ejercicio no se deduce en este. Puede ser un error de lectura — verifica la fecha impresa.`, gastoId: g.id });
      } else if ((input.fechaMax != null && f > input.fechaMax) || (input.fechaMin != null && f < input.fechaMin)) {
        diferencias.push({ tipo: 'fecha_sospechosa', concepto: g.concepto, monto: 0, nota: `La fecha del comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} (${f}) está fuera del rango esperado del viaje — verifícala (afecta periodo fiscal y plazo de facturación).`, gastoId: g.id });
      }
    }

    // #3: folio leído con BAJA CONFIANZA en un ticket de combustible (que se
    // factura en portal) → avisar que lo verifique. NO bloquea, solo advierte.
    if (g.folio && g.concepto === 'diesel' && g.ocrConfianza != null && g.ocrConfianza < umbral) {
      diferencias.push({ tipo: 'folio_verificar', concepto: g.concepto, monto: 0, nota: `El folio del ticket de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} (${sanitizarFolio(g.folio)}) se leyó con baja confianza — verifícalo antes de facturarlo en el portal de la gasolinera.`, gastoId: g.id });
    }

    const pol = politicaPara(g.concepto, input.ruta, input.politica);
    if (pol?.topeMonto != null && g.monto > pol.topeMonto) {
      diferencias.push({
        tipo: 'sobre_politica', concepto: g.concepto, esperado: pol.topeMonto, real: g.monto,
        monto: g.monto - pol.topeMonto,
        nota: `${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} de ${mxn(g.monto)} excede el tope de política (${mxn(pol.topeMonto)}) por ${mxn(g.monto - pol.topeMonto)}.`,
        gastoId: g.id,
      });
    }
    if (pol?.requiereCfdi && !g.cfdiUuid) {
      diferencias.push({ tipo: 'sin_cfdi', concepto: g.concepto, monto: 0, nota: `${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} de ${mxn(g.monto)} requiere factura CFDI y no trae UUID válido.`, gastoId: g.id });
    }
    if (g.ocrConfianza != null && g.ocrConfianza < umbral) {
      diferencias.push({ tipo: 'ocr_baja_confianza', concepto: g.concepto, monto: 0, nota: `El comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} se leyó con baja confianza — conviene revisarlo a mano.`, gastoId: g.id });
    }
    if (rfcsOk.size > 0 && g.rfcReceptor && !rfcsOk.has(norm(g.rfcReceptor))) {
      // RLISR 57: "Si benefician a personas que le prestan servicios personales
      // subordinados, los comprobantes fiscales PODRÁN ser expedidos a nombre de
      // dichas personas". El operador de una flota es trabajador subordinado, así
      // que su viático a su propio nombre es VÁLIDO. Rechazarlo le tira al cliente
      // una deducción que el reglamento le concede.
      //
      // No aplica al diésel ni a las facturas: eso sí va a nombre de la empresa.
      const esViatico = ES_VIATICO.includes(g.concepto);
      const rfcOperador = input.operadorRfc ? norm(input.operadorRfc) : null;
      if (esViatico && rfcOperador && norm(g.rfcReceptor) === rfcOperador) {
        // Es del operador: correcto por RLISR 57, no se reporta nada.
      } else if (esViatico && !rfcOperador) {
        // Sin el RFC del operador no se puede confirmar NI descartar. Se revisa,
        // pero no se le quita la deducción por una duda nuestra.
        diferencias.push({ tipo: 'viatico_rfc_operador', concepto: g.concepto, monto: 0, nota: `Viático de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} timbrado al RFC ${g.rfcReceptor}. Si es el del operador es válido (RLISR 57, trabajador subordinado) — captura su RFC para confirmarlo.`, gastoId: g.id });
      } else {
        diferencias.push({ tipo: 'rfc_receptor', concepto: g.concepto, monto: 0, nota: `Factura de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} timbrada al RFC ${g.rfcReceptor} (no es de la empresa) — no deducible.`, gastoId: g.id });
      }
    }
    if (g.estadoSat === 'cancelado') {
      diferencias.push({ tipo: 'cfdi_cancelado', concepto: g.concepto, monto: 0, nota: `El CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} está CANCELADO ante el SAT — no deducible.`, gastoId: g.id });
    } else if (g.estadoSat === 'no_encontrado' && g.cfdiUuid) {
      diferencias.push({ tipo: 'cfdi_no_encontrado', concepto: g.concepto, monto: 0, nota: `El SAT NO reconoce el CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} (UUID inexistente o fabricado) — no deducible.`, gastoId: g.id });
    } else if (g.efos === true) {
      diferencias.push({ tipo: 'cfdi_efos', concepto: g.concepto, monto: 0, nota: `El emisor del CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} está en lista negra del SAT (EFOS) — no deducible.`, gastoId: g.id });
    } else if (g.efosRevisar) {
      diferencias.push({ tipo: 'cfdi_efos_indeterminado', concepto: g.concepto, monto: 0, nota: `La validación EFOS del CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} no fue concluyente — conviene revisarlo a mano.`, gastoId: g.id });
    } else if (g.estadoSat === 'pendiente' && g.cfdiUuid) {
      diferencias.push({ tipo: 'cfdi_pendiente', concepto: g.concepto, monto: 0, nota: `No se pudo validar el CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} con el SAT — se revisa después.`, gastoId: g.id });
    }

    // Complemento de hidrocarburos (Bloque 1). Regla determinística en DOS
    // NIVELES. Mismo criterio que EFOS: NUNCA se declara no deducible sin
    // verificar — un falso positivo de fraude es peor que un falso negativo.
    // (h y esCombustible se hoistearon arriba del loop.)
    if (h && esCombustible) {
      const aplicaPorFecha = !g.fecha || g.fecha >= h.vigenteDesde; // solo CFDI vigentes
      if (g.xmlVerificado) {
        // NIVEL 2: tenemos el XML → regla DURA (regla 2.7.1.48 RMF 2026). La ley
        // obliga solo el ClaveProdServ de combustible en CFDI tipo I/E de un
        // permisionario; la unidad LTR es consistencia esperada, NO requisito de
        // la regla (por eso NO se exige aquí — evita falsos negativos). Se EXCLUYEN
        // los esquemas alternos (monedero ECC / Carta Porte), que no caen en 2.7.1.48.
        const combustibleFiscal = h.claves.includes(g.claveProdServ ?? '');
        const tipoAplica = g.tipoComprobante === 'I' || g.tipoComprobante === 'E';
        if (combustibleFiscal && tipoAplica && aplicaPorFecha && !g.cfdiEsquemaAlterno && !g.complementoHidrocarburos) {
          diferencias.push({ tipo: 'complemento_hidrocarburos', concepto: g.concepto, monto: 0, nota: `El CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} es de combustible y NO trae el complemento de hidrocarburos requerido (obligatorio desde 24-abr-2026, regla 2.7.1.48 RMF) — no deducible (CFF 29-A).`, gastoId: g.id });
        }
      } else if (g.cfdiUuid && aplicaPorFecha) {
        // NIVEL 1: es una FACTURA de combustible (tiene UUID) pero sin el XML →
        // no se puede verificar el complemento. A la bandeja del liquidador, NO
        // se declara no deducible. Se resuelve cuando reenvíen el XML.
        diferencias.push({ tipo: 'complemento_no_verificable', concepto: g.concepto, monto: 0, nota: `La factura de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} es de combustible: reenvía el XML (el que te manda la gasolinera por correo) para verificar el complemento de hidrocarburos.`, gastoId: g.id });
      }
    }
  }

  // 2) Duplicados como diferencia (ya excluidos del total).
  for (const g of input.gastos) {
    if (duplicados.has(g.id)) {
      diferencias.push({ tipo: 'duplicado', concepto: g.concepto, monto: g.monto, nota: `Comprobante duplicado: ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)}${g.folio ? ` folio ${sanitizarFolio(g.folio)}` : ''} por ${mxn(g.monto)} aparece dos veces (excluido del total).`, gastoId: g.id });
    }
  }

  // 3) Diferencia global contra el anticipo
  // diferencia > 0  → sobró anticipo (a favor de la empresa: el operador regresa)
  // diferencia < 0  → el operador gastó de más (a favor del operador)
  const diferencia = round2(input.anticipo - totalComprobado);
  if (Math.abs(diferencia) >= 0.5) {
    diferencias.push({
      tipo: 'anticipo',
      esperado: input.anticipo,
      real: totalComprobado,
      monto: diferencia,
      nota:
        diferencia > 0
          ? `Sobró ${mxn(diferencia)} del anticipo — a favor de la empresa.`
          : `El operador puso ${mxn(-diferencia)} de su bolsa — a favor del operador.`,
    });
  }

  // ── Tickets de portal que se van a quedar sin factura ────────────────────────
  //
  // Un ticket de gasolinera NO es factura: hay que timbrarlo en el portal del
  // emisor. Si nadie lo hace a tiempo, el gasto deja de ser deducible — el
  // dinero ya salió y el IVA se pierde.
  //
  // Se avisa con la regla GENERAL (dentro del mes natural de la operación). Los
  // plazos por cadena que circulan (5-15 días) están SIN VERIFICAR contra los
  // portales, así que NO se afirman: se dice que la ventana puede ser menor.
  //
  // LA LIGA IMPRESA NO PUEDE SER EL ÚNICO DISPARADOR. Lo era, y sobre un ticket
  // real de OXXO ($41.50, 16-jul, tres días de ventana) el aviso no salió: ese
  // papel no trae QR ni URL de facturación, solo el ID de venta. El comercio se
  // reconoce además por RFC —respaldado por dígito verificador— y por la razón
  // social impresa, que es justo para lo que existe `identificarComercio`. Estaba
  // escrito, probado y sin llamar desde ningún lado.
  if (input.hoy) {
    for (const g of input.gastos) {
      if (duplicados.has(g.id) || !(g.monto > 0)) continue;
      if (g.cfdiUuid) continue; // ya timbrado
      const extra = g.ocrExtra as Record<string, unknown> | undefined;
      const liga = extra?.urlFacturacion as string | undefined;
      const comercio = identificarComercio({
        urlFacturacion: liga,
        rfcEmisor: g.rfcEmisor,
        textoTicket: [extra?.emisor, extra?.estacion].filter(Boolean).join(' '),
      });
      // Sin comercio Y sin liga no hay nada que afirmar: no todo ticket es
      // facturable, y prometerle un portal a quien compró en una fonda sin RFC
      // manda a la oficina a buscar algo que no existe.
      if (!liga && !comercio) continue;
      if (!g.fecha) continue; // sin fecha no se afirma nada
      // El plazo del comercio se usa SOLO si está verificado contra su portal.
      // `plazoVerificado: false` es el default del catálogo a propósito: un plazo
      // inventado haría que el sistema jure que un ticket sigue vigente.
      const plazo = comercio?.plazoVerificado ? comercio.plazo : 'mes_natural';
      const c = calcularCaducidad({ fechaTicket: g.fecha.slice(0, 10), plazo, hoy: input.hoy });
      if (c.desconocido || (!c.urgente && !c.vencido)) continue;
      const cuerpo = c.vencido
        ? `se pasó el mes de la compra. El comercio ya no suele facturarlo en su portal, pero legalmente puedes exigirlo dentro del ejercicio (Conciliación de Factura del SAT)`
        : `quedan ${c.diasRestantes} día(s) del mes para timbrarlo en el portal — y la ventana del comercio puede ser menor, así que hazlo antes`;
      // Con comercio reconocido el aviso deja de ser genérico: dice a qué portal
      // ir y qué datos hay que teclear, que es la diferencia entre un recordatorio
      // y una instrucción que alguien puede ejecutar.
      const donde = comercio
        ? ` Portal de ${comercio.nombre}: ${comercio.portal} — te pedirá ${comercio.campos.filter((k) => k.requerido).map((k) => k.etiquetaPortal).join(', ')}.`
        : '';
      diferencias.push({
        tipo: 'factura_por_vencer', concepto: g.concepto, monto: 0,
        nota: `${etiquetaConcepto(g.concepto, extra)} de ${mxn(g.monto)} sigue sin factura: ${cuerpo}.${donde}`,
        gastoId: g.id,
      });
    }
  }

  // ── H1: la alimentación necesita hospedaje o transporte que la ampare ────────
  //
  // LISR 28-V: el tope de $750 procede "y el contribuyente acompañe el comprobante
  // fiscal o la documentación comprobatoria que ampare el hospedaje o transporte".
  // Una comida sola no cumple ese párrafo.
  //
  // Se marca para REVISIÓN, no se declara no deducible: no vemos toda la
  // contabilidad de la flota y el comprobante de hospedaje puede existir fuera de
  // esta liquidación. Declararlo perdido sería el mismo error al revés.
  {
    const vivos = input.gastos.filter((g) => !duplicados.has(g.id) && g.monto > 0);
    const haySoporte = vivos.some((g) => g.concepto === 'hospedaje' || g.concepto === 'transporte');
    if (!haySoporte) {
      for (const g of vivos.filter((g) => g.concepto === 'alimentacion')) {
        diferencias.push({
          tipo: 'alimentacion_sin_soporte', concepto: g.concepto, monto: 0,
          nota: `Alimentación de ${mxn(g.monto)} sin comprobante de hospedaje ni de transporte del mismo viaje: LISR 28-V condiciona la deducción a que uno de los dos la ampare. Adjúntalo o confírmalo con tu contador.`,
          gastoId: g.id,
        });
      }
    }
  }

  // ── Tope fiscal de ALIMENTACIÓN: $750 POR DÍA y por beneficiario (LISR 28-V) ──
  //
  // Dos correcciones sobre cómo estaba:
  //
  // 1. Solo aplica a ALIMENTACIÓN. El hospedaje nacional NO tiene tope, y el
  //    transporte del operador tampoco. Antes todo lo etiquetado "viaticos"
  //    cargaba el tope, así que una noche de hotel de $2,000 salía con $1,250
  //    "no deducibles" que sí lo eran.
  //
  // 2. Es POR DÍA, no por comprobante. Antes, tres comidas de $400 el mismo día
  //    pasaban limpias mientras una sola de $800 se marcaba — el hueco por el que
  //    se cuela el gasto real, y encima castigaba a quien comprobaba de una vez.
  //
  // El beneficiario es el operador del viaje: la liquidación es de un solo
  // operador, así que agrupar por día dentro del viaje es la unidad correcta.
  // gastoId → qué fracción de él es deducible. Lo llena el tope diario de
  // alimentación; el acreditamiento lo consume. Un gasto que no esté aquí es
  // deducible al 100%.
  const proporcionDeducible = new Map<string, number>();

  const topeAlimentacion = input.estimulos?.viaticosTopeFiscalDiarioMxn;
  if (topeAlimentacion != null) {
    // 'viaticos' a secas entra por compatibilidad: es lo que emitía el OCR viejo
    // y esos gastos ya guardados no se pueden reclasificar solos. Criterio
    // conservador: se le sigue aplicando el tope.
    const conTope = (c: string) => c === 'alimentacion' || c === 'viaticos';
    const porDia = new Map<string, Gasto[]>();
    for (const g of input.gastos) {
      if (duplicados.has(g.id) || !(g.monto > 0) || !conTope(g.concepto)) continue;
      // Sin fecha no se puede agrupar: cada comprobante cuenta como su propio día
      // (su id como llave). No inventamos una fecha para poder sumar.
      const dia = g.fecha ? g.fecha.slice(0, 10) : `sin-fecha:${g.id}`;
      porDia.set(dia, [...(porDia.get(dia) ?? []), g]);
    }
    for (const [dia, delDia] of porDia) {
      const total = delDia.reduce((s, x) => s + x.monto, 0);
      if (total <= topeAlimentacion) continue;
      const exceso = round2(total - topeAlimentacion);

      // LA PROPORCIÓN ES DEL DÍA, NO DEL COMPROBANTE QUE LO CRUZÓ.
      //
      // El tope de LISR 28-V es diario, así que lo deducible del día es
      // `tope/total` y cada comprobante hereda esa misma proporción. Antes el
      // exceso se colgaba entero del ÚLTIMO gasto del arreglo, y eso rompía el
      // IVA de dos maneras:
      //
      //  - si ese último era MÁS CHICO que el exceso, su proporción se recortaba
      //    a 0 y lo que sobraba no se descontaba de ningún lado: se acreditaba
      //    IVA de más ($160 en vez de $120, reproducido en la auditoría 3);
      //  - y con tasas distintas en el mismo día, el resultado dependía del
      //    ORDEN de los gastos en el arreglo ($92 contra $80 con los mismos
      //    hechos).
      //
      // Acreditar de más es del lado caro: responde el cliente ante una revisión.
      const proporcionDia = topeAlimentacion / total;
      for (const x of delDia) proporcionDeducible.set(x.id, proporcionDia);

      // La DIFERENCIA sigue colgada de un comprobante, porque los totales de
      // deducibilidad suman por gastoId y tiene que vivir en alguno. Eso es
      // correcto para el total no deducible del día; lo que no podía ser es que
      // decidiera también el prorrateo del IVA.
      const ancla = delDia[delDia.length - 1];
      const cuantos = delDia.length > 1 ? ` (${delDia.length} comprobantes del día)` : '';
      const cuando = dia.startsWith('sin-fecha') ? 'sin fecha' : dia;
      diferencias.push({
        tipo: 'viatico_excede_fiscal', concepto: ancla.concepto,
        esperado: topeAlimentacion, real: round2(total), monto: exceso,
        nota: `Alimentación del ${cuando}: ${mxn(total)}${cuantos} excede el tope fiscal de ${mxn(topeAlimentacion)} por día (LISR 28-V) — el excedente de ${mxn(exceso)} no es deducible.`,
        gastoId: ancla.id,
      });
    }
  }



  // ── Acreditamiento ─────────────────────────────────────────────────────────
  // ESTE BLOQUE VA AL FINAL A PROPÓSITO. Corría antes del tope de alimentación,
  // que es lo que genera `viatico_excede_fiscal`, así que cuando calculaba la
  // proporción deducible de LIVA 5-I esa diferencia todavía no existía y el IVA
  // se acreditaba entero. Mover el bloque es el arreglo: aquí ya están TODAS las
  // diferencias.
  // OJO CON EL NOMBRE: esta lista NO dice qué gasto es deducible para ISR. Dice
  // qué gasto no puede ACREDITAR impuestos, que es otra cosa. Se llamaba
  // NO_DEDUCIBLE y esa confusión casi cuesta un bug caro: `combustible_efectivo`
  // SÍ es deducible hasta el 15% (RFA 2026 regla 2.9), pero NO acredita IEPS —
  // la facilidad salva un beneficio, no los dos. Sacarlo de aquí acreditaría un
  // IEPS que la facilidad no concede.
  const SIN_ACREDITAMIENTO: TipoDiferencia[] = ['rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_no_encontrado', 'complemento_hidrocarburos', 'combustible_efectivo', 'efectivo_sobre_tope', 'monto_invalido'];
  const peajeFactor = input.estimulos?.peajeFactor ?? 0.5;
  // `iepsAcreditable` se queda en 0 a propósito y por eso es const: el estímulo
  // del LIF 20-A no es una cifra que este motor pueda calcular (necesita la cuota
  // semanal del DOF). Se conserva el campo para no romper los consumidores y la
  // columna de la BD; el dato útil es `litrosDieselAcreditables`.
  const iepsAcreditable = 0;
  let ivaAcreditable = 0, peajeAcreditable = 0;
  let litrosDieselAcreditables = 0;
  for (const g of input.gastos) {
    if (duplicados.has(g.id)) continue;
    if (diferencias.some((d) => d.gastoId === g.id && SIN_ACREDITAMIENTO.includes(d.tipo))) continue;
    // El acreditamiento exige un CFDI VERIFICADO (XML): un ticket de gasolinera
    // sin factura NO es deducible ni acreditable hasta timbrarse. Además, así el
    // IVA/IEPS son SIEMPRE los importes LEÍDOS del XML (nunca recomputados con una
    // tasa asumida: 16% u 8% fronterizo salen tal cual del comprobante).
    if (!g.xmlVerificado) continue;

    // EN PROPORCIÓN A LO DEDUCIBLE. LIVA art. 5 fr. I, verificado contra fuente
    // primaria: "Tratándose de erogaciones PARCIALMENTE DEDUCIBLES para los
    // fines del impuesto sobre la renta, únicamente se considerará para los
    // efectos del acreditamiento... EN LA PROPORCIÓN en la que dichas
    // erogaciones sean deducibles".
    //
    // El caso que ocurre a diario: un viático de alimentación que excede el
    // tope de LISR 28-V es deducible solo hasta el tope, así que su IVA se
    // acredita solo en esa misma proporción. Antes se acreditaba el traslado
    // completo, y acreditar de más es del lado caro: es el cliente quien
    // responde ante una revisión, y el papel se lo dio Likida.
    // La proporción la fijó el tope diario, que es quien sabe repartirla entre
    // los comprobantes del día. Deducirla aquí del monto de la diferencia era lo
    // que colgaba todo el exceso de un solo gasto.
    const proporcion = Math.max(0, Math.min(1, proporcionDeducible.get(g.id) ?? 1));

    if ((g.ivaTraslado ?? 0) > 0) ivaAcreditable += (g.ivaTraslado as number) * proporcion;
    // Peaje (1.6): 50% del SubTotal (sin IVA) de casetas.
    if (g.concepto === 'caseta' && (g.subTotal ?? 0) > 0) peajeAcreditable += (g.subTotal as number) * peajeFactor;
    // IEPS de DIÉSEL (7): el estímulo (LIF 2026 art. 20, ap. A) es SOLO diésel — NO
    // gasolina. Se identifica por la clave de producto del SAT (15101505).
    const clavesDiesel = input.estimulos?.clavesDieselIeps ?? [];
    const esDieselIeps = clavesDiesel.includes(g.claveProdServ ?? '');
    if (esDieselIeps) {
      // EL ESTÍMULO NO ES EL IEPS TRASLADADO. `normas/lif-2026-20-A.yaml`
      // (verificado_fuente_primaria) dice literal: "cuota IEPS vigente al momento
      // de la compra × LITROS. No es el IEPS trasladado en el CFDI."
      //
      // Antes se sumaba el trasladado y el PDF lo imprimía en verde citando ese
      // artículo. Dos errores encima: la fórmula equivocada, y una cifra en pesos
      // que la decisión D2 del roadmap prohibió enseñar "sin discusión" —la cuota
      // pasó de $7.3634 a $2.0925 en cinco meses, y el estímulo es ingreso
      // acumulable, así que en bruto infla la propuesta ~30%.
      //
      // Sin el acuerdo semanal del DOF no se puede calcular. Lo que sí se puede
      // es contar los LITROS elegibles: es el dato duro que el contador
      // multiplica por la cuota que él tenga fechada.
      //
      // El medio de pago es requisito del 4º párrafo de la LIF 20-A-IV (monedero,
      // tarjeta, cheque nominativo o transferencia) y NO tiene la válvula del 15%
      // que la RFA 2.9 sí concede para ISR: la facilidad salva la deducción, no
      // el acreditamiento.
      // Los litros los lee el OCR del ticket y viven en `ocrExtra` (el XML del
      // CFDI no siempre trae la cantidad desglosada por concepto).
      const litros = Number((g.ocrExtra as Record<string, unknown> | undefined)?.litros ?? 0);
      const pagoElectronico = !!g.formaPago && g.formaPago !== '01';
      if (pagoElectronico && Number.isFinite(litros) && litros > 0) litrosDieselAcreditables += litros;
      if (!(g.iepsTraslado ?? 0) && g.xmlVerificado) {
        diferencias.push({ tipo: 'ieps_no_desglosado', concepto: g.concepto, monto: 0, nota: `El CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} no desglosa el IEPS — es deducible, pero sin ese desglose se complica documentar el estímulo (LIF 2026 art. 20, ap. A).`, gastoId: g.id });
      }
    }
  }


  // ── Totales de deducibilidad (la cifra que compra el contralor) ──────────────
  // El motor ya detectaba todo lo necesario y no lo sumaba: el contralor tenía que
  // leer la lista de diferencias y hacer la cuenta a mano.
  //
  // Son TRES cubetas, no dos. El combustible en efectivo no cabe en ninguna de las
  // clásicas: es deducible hasta el 15% del combustible del ejercicio (RFA 2026
  // regla 2.9) y ese contador todavía no existe. Ponerlo en "no deducible" le
  // quita dinero al cliente; ponerlo en "deducible" le promete algo que quizá no
  // tenga. Se declara "por confirmar" hasta que exista el contador.
  //
  // OJO: `sobre_politica` NO entra aquí. Exceder la política INTERNA de la flota
  // no vuelve el gasto no deducible ante el SAT: son dos juicios distintos.
  // `sin_cfdi` NO va aquí, y es a propósito. Estuvo, y creaba una contradicción:
  // esta lista se evalúa ANTES que la regla de "sin cfdiUuid → POR CONFIRMAR", así
  // que el mismo hecho —un ticket sin timbrar— salía ROJO si el tenant tenía
  // `requiereCfdi` en su política y ÁMBAR si no. El veredicto dependía de un flag
  // de configuración, no de la ley.
  //
  // El correcto es ámbar. LISR 27-III exige comprobante fiscal, pero el ticket
  // TODAVÍA se puede timbrar: no es deducción perdida, es pendiente. Pintarla de
  // rojo le dice al contralor que dé por perdido un dinero que recupera con una
  // llamada al portal. Se sigue avisando por `diferencias`, que para eso está.

  let totalDeducible = 0, totalNoDeducible = 0, totalPorConfirmar = 0;
  for (const g of input.gastos) {
    // Mismo filtro que `totalComprobado`, para que las tres cubetas SIEMPRE sumen
    // ese total. Si no cuadra, el contralor lo nota con una calculadora.
    if (duplicados.has(g.id) || !(g.monto > 0)) continue;
    const suyas = diferencias.filter((d) => d.gastoId === g.id);
    const cubeta = cubetaDe(g, suyas);
    if (cubeta === 'no_deducible') { totalNoDeducible += g.monto; continue; }
    if (cubeta === 'por_confirmar') { totalPorConfirmar += g.monto; continue; }
    // Parcial: del viático solo se pierde el EXCEDENTE sobre el tope fiscal
    // (LISR 28-V), no el gasto entero. Mandar los $900 completos a no deducible
    // por $150 de exceso es el error que más dinero le cuesta al cliente.
    const excedente = suyas.filter((d) => d.tipo === 'viatico_excede_fiscal').reduce((s, d) => s + (d.monto ?? 0), 0);
    totalNoDeducible += excedente;
    totalDeducible += g.monto - excedente;
  }

  // `ieps_no_desglosado` NO va aquí a propósito: el gasto es deducible y lo único
  // que se pierde es el acreditamiento del estímulo. Casi ningún CFDI de
  // gasolinera desglosa el IEPS al consumidor final, así que tenerlo en REVISAR
  // mandaba TODA liquidación con diésel a la bandeja y la vaciaba de significado.
  // Se sigue avisando en `diferencias`; ya no bloquea.
  const REVISAR: TipoDiferencia[] = ['ocr_baja_confianza', 'sin_cfdi', 'rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_efos_indeterminado', 'cfdi_no_encontrado', 'cfdi_pendiente', 'monto_invalido', 'complemento_hidrocarburos', 'complemento_no_verificable', 'combustible_efectivo', 'efectivo_sobre_tope', 'viatico_excede_fiscal', 'factura_por_vencer', 'alimentacion_sin_soporte', 'viatico_rfc_operador', 'monto_discrepante', 'texto_sospechoso', 'fecha_sospechosa', 'folio_verificar'];
  const hayRevisar = diferencias.some((d) => REVISAR.includes(d.tipo));
  const hayDif = diferencias.some((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado' || d.tipo === 'diesel_desviacion') || Math.abs(diferencia) >= 0.5;
  const estatus: EstatusLiquidacion = hayRevisar ? 'revisar' : hayDif ? 'con_diferencias' : 'cuadrada';

  return {
    viajeId: input.viajeId,
    totalComprobado: round2(totalComprobado),
    totalAnticipo: round2(input.anticipo),
    diferencia,
    estatus,
    diferencias,
    gastos: input.gastos,
    totalDeducible: round2(totalDeducible),
    totalNoDeducible: round2(totalNoDeducible),
    totalPorConfirmar: round2(totalPorConfirmar),
    iepsAcreditable: round2(iepsAcreditable),
    litrosDieselAcreditables: round2(litrosDieselAcreditables),
    ivaAcreditable: round2(ivaAcreditable),
    peajeAcreditable: round2(peajeAcreditable),
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function mxn(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
/**
 * Cómo se llama un concepto en el papel que ve el contralor.
 *
 * `diesel` es un cajón que el OCR usa para TODA la gasolinera —el prompt se lo
 * pide, y para el 15% de la RFA 2.9 está bien porque la regla habla de
 * "combustible"—. Pero un ticket real de PLUS (gasolina premium) salía
 * etiquetado "Diésel", y eso invita a reclamar un estímulo que NO aplica: el de
 * IEPS es solo diésel (LIF 20-A fr. IV).
 *
 * El producto impreso ya lo captura el OCR; aquí solo se usa. Sin él se dice
 * "Combustible", que es cierto siempre.
 */

export function etiquetaConcepto(c: string, ocrExtra?: Record<string, unknown>): string {
  if (c !== 'diesel') return label(c);
  const producto = typeof ocrExtra?.producto === 'string' ? ocrExtra.producto.trim() : '';
  if (!producto) return 'Combustible';
  // Se respeta lo impreso, con la primera en mayúscula: "PLUS" → "Plus".
  const bonito = producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase();
  return /diesel|diésel/i.test(producto) ? 'Diésel' : `Combustible ${bonito}`;
}

function label(c: string): string {
  const m: Record<string, string> = { diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura', alimentacion: 'Alimentación', hospedaje: 'Hospedaje', transporte: 'Transporte', viaticos: 'Viáticos', otro: 'Otro' };   // 'Otro' y no 'Gasto': tiene que decir lo MISMO que pdf.ts y el dashboard
  return m[strip_accents(c.toLowerCase())] ?? c;
}
