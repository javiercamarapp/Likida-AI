import { normalizarNombre, normalizarTag } from './formatos';
import { decenasDelMes, limitesDelMes, mesAnterior } from './periodo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CIERRE MENSUAL DE PEAJES — consolidar las 3 decenas de un mes.
//
// Finanzas no revisa decena por decena: revisa el MES completo (≈ 28 000–36 000
// cruces) y, para que los cobros tardíos «se acomoden», hasta DOS meses juntos.
// Esta pieza junta los archivos decenales de un mes y responde:
//   · ¿están las tres decenas? (si falta una, el cierre lo dice: un mes a medias
//     no se presenta como completo);
//   · ¿cuántos cruces e importe tiene el mes, por decena?;
//   · ¿qué cobros llegaron TARDE? Dos tipos: los del MES ANTERIOR cobrados en este
//     mes, y los de una decena anterior del mismo mes cobrados en una decena
//     posterior;
//   · ¿algún cobro aparece en DOS archivos? Si un extemporáneo ya se cobró en el
//     archivo de su mes, o un cruce está en dos decenas, es la señal más fuerte de
//     cobro repetido — pero necesita los archivos que se hayan subido.
// Todo es CANDIDATO para validar con el proveedor, igual que `reglas_cobro.ts`.
//
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

export interface LineaCierre {
  fecha: string | null;
  hora?: string | null;
  caseta: string | null;
  tag: string | null;
  monto: number;
}

export interface ArchivoCierre {
  id: string;
  etiqueta: string;
  /** El periodo OFICIAL del archivo (declarado o del nombre). `null` = no se sabe. */
  periodoDesde: string | null;
  periodoHasta: string | null;
  lineas: readonly LineaCierre[];
}

export interface ResumenDecena {
  etiqueta: string;
  desde: string;
  hasta: string;
  /** Archivos que cubren esa decena (normalmente uno). */
  archivos: string[];
  cruces: number;
  monto: number;
  cubierta: boolean;
}

export interface TardioDelMes {
  archivoId: string;
  fecha: string;
  caseta: string | null;
  tag: string | null;
  monto: number;
  /** `mes_anterior` = fecha anterior al mes del cierre; `decena_anterior` = dentro del mes, pero antes del inicio de su archivo. */
  tipo: 'mes_anterior' | 'decena_anterior';
  /** ¿Ya aparece el mismo cobro en otro archivo cargado? Si sí, es un candidato fuerte a cobro repetido. */
  yaCobradoEn: string | null;
}

