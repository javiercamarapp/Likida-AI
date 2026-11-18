// «Casos por pantalla»: un caso concreto, contado en cuatro etapas, de cómo entra la información a una pantalla, cómo se procesa,
// qué se decide (y dónde interviene una persona) y qué sale. DATOS puros: los pasos apuntan a elementos reales por ancla y son solo texto.
// Reglas de voz: tuteo, frases cortas, sin emojis, SIN cifras escritas a mano; el título del caso empieza por «Ejemplo:».

export const ETAPAS_CASO = ['entra', 'procesa', 'decide', 'sale'] as const;
export type EtapaCaso = (typeof ETAPAS_CASO)[number];

export interface PasoCaso {
  etapa: EtapaCaso;
  /** Ancla `data-onboarding` / `data-tour` o universal. Por omisión `pantalla.primer-bloque`. */
  ancla?: string;
  /** ≤ 48 caracteres. La etapa se antepone sola («Entra: …»). */
  titulo: string;
  /** ≤ 180 caracteres. */
  texto: string;
  /** Una línea: dónde interviene una persona en este paso. Genera un paso propio. ≤ 180 caracteres. */
  persona?: string;
}

export interface CasoPantalla {
  /** Rótulo del caso, empieza por «Ejemplo:». */
  titulo: string;
  pasos: readonly PasoCaso[];
}

/** Contenido de un grupo de pantallas: href → caso. */
export type CasosGrupo = Readonly<Record<string, CasoPantalla>>;

export const ANCLA_CASO_POR_OMISION = 'pantalla.primer-bloque';
