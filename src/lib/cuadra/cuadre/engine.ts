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
import { esRfcValido, rfcChecksumOk } from '../intake/cfdi';
import { calcularCaducidad } from '../facturacion/caducidad';
import { identificarComercio } from '../facturacion/identificar';
import { NORMAS } from '../normas/indice';
import type { Gasto, Diferencia, Liquidacion, EstatusLiquidacion, TipoDiferencia } from '@/types/cuadra';
// `formato.ts` no importa NADA: el motor sigue siendo puro y sin I/O.
import { mxn } from '@/lib/formato';

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
   *  y desde cuándo se MIRA. Sin esto, la regla no corre.
   *
   *  `vigenteDesde` viene de la configuración y NO decide dinero: es solo el
   *  filtro de ruido que evita pedir el complemento sobre CFDI viejos. La fecha
   *  que decide dinero es `exigibleDesde`, y su fuente es la FICHA. */
  hidrocarburos?: {
    claves: string[];
    unidad: string;
    vigenteDesde: string;
    /** Fecha de EXIGIBILIDAD respaldada por ficha, o `null` si nadie la ha
     *  confirmado. Si se omite, se toma de `normas/rmf-2026-2.7.1.48.yaml` a
     *  través del índice — que hoy dice `null`. Está aquí para poder probar las
     *  dos ramas y para que el día que se confirme entre por configuración sin
     *  tocar el motor. */
    exigibleDesde?: string | null;
  };
  /** Estímulos y topes fiscales (LIF 2026 art. 20, ap. A / LISR). */
  estimulos?: { peajeFactor: number; viaticosTopeFiscalDiarioMxn: number; efectivoTopeMxn: number; clavesDieselIeps?: string[]; precioDieselPorDefecto?: number };
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
const POR_CONFIRMAR: TipoDiferencia[] = ['combustible_efectivo', 'rfc_receptor_no_verificable'];

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

/**
 * Qué gastos son COPIA de otro, y de cuál.
 *
 * Exportada y única, porque tiene DOS consumidores que se habían separado sin
 * que nadie lo notara: el cuadre —que excluye las copias del total comprobado—
 * y el resumen laboral del PDF, que le dice al contralor cuánto reembolsarle al
 * operador.
 *
 * El segundo recorría TODOS los gastos, copias incluidas. En el primer PDF real
 * (1-ago-2026) eso decía "$19,978.10 no son deducibles todavía, pero el operador
 * puso el dinero: se le reembolsan igual" cuando el total comprobado eran
 * $16,297.05. La diferencia, al centavo, eran las dos copias del mismo ticket de
 * Costco: $15,762.10 que el papel mandaba pagar tres veces.
 *
 * Se detecta primero por UUID del CFDI (regla dura) y si no hay, por
 * concepto+folio+monto. La primera aparición es el ORIGINAL y las siguientes son
 * copias suyas.
 */
export function copiasDeComprobante(gastos: Gasto[]): Map<string, string> {
  const vistoUuid = new Map<string, string>();
  const vistoFolio = new Map<string, string>();
  /** copia → el gasto original del que es copia. */
  const originalDe = new Map<string, string>();
  for (const g of gastos) {
    if (g.cfdiUuid) {
      const u = g.cfdiUuid.toLowerCase();
      const previo = vistoUuid.get(u);
      if (previo) originalDe.set(g.id, previo);
      else vistoUuid.set(u, g.id);
      continue;
    }
    if (g.folio) {
      const key = `${strip_accents(g.concepto.toLowerCase())}|${g.folio}|${g.monto}`;
      const previo = vistoFolio.get(key);
      if (previo) originalDe.set(g.id, previo);
      else vistoFolio.set(key, g.id);
    }
  }
  return originalDe;
}

