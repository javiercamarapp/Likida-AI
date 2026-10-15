// ═══════════════════════════════════════════════════════════════════════════
// REGLAS PURAS DEL DESGLOSE (T-A1-08): renglón de viaje, renombres del contralor y guardas previas al envío.
//
// GUARDIA: Likida NO recalcula el sueldo. Estas funciones solo REAGRUPAN o RENOMBRAN valores que llegan de la fuente;
// el total que se imprime es el de la fuente. Invariante probado: Σpercepciones − Σdeducciones no cambia tras
// `colapsarRenglonViaje` ni `aplicarRenombres`. Toda la aritmética es en centavos enteros.
//
// BLOQUEO EXTERNO: el nombre final del renglón, qué conceptos se funden, la lista de renombres del contralor y la
// política para locales/permisionarios no están confirmados por el cliente. Todo es CONFIGURABLE y los valores por
// defecto son neutros (colapso y renombres desactivados; permisionario retenido).
// ═══════════════════════════════════════════════════════════════════════════

import { aCentavos } from './esquema';
import type { DesgloseBitacora, RenglonBitacora, TipoOperadorDesglose } from './desglose_contrato';

const aPesos = (centavos: number): number => centavos / 100;

/** Minúsculas, sin acentos y sin espacios sobrantes: «Viáticos » ≡ «viaticos». */
export function normalizarConcepto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Renglón de viaje ───────────────────────────────────────────────────────

export interface OpcionesRenglonViaje {
  /** Interruptor. Por defecto desactivado hasta que el cliente confirme. */
  activa: boolean;
  /** Nombre del renglón resultante (defecto neutro). */
  etiqueta?: string;
  /** Conceptos GENÉRICOS que se funden (comparación sin acentos ni mayúsculas). Defecto: Sueldo y Viáticos. */
  conceptosOrigen?: string[];
  /** Si viene, solo se colapsa para estos tipos de operador (locales conservan sueldo/complemento). */
  soloTipos?: TipoOperadorDesglose[];
  /** Tipo del operador de este desglose (necesario cuando `soloTipos` está definido). */
  tipoOperador?: TipoOperadorDesglose;
}

export const ETIQUETA_VIAJE_DEFECTO = 'Pago de viaje';
export const CONCEPTOS_ORIGEN_VIAJE_DEFECTO: readonly string[] = ['Sueldo', 'Viáticos'];

/**
 * Funde los conceptos genéricos (Sueldo + Viáticos) en UN renglón, que queda en primer lugar. Los viáticos con
 * descripción propia (taxi, talacha…) no coinciden con el nombre genérico y se conservan intactos. Si la regla está
 * desactivada, el tipo no aplica o no hay conceptos de origen, devuelve el mismo contenido sin tocar.
 */
export function colapsarRenglonViaje(conceptos: readonly RenglonBitacora[], opciones: OpcionesRenglonViaje): RenglonBitacora[] {
  const copia = conceptos.map((c) => ({ ...c }));
  if (!opciones.activa) return copia;
  if (opciones.soloTipos) {
    if (opciones.tipoOperador === undefined || !opciones.soloTipos.includes(opciones.tipoOperador)) return copia;
  }
  const origen = new Set((opciones.conceptosOrigen ?? CONCEPTOS_ORIGEN_VIAJE_DEFECTO).map(normalizarConcepto));
  let suma = 0;
  let encontrados = 0;
  const resto: RenglonBitacora[] = [];
  for (const c of copia) {
    if (origen.has(normalizarConcepto(c.concepto))) {
      suma += aCentavos(c.monto);
      encontrados += 1;
    } else {
      resto.push(c);
    }
  }
  if (encontrados === 0) return copia;
  return [{ concepto: opciones.etiqueta ?? ETIQUETA_VIAJE_DEFECTO, monto: aPesos(suma) }, ...resto];
}

// ── Renombres del contralor ────────────────────────────────────────────────

export interface Renombre {
  /** Se prueba contra el concepto tal cual llega (los flags g/y se ignoran). */
  patron: RegExp;
  a: string;
  /** Si es true, los renglones que quedan con el MISMO nombre se suman en el lugar del primero. Defecto: separados. */
  fusionar?: boolean;
}

export interface OpcionesRenombres {
  /** Si la fuente YA entregó `desglose` (con sus nombres), no se renombra nada. */
  fuenteEntregoDesglose?: boolean;
}

/** Regla de ejemplo del contralor: diésel y similares se presentan como «Otros». Sin datos reales. */
export const RENOMBRE_EJEMPLO: Renombre = { patron: /di[eé]sel|urea/i, a: 'Otros' };

/**
 * Renombra conceptos por reglas (la primera que coincide gana). El monto y el vale se conservan; el total no cambia.
 * No hace nada si la fuente ya entregó el desglose. Los renglones que quedan con el mismo nombre se conservan
 * separados salvo que la regla pida `fusionar`.
 */
