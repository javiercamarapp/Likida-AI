// ═══════════════════════════════════════════════════════════════════════════
// LAS MEDIDAS DEL MARCO v2 — propio de /dashboard v2; `marco.ts` (compartido con /admin) NO se toca.
//
// Las clases `rv-*` viven en `ui-v2/shell.css`; las MEDIDAS que ese CSS repite en px están aquí como constantes para
// que `dashboard/shell/shell_css.test.ts` las cruce: si alguien cambia un número en un lado y no en el otro, la prueba lo dice.
// ═══════════════════════════════════════════════════════════════════════════

/** Bajo este ancho no hay riel: cabecera de 56 px + barra inferior + hoja «Más». Es el ÚNICO corte móvil/escritorio (breakpoints disjuntos). */
export const CORTE_MOVIL_PX = 768;
/** Desde este ancho el sidebar es el completo (232 px); entre 768 y 1023 es el riel de íconos (72 px). */
export const CORTE_SIDEBAR_COMPLETO_PX = 1024;

export const ANCHO_SIDEBAR_PX = 232;
export const ANCHO_RIEL_PX = 72;
export const ALTO_CABECERA_ESCRITORIO_PX = 44;
export const ALTO_CABECERA_MOVIL_PX = 56;
/** Alto de un ítem del menú. */
export const ALTO_ITEM_PX = 32;
/** Grosor de la barra de TINTA del ítem activo (fondo suave + barra; nunca bloque negro ni blanco). */
export const GROSOR_SENAL_PX = 3;

/** Techo del pie fijo del sidebar: UN solo bloque (Puesta en marcha <6/6 + tarjeta de cuenta). Notificaciones, tema, perfil y ayuda ya no se apilan ahí. */
export const ALTO_PIE_MAX_PX = 100;
/** Barra inferior móvil: alto de la píldora (más el área segura de abajo, mínimo 10 px de aire). */
export const ALTO_BARRA_INFERIOR_PX = 64;
/** Alto del logo (por ALTURA): sidebar 30, riel y cabecera móvil 28, carga 40. */
export const ALTO_LOGO_PX = { sidebar: 30, riel: 28, movil: 28, carga: 40 } as const;
/** Marco: padding y separación entre sidebar y columna de contenido. */
export const MARCO_PX = 16;

export const CLASES_V2 = {
  raiz: 'rv-app min-h-dvh tema-neutro',
  saltar: 'rv-skip',
  fila: 'rv-fila',
  sidebar: 'rv-sb',
  columna: 'rv-col',
  contenido: 'rv-contenido outline-none',
} as const;
