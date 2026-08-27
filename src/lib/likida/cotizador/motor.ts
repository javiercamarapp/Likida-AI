// ═══════════════════════════════════════════════════════════════════════════
// EL COTIZADOR DE GANANCIA REAL — el motor puro (0225, A8 del plan).
//
// La pregunta que contesta es la que Troost cobra por contestar a medias:
// "¿a cuánto tengo que cotizar este viaje para GANAR dinero?" — pero con la
// doctrina de la casa: cada renglón del costo lleva su SUPUESTO en la misma
// línea (de dónde salió el número), las casetas son MEDIDAS cuando hay
// viajes liquidados de la misma ruta (la ventaja que nadie más tiene: el
// conciliador de peajes ya dejó ese dato limpio), y lo que no está declarado
// NO se inventa — sin costo de diésel declarado no hay precio sugerido, hay
// una lista de qué falta.
//
// PURO A PROPÓSITO, como `tarifaSugerida` (clientes.ts) y el motor de
// estadías: recibe los datos en vez de ir por ellos. Es la única función que
// decide el precio sugerido, y una que consulta la base no se puede probar
// sin montar una base. `cotizador/lector.ts` es quien la alimenta.
//
// EL DESGLOSE ES CITABLE: se persiste TAL CUAL en `cotizacion.desglose`
// (jsonb, 0225) al crear la cotización. Si mañana cambian los costos
// declarados, la cotización de ayer sigue diciendo con qué números se armó
// — mismo contrato que el XML de Carta Porte (0214): lo citable es lo que
// salió, no lo que saldría hoy.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '@/lib/formato';

/** Los costos DECLARADOS por la flota (cotizador_config, 0225). NULL = no
 *  declarado — jamás un default: un diésel supuesto cotiza a pérdida con
 *  cara de ganancia. */
export interface CostosDeclarados {
  dieselPorKm: number | null;
  salarioDia: number | null;
  viaticosDia: number | null;
  fijosPorKm: number | null;
  /** Multiplicador de los costos por km para cubrir el regreso (1–3). */
  factorRegresoVacio: number | null;
  /** Markup objetivo sobre el costo, en % (0–90). */
  margenObjetivoPct: number | null;
}

/** De dónde salen las casetas de esta cotización. La jerarquía la decide el
 *  lector: medida > capturada > falta. */
export type FuenteCasetas =
  | { tipo: 'medida'; promedio: number; viajes: number }
  | { tipo: 'capturada'; monto: number }
  | { tipo: 'falta' };

/** El pacto de detención aplicable (0207) — informativo: el riesgo de
 *  estadías se DECLARA en la cotización, no se suma al costo (sumarlo
 *  afirmaría que la estadía va a pasar, y eso nadie lo sabe al cotizar). */
export interface PactoDetencion {
  horasLibres: number | null;
  tarifaHora: number | null;
  origen: 'cliente' | 'flota';
}

export interface EntradaCotizacion {
  /** Km de la ruta. `null` = sin capturar: nada por-km se puede calcular. */
  km: number | null;
  /** Días de viaje DECLARADOS por quien cotiza. `null` = sin declarar. */
  dias: number | null;
  casetas: FuenteCasetas;
  costos: CostosDeclarados;
  pactoDetencion: PactoDetencion | null;
}

export interface LineaDesglose {
  concepto: string;
  /** `null` = este renglón no se pudo calcular (y `supuesto` dice por qué). */
  monto: number | null;
  /** De dónde salió el número, en palabras de pantalla. SIEMPRE presente. */
  supuesto: string;
}

export interface Desglose {
  lineas: LineaDesglose[];
  /** Suma de renglones SOLO cuando todos tienen monto. `null` = incompleto. */
  costoTotal: number | null;
  /** Qué falta declarar/capturar para poder afirmar el costo o el precio. */
  faltantes: string[];
  /** `costoTotal × (1 + margen/100)`. `null` si falta costo o margen. */
  precioSugerido: number | null;
  /** Avisos que viajan con la cotización (pacto de detención, etc.). */
  notas: string[];
}