export function cuadrarViaje(input: CuadreInput): Omit<Liquidacion, 'id' | 'creadaEn'> {
  const umbral = input.umbralConfianza ?? 0.85;
  const diferencias: Diferencia[] = [];

  const norm = (r: string) => strip_accents(r.toUpperCase().replace(/\s/g, ''));
  // RFC genérico del SAT: si el tenant no capturó su RFC real, NO se valida el
  // receptor (evita marcar toda factura como "no es de la empresa"). AL-6.
  const RFC_GENERICO = 'XAXX010101000';
  // Un RFC de empresa MAL FORMADO es un dato que falta, no un dato contra el que
  // comparar. El tenant de demo traía 'TIN010101AAA' —falla el dígito
  // verificador, lo rechaza nuestro propio validador— y `getConfig` lo mete en
  // `empresa.rfc` desde la columna del tenant. Como aquí solo se descartaba el
  // genérico del SAT, ese RFC inventado SÍ se usaba: toda factura legítima cuyo
  // receptor no fuera él salía `rfc_receptor` → NO DEDUCIBLE. Enseñar un CFDI
  // real en una demostración y que el sistema lo declare no deducible es peor
  // que no validar. Se descartan igual que el genérico.
  const rfcsOk = new Set(
    [input.empresaRfc, ...(input.rfcsAdicionales ?? [])]
      .filter(Boolean)
      .map((r) => norm(r as string))
      .filter((r) => r !== RFC_GENERICO)
      .filter((r) => esRfcValido(r) && rfcChecksumOk(r)),
  );
  // "No hay RFC configurado" y "hay uno y no sirve" NO son lo mismo, y tratarlos
  // igual fue una regresión mía del 28-jul: al descartar el RFC mal formado,
  // `rfcsOk` quedaba vacía, la comprobación entera se saltaba, y un CFDI de
  // $11,600 timbrado a un TERCERO salía deducible con $1,600 de IVA acreditable,
  // estatus `cuadrada` y cero diferencias. Cambié "rechaza todo" por "aprueba
  // todo", y la segunda dirección es peor: el producto AFIRMA una deducción que
  // no existe, en verde, y el único rastro es un log de servidor.
  //
  // El estado correcto es el tercero: no se puede confirmar NI descartar → a
  // revisión. Nunca deducible, nunca acreditable, y dicho en el informe.
  // EL GENÉRICO ENTRA AQUÍ, y esa es la corrección de la auditoría 6.
  //
  // La exclusión `!== RFC_GENERICO` se escribió cuando la única alternativa era
  // "rechaza todo": si el tenant no había capturado su RFC, validar el receptor
  // marcaba TODA factura como ajena. Con esa disyuntiva, no validar era lo menos
  // malo. Pero ayer se creó el tercer estado —no se puede confirmar NI
  // descartar → a revisión— y el genérico se quedó fuera por inercia.
  //
  // `XAXX010101000` es el RFC de "público en general" del SAT. Que sea el de la
  // FLOTA significa exactamente lo mismo que un RFC mal formado: hay un valor y
  // no sirve para comparar. Tratarlo distinto era aprobar por defecto, y medido
  // con el motor real un CFDI de $11,600 timbrado a un TERCERO salía
  // "Deducible para ISR $11,600.00" en verde, con $1,600 de IVA acreditable y
  // cero diferencias. El mismo daño del crítico de ayer, por la otra puerta.
  //
  // Y no es un caso raro: `DEMO_CONFIG.empresa.rfc` ES el genérico, así que ésta
  // es la ruta de CUALQUIER tenant que todavía no capturó su RFC — el estado
  // normal de un cliente el día uno, justo después de una demo.
  //
  // Sin RFC ninguno (`empresaRfc` ausente) NO entra: ahí no hay dato que
  // interpretar, y meterlo cambiaría el veredicto de todo viaje sin config,
  // incluidos los arneses de prueba. Un valor inservible y la ausencia de valor
  // no son el mismo hecho.
  const rfcEmpresaInservible = rfcsOk.size === 0 && !!input.empresaRfc;
  /** El valor existe pero es el "público en general": nunca se capturó el real. */
  const rfcEmpresaNoCapturado =
    rfcEmpresaInservible && norm(input.empresaRfc as string) === RFC_GENERICO;

  // 0) Duplicados: primero por UUID (regla dura), luego por concepto+folio+monto.
  //    Se EXCLUYEN del total (no lo inflan) — fix del audit.
  const originalDe = copiasDeComprobante(input.gastos);
  const duplicados = new Set(originalDe.keys());

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
    // EL PAPEL DICE DE SÍ MISMO QUE NO LO ES. Un ticket de restaurante puede
    // traer RFC, subtotal e IVA y aun así llevar impreso "ESTE NO ES UN
    // COMPROBANTE FISCAL": por el art. 29-A no ampara la deducción de nadie.
    //
    // El gasto NO se excluye del comprobado —es dinero que el operador puso y se
    // le tiene que reponer— y por eso `monto: 0`: la diferencia informa, no
    // castiga al chofer por lo que le dio el negocio. Lo que hay que hacer es
    // pedir la factura, y eso es trabajo de la oficina.
    if (extraOcr?.noEsComprobanteFiscal) {
      diferencias.push({ tipo: 'comprobante_no_fiscal', concepto: g.concepto, monto: 0, nota: `El comprobante de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} de ${mxn(g.monto)} lleva impreso que NO es un comprobante fiscal: no ampara deducción (CFF 29-A). El gasto se le repone al operador, pero hay que pedirle la factura al establecimiento.`, gastoId: g.id });
    }
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
    if (rfcEmpresaInservible && g.rfcReceptor) {
      // El texto distingue los dos motivos porque la acción es distinta: uno se
      // corrige, el otro se captura. Decirle "está mal capturado" a quien nunca
      // lo capturó lo manda a buscar un error que no existe.
      const porQue = rfcEmpresaNoCapturado
        ? 'la flota todavía no tiene su RFC capturado'
        : 'el RFC de la flota está mal capturado';
      const queHacer = rfcEmpresaNoCapturado
        ? 'Captura el RFC de la empresa y vuelve a cuadrar.'
        : 'Corrige el RFC de la empresa y vuelve a cuadrar.';
      diferencias.push({
        tipo: 'rfc_receptor_no_verificable', concepto: g.concepto, monto: 0,
        nota: `No se puede verificar a nombre de quién está la factura de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)}: ${porQue}. Queda a revisión — ${queHacer}`,
        gastoId: g.id,
      });
    }
    // AUDITORÍA 8, CRÍTICO: AL-6 por la puerta que quedó abierta. Las dos
    // validaciones de arriba y de abajo exigen `g.rfcReceptor` truthy — pero el
    // esquema de visión NO tiene campo de receptor (el prompt del OCR pide
    // expresamente el RFC del EMISOR, "no el del cliente"), así que un CFDI
    // leído del QR de un ticket impreso, o un XML cuyo Receptor@Rfc no se
    // parseó, llega aquí con `rfcReceptor` vacío. Sin este tercer camino, "no sé
    // a nombre de quién está" caía en 'deducible' — el mismo daño de AL-6, por
    // otra puerta. Solo aplica con CFDI presente: sin él, `cubetaDe` ya manda a
    // 'por_confirmar' por falta de comprobante, y esta nota confundiría la
    // causa.
    if (g.cfdiUuid && !g.rfcReceptor) {
      diferencias.push({
        tipo: 'rfc_receptor_no_verificable', concepto: g.concepto, monto: 0,
        nota: `No se puede verificar a nombre de quién está la factura de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)}: el receptor no se pudo leer del comprobante. Queda a revisión — reenvía el XML o una foto más clara del QR.`,
        gastoId: g.id,
      });
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
      // DOS FECHAS DISTINTAS, Y SOLO UNA PUEDE DECIDIR DINERO.
      //
      // `h.vigenteDesde` sale de `config.ts` ('2026-04-24') y su comentario la
      // funda en la RMF 2.7.1.8 — una cita que NO tiene ficha. Con ella el motor
      // declaraba no deducible: el MISMO CFDI de diésel de $5,800 movido un día
      // pasaba de "$5,800 deducibles, $689.66 de IVA acreditable, 200 L
      // elegibles" a "$0, $0, 0 L", y el papel afirmaba "obligatorio desde
      // 24-abr-2026" sobre una regla redactada en FUTURO ("el complemento que al
      // efecto publique el SAT en su Portal"), cuya propia ficha dice que la
      // obligación puede estar latente y que esa fecha no está respaldada.
      //
      // Ahora `vigenteDesde` es solo el filtro de ruido —desde cuándo vale la
      // pena mirar el complemento— y la que decide dinero es la de la FICHA. Con
      // `null` el motor avisa y manda a revisión; nunca declara no deducible.
      const miraElComplemento = !g.fecha || g.fecha >= h.vigenteDesde;
      const exigibleDesde = h.exigibleDesde !== undefined
        ? h.exigibleDesde
        : (NORMAS['rmf-2026-2.7.1.48']?.exigibleDesde ?? null);
      const exigible = exigibleDesde != null && (!g.fecha || g.fecha.slice(0, 10) >= exigibleDesde);
      if (g.xmlVerificado) {
        // NIVEL 2: tenemos el XML → se puede AFIRMAR que el complemento falta
        // (regla 2.7.1.48 RMF 2026). La regla obliga solo el ClaveProdServ de
        // combustible en CFDI tipo I/E de un permisionario; la unidad LTR es
        // consistencia esperada, NO requisito de la regla (por eso NO se exige
        // aquí — evita falsos negativos). Se EXCLUYEN los esquemas alternos
        // (monedero ECC / Carta Porte), que no caen en 2.7.1.48.
        const combustibleFiscal = h.claves.includes(g.claveProdServ ?? '');
        const tipoAplica = g.tipoComprobante === 'I' || g.tipoComprobante === 'E';

        // PERMISO CRE (LISR 27-III 2º párrafo / RFA 2026 regla 2.9): el CFDI de
        // combustible debe consignar el permiso vigente del proveedor. El
        // sistema no lo extrae del XML —el atributo exacto dentro del
        // complemento de hidrocarburos no está confirmado contra el esquema
        // oficial del SAT, y afirmar mal ahí es peor que no afirmar nada— así
        // que NUNCA se declara cumplido ni incumplido. Solo REVISAR: no toca
        // la cubeta ni el acreditamiento, mismo criterio que EFOS y el
        // complemento de arriba (nunca declarar sin verificar). Independiente
        // de si el complemento de hidrocarburos está presente: son dos
        // requisitos distintos de la misma compra.
        if (combustibleFiscal && tipoAplica) {
          diferencias.push({ tipo: 'permiso_cre_no_verificable', concepto: g.concepto, monto: 0, nota: `El CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} es de combustible: LISR 27-III y RFA 2026 regla 2.9 exigen que conste el permiso CRE vigente del proveedor. El sistema todavía no lo valida — confírmalo con tu contador contra el CFDI.`, gastoId: g.id });
        }

        if (combustibleFiscal && tipoAplica && miraElComplemento && !g.cfdiEsquemaAlterno && !g.complementoHidrocarburos) {
          if (exigible) {
            // Solo con una fecha de exigibilidad RESPALDADA se tira la deducción.
            diferencias.push({ tipo: 'complemento_hidrocarburos', concepto: g.concepto, monto: 0, nota: `El CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} es de combustible y NO trae el complemento de hidrocarburos requerido (obligatorio desde ${exigibleDesde}, regla 2.7.1.48 RMF) — no deducible (CFF 29-A).`, gastoId: g.id });
          } else {
            // El hecho es verificable (el XML no trae el nodo); lo que NO es
            // verificable es que ya se exija. Se reusa `complemento_no_verificable`
            // porque es el tipo que significa "no se puede concluir": queda en
            // REVISAR, fuera de NO_DEDUCIBLE_ISR y fuera de SIN_ACREDITAMIENTO,
            // que es exactamente el veredicto que el motor puede sostener.
            diferencias.push({ tipo: 'complemento_no_verificable', concepto: g.concepto, monto: 0, nota: `El CFDI de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} es de combustible y no trae el complemento de hidrocarburos de la regla 2.7.1.48 RMF. Pídele a la gasolinera la factura con el complemento. NO se declara no deducible: la fecha desde la que el SAT lo hace exigible no está confirmada — confírmalo con tu contador.`, gastoId: g.id });
          }
        }
      } else if (g.cfdiUuid && miraElComplemento) {
        // NIVEL 1: es una FACTURA de combustible (tiene UUID) pero sin el XML →
        // no se puede verificar el complemento. A la bandeja del liquidador, NO
        // se declara no deducible. Se resuelve cuando reenvíen el XML.
        diferencias.push({ tipo: 'complemento_no_verificable', concepto: g.concepto, monto: 0, nota: `La factura de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} es de combustible: reenvía el XML (el que te manda la gasolinera por correo) para verificar el complemento de hidrocarburos.`, gastoId: g.id });
      }
    }
  }

  // 2) Duplicados como diferencia (ya excluidos del total).
  //
  // UNA LÍNEA POR COMPROBANTE REPETIDO, NO UNA POR COPIA. El 1-ago, en el primer
  // ensayo con tickets reales, el mismo Costco entró TRES veces y el cierre le
  // enseñó al operador dos líneas idénticas, palabra por palabra:
  //
  //     • Comprobante duplicado: Alimentación folio 3522 por $7,881.05 aparece
  //       dos veces (excluido del total).
  //     • Comprobante duplicado: Alimentación folio 3522 por $7,881.05 aparece
  //       dos veces (excluido del total).
  //
  // El motor tenía razón —había dos copias sobrantes— pero repetir el mismo
  // texto se lee como un sistema roto justo delante de quien decide la compra. Y
  // "aparece dos veces" era falso: aparecía tres.
  //
  // Se agrupa por el gasto ORIGINAL (el que sí cuenta), y el `gastoId` que se
  // reporta es el del original: es el que el contralor tiene que abrir para
  // decidir cuál se queda. Las copias no le sirven de nada.
  const copiasPorOriginal = new Map<string, Gasto[]>();
  for (const g of input.gastos) {
    if (!duplicados.has(g.id)) continue;
    const original = originalDe.get(g.id);
    if (!original) continue;
    const lista = copiasPorOriginal.get(original) ?? [];
    lista.push(g);
    copiasPorOriginal.set(original, lista);
  }
  for (const [originalId, copias] of copiasPorOriginal) {
    const g = input.gastos.find((x) => x.id === originalId) ?? copias[0];
    const veces = copias.length + 1;   // las copias más el original
    diferencias.push({
      tipo: 'duplicado',
      concepto: g.concepto,
      // El impacto en pesos es lo que se EXCLUYÓ, no el valor de una copia: con
      // tres apariciones se excluyeron dos.
      monto: round2(copias.reduce((a, c) => a + (c.monto > 0 ? c.monto : 0), 0)),
      nota: `Comprobante duplicado: ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)}${g.folio ? ` folio ${sanitizarFolio(g.folio)}` : ''} por ${mxn(g.monto)} aparece ${veces} veces (${copias.length === 1 ? 'una excluida' : `${copias.length} excluidas`} del total).`,
      gastoId: originalId,
    });
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
      // Un comprobante de otro EJERCICIO ya lleva su `fecha_sospechosa`, que dice
      // que no se deduce en este año. Añadirle el aviso de facturación produce
      // dos frases que se contradicen sobre el mismo ticket: una dice que no se
      // deduce, y la otra ofrece "exigirlo dentro del ejercicio" — un remedio que
      // para un ticket de 2019 mirado en 2026 no existe. Salió sobre cinco
      // tickets viejos el 28-jul-2026, al hacer permanente el aviso.
      const ejercicioHoy = Number(input.hoy.slice(0, 4));
      if (Number(g.fecha.slice(0, 4)) < ejercicioHoy) continue;
      // El plazo del comercio se usa SOLO si está verificado contra su portal.
      // `plazoVerificado: false` es el default del catálogo a propósito: un plazo
      // inventado haría que el sistema jure que un ticket sigue vigente.
      const plazo = comercio?.plazoVerificado ? comercio.plazo : 'mes_natural';
      const c = calcularCaducidad({ fechaTicket: g.fecha.slice(0, 10), plazo, hoy: input.hoy });
      // NO se espera a que sea urgente. El umbral de 2 días viene de un panel que
      // alguien mira a diario; la liquidación es un documento de UNA sola vez, y
      // si al generarla quedaban 3 días, el PDF calla y nadie vuelve a abrirlo.
      // Medido el 28-jul-2026 sobre ocho tickets reales: $9,070 sin timbrar, con
      // portal reconocido, a tres días del cierre, y la liquidación en silencio.
      // Ahora se dice siempre, y lo que cambia con la urgencia es el TONO.
      if (c.desconocido) continue;
      // LA FECHA QUE SE DICE ES DE NIVEL 6, Y TIENE QUE SONAR A NIVEL 6.
      //
      // `normas/politica-portales-plazos.yaml` lo dice sin rodeos: "ESTO NO ES
      // UNA NORMA FISCAL… El plazo LEGAL para pedir factura es todo el ejercicio
      // (el SAT lo dice expresamente)… El producto NUNCA debe presentar estos
      // plazos como una obligación fiscal". La rama VENCIDA sí lo decía; las
      // otras dos no, y son las que se leen antes. Un contralor que lee "puedes
      // timbrarlo hasta el 31-ago" concluye que el 1-sep se perdió el CFDI —
      // justo el error de confundir niveles que `normas/README.md` llama el más
      // caro del dominio, esta vez cometido por el papel que vendemos.
      //
      // El matiz cambia según de dónde salga la fecha: sin verificar, la ventana
      // del comercio puede ser MENOR; verificada, la ventana es la del comercio
      // y el ejercicio sigue siendo el plazo de la ley.
      const cierreComercio = comercio?.plazoVerificado
        ? ` (plazo del portal de ${comercio.nombre}, no de la ley: legalmente puedes exigir la factura dentro del ejercicio)`
        : ', y la ventana del comercio puede ser menor';
      // SI LA FECHA ESTÁ EN DUDA, EL PLAZO TAMBIÉN. Las dos observaciones salen
      // del MISMO dato, y una de ellas manda a la oficina a hacer algo.
      //
      // Visto el 1-ago con un ticket real: el OCR leyó un 8 como 6 y fechó en
      // junio una compra de agosto. El motor dudó de la fecha —bien— y en la
      // línea siguiente afirmó que el plazo de facturación se había vencido,
      // calculado sobre esa misma fecha. Le habría costado a la oficina pelear
      // por Conciliación de Factura una factura que el portal del comercio
      // habría emitido sin discutir.
      //
      // Dudar de un dato y a la vez actuar sobre él es peor que no dudar: el
      // aviso lleva la autoridad de un cálculo y la fragilidad de una lectura.
      const fechaEnDuda = diferencias.some((d) => d.tipo === 'fecha_sospechosa' && d.gastoId === g.id);
      const cuerpo = fechaEnDuda
        ? `no se puede calcular el plazo de facturación: su fecha no cuadra con el viaje y hay que verificarla primero en el papel`
        : c.vencido
        ? `se pasó el plazo de facturación. El comercio ya no suele facturarlo en su portal, pero legalmente puedes exigirlo dentro del ejercicio (Conciliación de Factura del SAT)`
        : c.urgente
          ? `quedan ${c.diasRestantes} día(s) para timbrarlo${comercio?.plazoVerificado ? `${cierreComercio}` : ' — y la ventana del comercio puede ser menor, así que hazlo antes'}`
          : `puedes timbrarlo hasta el ${c.fechaLimite} (${c.diasRestantes} días)${cierreComercio}`;
      // Con comercio reconocido el aviso deja de ser genérico: dice a qué portal
      // ir y qué datos hay que teclear, que es la diferencia entre un recordatorio
      // y una instrucción que alguien puede ejecutar.
      // Los campos solo se enumeran si el catálogo los tiene: hay comercios
      // portados de la tabla vieja cuyo portal se conoce pero cuyas etiquetas no
      // están verificadas, y listar nombres inventados en un documento que lee un
      // contralor es el mismo error que citar una ley que no dice lo que se cita.
      const pide = comercio?.campos.filter((k) => k.requerido).map((k) => k.etiquetaPortal) ?? [];
      const donde = comercio
        ? ` Portal de ${comercio.nombre}: ${comercio.portal}${pide.length ? ` — te pedirá ${pide.join(', ')}.` : '.'}`
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
    // `flete` NO cuenta, y por eso existe como concepto aparte. LISR 28-V pide el
    // comprobante que ampare "el hospedaje o transporte" — de la PERSONA. Medido
    // el 28-jul-2026 sobre tickets reales: tres guías de Paquetexpress bastaban
    // para que esta advertencia desapareciera sobre una comida de $1,050. El
    // motor daba por amparado lo que la ley no ampara, y callando.
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
      // AUDITORÍA 8, CRÍTICO: la proporción que de verdad se APLICA al dinero se
      // calcula solo entre los TIMBRADOS del día, no contra `total` (que incluye
      // tickets sin CFDI). `cubetaDe` ya manda esos tickets a por_confirmar por
      // su cuenta y nunca lee `proporcionDeducible` — pero antes SÍ inflaban este
      // denominador, y le recortaban la deducción a los comprobantes que sí
      // amparan. Medido: una comida de $700 con CFDI, bajo el tope de $750,
      // salía "$194.44 deducibles" solo porque un ticket sin timbrar del mismo
      // día se sumó al total. La nota de arriba (`total`, `exceso`) sigue
      // informando del día completo a propósito: antes de timbrarse, el
      // contralor quiere saber que ese gasto tampoco va a deducir completo.
      const timbrados = delDia.filter((x) => x.cfdiUuid);
      const totalTimbrado = timbrados.reduce((s, x) => s + x.monto, 0);
      if (totalTimbrado > 0) {
        const proporcionTimbrado = Math.min(1, topeAlimentacion / totalTimbrado);
        for (const x of timbrados) proporcionDeducible.set(x.id, proporcionTimbrado);
      }

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
  const SIN_ACREDITAMIENTO: TipoDiferencia[] = ['rfc_receptor', 'rfc_receptor_no_verificable', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_no_encontrado', 'complemento_hidrocarburos', 'combustible_efectivo', 'efectivo_sobre_tope', 'monto_invalido'];
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
      if (pagoElectronico && Number.isFinite(litros) && litros > 0) {
        // AUDITORÍA 8, CRÍTICO: los litros salen del OCR y nada los cotejaba —
        // ni contra el XML (no siempre trae la cantidad desglosada), ni contra
        // precio×litros≈monto. Un decimal corrido en la lectura (200.00 L visto
        // como 20,000 L) acreditaba cien veces el estímulo real, y es justo el
        // número que el contador multiplica por la cuota del DOF. Tolerancia
        // amplia (0.5×–2× el precio de referencia) a propósito: no es para fijar
        // el precio del litro, solo para atrapar un error de lectura grosero sin
        // marcar tickets legítimos por variación regional de precio.
        const precioRef = input.estimulos?.precioDieselPorDefecto ?? 27.0;
        const litrosEsperados = precioRef > 0 ? g.monto / precioRef : 0;
        const razon = litrosEsperados > 0 ? litros / litrosEsperados : Infinity;
        if (razon < 0.5 || razon > 2) {
          diferencias.push({
            tipo: 'diesel_desviacion', concepto: g.concepto, monto: 0,
            nota: `Los ${litros} L leídos de ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined)} no cuadran con el monto: ${mxn(g.monto)} ÷ ~$${precioRef}/L ≈ ${Math.round(litrosEsperados)} L esperados. No se acredita el estímulo hasta verificar el ticket.`,
            gastoId: g.id,
          });
        } else {
          litrosDieselAcreditables += litros;
        }
      }
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
    //
    // El reparto va por PROPORCIÓN del día, la misma que el bloque de
    // acreditamiento usa para el IVA — y por la misma razón que allá se dejó de
    // anclar el exceso a un comprobante. Aquí se seguía anclando, y producía un
    // deducible NEGATIVO: dos comidas del mismo día, $2,000 sin CFDI y $100 con
    // CFDI, tope $750. El exceso del día ($1,350) se colgaba del ancla —el de
    // $100, que es el único en la cubeta deducible— y salía
    // `totalDeducible = -1250` bajo un comprobado de $2,100. Eso se imprime.
    //
    // Con la proporción, cada comprobante del día es deducible en su parte del
    // tope ($750/$2,100 = 35.7%) y no deducible en el resto. Nunca es negativo,
    // no depende del ORDEN del arreglo, y las tres cubetas siguen sumando el
    // comprobado. Los gastos que ya cayeron en `por_confirmar` no arrastran su
    // exceso hasta acá: mientras no estén timbrados no son deducción de nadie.
    const proporcion = Math.max(0, Math.min(1, proporcionDeducible.get(g.id) ?? 1));
    const deducibleDelGasto = round2(g.monto * proporcion);
    totalDeducible += deducibleDelGasto;
    totalNoDeducible += round2(g.monto - deducibleDelGasto);
  }

  // `ieps_no_desglosado` NO va aquí a propósito: el gasto es deducible y lo único
  // que se pierde es el acreditamiento del estímulo. Casi ningún CFDI de
  // gasolinera desglosa el IEPS al consumidor final, así que tenerlo en REVISAR
  // mandaba TODA liquidación con diésel a la bandeja y la vaciaba de significado.
  // Se sigue avisando en `diferencias`; ya no bloquea.
  const REVISAR: TipoDiferencia[] = ['ocr_baja_confianza', 'sin_cfdi', 'rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_efos_indeterminado', 'cfdi_no_encontrado', 'cfdi_pendiente', 'monto_invalido', 'complemento_hidrocarburos', 'complemento_no_verificable', 'combustible_efectivo', 'efectivo_sobre_tope', 'viatico_excede_fiscal', 'factura_por_vencer', 'alimentacion_sin_soporte', 'viatico_rfc_operador', 'monto_discrepante', 'texto_sospechoso', 'fecha_sospechosa', 'folio_verificar', 'comprobante_no_fiscal', 'diesel_desviacion', 'permiso_cre_no_verificable'];
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
  const m: Record<string, string> = { diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura', alimentacion: 'Alimentación', hospedaje: 'Hospedaje', transporte: 'Transporte', flete: 'Flete', viaticos: 'Viáticos', otro: 'Otro' };   // 'Otro' y no 'Gasto': tiene que decir lo MISMO que pdf.ts y el dashboard
  return m[strip_accents(c.toLowerCase())] ?? c;
}
