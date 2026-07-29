// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE IMPRIME UNA CIFRA EN EL PANEL.
//
// Las dos pantallas del panel formateaban por su cuenta y no coincidían ni
// entre ellas ni con el PDF que el contralor le manda a su contador. Medido
// sobre `1234.56` litros (auditoría 5, frontend, MEDIO 1):
//
//   PDF     pdf.ts:294   → 1,234.56 L   (toLocaleString('es-MX'))
//   Lista   page.tsx     → 1,235 L      (maximumFractionDigits: 0)
//   Detalle [id]/page    → 1234.56 L    (interpolación cruda)
//
// Tres representaciones de una cifra fiscal se leen como tres cálculos. Aquí
// hay UNA, y está escogida para coincidir con la del PDF, que es el papel que
// se archiva.
//
// La fecha tenía el mismo problema con otra causa: `.slice(0, 10)` sobre un
// `timestamptz` se queda con la fecha UTC, y CST es UTC−6, así que TODO lo que
// se cierre después de las 18:00 hora local sale fechado al día siguiente
// (auditoría 5, frontend, MEDIO 3). Las liquidaciones se cierran al terminar
// el viaje, de noche. En el corte mensual, una liquidación del 31 de julio
// aparecía listada en agosto.
//
// AUDITORÍA 6: ya viven en `src/lib/utils.ts` y `pdf.ts` usa las mismas.
// ═══════════════════════════════════════════════════════════════════════════

// LAS DOS FUNCIONES VIVEN AHORA EN `src/lib/utils.ts`, junto a `mxn()`, que es
// la casa que este mismo comentario nombraba. Se reexportan para no tocar los
// tres consumidores del panel, y `pdf.ts` usa las MISMAS: el papel y la pantalla
// no pueden volver a fechar distinto el mismo hecho (auditoría 6, arquitectura).
export { TZ_MX, litros, fechaMx } from '@/lib/utils';
