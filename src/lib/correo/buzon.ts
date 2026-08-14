import { randomBytes } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// EL BUZÓN DE LA FLOTA — la dirección por la que entran las facturas.
//
// Las facturas de talleres, refaccionarias y diésel llegan POR CORREO. Es el
// canal que multiplica a los agentes de Peajes y Proveedores, y el que pidió
// Transportes Innovativos con todas sus letras.
//
// Este módulo es la mitad PURA: armar la dirección, sacarle el token a una que
// llega, y generar uno nuevo. La resolución contra la base vive aparte para que
// estas reglas —que deciden a qué flota entra un gasto— se prueben sin base.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El alfabeto: base32 de Crockford SIN los caracteres ambiguos.
 *
 * Fuera `i`, `l`, `o`, `u`, `0` y `1`. No es purismo: esta dirección va a
 * acabar dictada por teléfono a un contador y tecleada a mano en el ERP de un
 * proveedor. Un `0` que alguien escribe como `O` no rebota con un error — el
 * correo simplemente nunca llega, y nadie sabe por qué.
 *
 * La `u` se va además porque su ausencia evita que el azar arme palabras
 * malsonantes en español dentro del token.
 */
const ALFABETO = 'abcdefghjkmnpqrstvwxyz23456789';

/** 24 caracteres de este alfabeto son ~118 bits. No hay fuerza bruta que
 *  alcance, y sigue cabiendo en una línea al dictarlo. */
const LARGO = 24;

/** El prefijo que hace reconocible la dirección y deja espacio para otros
 *  buzones (`p-` para pagos, por ejemplo) sin chocar con éste. */
const PREFIJO = 'f-';

/**
 * Genera un token nuevo.
 *
 * `randomBytes` y no `Math.random`: este token es la única credencial que
 * separa las facturas de una flota de las de otra, y el estado de
 * `Math.random` se puede reconstruir observando salidas.
 *
 * El rechazo por módulo importa aquí: tomar `byte % 30` sobre 256 valores hace
 * que los primeros 16 caracteres del alfabeto salgan más seguido. Se descartan
 * los bytes que caen fuera del último múltiplo completo.
 */
export function generarToken(): string {
  const tope = Math.floor(256 / ALFABETO.length) * ALFABETO.length;
  let salida = '';
  while (salida.length < LARGO) {
    for (const b of randomBytes(LARGO)) {
      if (b >= tope) continue;
      salida += ALFABETO[b % ALFABETO.length];
      if (salida.length === LARGO) break;
    }
  }
  return salida;
}

export function esTokenValido(token: string): boolean {
  if (token.length !== LARGO) return false;
  for (const c of token) if (!ALFABETO.includes(c)) return false;
  return true;
}

/** El dominio del buzón. Es el MISMO que el de salida: `mail.likida.ai` recibe
 *  y manda, y su MX ya apunta a Resend. El dominio raíz NO se toca — ahí vive
 *  el correo de Google de la empresa. */
export function dominioBuzon(): string | null {
  return process.env.RESEND_EMAIL_DOMAIN || null;
}

/** La dirección completa que se le enseña a la flota. `null` si el canal no
 *  está configurado: se dice, no se arma una dirección que no existe. */
export function direccionDe(token: string): string | null {
  const dom = dominioBuzon();
  if (!dom || !esTokenValido(token)) return null;
  return `${PREFIJO}${token}@${dom}`;
}

/**
 * Saca el token de una dirección que llegó.
 *
 * TOLERANTE con lo que hace la gente y los servidores de correo de verdad:
 * mayúsculas (el correo no distingue caso en el dominio, y muchos clientes
 * capitalizan), espacios, y el formato `Nombre <correo@dominio>` que llega en
 * el `to` de casi todos los proveedores.
 *
 * ESTRICTO con lo que decide a qué flota entra el gasto: si el dominio no es
 * el nuestro, devuelve `null` en vez de intentar rescatar el token. Un correo
 * a `f-<token>@otro-dominio.com` no es nuestro.
 */
export function tokenDeDireccion(direccion: string): string | null {
  const dom = dominioBuzon();
  if (!dom) return null;

  // `Nombre <a@b>` → `a@b`
  const conAngulos = /<([^>]+)>/.exec(direccion);
  const limpia = (conAngulos ? conAngulos[1] : direccion).trim().toLowerCase();

  const arroba = limpia.lastIndexOf('@');
  if (arroba === -1) return null;
  if (limpia.slice(arroba + 1) !== dom.toLowerCase()) return null;

  const local = limpia.slice(0, arroba);
  if (!local.startsWith(PREFIJO)) return null;

  // Se descarta cualquier sufijo `+algo`: los servidores lo agregan y no forma
  // parte del token.
  const sinSufijo = local.slice(PREFIJO.length).split('+')[0];
  return esTokenValido(sinSufijo) ? sinSufijo : null;
}

/**
 * De una lista de destinatarios, cuál es el buzón de una flota.
 *
 * Un correo reenviado trae varias direcciones en `to` y en `cc` —la del
 * proveedor, la del contador, y la nuestra— y solo una es un buzón. Se
 * devuelve el PRIMER token válido; si hay dos buzones distintos en el mismo
 * correo, se devuelve `null`: no se adivina a cuál de las dos flotas iba.
 */
export function tokenDeDestinatarios(direcciones: readonly string[]): string | null {
  const encontrados = new Set<string>();
  for (const d of direcciones) {
    const t = tokenDeDireccion(d);
    if (t) encontrados.add(t);
  }
  if (encontrados.size !== 1) return null;
  return [...encontrados][0];
}
