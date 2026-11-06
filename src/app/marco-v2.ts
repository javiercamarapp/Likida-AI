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
// El ítem activo ya no lleva barra (controles finos K2-2, SPEC D8): fondo gris suave + peso 600. Se retiró GROSOR_SENAL_PX.

/** Techo del pie fijo del sidebar: UN solo bloque (Puesta en marcha <6/6 + tarjeta de cuenta). Notificaciones, tema, perfil y ayuda ya no se apilan ahí. */
export const ALTO_PIE_MAX_PX = 100;
/** Barra inferior móvil: alto de la píldora (más el área segura de abajo, mínimo 10 px de aire). */
export const ALTO_BARRA_INFERIOR_PX = 64;
/** Alto del logo (por ALTURA), fino como el de Rovaq: sidebar 22 (107 px de ancho), riel 24, cabecera móvil 22, carga 40.
 *  Se cruza con `--logo-*` de tokens.css y lo lee el JSX (`sidebar-v2.tsx`, `cabecera-movil.tsx`): `shell_css.test.ts`. */
export const ALTO_LOGO_PX = { sidebar: 22, riel: 24, movil: 22, carga: 40 } as const;
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
