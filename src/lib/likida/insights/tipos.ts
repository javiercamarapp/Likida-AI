// Marco común «qué pasó · qué significa · qué hacer» (T-INS-02).
// Reglas deterministas: la IA puede explicar, nunca decidir. Sin dependencias nuevas.

export const AGENTES_INSIGHT = [
  'liquidacion',
  'peajes',
  'carta-porte',
  'vigia',
  'conductores',
] as const;
export type AgenteInsight = (typeof AGENTES_INSIGHT)[number];

export const TIPOS_INSIGHT = ['dato', 'candidato', 'ejemplo', 'simulado'] as const;
export type TipoInsight = (typeof TIPOS_INSIGHT)[number];

export const SEVERIDADES = ['info', 'atencion', 'urgente'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

/** Rótulos exhaustivos (patrón Record<Tipo,string>): agregar un tipo sin rótulo no compila. */
export const ROTULO_TIPO: Record<TipoInsight, string> = {
  dato: 'Dato',
  candidato: 'Candidato por validar',
  ejemplo: 'Ejemplo',
  simulado: 'Simulado',
};

export const ROTULO_SEVERIDAD: Record<Severidad, string> = {
  info: 'Informativo',
  atencion: 'Atención',
  urgente: 'Urgente',
};

/** Mayor número = más grave; `componer` ordena de mayor a menor. */
export const PESO_SEVERIDAD: Record<Severidad, number> = {
  info: 0,
  atencion: 1,
  urgente: 2,
};

type Origen =
  | { tabla: string; archivo?: string; calculo?: string }
  | { archivo: string; tabla?: string; calculo?: string }
  | { calculo: string; tabla?: string; archivo?: string };

/** Todo número que se muestra trae su fuente: al menos una de tabla|archivo|calculo, más periodo y n. */
export type Fuente = Origen & {
  /** Periodo que cubre el dato, en texto llano (zona America/Mexico_City). */
  periodo: string;
  /** Tamaño de la muestra/filas que respaldan el número. */
  n: number;
};

export interface Accion {
  rotulo: string;
  ruta: string;
}

interface Base {
  id: string;
  agente: AgenteInsight;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
  fuente: Fuente;
  severidad: Severidad;
  accion?: Accion;
}

export interface InsightDato extends Base {
  tipo: 'dato';
}

/** Candidato: `queSignifica` DEBE contener «candidato» (error de tipo y de ejecución). */
export interface InsightCandidato extends Base {
  tipo: 'candidato';
  queSignifica: `${string}candidato${string}` | `${string}Candidato${string}`;
}

/** Ejemplo/simulado: rótulo visible obligatorio. */
export interface InsightRotulado extends Base {
  tipo: 'ejemplo' | 'simulado';
  rotulo: string;
}

export type Insight = InsightDato | InsightCandidato | InsightRotulado;

/**
 * Interfaz (solo interfaz, sin implementación en este commit) para que una capa opcional
 * de IA REDACTE una explicación de un insight ya decidido por reglas. No puede cambiar
 * severidad, tipo, fuente ni acción.
 */
export interface Explicador {
  explicar(insight: Insight): Promise<string>;
}
