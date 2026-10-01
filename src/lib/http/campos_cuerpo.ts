// Validadores de campos de un cuerpo JSON de escritura. Viven en lib/ (y no en
// app/api/v1/_escritura.ts) para que lib/ no importe de app/ (ARQ-B1);
// _escritura.ts los re-exporta y las rutas /v1 no cambian.

// ── Validación en el borde ─────────────────────────────────────────────────
//
// `crearViaje` y `crearUnidad` esperan una forma que hoy garantiza un
// formulario del panel: un `<select>` no manda un objeto donde va un uuid, ni
// `true` donde va un monto. Un cuerpo de API puede traer cualquier cosa, y sin
// esta capa esa cualquier-cosa llega hasta el INSERT — donde el que contesta
// es Postgres, con un mensaje que ni se le puede enseñar al integrador ni le
// dice QUÉ campo corregir.

/** Un campo del cuerpo que no cumple. `campo` viaja para poder nombrarlo. */
export class CampoInvalido extends Error {
  constructor(readonly campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'CampoInvalido';
  }
}

/**
 * ¿El campo viene o no viene?
 *
 * `undefined` y `null` son AUSENCIA; `''` también, porque un TMS que no tiene
 * el dato manda la cadena vacía tan seguido como la omite. La distinción que
 * importa —y que sostiene todo lo demás— es que ausencia NUNCA se convierte en
 * 0 ni en cadena vacía guardada: se convierte en `null`.
 */
function ausente(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Un texto.
 *
 * Acepta también un número porque un folio de TMS viaja tan seguido como
 * `12345` que como `"12345"`, y rechazarlo obligaría al integrador a
 * convertirlo del otro lado. Los dos se normalizan al MISMO texto, que además
 * es lo que hace que la deduplicación por folio funcione entre las dos formas.
 * Lo que no se acepta es un booleano, un objeto o una lista: eso no es un
 * folio escrito de otra manera, es un error de quien armó el cuerpo.
 */
export function texto(
  cuerpo: Record<string, unknown>, campo: string,
  opciones: { obligatorio?: boolean; max: number },
): string | null {
  const v = cuerpo[campo];
  if (ausente(v)) {
    if (opciones.obligatorio) throw new CampoInvalido(campo, `\`${campo}\` es obligatorio.`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new CampoInvalido(campo, `\`${campo}\` tiene que ser texto.`);
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new CampoInvalido(campo, `\`${campo}\` tiene que ser texto.`);
  }
  const t = String(v).trim();
  if (t.length > opciones.max) {
    // NO se recorta en silencio: un folio truncado dedupea contra el folio
    // equivocado, que es peor que un 400. Mismo criterio que `leerPagina`.
    throw new CampoInvalido(campo, `\`${campo}\` no puede pasar de ${opciones.max} caracteres.`);
  }
  return t;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un uuid.
 *
 * Se valida la FORMA aquí para que un `"el-de-siempre"` no llegue a Postgres
 * como un 22P02 que hay que traducir a ciegas. Que el id sea DE ESTA FLOTA no
 * se comprueba aquí: eso lo hacen los candados anti-IDOR de `operacion.ts`
 * (`operadorPropio`, `unidadPropia`, `clientePropioLocal`), que son los que
 * tienen la base enfrente. Duplicar esa comprobación aquí sería una segunda
 * versión de la regla de seguridad más cara del repo.
 */
export function uuid(
  cuerpo: Record<string, unknown>, campo: string,
  opciones: { obligatorio?: boolean } = {},
): string | null {
  const v = cuerpo[campo];
  if (ausente(v)) {
    if (opciones.obligatorio) throw new CampoInvalido(campo, `\`${campo}\` es obligatorio.`);
    return null;
  }
  if (typeof v !== 'string' || !UUID.test(v.trim())) {
    throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un uuid.`);
  }
  return v.trim();
}

/**
 * Una fecha de calendario, `YYYY-MM-DD`.
 *
 * La columna es `date` (0001), no `timestamptz`. Aceptar un ISO con hora
 * dejaría caer la hora EN SILENCIO y con ella la zona horaria: un viaje de las
 * 23:00 en Ciudad de México mandado como `...T23:00:00Z` se guardaría en el
 * día siguiente. Se rechaza y se dice el formato.
 *
 * Se comprueba además que la fecha EXISTA: `2026-02-30` cumple el regex y no
 * es un día. Postgres lo rechazaría, pero con un mensaje suyo.
 */
export function fecha(cuerpo: Record<string, unknown>, campo: string): string | null {
  const v = cuerpo[campo];
  if (ausente(v)) return null;
  if (typeof v !== 'string') throw new CampoInvalido(campo, `\`${campo}\` tiene que ser una fecha \`AAAA-MM-DD\`.`);
  const t = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser una fecha \`AAAA-MM-DD\` (sin hora).`);
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mes - 1, dia));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new CampoInvalido(campo, `\`${campo}\` no es una fecha que exista.`);
  }
  return t;
}

