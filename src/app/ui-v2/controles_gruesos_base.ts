// Base del trinquete de controles_gruesos_guarda.test.ts: archivos con controles gruesos, con su tope por regla (R1 botones crudos,
// R2 clases gruesas, R3 constantes duplicadas). Solo puede BAJAR: al migrar un archivo se borra su línea. Un archivo nuevo no entra aquí.
export interface ConteoControles { R1: number; R2: number; R3: number }
export const BASE_CONTROLES: Record<string, ConteoControles> = {
  'app/admin/ui/kit.tsx': { R1: 1, R2: 1, R3: 1 },
};

// R6 · botones/enlaces con pinta de botón sin altura definida (h-*, min-h-*, size-*, py-*, rv-*, card), solo en app/admin. También solo BAJA.
export const BASE_SIN_ALTURA: Record<string, number> = {
};