export interface CierreMensual {
  mes: string;
  decenas: ResumenDecena[];
  decenasFaltantes: string[];
  archivosSinPeriodo: string[];
  cruces: number;
  monto: number;
  tardios: TardioDelMes[];
  tardiosMesAnterior: { n: number; monto: number };
  tardiosDecenaAnterior: { n: number; monto: number };
  /** Cobros que aparecen en dos o más archivos de los cargados. */
  repetidosEntreArchivos: Array<{ fecha: string; caseta: string | null; tag: string | null; monto: number; archivos: string[] }>;
  /** Mes anterior contra el que se compararon los tardíos: `true` si se cargó al menos un archivo suyo. */
  mesAnteriorCargado: boolean;
  completo: boolean;
  avisos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function llave(l: LineaCierre): string | null {
  const tag = normalizarTag(l.tag);
  if (!tag || !l.fecha || !l.hora) return null; // sin TAG o sin hora no se puede afirmar que sea EL mismo cobro
  return `${tag}|${l.fecha}|${l.hora.slice(0, 8)}|${normalizarNombre(l.caseta)}|${l.monto.toFixed(2)}`;
}

/**
 * Consolida los archivos de un mes. `archivos` puede traer también archivos del mes
 * anterior (para comprobar si un tardío ya se cobró allá): los que cae fuera del mes
 * del cierre no suman a sus totales, solo sirven de comparación.
 */
export function cierreMensual(mes: string, archivos: readonly ArchivoCierre[]): CierreMensual | { error: string } {
  const lim = limitesDelMes(mes);
  if (!lim) return { error: `El mes «${mes}» no es válido (usa AAAA-MM).` };
  const previo = mesAnterior(mes) as string;
  const limPrevio = limitesDelMes(previo) as { desde: string; hasta: string };

  const avisos: string[] = [];
  const archivosSinPeriodo: string[] = [];
  const delMes: ArchivoCierre[] = [];
  const delPrevio: ArchivoCierre[] = [];
  for (const a of archivos) {
    if (!a.periodoDesde || !a.periodoHasta) { archivosSinPeriodo.push(a.etiqueta); continue; }
    // Un archivo pertenece al mes en que TERMINA su periodo (la decena 21–30 es del mes aunque se cobre en el siguiente).
    if (a.periodoHasta >= lim.desde && a.periodoHasta <= lim.hasta) delMes.push(a);
    else if (a.periodoHasta >= limPrevio.desde && a.periodoHasta <= limPrevio.hasta) delPrevio.push(a);
  }
  if (archivosSinPeriodo.length > 0) {
    avisos.push(`${archivosSinPeriodo.length} archivo(s) sin periodo (${archivosSinPeriodo.join(', ')}) no entran al cierre: declara su periodo al subirlos.`);
  }

  // ── Las decenas y su cobertura ────────────────────────────────────────────
  const decenas: ResumenDecena[] = decenasDelMes(mes).map((d) => {
    const cubren = delMes.filter((a) => (a.periodoDesde as string) <= d.hasta && (a.periodoHasta as string) >= d.desde);
    let cruces = 0;
    let monto = 0;
    for (const a of cubren) {
      for (const l of a.lineas) {
        // Los cruces de la decena: los que caen dentro de ella (los tardíos se cuentan aparte, no inflan su decena).
        if (l.fecha && l.fecha >= d.desde && l.fecha <= d.hasta) { cruces++; monto += l.monto; }
      }
    }
    return { etiqueta: d.etiqueta, desde: d.desde, hasta: d.hasta, archivos: cubren.map((a) => a.etiqueta), cruces, monto: r2(monto), cubierta: cubren.length > 0 };
  });
  const decenasFaltantes = decenas.filter((d) => !d.cubierta).map((d) => d.etiqueta);
  if (decenasFaltantes.length > 0) {
    avisos.push(`Faltan las decenas ${decenasFaltantes.join(' y ')} de ${mes}: el cierre NO está completo.`);
  }

  // ── Totales del mes: TODAS las líneas de los archivos del mes (incluye tardíos: se cobraron en este mes) ──
  let cruces = 0;
  let monto = 0;
  for (const a of delMes) for (const l of a.lineas) { cruces++; monto += l.monto; }

  // ── Índice de cobros de los otros archivos, para detectar repetidos ───────
  const porLlave = new Map<string, Set<string>>(); // llave → ids de archivo
  for (const a of [...delMes, ...delPrevio]) {
    for (const l of a.lineas) {
      const k = llave(l);
      if (!k) continue;
      const s = porLlave.get(k) ?? new Set<string>();
      s.add(a.id);
      porLlave.set(k, s);
    }
  }
  const etiquetaDe = new Map(archivos.map((a) => [a.id, a.etiqueta]));

  // ── Los tardíos ───────────────────────────────────────────────────────────
  const tardios: TardioDelMes[] = [];
  for (const a of delMes) {
    for (const l of a.lineas) {
      if (!l.fecha) continue;
      let tipo: TardioDelMes['tipo'] | null = null;
      if (l.fecha < lim.desde) tipo = 'mes_anterior';
      else if (l.fecha < (a.periodoDesde as string)) tipo = 'decena_anterior';
      if (!tipo) continue;
      const k = llave(l);
      const otros = k ? [...(porLlave.get(k) ?? [])].filter((id) => id !== a.id) : [];
      tardios.push({
        archivoId: a.id, fecha: l.fecha, caseta: l.caseta, tag: l.tag, monto: l.monto, tipo,
        yaCobradoEn: otros.length > 0 ? (etiquetaDe.get(otros[0]) ?? otros[0]) : null,
      });
    }
  }
  const suma = (t: TardioDelMes['tipo']) => {
    const f = tardios.filter((x) => x.tipo === t);
    return { n: f.length, monto: r2(f.reduce((s, x) => s + x.monto, 0)) };
  };
  const mesAnteriorCargado = delPrevio.length > 0;
  if (tardios.some((t) => t.tipo === 'mes_anterior') && !mesAnteriorCargado) {
    avisos.push(`Hay cobros de ${previo} en este mes, pero no cargaste los archivos de ${previo}: no se puede comprobar si ya se habían cobrado allá. Súbelos para descartar cobros repetidos.`);
  }

  // ── Repetidos entre archivos (dentro del mes o contra el mes anterior) ───
  const repetidos: CierreMensual['repetidosEntreArchivos'] = [];
  const vistoRep = new Set<string>();
  for (const a of [...delMes, ...delPrevio]) {
    for (const l of a.lineas) {
      const k = llave(l);
      if (!k || vistoRep.has(k)) continue;
      const ids = porLlave.get(k);
      if (ids && ids.size > 1) {
        vistoRep.add(k);
        repetidos.push({ fecha: l.fecha as string, caseta: l.caseta, tag: l.tag, monto: l.monto, archivos: [...ids].map((id) => etiquetaDe.get(id) ?? id) });
      }
    }
  }
  if (repetidos.length > 0) {
    avisos.push(`${repetidos.length} cobro(s) aparecen en más de un archivo (mismo TAG, segundo, caseta e importe): candidatos fuertes a cobro repetido. Si subiste dos veces el mismo archivo, anula uno.`);
  }

  return {
    mes, decenas, decenasFaltantes, archivosSinPeriodo,
    cruces, monto: r2(monto),
    tardios, tardiosMesAnterior: suma('mes_anterior'), tardiosDecenaAnterior: suma('decena_anterior'),
    repetidosEntreArchivos: repetidos, mesAnteriorCargado,
    completo: decenasFaltantes.length === 0 && archivosSinPeriodo.length === 0,
    avisos,
  };
}
