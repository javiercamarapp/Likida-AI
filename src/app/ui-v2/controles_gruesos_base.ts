// Base del trinquete de controles_gruesos_guarda.test.ts: archivos con controles gruesos, con su tope por regla (R1 botones crudos,
// R2 clases gruesas, R3 constantes duplicadas). Solo puede BAJAR: al migrar un archivo se borra su línea. Un archivo nuevo no entra aquí.
export interface ConteoControles { R1: number; R2: number; R3: number }
export const BASE_CONTROLES: Record<string, ConteoControles> = {
  'app/admin/agentes/[id]/insumos/zona-insumos.tsx': { R1: 3, R2: 1, R3: 0 },
  'app/admin/conversaciones/page.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/corridas/page.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/dev/mapa-actividad.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/error.tsx': { R1: 1, R2: 1, R3: 0 },
  'app/admin/mapa-prospectos/[id]/detalle.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/mapa-prospectos/calles.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/mapa-prospectos/cerebro.tsx': { R1: 11, R2: 2, R3: 1 },
  'app/admin/observabilidad/page.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/qa/banco-verdad.tsx': { R1: 4, R2: 0, R3: 0 },
  'app/admin/qa/lanzar-form.tsx': { R1: 5, R2: 0, R3: 0 },
  'app/admin/rango-costo.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/ui/kit.tsx': { R1: 1, R2: 1, R3: 1 },
  'app/admin/vendedores/consola-vendedores.tsx': { R1: 1, R2: 0, R3: 0 },
  'app/admin/vendedores/formas.tsx': { R1: 1, R2: 0, R3: 1 },
  'app/admin/vendedores/tablero.tsx': { R1: 3, R2: 0, R3: 1 },
  'app/vendedor/layout.tsx': { R1: 1, R2: 0, R3: 0 },
};

// R6 · botones/enlaces con pinta de botón sin altura definida (h-*, min-h-*, size-*, py-*, rv-*, card), solo en app/admin. También solo BAJA.
export const BASE_SIN_ALTURA: Record<string, number> = {
  'app/admin/mapa-prospectos/calles.tsx': 1,
  'app/admin/mapa-prospectos/cerebro.tsx': 6,
  'app/admin/qa/banco-verdad.tsx': 3,
  'app/admin/qa/lanzar-form.tsx': 3,
  'app/admin/vendedores/tablero.tsx': 3,
};
