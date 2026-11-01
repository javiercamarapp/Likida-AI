// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING — tipos compartidos. Datos puros: sin React, sin DOM, sin base.
//
// La arquitectura es la de Vexa (catálogo → recorrido → pista → estado → prerrequisitos → asistente), adaptada a Likida:
// el recorrido se DERIVA del menú real de cada rol y perfil (`menuPorPerfil` + `puedeVerRuta`); no es una lista aparte.
// Así un rol solo recibe pasos de pantallas que puede abrir y el recorrido nunca se desfasa del menú.
// ═══════════════════════════════════════════════════════════════════════════

/** Los roles que entran a un panel y la pista de recorrido de cada uno. `vendedor` no tiene: su panel es /vendedor. */
export type Pista = 'dueno' | 'encargado' | 'contador' | 'nomina';
export const PISTAS: readonly Pista[] = ['dueno', 'encargado', 'contador', 'nomina'];

/** Los dos modos: el corto son ~12 pasos; el completo, todas las pantallas del menú del rol. Los ids de paso son los mismos. */
export type Modo = 'corto' | 'completo';
export const MODOS: readonly Modo[] = ['corto', 'completo'];

/** Ilustraciones del marco de la tarjeta (SVG de línea, monocromas). */
export type Ilu =
  | 'barras' | 'linea' | 'chat' | 'nodos' | 'tarjetas' | 'escudo' | 'mapa' | 'importar' | 'corte' | 'campana' | 'lista' | 'equipo'
  | 'panel' | 'cierre';

/** Lo que el rol debe poder hacer para que exista el paso `accion` de una pantalla. Sale de `lib/auth/permisos.ts`, nunca se copia. */
export type Permiso = 'asignar' | 'administrar' | 'timbrar' | 'catalogo' | 'firmar' | 'exportar' | 'dinero';

export interface Ancla {
  /** Nombre estable del elemento (`data-onboarding`/`data-tour`) o uno derivado de `ANCLAS_DERIVADAS`. */
  ancla: string;
  titulo: string;
  texto: string;
}

export interface TextosPantalla {
  que: string;
  clave: Ancla;
  accion?: Ancla & { permiso: Permiso; verbo: string; objetivo: string };
}

/** Claves de variante: un rol (`contador`, `encargado`, `nomina`) o el perfil de la flota (`cinco_agentes`). */
export type ClaveVariante = 'contador' | 'encargado' | 'nomina' | 'cinco_agentes';

export interface Pantalla extends TextosPantalla {
  ilu: Ilu;
  /** Textos que cambian según el rol o el perfil cuando el texto general promete algo que esa persona no hace o no ve. */
  variantes?: Partial<Record<ClaveVariante, Partial<{ que: string; claveTitulo: string; claveTexto: string }>>>;
}

/** Una pista contextual: una nota breve que aparece al abrir una pantalla que no está en el menú (subpantallas, detalles). */
export interface PistaContextual {
  titulo: string;
  texto: string;
  ilu: Ilu;
  /** Ruta de la que se llega (para decir de dónde se abre). */
  desde: string;
}

/** Un paso del recorrido ya construido (extiende `PasoTour` del motor con lo que la tarjeta necesita). */
export type TipoPaso = 'ir' | 'info' | 'cierre' | 'agente';
