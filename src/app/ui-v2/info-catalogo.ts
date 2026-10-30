// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE EXPLICACIONES (ⓘ) · un solo lugar, por clave, en español (DIRECTIVA 29-oct, punto 6).
//
// Cada recuadro, tarjeta, gráfica o tabla declara `info="clave"`; el texto NO se escribe en la página.
// Estructura única: Qué es (1 línea) · Cómo se calcula · Fuente y corte · Qué hacer con esto (opcional).
//
// REGLA DE HONESTIDAD: un texto solo afirma lo que el lector del indicador hace y está verificado. Mientras no lo esté,
// la entrada lleva `estado: 'por_confirmar'`: describe la etiqueta del recuadro sin inventar fórmula, algoritmo, regla de
// producto ni sistema de origen, y el ⓘ lo dice a la vista. Al verificar el lector, se pasa a `'verificado'` y se
// precisa «Cómo se calcula» y «Fuente y corte» con lo que de verdad hace.
// ═══════════════════════════════════════════════════════════════════════════

export interface InfoTexto {
  /** Título corto del recuadro (también nombre accesible del botón ⓘ). */
  titulo: string;
  /** `por_confirmar` = descripción provisional (se muestra la marca); `verificado` = respaldada por el lector. */
  estado: 'verificado' | 'por_confirmar';
  /** Qué es: UNA línea. */
  queEs: string;
  comoSeCalcula: string;
  /** Procedencia y corte (fuente + periodo). */
  fuente: string;
  /** Opcional: qué hacer con esta cifra. */
  queHacer?: string;
}

const PENDIENTE_CALCULO = 'Por confirmar: la fórmula exacta se documenta al verificar el lector de este indicador.';
const PENDIENTE_FUENTE = 'Por confirmar: fuente y fecha de corte de este indicador.';
const T = (titulo: string, queEs: string): InfoTexto => ({ titulo, estado: 'por_confirmar', queEs, comoSeCalcula: PENDIENTE_CALCULO, fuente: PENDIENTE_FUENTE });

export const INFO = {
  'resumen.monto_comprobado': T('Monto comprobado', 'Dinero de gastos de ruta con comprobante, en el periodo elegido.'),
  'resumen.por_firmar': T('Por firmar', 'Liquidaciones que esperan una firma.'),
  'resumen.peajes_periodo': T('Peajes del periodo', 'Gasto en casetas del periodo elegido.'),
  'resumen.carta_porte_completas': T('Carta Porte completas', 'Documentos de Carta Porte completos, junto al total esperado.'),
  'resumen.a_tiempo': {
    titulo: 'A tiempo',
    estado: 'por_confirmar',
    queEs: 'Entregas dentro del compromiso de servicio.',
    comoSeCalcula: 'Aún sin lector verificado: mientras no lo esté, la cifra se muestra como sin dato, no como cero.',
    fuente: PENDIENTE_FUENTE,
  },
  'resumen.requiere_atencion': T('Requiere tu atención', 'Lo que espera una decisión tuya.'),
  'resumen.cierres_semana': T('Liquidaciones cerradas por semana', 'Cuántas liquidaciones se cierran cada semana.'),
  'resumen.diferencias_recuperado': T('Diferencias vs recuperado', 'Lo que no cuadró frente a lo que ya se recuperó.'),
  'resumen.lo_que_hizo_solo': T('Lo que hizo solo', 'Tareas que los agentes resolvieron sin intervención.'),
  'resumen.siguiente_mejor_accion': T('Siguiente mejor acción', 'La acción sugerida para hoy.'),
} as const satisfies Record<string, InfoTexto>;

export type InfoClave = keyof typeof INFO;

/** Texto de una clave; falla fuerte si no existe (nunca un ⓘ vacío). */
export function infoDe(clave: InfoClave): InfoTexto {
  const t = (INFO as Record<string, InfoTexto | undefined>)[clave];
  if (!t) throw new Error(`Clave de información desconocida: ${clave}`);
  return t;
}
