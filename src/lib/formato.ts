// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE IMPRIME UNA CIFRA. UNA SOLA VEZ, PARA TODO EL PRODUCTO.
//
// POR QUÉ ESTE ARCHIVO EXISTE Y NO ESTÁ EN `utils.ts`, QUE ERA LO OBVIO:
// `utils.ts` importa `clsx` y `tailwind-merge` para `cn()`, que son librerías de
// CSS del panel. El motor del cuadre (`engine.ts`) es puro y sin I/O, y el PDF
// viaja en el bundle de la función del webhook: ninguno de los dos tiene por qué
// arrastrar el sistema de clases de Tailwind para escribir "$1,234.56".
//
// Hoy el tree-shaking de Next lo salva —se midió sobre el `.nft.json` del
// webhook y `clsx` no entra—, pero eso depende de que nadie añada un
// side-effect a `utils.ts`. Un archivo sin una sola importación no depende de la
// suerte. `utils.ts` reexporta de aquí para no romper al panel.
//
// ── EL HALLAZGO QUE CIERRA, Y VA POR SU TERCERA RONDA ──────────────────────
//
// `mxn()` estaba escrita A MANO en el producto, y el número CRECÍA entre rondas:
//
//     ronda 6 →  3 sitios
//     ronda 7 →  8 sitios
//     hoy     → 11 sitios  (7 de moneda + los de litros)
//
// Siete copias idénticas de la misma línea, cada una en un archivo que imprime
// dinero que el contralor lee: el PDF, el resumen de WhatsApp, el panel, el
// aviso del tope del 15%, los acreditables y el motor. Que sean idénticas HOY no
// es una defensa: el hallazgo gemelo de `litros()` ya se divergió una vez, y ahí
// el panel decía "1,235 L" donde el PDF decía "1,234.56 L".
//
// Una cifra fiscal que se lee distinta en dos pantallas se lee como dos
// cálculos distintos.
// ═══════════════════════════════════════════════════════════════════════════

/** Zona del cliente: la flota, el contralor y el SAT están todos aquí. */
export const TZ_MX = 'America/Mexico_City';

/**
 * Redondea a dos decimales (centavos) sin creerle a la coma flotante.
 *
 * AUDITORÍA 9, ALTO REINCIDENTE (arquitectura) — reimplementado a mano en
 * CUATRO archivos de dinero (`engine.ts`, `analytics.ts`, `pagadero.ts`,
 * `combustible.ts`), los cuatro con `Math.round(n * 100) / 100` y el mismo
 * bug: `round2(1.005)` daba `1`, no `1.01`. `1.005` no es representable
 * exacto en punto flotante —se guarda como `1.00499999999999989…`— y
 * `Math.round(100.4999…)` cae para abajo. El `+ Number.EPSILON` antes de
 * multiplicar empuja el valor lo suficiente para que el redondeo caiga del
 * lado correcto sin afectar los casos que ya funcionaban.
 *
 * El signo se separa ANTES de sumar el `EPSILON`: sumar un épsilon positivo a
 * un negativo lo acerca a cero (`-1.005 + EPSILON` es MENOS negativo), y el
 * mismo truco que arregla el redondeo hacia arriba lo rompe hacia abajo. Se
 * corrige sobre el valor absoluto y se restaura el signo al final.
 */
export function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/** % de cambio de `actual` contra `base`, o `null` si no se puede calcular
 *  honesto: sin base (0 o desconocida) un "+100%" o un "$0 → $500" como
 *  "∞%" no dicen nada real — es la MISMA regla que `costoPorViaje` (en
 *  `analytics.ts`) aplica para no dividir entre cero.
 *
 *  Vive aquí, no en `analytics.ts` (de donde se movió el 8-ago-2026): es
 *  pura, sin consulta a la base, y las tarjetas de KPI con flechas de
 *  periodo (`kpi-periodo.tsx`) la necesitan desde un Client Component.
 *  `analytics.ts` importa `supabaseAdmin` — "NUNCA importar en código de
 *  cliente" es el comentario textual en ese archivo — así que cualquier
 *  valor en tiempo de ejecución que se importe de ahí arrastra esa cadena
 *  al bundle del navegador aunque la función en sí no la use. */
export function pctCambio(actual: number, base: number | null): number | null {
  if (base === null || base === 0) return null;
  return round2(((actual - base) / base) * 100);
}

/** Pesos mexicanos como los espera un contador: `$1,234.56`. */
export function mxn(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/**
 * Dólares, para el costo interno de los modelos — nunca para el cliente.
 *
 * AUDITORÍA 10, BAJO — `mxn(1.83)` y `usd(1.83)` daban el mismo string,
 * "$1.83": los dos estilos de moneda de Intl usan el símbolo genérico "$".
 * En /admin, "Gastado en IA" y "Costo de IA" son dólares en la misma
 * pantalla que enseña pesos en todo lo demás, y nada en el texto avisaba
 * cuál era cuál. El prefijo "US$" es el símbolo real que ya se usa para
 * distinguir moneda de EUA de otras monedas con signo "$" (MXN, CAD, ARS…);
 * `mxn()` se queda con el símbolo genérico porque es el que espera un
 * contador MEXICANO leyendo pesos.
 */
export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', 'US$');
}

