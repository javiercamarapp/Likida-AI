// ═══════════════════════════════════════════════════════════════════════════
// LA CUOTA SEMANAL DEL IEPS DE DIÉSEL — EL LECTOR QUE SE NIEGA A CORRER.
//
// Fuente: `normas/datos/cuota-ieps-diesel.yaml`, una fila por acuerdo semanal
// del DOF (viernes, edición vespertina, leído por SIDOF con su codNota). El
// estímulo del transportista (LIF 2026 art. 20 ap. A fr. IV, criterio 1/LIF/PI)
// es CUOTA DISMINUIDA × LITROS. NO es `reduccion_shcp_por_litro`: ése es el
// recorte que la SHCP le aplica a la cuota completa, y multiplicarlo por los
// litros da 2.2× el estímulo real (sobre 500 L: $2,543.70 contra $1,138.00 con
// la cuota del 15-21-ago-2026). Ese campo se llamaba `estimulo_por_litro`
// hasta la auditoría 18 (B5) y este módulo NO lo expone a propósito.
//
// AUDITORÍA 18, B5: nada en `src/` leía el archivo, así que el fail-closed que
// la skill `cuota-diesel` promete ("sin cuota vigente para la fecha, el motor
// NO calcula") no existía porque no había nada que pudiera negarse. Esto es
// ese algo: `cuotaDieselVigente` devuelve `null` fuera del rango cubierto y
// NUNCA cae al último valor conocido. Un número viejo se ve idéntico a uno
// correcto y sale impreso citando un artículo.
//
// El MOTOR SIGUE SIN CONSUMIRLO, y es deliberado: la decisión D2 del roadmap
// (y la tensión viva anotada en el propio YAML: cuota íntegra vs disminuida,
// 3.5× entre lecturas, sin fiscalista que firme) prohíbe imprimir el estímulo
// en pesos. `engine.ts` entrega LITROS. Este módulo existe para que, el día que
// un fiscalista firme, el cableado sea una línea y no una decisión, y para que
// `cuota_diesel.test.ts` vigile HOY que el archivo que la rutina escribe
// cumple su contrato (empalme, aritmética, rango).
//
// Puro: sin I/O. Quien lo llame le pasa el texto del YAML (la prueba lo lee
// del repo; Vercel no despliega `normas/`).
// ═══════════════════════════════════════════════════════════════════════════

export interface SemanaCuotaDiesel {
  /** 'YYYY-MM-DD', el sábado. */
  desde: string;
  /** 'YYYY-MM-DD', el viernes. */
  hasta: string;
  /** $/litro. LA cifra del estímulo del transportista. */
  cuotaDisminuidaPorLitro: number;
  /** $/litro. El recorte de la SHCP a la cuota completa. NO es el estímulo de la flota. */
  reduccionShcpPorLitro: number;
  porcentajeEstimulo: number;
  fuente: { dof: string; edicion: string; codNota: string };
}

export interface TablaCuotaDiesel {
  /** $/litro, la cuota completa de la que se resta la reducción (LIEPS 2o-I-D-1-c actualizada). */
  cuotaCompleta: number;
  semanas: SemanaCuotaDiesel[];
}

const RE_VIGENCIA = /^\s*-\s*vigencia:\s*(\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})\s*$/;
const RE_NUM = (k: string) => new RegExp(`^\\s+${k}:\\s*([\\d.]+)\\s*(?:#.*)?$`);
const RE_FUENTE = /^\s+fuente:\s*\{\s*dof:\s*(\S+?),\s*edicion:\s*(\S+?),\s*codNota:\s*(\S+?)\s*\}/;

/**
 * Parser DELIBERADAMENTE parcial del archivo de cuotas: solo la forma que la
 * rutina escribe. Falla ruidosamente (throw) ante cualquier fila incompleta:
 * una semana a medias no es una semana.
 */
