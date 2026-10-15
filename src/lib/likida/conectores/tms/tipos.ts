// ═══════════════════════════════════════════════════════════════════════════
// CONTRATO INTERNO del conector TMS: qué recursos se pueden leer y cómo luce un lector.
// Sin red ni credenciales aquí: la sesión HTTP (login/token) y el cableado al catálogo
// son tareas aparte. Este archivo solo fija la forma, para que cada lector sea
// intercambiable y se pruebe con un servidor falso.
// ═══════════════════════════════════════════════════════════════════════════

export const RECURSOS_TMS = ['liquidaciones', 'peajes', 'viajes', 'hitos', 'posiciones', 'ccp_reque'] as const;
export type RecursoTms = (typeof RECURSOS_TMS)[number];

/** Cursor opaco de paginación: lo que el sistema de origen devuelva para pedir la siguiente página. */
export type CursorTms = string | number;

/** Una fila que NO se pudo leer: nunca se descarta en silencio, se dice cuál y por qué. */
export interface FilaRechazadaTms {
  /** Posición (base 0) dentro de la respuesta del origen. */
  indice: number;
  /** Motivo en lenguaje llano. */
  motivo: string;
}

export interface LecturaTms<T> {
  filas: T[];
  /** Presente solo si hay más páginas. */
  siguiente?: CursorTms;
  rechazadas: FilaRechazadaTms[];
}

/** Lector de un recurso: pide un rango de fechas (ISO UTC) y devuelve filas ya mapeadas. */
export interface LectorTms<T> {
  recurso: RecursoTms;
  leer(desde: string, hasta: string, cursor?: CursorTms): Promise<LecturaTms<T>>;
}