/** Un entero con separador de millares, sin moneda ni unidad — tokens, conteos. */
export function numero(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * Litros con separador de millares y hasta dos decimales, sin rellenar ceros.
 *
 * El motor redondea a dos decimales, así que el tope no puede recortar
 * información: solo evita que un `1234.5600000001` de coma flotante salga con
 * tres cifras donde el papel enseña dos.
 */
export function litros(n: number): string {
  return `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} L`;
}

/**
 * Fecha en hora de México: `31 jul 2026`.
 *
 * Devuelve `—` ante una fecha ausente o ilegible en vez de `Invalid Date`: una
 * celda vacía es más honesta que una cadena de error en la columna que el
 * contralor usa para ordenar su corte.
 *
 * La zona es explícita porque `.slice(0,10)` sobre un `timestamptz` se queda con
 * la fecha UTC, y CST es UTC−6: todo lo cerrado después de las 18:00 hora local
 * salía fechado al día siguiente. Las liquidaciones se cierran de noche, al
 * terminar el viaje, así que en el corte mensual una del 31 de julio aparecía en
 * agosto.
 */
export function fechaMx(iso?: string | null): string {
  if (!iso) return '—';

  // UNA FECHA SIN HORA NO TIENE ZONA, Y CONVERTIRLA LA CORRE UN DÍA.
  //
  // `gasto.fecha` es `date` en Postgres y llega como '2026-07-15'. `new Date()`
  // lo interpreta como MEDIANOCHE UTC, y al formatearlo en America/Mexico_City
  // (UTC−6) sale «14 jul». TODAS las fechas del PDF salían un día antes.
  //
  // Se vio en el primer PDF real (1-ago-2026), y el propio documento se
  // contradecía: la tabla decía «18 jun 2026» y la línea de diferencias, tres
  // párrafos abajo, «(2026-06-19)». El ticket del Costco es del 1 de julio y
  // aparecía como «30 jun» — otro mes, otro periodo fiscal.
  //
  // La ironía: esta función nació para arreglar el problema INVERSO. Un
  // `.slice(0,10)` sobre un `timestamptz` se quedaba con la fecha UTC y los
  // cierres nocturnos salían fechados al día siguiente. Aquello se arregló
  // poniendo la zona, y esa misma zona rompió el caso sin hora.
  //
  // Un valor de solo fecha es un día del calendario, no un instante: tiene que
  // imprimirse tal cual está escrito. Se formatea en UTC —la zona en la que se
  // construyó— para que no se mueva.
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  const d = soloFecha ? new Date(`${iso.trim()}T00:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: soloFecha ? 'UTC' : TZ_MX,
  });
}

/**
 * Fecha corta, SIN año: `27 jul`. Misma lógica de zona que `fechaMx` (fecha
 * simple → UTC, para que no se corra un día) — solo cambia el formato de
 * salida, para etiquetas de espacio angosto como el rango de una tarjeta de
 * KPI ("27 jul – 02 ago") donde el año ya es obvio por contexto.
 */
export function fechaCorta(iso?: string | null): string {
  if (!iso) return '—';
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  const d = soloFecha ? new Date(`${iso.trim()}T00:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short',
    timeZone: soloFecha ? 'UTC' : TZ_MX,
  });
}

/**
 * Fecha CON hora, en hora de México: `04 ago 2026, 14:32`.
 *
 * La necesitó la confirmación del chofer (mig. 0058): a un contralor le basta
 * el día en que se cerró una liquidación, pero a un jefe de tráfico no le sirve
 * saber que el chofer confirmó "el 4 de agosto" — la decisión de cambiar de
 * personal se toma por horas, y el plazo de escalación son 5.
 *
 * Vive aquí y no en el componente por la misma razón que `fechaMx`: una hora
 * formateada a mano en la pantalla se separa de la de al lado en la siguiente
 * ronda. `h23` es explícito porque `hour12: false` puede imprimir "24:00" para
 * la medianoche según la versión de ICU, y "24:00" no es una hora que exista.
 *
 * Un valor de SOLO FECHA (`2026-08-04`) no tiene hora que enseñar, y darle una
 * sería inventarla: cae en `fechaMx`, que además lo formatea en UTC para que no
 * se corra un día. Las cuatro columnas de la 0058 son `timestamptz`, así que en
 * la práctica esa rama no se usa; existe para que no pueda mentir si se usa.
 */
export function fechaHoraMx(iso?: string | null): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return fechaMx(iso);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: TZ_MX,
  });
}
