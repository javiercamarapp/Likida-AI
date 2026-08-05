// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE IMPRIME UNA CIFRA EN EL PANEL — historia de un hallazgo de tres rondas.
//
// Las dos pantallas del panel formateaban por su cuenta y no coincidían ni entre
// ellas ni con el PDF que el contralor le manda a su contador. Medido sobre
// 1234.56 litros (auditoría 5, frontend, MEDIO 1), la misma cifra salía en tres
// formas: con dos decimales en el PDF, redondeada a entero en la lista, y cruda
// en el detalle. Tres representaciones de una cifra fiscal se leen como tres
// cálculos.
//
// La fecha tenía el mismo problema con otra causa: `.slice(0, 10)` sobre un
// `timestamptz` se queda con la fecha UTC, y CST es UTC−6, así que todo lo que
// se cierre después de las 18:00 hora local salía fechado al día siguiente. Las
// liquidaciones se cierran al terminar el viaje, de noche: en el corte mensual,
// una del 31 de julio aparecía en agosto.
//
// AUDITORÍA 7 (31-jul): el formato vive en `src/lib/formato.ts`, un archivo SIN
// una sola importación — para que el motor puro y el bundle del webhook puedan
// usarlo sin arrastrar `clsx` ni `tailwind-merge`, que `utils.ts` necesita para
// `cn()`. Este archivo reexporta para no tocar a los consumidores del panel.
//
// Y hay una prueba que impide la siguiente copia (`formato.test.ts`): busca
// `toLocaleString('es-MX')` en todo `src/` y falla si aparece fuera de
// `formato.ts`. Es lo que le faltaba al hallazgo para no volver por cuarta vez.
// ═══════════════════════════════════════════════════════════════════════════

export { TZ_MX, litros, fechaMx, fechaHoraMx } from '@/lib/formato';
