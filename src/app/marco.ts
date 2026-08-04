// ═══════════════════════════════════════════════════════════════════════════
// LAS MEDIDAS DEL MARCO — una sola fuente para /admin y /dashboard.
//
// Los dos paneles nacieron con las mismas medidas y se separaron: /dashboard
// bajó a `p-3 gap-3`, sidebar de 232 a 208 y rail de 276 a 300, buscando
// recuperar ancho para la columna central. El resultado fue que el sidebar y
// el asistente se veían de distinto tamaño según en qué panel estuvieras —
// y como el superadmin salta entre los dos con "Panel de dueño" / "Panel de
// jefe de flota", el salto se nota.
//
// Vivían como literales copiados en cuatro archivos, así que "igual" dependía
// de que alguien se acordara de cambiar los cuatro. Aquí es igual por
// construcción: un cambio se aplica a los dos paneles o a ninguno.
//
// Gana la medida de /admin porque es la referencia visual del producto.
// ═══════════════════════════════════════════════════════════════════════════

/** El contenedor de la fila: sidebar · columna · asistente. */
export const MARCO_FILA = 'min-h-dvh flex items-start gap-4 p-4 relative z-10';

/** El sidebar de navegación. Colapsa a solo íconos abajo de `lg`. */
export const MARCO_SIDEBAR =
  'glass-panel w-[72px] lg:w-[232px] shrink-0 flex flex-col h-[calc(100dvh-2rem)] sticky top-4 self-start overflow-hidden';

/** La columna de contenido, con su propio scroll.
 *
 *  `pb-3` no es adorno: sin él, el último panel de la página termina EXACTO
 *  donde termina el área de scroll y su borde redondeado nunca se ve, ni
 *  llegando hasta abajo. Se lee como si la interfaz estuviera cortada. Con el
 *  respiro, todo panel cierra.
 *
 *  Las páginas que además quieren el encabezado FIJO y el scroll dentro del
 *  panel —como Inicio en las dos consolas— lo declaran ellas: `h-full flex
 *  flex-col` en el `<main>`, el encabezado `shrink-0`, y el resto envuelto en
 *  `flex-1 min-h-0 overflow-y-auto`. No se puede hacer desde aquí porque cada
 *  página decide qué parte suya es encabezado. */
export const MARCO_COLUMNA = 'flex-1 min-w-0 h-[calc(100dvh-2rem)] overflow-y-auto pb-3';

/** Ancho del asistente contraído, en px. */
export const ANCHO_ASISTENTE = 276;

/** El asistente contraído: pegado a la derecha, con su propio alto.
 *
 *  SIN `top-`: lo pone cada llamador porque los dos paneles lo montan a
 *  distinta profundidad. En /dashboard es hermano directo de la fila con
 *  `p-4`, así que necesita `top-4` para alinear con el sidebar. En /admin
 *  vive DENTRO de la columna de contenido, que ya trae ese padding, así que
 *  un `top-4` ahí lo baja 16 px de más y queda desalineado con el sidebar —
 *  que es exactamente lo que pasó al unificar las medidas. */
export const MARCO_ASISTENTE = 'sticky self-start h-[calc(100dvh-2rem)]';

/** El asistente expandido SALE del flujo (ver rail.tsx): pedir `width: 100%`
 *  siendo hermano flex del sidebar desbordaba el panel y se llevaba el botón
 *  de cerrar fuera de la pantalla.
 *
 *  NO CUBRE EL SIDEBAR. Arranca donde arranca la columna de contenido: 16 de
 *  padding + 232 del sidebar + 16 de gap = 264. El número es exacto y no
 *  responsive porque el asistente solo existe de `xl` para arriba (`hidden
 *  xl:flex`), y ahí el sidebar siempre está en su ancho grande — abajo de
 *  `lg` colapsa a 72, pero a esos anchos el asistente ni se pinta. */
export const MARCO_ASISTENTE_EXPANDIDO = 'fixed top-4 right-4 bottom-4 left-[264px] z-20';

/** La columna del centro. Se marca para poder desvanecerla cuando el
 *  asistente se expande: la clase la lee `globals.css`, porque el rail y la
 *  columna son HERMANOS y ninguno puede tocar al otro por props. */
export const CLASE_COLUMNA_CENTRO = 'columna-centro';
