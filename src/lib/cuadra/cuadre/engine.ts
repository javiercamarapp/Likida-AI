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
  /** Complemento de hidrocarburos (Bloque 1): claves de combustible, unidad,
   *  y fecha de vigencia. Sin esto, la regla no corre. */
  hidrocarburos?: { claves: string[]; unidad: string; vigenteDesde: string };
  /** Estímulos y topes fiscales (LIF 2026 Art. 20 / LISR). */
  estimulos?: { peajeFactor: number; viaticosTopeFiscalDiarioMxn: number; efectivoTopeMxn: number; clavesDieselIeps?: string[] };
}

function politicaPara(concepto: string, ruta: string | undefined, pol: PoliticaGasto[]): PoliticaGasto | undefined {
  const c = strip_accents(concepto.toLowerCase());
  // Preferir una política específica de la ruta; si no, la general del concepto.
  const dela = pol.filter((p) => strip_accents(p.concepto.toLowerCase()) === c);
  return dela.find((p) => p.ruta && ruta && p.ruta === ruta) ?? dela.find((p) => !p.ruta);
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
      diferencias.push({ tipo: 'monto_invalido', concepto: g.concepto, monto: 0, nota: `El comprobante de ${label(g.concepto)} tiene un monto inválido (${mxn(g.monto)}) — revisar a mano.`, gastoId: g.id });
      continue;
    }
    const h = input.hidrocarburos;
    const esCombustible = g.concepto === 'diesel' || (!!h && h.claves.includes(g.claveProdServ ?? ''));

    // Regla 5 (LISR 27-III): el combustible EXIGE pago electrónico sin importar el
    // monto; pagado en efectivo (FormaPago 01) → no deducible.
    const topeEfectivo = input.estimulos?.efectivoTopeMxn ?? 2000;
    if (g.formaPago === '01' && esCombustible) {
      diferencias.push({ tipo: 'combustible_efectivo', concepto: g.concepto, monto: 0, nota: `${label(g.concepto)} pagado en EFECTIVO — el combustible exige pago electrónico (LISR 27-III), no deducible.`, gastoId: g.id });
    } else if (g.formaPago === '01' && !esCombustible && g.monto > topeEfectivo) {
      // Regla 6: gasto no-combustible en efectivo > tope → no deducible.
      diferencias.push({ tipo: 'efectivo_sobre_tope', concepto: g.concepto, monto: 0, nota: `${label(g.concepto)} de ${mxn(g.monto)} en efectivo excede el tope de ${mxn(topeEfectivo)} (LISR 27-III) — no deducible.`, gastoId: g.id });
    }

    // Regla 1.10: tope FISCAL de alimentación $750/día (LISR 28-V), distinto del
    // tope de POLÍTICA interna. Manda el menor; aquí se marca el excedente fiscal.
    const topeViaticoFiscal = input.estimulos?.viaticosTopeFiscalDiarioMxn;
    if (g.concepto === 'viaticos' && topeViaticoFiscal != null && g.monto > topeViaticoFiscal) {
      diferencias.push({ tipo: 'viatico_excede_fiscal', concepto: g.concepto, esperado: topeViaticoFiscal, real: g.monto, monto: round2(g.monto - topeViaticoFiscal), nota: `Viático de ${mxn(g.monto)} excede el tope fiscal de alimentación (${mxn(topeViaticoFiscal)}/día, LISR 28-V) — el excedente de ${mxn(g.monto - topeViaticoFiscal)} no es deducible.`, gastoId: g.id });
    }

    const pol = politicaPara(g.concepto, input.ruta, input.politica);
    if (pol?.topeMonto != null && g.monto > pol.topeMonto) {
      diferencias.push({
        tipo: 'sobre_politica', concepto: g.concepto, esperado: pol.topeMonto, real: g.monto,
        monto: g.monto - pol.topeMonto,
        nota: `${label(g.concepto)} de ${mxn(g.monto)} excede el tope de política (${mxn(pol.topeMonto)}) por ${mxn(g.monto - pol.topeMonto)}.`,
        gastoId: g.id,
      });
    }
    if (pol?.requiereCfdi && !g.cfdiUuid) {
      diferencias.push({ tipo: 'sin_cfdi', concepto: g.concepto, monto: 0, nota: `${label(g.concepto)} de ${mxn(g.monto)} requiere factura CFDI y no trae UUID válido.`, gastoId: g.id });
    }
    if (g.ocrConfianza != null && g.ocrConfianza < umbral) {
      diferencias.push({ tipo: 'ocr_baja_confianza', concepto: g.concepto, monto: 0, nota: `El comprobante de ${label(g.concepto)} se leyó con baja confianza — conviene revisarlo a mano.`, gastoId: g.id });
    }
    if (rfcsOk.size > 0 && g.rfcReceptor && !rfcsOk.has(norm(g.rfcReceptor))) {
      diferencias.push({ tipo: 'rfc_receptor', concepto: g.concepto, monto: 0, nota: `Factura de ${label(g.concepto)} timbrada al RFC ${g.rfcReceptor} (no es de la empresa) — no deducible.`, gastoId: g.id });
    }
    if (g.estadoSat === 'cancelado') {
      diferencias.push({ tipo: 'cfdi_cancelado', concepto: g.concepto, monto: 0, nota: `El CFDI de ${label(g.concepto)} está CANCELADO ante el SAT — no deducible.`, gastoId: g.id });
    } else if (g.estadoSat === 'no_encontrado' && g.cfdiUuid) {
      diferencias.push({ tipo: 'cfdi_no_encontrado', concepto: g.concepto, monto: 0, nota: `El SAT NO reconoce el CFDI de ${label(g.concepto)} (UUID inexistente o fabricado) — no deducible.`, gastoId: g.id });
    } else if (g.efos === true) {
      diferencias.push({ tipo: 'cfdi_efos', concepto: g.concepto, monto: 0, nota: `El emisor del CFDI de ${label(g.concepto)} está en lista negra del SAT (EFOS) — no deducible.`, gastoId: g.id });
    } else if (g.efosRevisar) {
      diferencias.push({ tipo: 'cfdi_efos_indeterminado', concepto: g.concepto, monto: 0, nota: `La validación EFOS del CFDI de ${label(g.concepto)} no fue concluyente — conviene revisarlo a mano.`, gastoId: g.id });
    } else if (g.estadoSat === 'pendiente' && g.cfdiUuid) {
      diferencias.push({ tipo: 'cfdi_pendiente', concepto: g.concepto, monto: 0, nota: `No se pudo validar el CFDI de ${label(g.concepto)} con el SAT — se revisa después.`, gastoId: g.id });
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
          diferencias.push({ tipo: 'complemento_hidrocarburos', concepto: g.concepto, monto: 0, nota: `El CFDI de ${label(g.concepto)} es de combustible y NO trae el complemento de hidrocarburos requerido (obligatorio desde 24-abr-2026, regla 2.7.1.48 RMF) — no deducible (CFF 29-A).`, gastoId: g.id });
        }
      } else if (g.cfdiUuid && aplicaPorFecha) {
        // NIVEL 1: es una FACTURA de combustible (tiene UUID) pero sin el XML →
        // no se puede verificar el complemento. A la bandeja del liquidador, NO
        // se declara no deducible. Se resuelve cuando reenvíen el XML.
        diferencias.push({ tipo: 'complemento_no_verificable', concepto: g.concepto, monto: 0, nota: `La factura de ${label(g.concepto)} es de combustible: reenvía el XML (el que te manda la gasolinera por correo) para verificar el complemento de hidrocarburos.`, gastoId: g.id });
      }
    }
  }

  // 2) Duplicados como diferencia (ya excluidos del total).
  for (const g of input.gastos) {
    if (duplicados.has(g.id)) {
      diferencias.push({ tipo: 'duplicado', concepto: g.concepto, monto: g.monto, nota: `Comprobante duplicado: ${label(g.concepto)}${g.folio ? ` folio ${g.folio}` : ''} por ${mxn(g.monto)} aparece dos veces (excluido del total).`, gastoId: g.id });
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

  // ── Acreditamiento (reglas 7, 9, 1.6): IEPS/IVA/peaje de CFDI DEDUCIBLES ──────
  // Un traslado solo suma si el gasto NO cayó en una diferencia de no-deducible.
  const NO_DEDUCIBLE: TipoDiferencia[] = ['rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_no_encontrado', 'complemento_hidrocarburos', 'combustible_efectivo', 'efectivo_sobre_tope', 'monto_invalido'];
  const peajeFactor = input.estimulos?.peajeFactor ?? 0.5;
  let iepsAcreditable = 0, ivaAcreditable = 0, peajeAcreditable = 0;
  for (const g of input.gastos) {
    if (duplicados.has(g.id)) continue;
    if (diferencias.some((d) => d.gastoId === g.id && NO_DEDUCIBLE.includes(d.tipo))) continue;
    // El acreditamiento exige un CFDI VERIFICADO (XML): un ticket de gasolinera
    // sin factura NO es deducible ni acreditable hasta timbrarse. Además, así el
    // IVA/IEPS son SIEMPRE los importes LEÍDOS del XML (nunca recomputados con una
    // tasa asumida: 16% u 8% fronterizo salen tal cual del comprobante).
    if (!g.xmlVerificado) continue;
    if ((g.ivaTraslado ?? 0) > 0) ivaAcreditable += g.ivaTraslado as number;
    // Peaje (1.6): 50% del SubTotal (sin IVA) de casetas.
    if (g.concepto === 'caseta' && (g.subTotal ?? 0) > 0) peajeAcreditable += (g.subTotal as number) * peajeFactor;
    // IEPS de DIÉSEL (7): el estímulo (LIF Art. 20-A fr. IV) es SOLO diésel — NO
    // gasolina. Se identifica por la clave de producto del SAT (15101505).
    const clavesDiesel = input.estimulos?.clavesDieselIeps ?? [];
    const esDieselIeps = clavesDiesel.includes(g.claveProdServ ?? '');
    if (esDieselIeps) {
      if ((g.iepsTraslado ?? 0) > 0) iepsAcreditable += g.iepsTraslado as number;
      else if (g.xmlVerificado) {
        diferencias.push({ tipo: 'ieps_no_desglosado', concepto: g.concepto, monto: 0, nota: `El CFDI de ${label(g.concepto)} no desglosa el IEPS — es deducible, pero sin ese desglose se pierde el acreditamiento del estímulo (LIF 2026 Art. 20).`, gastoId: g.id });
      }
    }
  }

  const REVISAR: TipoDiferencia[] = ['ocr_baja_confianza', 'sin_cfdi', 'rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_efos_indeterminado', 'cfdi_no_encontrado', 'cfdi_pendiente', 'monto_invalido', 'complemento_hidrocarburos', 'complemento_no_verificable', 'combustible_efectivo', 'efectivo_sobre_tope', 'ieps_no_desglosado', 'viatico_excede_fiscal'];
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
    iepsAcreditable: round2(iepsAcreditable),
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
function label(c: string): string {
  const m: Record<string, string> = { diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura', viaticos: 'Viáticos', otro: 'Gasto' };
  return m[strip_accents(c.toLowerCase())] ?? c;
}