export function aplicarRenombres(
  conceptos: readonly RenglonBitacora[],
  renombres: readonly Renombre[],
  opciones: OpcionesRenombres = {},
): RenglonBitacora[] {
  const copia = conceptos.map((c) => ({ ...c }));
  if (opciones.fuenteEntregoDesglose || renombres.length === 0) return copia;
  const reglas = renombres.map((r) => ({ ...r, patron: new RegExp(r.patron.source, r.patron.flags.replace(/[gy]/g, '')) }));
  const resultado: RenglonBitacora[] = [];
  const posicionFusion = new Map<string, number>();
  for (const c of copia) {
    const regla = reglas.find((r) => r.patron.test(c.concepto));
    if (!regla) {
      resultado.push(c);
      continue;
    }
    const renombrado: RenglonBitacora = { ...c, concepto: regla.a };
    if (regla.fusionar) {
      const pos = posicionFusion.get(regla.a);
      if (pos !== undefined) {
        const previo = resultado[pos];
        resultado[pos] = { concepto: previo.concepto, monto: aPesos(aCentavos(previo.monto) + aCentavos(c.monto)) };
        continue;
      }
      posicionFusion.set(regla.a, resultado.length);
      // Un renglón fusionado deja de ser un vale individual.
      delete renombrado.vale;
    }
    resultado.push(renombrado);
  }
  return resultado;
}

// ── Guardas previas al envío ───────────────────────────────────────────────

export type MotivoRetencion = 'neto_negativo' | 'concepto_prohibido' | 'tipo_sin_regla' | 'sin_poliza';

export interface ConfigGuardasEnvio {
  /** Qué hacer con un neto < 0. */
  neto_negativo: 'retener' | 'enviar';
  /** Descripciones que nunca deben salir al operador (texto: contiene, sin acentos ni mayúsculas; o RegExp). */
  conceptos_prohibidos: ReadonlyArray<string | RegExp>;
  /** Tipos que reciben el desglose; `null` = sin restricción. Un tipo ausente en el desglose también se retiene. */
  tipos_que_reciben: readonly TipoOperadorDesglose[] | null;
  /** Si es true, un desglose sin póliza se retiene (normalmente la póliza se resuelve antes, en T-A1-24). */
  requiere_poliza: boolean;
}

/** Defecto neutro: retiene lo dudoso (neto negativo, permisionario) hasta que el cliente confirme la política. */
export const GUARDAS_DEFECTO: ConfigGuardasEnvio = {
  neto_negativo: 'retener',
  conceptos_prohibidos: [],
  tipos_que_reciben: ['foraneo', 'local'],
  requiere_poliza: false,
};

export interface DecisionEnvio {
  decision: 'enviar' | 'retener';
  motivos: MotivoRetencion[];
  /** Una línea legible por motivo, para la bandeja de retenidos. */
  detalle: string[];
}

function coincide(descripcion: string, prohibido: string | RegExp): boolean {
  if (typeof prohibido === 'string') {
    const p = normalizarConcepto(prohibido);
    return p !== '' && normalizarConcepto(descripcion).includes(p);
  }
  return new RegExp(prohibido.source, prohibido.flags.replace(/[gy]/g, '')).test(descripcion);
}

/** Neto del desglose en centavos: el de la fuente si lo trae; si no, Σperc − Σded. */
export function netoEnCentavos(d: Pick<DesgloseBitacora, 'percepciones' | 'deducciones' | 'neto'>): number {
  if (d.neto !== undefined) return aCentavos(d.neto);
  return d.percepciones.reduce((a, r) => a + aCentavos(r.monto), 0) - d.deducciones.reduce((a, r) => a + aCentavos(r.monto), 0);
}

/** ¿Se envía este desglose al operador o se retiene para revisión? Pura: no envía ni escribe nada. */
export function guardasPreEnvio(d: DesgloseBitacora, config: Partial<ConfigGuardasEnvio> = {}): DecisionEnvio {
  const c: ConfigGuardasEnvio = { ...GUARDAS_DEFECTO, ...config };
  const motivos: MotivoRetencion[] = [];
  const detalle: string[] = [];

  if (netoEnCentavos(d) < 0 && c.neto_negativo === 'retener') {
    motivos.push('neto_negativo');
    detalle.push('El neto es negativo.');
  }

  const prohibidos = [...d.percepciones, ...d.deducciones].filter((r) => c.conceptos_prohibidos.some((p) => coincide(r.concepto, p)));
  if (prohibidos.length > 0) {
    motivos.push('concepto_prohibido');
    detalle.push(`Concepto no permitido en el desglose: ${[...new Set(prohibidos.map((r) => r.concepto))].join(', ')}.`);
  }

  if (c.tipos_que_reciben !== null) {
    if (d.tipoOperador === undefined) {
      motivos.push('tipo_sin_regla');
      detalle.push('El tipo de operador no viene en el desglose.');
    } else if (!c.tipos_que_reciben.includes(d.tipoOperador)) {
      motivos.push('tipo_sin_regla');
      detalle.push(`No hay regla de envío para operadores de tipo ${d.tipoOperador}.`);
    }
  }

  if (c.requiere_poliza && (d.poliza === null || d.poliza === '')) {
    motivos.push('sin_poliza');
    detalle.push('El desglose no trae póliza.');
  }

  return { decision: motivos.length === 0 ? 'enviar' : 'retener', motivos, detalle };
}
