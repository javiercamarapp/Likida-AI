import type { EscenaId } from '../../svg/escenas';

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DEL RECORRIDO ANIMADO (adenda 10 / 10.1 del PLAN-MAESTRO).
//
// Un recorrido es DATOS: una lista de pasos que apuntan a elementos REALES por
// el atributo estable `data-tour="…"` (nunca selectores CSS frágiles). El
// controlador es puro (sin React ni DOM): habla con la página a través de un
// `Anfitrion` inyectable, de modo que cada regla (avanzar por acción, saltar,
// reanudar, reduced-motion) se prueba sin navegador.
// ═══════════════════════════════════════════════════════════════════════════

export interface Rect { x: number; y: number; w: number; h: number }
export interface Tam { w: number; h: number }

export type Lado = 'auto' | 'arriba' | 'abajo' | 'izquierda' | 'derecha';
export type EventoAccion = 'click' | 'input' | 'change' | 'submit';

export type Avance =
  | { tipo: 'siguiente' }
  /** Avanza solo cuando la persona hace la acción sobre el elemento real (o el
   *  de `ancla`, si es otro). «Siguiente» sigue disponible siempre. */
  | { tipo: 'accion'; evento: EventoAccion; ancla?: string };

export interface PasoTour {
  id: string;
  /** Valor de `data-tour` del elemento a resaltar. Sin ancla = paso centrado. */
  ancla?: string;
  /** Página donde vive el paso. Si la persona no está ahí, el motor la lleva al
   *  avanzar (nunca al abrir ni sin que ella haya avanzado). Admite `*` final. */
  ruta?: string;
  titulo: string;
  texto: string;
  /** «Aprieta aquí → Subir archivo»: verbo + objetivo, dicho exactamente. */
  accion?: { verbo: string; objetivo: string };
  avance?: Avance;
  escena?: EscenaId;
  lado?: Lado;
  // ── Onboarding por cobertura (lote O). Todo opcional: los recorridos de antes siguen siendo válidos. ──
  /** `ir` = señala el ítem del menú (avanza al hacer clic o con «Llévame»); `info` = explica; `cierre` = último paso.
   *  `hacer` pide UNA acción y avanza cuando la señal del servidor cambia; `practicar` es igual, sobre datos de muestra (rótulo fijo). */
  tipo?: 'ir' | 'info' | 'cierre' | 'hacer' | 'practicar';
  /** Cómo se sabe que se hizo (solo `hacer`/`practicar`). Sin ella el paso se comporta como informativo. */
  deteccion?: DeteccionPaso;
  /** `hacer`: tras este tiempo sin señal pasa a `sin_dato` y se ofrece «Ya lo hice». Por omisión 90 000 ms. */
  tiempoLimiteMs?: number;
  /** Ruta de la pantalla a la que pertenece (agrupa los pasos para «PANTALLA n DE N» y la ruta de pantallas). */
  pantalla?: string;
  /** Índice de la pantalla dentro del recorrido (0..n-1). */
  grupo?: number;
  nombrePantalla?: string;
  ilu?: string;
  /** Enlace final del cierre (p. ej. «Ir a Puesta en marcha»). */
  cta?: { etiqueta: string; ruta: string };
}

export type DeteccionPaso =
  | { via: 'senal'; senal: string; modo: 'cambia' | 'existe' }
  | { via: 'dom'; evento: EventoAccion; ancla?: string }
  /** Complemento de algo que no se puede medir: se rotula «confirmado por ti» y nunca cuenta como medido. */
  | { via: 'declarada'; clave: string };

/** Lo que el servidor contesta de una señal. */
export interface LecturaSenal { estado: 'si' | 'no' | 'sin_dato'; n?: number }

/** Estado de espera de un paso `hacer`/`practicar` (SPEC 2.3). `declarable` = ya se puede apretar «Ya lo hice». */
export interface EstadoEspera {
  estado: 'leyendo' | 'esperando' | 'hecho' | 'ya_hecho' | 'sin_dato';
  evidencia: 'medido' | 'confirmado' | null;
  declarable: boolean;
}

export type EventoControlador =
  | { tipo: 'paso_visto' | 'paso_hecho_senal' | 'paso_hecho_confirmado' | 'paso_ya_hecho' | 'paso_omitido' | 'paso_sin_dato'; pasoId: string; ms: number | null };

export interface Recorrido {
  id: string;
  /** Súbela cuando cambien los pasos: invalida el progreso guardado. */
  version: number;
  titulo: string;
  pasos: PasoTour[];
  /** Pista (rol) y modo con que se construyó; solo informativo. */
  pista?: string;
  modo?: 'corto' | 'completo';
}

export interface Almacen {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Lo que el motor necesita de UN elemento real de la página. */
export interface ElementoTour {
  rect(): Rect;
  visible(): boolean;
  /** Lo trae a la vista; con `reducido` sin desplazamiento animado. */
  traerAVista(reducido: boolean): void;
  enfocar(): void;
  escuchar(evento: EventoAccion, fn: () => void): () => void;
}

/** Todo lo que el motor toca del mundo. En el navegador lo da `anfitrion-dom.ts`. */
export interface Anfitrion {
  buscarAncla(nombre: string): ElementoTour | null;
  rutaActual(): string;
  navegar(ruta: string): void;
  reducirMovimiento(): boolean;
  /** Programa `fn`; devuelve cómo cancelarlo. */
  programar(fn: () => void, ms: number): () => void;
  almacen: Almacen | null;
  /** Lee una señal medida por el servidor (solo para los pasos `hacer`/`practicar`). Sin ella esos pasos quedan en `sin_dato`. Nunca debe lanzar. */
  leerSenal?(id: string): Promise<LecturaSenal>;
}

export type Fase = 'inactivo' | 'activo' | 'terminado' | 'omitido';

export interface Instantanea {
  fase: Fase;
  indice: number;
  total: number;
  paso: PasoTour | null;
  /** null = buscando; true = resaltado; false = no apareció (se muestra centrado). */
  anclaLista: boolean | null;
  /** true mientras se espera la página destino. */
  navegando: boolean;
  reducirMovimiento: boolean;
  esPrimero: boolean;
  esUltimo: boolean;
  /** Contadores de la tarjeta: los saltos de menú («ir») no cuentan; el cierre sí. */
  pasoN?: number;
  pasoTotal?: number;
  /** Pantalla actual y total (0-based `grupo`; `grupoTotal` = nº de pantallas del recorrido). */
  grupo?: number;
  grupoTotal?: number;
  /** Pantallas del recorrido en orden, para la ruta de la tarjeta. */
  pantallas?: ReadonlyArray<{ href: string; nombre: string }>;
  /** Solo en pasos `hacer`/`practicar`. */
  espera?: EstadoEspera;
}