/** Un número finito y no negativo, o nada: un NaN aquí es un precio roto. */
function sano(v: number | null): number | null {
  return v !== null && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Arma el desglose completo de la cotización. Determinista y sin sorpresas:
 * mismos insumos, mismo desglose.
 */
export function armarDesglose(e: EntradaCotizacion): Desglose {
  const lineas: LineaDesglose[] = [];
  const faltantes: string[] = [];
  const notas: string[] = [];

  const km = e.km !== null && Number.isFinite(e.km) && e.km > 0 ? e.km : null;
  const dias = e.dias !== null && Number.isFinite(e.dias) && e.dias > 0 ? e.dias : null;
  const diesel = sano(e.costos.dieselPorKm);
  const fijos = sano(e.costos.fijosPorKm);
  const salario = sano(e.costos.salarioDia);
  const viaticos = sano(e.costos.viaticosDia);
  const factor = e.costos.factorRegresoVacio !== null
    && Number.isFinite(e.costos.factorRegresoVacio)
    && e.costos.factorRegresoVacio >= 1
    ? e.costos.factorRegresoVacio : null;
  const margen = e.costos.margenObjetivoPct !== null
    && Number.isFinite(e.costos.margenObjetivoPct)
    && e.costos.margenObjetivoPct >= 0
    ? e.costos.margenObjetivoPct : null;

  if (km === null) faltantes.push('los km de la ruta');
  if (factor === null) faltantes.push('el factor de regreso vacío (config)');

  // ── Diésel y fijos: por km, por el factor de regreso ─────────────────────
  // Las dos van multiplicadas por el factor: el camión también quema diésel
  // y depreciación de regreso, lo pague o no este cliente.
  if (diesel === null) {
    faltantes.push('el costo de diésel por km (config)');
    lineas.push({ concepto: 'Diésel', monto: null, supuesto: 'sin costo por km declarado en la configuración' });
  } else if (km === null || factor === null) {
    lineas.push({
      concepto: 'Diésel',
      monto: null,
      supuesto: `$${diesel}/km declarado — falta ${km === null ? 'el km de la ruta' : 'el factor de regreso'}`,
    });
  } else {
    lineas.push({
      concepto: 'Diésel',
      monto: round2(diesel * km * factor),
      supuesto: `$${diesel}/km declarado × ${km} km × factor ${factor} de regreso`,
    });
  }

  if (fijos === null) {
    faltantes.push('los fijos por km (config)');
    lineas.push({ concepto: 'Fijos prorrateados', monto: null, supuesto: 'sin fijos por km declarados en la configuración' });
  } else if (km === null || factor === null) {
    lineas.push({
      concepto: 'Fijos prorrateados',
      monto: null,
      supuesto: `$${fijos}/km declarado — falta ${km === null ? 'el km de la ruta' : 'el factor de regreso'}`,
    });
  } else {
    lineas.push({
      concepto: 'Fijos prorrateados',
      monto: round2(fijos * km * factor),
      supuesto: `$${fijos}/km declarado × ${km} km × factor ${factor} de regreso`,
    });
  }

  // ── El operador: por día declarado al cotizar ────────────────────────────
  if (dias === null) faltantes.push('los días de viaje');
  if (salario === null) faltantes.push('el salario por día (config)');
  if (viaticos === null) faltantes.push('los viáticos por día (config)');
  if (dias !== null && salario !== null && viaticos !== null) {
    lineas.push({
      concepto: 'Operador (salario y viáticos)',
      monto: round2((salario + viaticos) * dias),
      supuesto: `($${salario} + $${viaticos})/día declarados × ${dias} día(s) declarados al cotizar`,
    });
  } else {
    lineas.push({
      concepto: 'Operador (salario y viáticos)',
      monto: null,
      supuesto: 'faltan salario/viáticos declarados o los días del viaje',
    });
  }

  // ── Casetas: MEDIDAS cuando se puede, y la fuente lo dice ────────────────
  switch (e.casetas.tipo) {
    case 'medida': {
      const prom = sano(e.casetas.promedio);
      if (prom === null || e.casetas.viajes < 1) {
        // Una medición rota no degrada a silencio: degrada a "falta".
        lineas.push({ concepto: 'Casetas', monto: null, supuesto: 'la medición histórica no es legible — captura el monto a mano' });
        faltantes.push('las casetas (captura manual)');
      } else {
        lineas.push({
          concepto: 'Casetas',
          monto: round2(prom),
          supuesto: `MEDIDO: promedio de ${e.casetas.viajes} viajes liquidados de esta ruta (últimos 12 meses)`,
        });
      }
      break;
    }
    case 'capturada': {
      const m = sano(e.casetas.monto);
      if (m === null) {
        lineas.push({ concepto: 'Casetas', monto: null, supuesto: 'el monto capturado no es un número legible' });
        faltantes.push('las casetas (captura manual)');
      } else {
        lineas.push({ concepto: 'Casetas', monto: round2(m), supuesto: 'capturado a mano al cotizar (sin viajes medidos de esta ruta)' });
      }
      break;
    }
    case 'falta':
      lineas.push({
        concepto: 'Casetas',
        monto: null,
        supuesto: 'sin viajes liquidados de esta ruta para medir — captura el monto a mano',
      });
      faltantes.push('las casetas (captura manual)');
      break;
  }

  // ── El pacto de detención: riesgo DECLARADO, no costo sumado ─────────────
  if (e.pactoDetencion) {
    const p = e.pactoDetencion;
    const quien = p.origen === 'cliente' ? 'pactado con este cliente' : 'pacto de flota';
    if (p.horasLibres !== null && p.tarifaHora !== null) {
      notas.push(`Detención (${quien}): ${p.horasLibres} h libres y $${p.tarifaHora}/h después — riesgo declarado, NO sumado al costo (una estadía no se afirma antes de que pase).`);
    } else if (p.horasLibres !== null || p.tarifaHora !== null) {
      notas.push(`Detención (${quien}): pacto incompleto (falta ${p.horasLibres === null ? 'horas libres' : 'tarifa por hora'}) — revísalo en Facturación → Estadías.`);
    }
  } else {
    notas.push('Sin pacto de detención con este cliente ni de flota: las estadías de este viaje no tendrían tarifa cobrable (Facturación → Estadías).');
  }

  // ── El total y el precio: SOLO con todo declarado ────────────────────────
  const completos = lineas.every((l) => l.monto !== null);
  const costoTotal = completos
    ? round2(lineas.reduce((s, l) => s + (l.monto ?? 0), 0))
    : null;

  if (margen === null) faltantes.push('el margen objetivo (config)');
  const precioSugerido = costoTotal !== null && margen !== null
    ? round2(costoTotal * (1 + margen / 100))
    : null;

  // Sin duplicados y en el orden en que se detectaron.
  const faltantesUnicos = [...new Set(faltantes)];

  return { lineas, costoTotal, faltantes: faltantesUnicos, precioSugerido, notas };
}