export function parsearCuotasDiesel(texto: string): TablaCuotaDiesel {
  const lineas = texto.split('\n');
  const completa = lineas.map((l) => /^cuota_completa_lif_2026:\s*([\d.]+)/.exec(l)).find(Boolean);
  if (!completa) throw new Error('cuota-ieps-diesel.yaml: falta cuota_completa_lif_2026');
  const semanas: SemanaCuotaDiesel[] = [];
  let actual: Partial<SemanaCuotaDiesel> | null = null;
  const cerrar = () => {
    if (!actual) return;
    const faltan = (['desde', 'hasta', 'cuotaDisminuidaPorLitro', 'reduccionShcpPorLitro', 'porcentajeEstimulo', 'fuente'] as const)
      .filter((k) => actual![k] == null);
    if (faltan.length) throw new Error(`cuota-ieps-diesel.yaml: la semana ${actual.desde ?? '?'} está incompleta (${faltan.join(', ')})`);
    semanas.push(actual as SemanaCuotaDiesel);
    actual = null;
  };
  for (const l of lineas) {
    const v = RE_VIGENCIA.exec(l);
    if (v) { cerrar(); actual = { desde: v[1], hasta: v[2] }; continue; }
    if (!actual) continue;
    let m: RegExpExecArray | null;
    if ((m = RE_NUM('cuota_disminuida_por_litro').exec(l))) actual.cuotaDisminuidaPorLitro = Number(m[1]);
    else if ((m = RE_NUM('reduccion_shcp_por_litro').exec(l))) actual.reduccionShcpPorLitro = Number(m[1]);
    else if ((m = RE_NUM('porcentaje_estimulo').exec(l))) actual.porcentajeEstimulo = Number(m[1]);
    else if ((m = RE_FUENTE.exec(l))) actual.fuente = { dof: m[1], edicion: m[2], codNota: m[3] };
    else if (/^\s+estimulo_por_litro:/.test(l)) {
      throw new Error('cuota-ieps-diesel.yaml: `estimulo_por_litro` es el nombre viejo del recorte de la SHCP; se llama `reduccion_shcp_por_litro` (auditoría 18, B5)');
    }
  }
  cerrar();
  return { cuotaCompleta: Number(completa[1]), semanas };
}

const diaSiguiente = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const diaSemanaUtc = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * El contrato del archivo, como lista de violaciones (vacía = sano):
 *  - cada vigencia va de SÁBADO a VIERNES (7 días);
 *  - las semanas empalman sin hueco ni traslape, en orden;
 *  - reducción + disminuida = cuota completa, al diezmilésimo (el chequeo
 *    aritmético que la rutina hace al capturar, repetido aquí para que nadie
 *    lo salte a mano);
 *  - la cuota disminuida vive en un rango sano (0 < x < cuota completa).
 */
export function validarCuotasDiesel(t: TablaCuotaDiesel): string[] {
  const errores: string[] = [];
  if (!t.semanas.length) errores.push('sin semanas');
  t.semanas.forEach((s, i) => {
    const id = `semana ${s.desde} a ${s.hasta}`;
    if (diaSemanaUtc(s.desde) !== 6) errores.push(`${id}: no empieza en sábado`);
    if (diaSemanaUtc(s.hasta) !== 5) errores.push(`${id}: no termina en viernes`);
    if (i > 0 && diaSiguiente(t.semanas[i - 1].hasta) !== s.desde) {
      errores.push(`${id}: no empalma con la anterior (${t.semanas[i - 1].hasta}) — hueco o traslape`);
    }
    const suma = Math.round((s.reduccionShcpPorLitro + s.cuotaDisminuidaPorLitro) * 10000) / 10000;
    if (suma !== t.cuotaCompleta) errores.push(`${id}: reducción + disminuida = ${suma}, no ${t.cuotaCompleta}`);
    if (!(s.cuotaDisminuidaPorLitro > 0 && s.cuotaDisminuidaPorLitro < t.cuotaCompleta)) {
      errores.push(`${id}: cuota disminuida fuera de rango (${s.cuotaDisminuidaPorLitro})`);
    }
  });
  return errores;
}

/**
 * La cuota DISMINUIDA vigente en una fecha, o `null` si el archivo no la
 * cubre. FAIL-CLOSED: fuera de rango no se devuelve la última conocida, ni la
 * más cercana, ni la completa. Sin cuota no hay cifra.
 */
export function cuotaDieselVigente(t: TablaCuotaDiesel, fechaIso: string): SemanaCuotaDiesel | null {
  const f = fechaIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  return t.semanas.find((s) => s.desde <= f && f <= s.hasta) ?? null;
}
