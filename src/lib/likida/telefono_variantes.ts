// Puro y sin dependencias: se movió de `conv.ts` (que arrastra la base y el presupuesto) para que `conductor/trabajo.ts` lo use sin importar todo `conv`.
// `conv.ts` lo re-exporta: ningún importador existente cambia.

/**
 * Las formas en que el MISMO número mexicano puede llegar desde WhatsApp.
 *
 * México arrastra el "1" que Telmex metió entre la lada de país y el número de
 * celular. WhatsApp lo dejó de usar en 2020 para los `wa_id` nuevos, pero sigue
 * apareciendo: el mismo teléfono llega como `529993700779` o como
 * `5219993700779` según por dónde entre, y la búsqueda del operador es una
 * igualdad exacta contra la columna.
 *
 * El modo de fallo es el peor de todos para depurar: el sistema contesta
 * "no te tengo registrado" —una frase que suena a dato mal capturado— cuando el
 * operador SÍ está dado de alta y lo único que sobra es un dígito. Y como el
 * mensaje es amable y el webhook devolvió 200, nada en los logs dice "error".
 *
 * Se generan las variantes en vez de normalizar a una sola forma porque la
 * columna ya puede tener cualquiera de las dos: hay flotas capturadas a mano.
 * Aquí no se decide cuál es la buena, se aceptan las dos.
 *
 * Y el "+" es el mismo problema con otra cara, encontrado en la propia semilla
 * del demo: los operadores están guardados como `+521111111101` mientras que
 * Meta manda el `wa_id` sin signo (`521111111101`). Con la igualdad exacta que
 * había, NINGUNO de los operadores de demostración habría resuelto nunca.
 */
export function variantesTelefono(telefono: string): string[] {
  const limpio = telefono.replace(/[^\d]/g, '');
  const nums = new Set<string>([limpio]);
  // 52 + 1 + 10 dígitos → también sin el 1.
  const con1 = /^521(\d{10})$/.exec(limpio);
  if (con1) nums.add(`52${con1[1]}`);
  // 52 + 10 dígitos → también con el 1.
  const sin1 = /^52(\d{10})$/.exec(limpio);
  if (sin1) nums.add(`521${sin1[1]}`);
  // AUDITORÍA FABLE CICLO 4 (c4-4): la forma NACIONAL de 10 dígitos — lo que
  // el placeholder de captura invita a teclear ("10 dígitos"). El wa_id de
  // Meta siempre trae lada de país, así que el gruero capturado como
  // `5512345678` no matcheaba ninguna variante y recibía "no te tengo
  // registrado" con su cotización en la mano. Las dos direcciones:
  if (con1) nums.add(con1[1]);
  if (sin1) nums.add(sin1[1]);
  const nacional = /^(\d{10})$/.exec(limpio);
  if (nacional) { nums.add(`52${nacional[1]}`); nums.add(`521${nacional[1]}`); }
  // Cada forma, con y sin "+": la columna tiene una y el webhook trae la otra.
  const vistas = new Set<string>([telefono]);
  for (const n of nums) { vistas.add(n); vistas.add(`+${n}`); }
  return [...vistas];
}
