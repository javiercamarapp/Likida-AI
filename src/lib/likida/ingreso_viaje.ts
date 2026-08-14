import { DatoInvalido } from './errores';

// ═══════════════════════════════════════════════════════════════════════════
// EL INGRESO DEL VIAJE — lo que por fin cierra el ciclo del dinero.
//
// La migración 0048 ("EL LADO DEL INGRESO") creó `viaje.cliente_id`,
// `viaje.ingreso_flete` y `viaje.km_recorridos` hace semanas. Nadie las
// escribía porque no había formulario, y sin ellas:
//
//   · `getRentabilidad` sumaba sobre nulos y contaba TODOS los viajes como
//     "sin ingreso capturado";
//   · el libro del viaje no podía calcular contribución;
//   · la pregunta que le quita el sueño a un dueño de flota —"¿este viaje ganó
//     dinero?"— no tenía respuesta posible.
//
// Este módulo es la mitad pura de esa captura: de lo que teclea una persona a
// lo que el motor entiende. Vive aparte del formulario y del server action
// para que las reglas se prueben sin montar ni pantalla ni base.
//
// ── LA REGLA QUE LO SOSTIENE TODO: VACÍO NO ES CERO ────────────────────────
//
// `Number('')` es 0. Si el campo vacío entrara como 0, un viaje sin ingreso
// capturado se contaría como un viaje que NO PRODUJO NADA: su contribución
// saldría igual a menos todo el gasto, su margen -100%, y el promedio de la
// flota se hundiría con viajes de los que en realidad no se sabe nada. Peor
// aún, las tres cifras se ven plausibles — nadie las cuestionaría.
//
// Un cero TECLEADO sí es cero (un viaje de cortesía, un tramo de regreso que
// se factura aparte) y entra como medición. La distinción entre "no sé" y
// "cero" es la misma que el resto del producto sostiene en todas partes.
// ═══════════════════════════════════════════════════════════════════════════

export interface IngresoCrudo {
  /** El id del cliente que paga el flete, o '' si no se eligió. */
  clienteId: string;
  ingresoFlete: string;
  kmRecorridos: string;
}

export interface IngresoValido {
  clienteId: string | null;
  /** `null` = no capturado. `0` = capturado y es cero. */
  ingresoFlete: number | null;
  kmRecorridos: number | null;
}

/**
 * Topes de cordura, con su porqué. No son gustos: son el dedazo que se detecta
 * al capturar en vez de tres semanas después, cuando ya contaminó el margen de
 * la ruta, el del cliente y el de la flota.
 */
const TOPES = {
  // El flete de un viaje nacional de carga completa anda entre miles y decenas
  // de miles de pesos. $5,000,000 en UN viaje es un cero de más, no una venta
  // excepcional — y si de verdad lo fuera, se captura hablando con nosotros.
  ingreso: 5_000_000,
  // México mide ~3,200 km de punta a punta. 20,000 km en un viaje es un
  // odómetro mal leído o los km del mes en la casilla del viaje.
  km: 20_000,
} as const;

/**
 * Lee un campo de dinero o de distancia.
 *
 * Devuelve `null` cuando está VACÍO —que es "no capturado"— y un número cuando
 * hay algo tecleado, incluido el 0.
 */
function opcional(crudo: string, campo: string, tope: number): number | null {
  const t = crudo.trim();
  if (t === '') return null;

  // La coma decimal es como se teclea en México; el separador de millares
  // también se pega desde un Excel ("38,500.00"), así que se quita.
  const limpio = t.replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpio);

  if (!Number.isFinite(n)) throw new DatoInvalido(`${campo} tiene que ser un número.`);
  if (n < 0) throw new DatoInvalido(`${campo} no puede ser negativo.`);
  if (n > tope) {
    throw new DatoInvalido(
      `${campo} pasa de ${tope.toLocaleString('es-MX')} y eso casi siempre es un cero de más. Si es correcto, avísanos.`,
    );
  }
  return n;
}

export function validarIngreso(c: IngresoCrudo): IngresoValido {
  const ingresoFlete = opcional(c.ingresoFlete, 'El ingreso del flete', TOPES.ingreso);
  const kmRecorridos = opcional(c.kmRecorridos, 'Los kilómetros', TOPES.km);
  const clienteId = c.clienteId.trim() || null;

  // Un ingreso SIN cliente se acepta: muchas flotas capturan primero el monto
  // y asignan el cliente al facturar. Lo que NO se acepta es al revés en
  // silencio — ver `faltaParaElMargen`.
  return { clienteId, ingresoFlete, kmRecorridos };
}

/**
 * Qué le falta a este viaje para que se pueda medir su margen, en palabras de
 * pantalla. `null` cuando no le falta nada.
 *
 * Existe para que la pantalla diga QUÉ capturar en vez de enseñar un guion sin
 * explicación — la diferencia entre un dato faltante y un dato que el usuario
 * no sabe que puede llenar.
 */
export function faltaParaElMargen(v: IngresoValido): string | null {
  if (v.ingresoFlete === null) return 'Falta el ingreso del flete: sin él no se puede calcular el margen del viaje.';
  return null;
}

/**
 * ¿Vale la pena ofrecer la tarifa del catálogo?
 *
 * Solo cuando el ingreso está VACÍO. Sobrescribir un monto ya tecleado con el
 * de la lista de precios borraría justo lo que distingue al viaje: el precio
 * negociado. La tarifa sugiere, la persona decide.
 */
export function admiteSugerencia(v: IngresoValido): boolean {
  return v.ingresoFlete === null;
}
