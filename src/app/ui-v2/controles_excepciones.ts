// Excepciones a la guarda de controles gruesos (controles_gruesos_guarda.test.ts). Cada una lleva su razón y un TOPE por regla
// (R1 botones crudos, R2 clases gruesas, R3 constantes). Una excepción nueva exige razón y tope; el tope solo puede bajar.
export interface Excepcion { razon: string; R1?: number; R2?: number; R3?: number }

export const EXCEPCIONES: Record<string, Excepcion> = {
  // Controles que NO son botones de acción del kit (fila, tarjeta-botón, flecha minúscula, cabecera de grupo, campo embebido). Llevan tope
  // y se miden: no pueden crecer.
  'app/dashboard/barra-acciones.tsx': { razon: 'fila de resultados de la paleta de búsqueda: botón-fila con hover, no una acción', R1: 1 },
  'app/dashboard/kpi-periodo.tsx': { razon: 'flechas de periodo de 24 px del KPI (BOTON_PERIODO del kit de admin); K2/K3 las pasan a icono del kit', R1: 2 },
  'app/dashboard/motor-fiscal-periodo.tsx': { razon: 'flechas de periodo de 24 px (BOTON_PERIODO del kit de admin); igual que kpi-periodo', R1: 2 },
  'app/dashboard/sidebar-nav.tsx': { razon: 'cabecera plegable de grupo del menú antiguo (rotulo en mayúsculas); el marco nuevo lo reemplaza (K2)', R1: 1 },
  'app/ui-v2/componentes/': { razon: 'las propias primitivas del kit: aquí se define lo que el resto consume' },
  'app/ui-v2/graficas/': { razon: 'gráficas: sus controles internos (leyenda, interruptores de serie) son parte del dibujo' },
  'app/dashboard/global-error.tsx': { razon: 'pantalla de error global: se pinta sin el chrome v2 ni su CSS' },
};
