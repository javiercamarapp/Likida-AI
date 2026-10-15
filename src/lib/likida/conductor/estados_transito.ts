// T-A5-20 — Vocabulario de estados de tránsito (frontera) y su normalización.
//
// El cliente mantiene a mano en su programa de despacho un estado del tipo «PATIO NLD», «EN RUTA», «PEND CRUCE». Esta función
// lo traduce al vocabulario cerrado de `viaje.transito_estado` (0804) y conserva el texto crudo para auditar el mapeo.
// Regla de oro: NUNCA se inventa un estado. Vacío o «OK» (que no es un estado de tránsito) → `null`; lo que no se reconoce →
// `otro`, con el texto tal como vino. El diccionario es editable por flota: sus reglas se evalúan antes que las de fábrica.
// La usan el importador de viajes, el del programa de despacho (A4) y el conector (B7).

export type EstadoTransito = 'en_patio' | 'en_ruta' | 'pendiente_cruce' | 'otro';

export interface ResultadoTransito {
  estado: EstadoTransito;
  /** El texto crudo (recortado), tal como vino de la fuente. */
  textoOrigen: string;
}

/** Una regla del diccionario. `texto` ya va en minúsculas, sin acentos y con espacios simples (se normaliza igual al evaluar). */
export interface ReglaTransito {
  texto: string;
  /** `exacto`: el texto completo; `prefijo`: empieza con ese texto seguido de espacio (p. ej. «patio» cubre «patio <ciudad>»). */
  tipo: 'exacto' | 'prefijo';
  /** `null` = «esto no es un estado de tránsito»: se ignora sin inferir nada (p. ej. «OK»). */
  estado: Exclude<EstadoTransito, 'otro'> | null;
}

/** Diccionario de fábrica (sintético, sin nombres de plazas ni de personas). */
export const DICCIONARIO_TRANSITO_BASE: readonly ReglaTransito[] = [
  { texto: 'patio', tipo: 'prefijo', estado: 'en_patio' },
  { texto: 'en patio', tipo: 'prefijo', estado: 'en_patio' },
  { texto: 'en ruta', tipo: 'exacto', estado: 'en_ruta' },
  { texto: 'pend cruce', tipo: 'exacto', estado: 'pendiente_cruce' },
  { texto: 'pendiente cruce', tipo: 'exacto', estado: 'pendiente_cruce' },
  { texto: 'pendiente de cruce', tipo: 'exacto', estado: 'pendiente_cruce' },
  { texto: 'ok', tipo: 'exacto', estado: null },
];

const TOPE_TEXTO = 120;

export function normalizarTextoTransito(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Texto de tránsito → `{estado, textoOrigen}`, o `null` cuando no hay nada que registrar (vacío o «OK»).
 * `diccionario` (de la flota) se evalúa primero; las reglas de fábrica son el respaldo.
 */
export function normalizarEstadoTransito(
  texto: unknown,
  diccionario: readonly ReglaTransito[] = [],
): ResultadoTransito | null {
  const crudo = String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, TOPE_TEXTO);
  const t = normalizarTextoTransito(crudo);
  if (!t) return null;
  for (const r of [...diccionario, ...DICCIONARIO_TRANSITO_BASE]) {
    const regla = normalizarTextoTransito(r.texto);
    if (!regla) continue;
    const coincide = r.tipo === 'exacto' ? t === regla : t === regla || t.startsWith(`${regla} `);
    if (!coincide) continue;
    return r.estado === null ? null : { estado: r.estado, textoOrigen: crudo };
  }
  return { estado: 'otro', textoOrigen: crudo };
}