/**
 * Un entero dentro de un rango.
 *
 * Acepta el número y también su forma de texto (`"2018"`), porque un CSV
 * exportado por un TMS manda todo como texto. `"2018.5"` NO pasa: un año con
 * decimales es un dato equivocado, no un entero escrito distinto.
 */
export function entero(
  cuerpo: Record<string, unknown>, campo: string,
  opciones: { min: number; max: number },
): number | null {
  const v = cuerpo[campo];
  if (ausente(v)) return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número entero.`);
  if (!Number.isSafeInteger(n)) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número entero.`);
  if (n < opciones.min || n > opciones.max) {
    throw new CampoInvalido(campo, `\`${campo}\` tiene que estar entre ${opciones.min} y ${opciones.max}.`);
  }
  return n;
}

/**
 * Un monto en pesos, con hasta dos decimales.
 *
 * ── POR QUÉ EXISTE ESTO SI YA HAY `validarIngreso` ───────────────────────
 *
 * Sirve para `viaje.anticipo` y SOLO para él, que es el único monto de estas
 * rutas cuya columna es `NOT NULL DEFAULT 0` (0001): ahí ausente y cero
 * significan lo mismo porque la base no puede guardar otra cosa. Todo monto
 * cuya ausencia SÍ cambia una medición —el ingreso del flete, los kilómetros—
 * pasa por `validarIngreso`, que es donde vive la regla de VACÍO ≠ CERO. Este
 * validador no la reimplementa: no la necesita.
 *
 * MÁS DE DOS DECIMALES SE RECHAZAN en vez de redondearse. `numeric(12,2)`
 * redondearía en silencio, y un anticipo que se guarda distinto del que se
 * mandó es exactamente el descuadre de centavos que el contralor persigue
 * durante media tarde.
 */
export function monto(
  cuerpo: Record<string, unknown>, campo: string,
  opciones: { min: number; max: number },
): number | null {
  const v = cuerpo[campo];
  if (ausente(v)) return null;

  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    // Mismo saneado que `ingreso_viaje.ts`: la coma decimal es como se teclea
    // en México y el separador de millares se pega desde un Excel.
    const limpio = v.trim().replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(limpio)) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
    n = Number(limpio);
  } else {
    throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
  }

  if (!Number.isFinite(n)) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
  // Con TOLERANCIA y no con un `!==` pelado: `1234.56 * 100` es
  // 123455.99999999999 en binario, así que la comparación exacta rechazaría un
  // monto perfectamente válido. La tolerancia es mil veces más chica que el
  // centavo que se está midiendo, así que 1234.567 sigue sin pasar.
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new CampoInvalido(campo, `\`${campo}\` no puede traer más de dos decimales.`);
  }
  if (n < opciones.min || n > opciones.max) {
    throw new CampoInvalido(campo, `\`${campo}\` tiene que estar entre ${opciones.min} y ${opciones.max}.`);
  }
  return n;
}

/**
 * Lo que se le pasa a `validarIngreso` (`lib/likida/ingreso_viaje.ts`): el
 * campo tal cual lo teclearía una persona, en TEXTO.
 *
 * ── POR QUÉ SE DELEGA EN VEZ DE VALIDAR AQUÍ ─────────────────────────────
 *
 * Porque la regla que distingue VACÍO de CERO ya está escrita, probada y es la
 * que sostiene toda la medición de margen. Una segunda implementación en el
 * borde de la API sería una segunda oportunidad de escribir `Number('')` y
 * meter un 0 donde no hay dato: el viaje sin ingreso capturado se contaría como
 * un viaje que no produjo nada, su margen saldría -100%, y las tres cifras se
 * verían plausibles. Aquí solo se comprueba el TIPO —lo único que un formulario
 * garantizaba y un JSON no— y el resto lo decide el motor.
 *
 * `null` y ausente salen como `''`, que es lo que `validarIngreso` lee como
 * "no capturado" y convierte en `null`. Un `0` sale como `'0'`, que ese mismo
 * motor lee como un cero MEDIDO.
 */
export function crudoNumerico(cuerpo: Record<string, unknown>, campo: string): string {
  const v = cuerpo[campo];
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
    return String(v);
  }
  if (typeof v === 'string') return v;
  throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
}

