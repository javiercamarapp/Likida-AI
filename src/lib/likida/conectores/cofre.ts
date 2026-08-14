import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { CampoCredencial, ValoresCredencial } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL COFRE — cifrado de las credenciales de conector.
//
// La mig. 0094 guarda `valores_cifrados` como texto y tiene un CHECK que
// rechaza cualquier cosa que empiece con `{`: un JSON en claro no cabe. Este
// módulo es quien produce lo que sí cabe.
//
// ── POR QUÉ EN LA APLICACIÓN Y NO CON pgcrypto ───────────────────────────
//
// Si el cifrado viviera en Postgres, la llave viviría en la base o en un
// parámetro de sesión — y quien pudiera leer la tabla (el service role, un
// volcado, un respaldo) podría descifrarla. Cifrando aquí con una llave que
// solo existe en el entorno de ejecución, un volcado de la base es ruido.
//
// ── AES-256-GCM, NO CBC ──────────────────────────────────────────────────
//
// GCM es cifrado AUTENTICADO: además de ocultar, detecta si alguien alteró el
// texto cifrado. Con CBC, un atacante con acceso de escritura a la tabla puede
// voltear bits del cifrado y el descifrado devuelve basura SIN AVISAR — y esa
// basura terminaría intentando autenticarse contra el SAP del cliente. Aquí
// una alteración tira excepción.
//
// ── EL IV ES NUEVO EN CADA GUARDADO ──────────────────────────────────────
//
// Reusar el IV con la misma llave rompe GCM por completo (deja recuperar el
// texto plano de dos mensajes). Va delante del cifrado, en claro: el IV no es
// secreto, solo tiene que ser único.
// ═══════════════════════════════════════════════════════════════════════════

/** El formato: `v1.<iv>.<tag>.<cifrado>`, todo en base64url. La versión al
 *  frente para poder rotar el algoritmo sin adivinar qué es cada cadena. */
const VERSION = 'v1';

/**
 * La llave de cifrado, derivada de una variable de entorno.
 *
 * Se deriva con SHA-256 en vez de exigir 32 bytes exactos porque una variable
 * de entorno la teclea una persona: pedirle que produzca exactamente 32 bytes
 * termina en que alguien recorta o rellena y el error aparece en runtime.
 *
 * SIN la variable, `cifrar` LANZA en vez de guardar en claro. Es deliberado:
 * el modo de falla aceptable es "no se puede guardar la credencial", no
 * "se guardó donde cualquiera puede leerla".
 */
function llave(): Buffer {
  const secreto = process.env.LIKIDA_COFRE_LLAVE;
  if (!secreto || secreto.length < 32) {
    throw new Error(
      'LIKIDA_COFRE_LLAVE ausente o demasiado corta (mínimo 32 caracteres). ' +
      'Sin ella no se pueden guardar credenciales de conector — y guardarlas en claro no es una opción.',
    );
  }
  return createHash('sha256').update(secreto, 'utf8').digest();
}

/** ¿Está el cofre utilizable? Lo usa la pantalla para decir la verdad en vez
 *  de ofrecer un formulario que va a tronar al guardar. */
export function cofreConfigurado(): boolean {
  const s = process.env.LIKIDA_COFRE_LLAVE;
  return Boolean(s && s.length >= 32);
}

export function cifrar(valores: ValoresCredencial): string {
  const iv = randomBytes(12); // 96 bits, el tamaño que GCM espera
  const c = createCipheriv('aes-256-gcm', llave(), iv);
  const cifrado = Buffer.concat([c.update(JSON.stringify(valores), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), cifrado.toString('base64url')].join('.');
}

/**
 * Descifra. LANZA si el texto fue alterado, si la llave cambió o si el formato
 * no es el esperado — nunca devuelve un objeto a medias.
 */
export function descifrar(guardado: string): ValoresCredencial {
  const partes = guardado.split('.');
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new Error('El valor guardado no tiene el formato del cofre.');
  }
  const [, iv, tag, cifrado] = partes;
  const d = createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  // `final()` es quien verifica el tag: si alguien alteró un bit, lanza aquí.
  const plano = Buffer.concat([d.update(Buffer.from(cifrado, 'base64url')), d.final()]).toString('utf8');
  return JSON.parse(plano) as ValoresCredencial;
}

/**
 * Las PISTAS: lo único que vuelve al panel.
 *
 * Los campos no secretos van en claro —el host de SAP y el usuario no son
 * secretos y sin ellos nadie reconoce cuál credencial es—, y de cada secreto
 * solo sus últimos 4 caracteres, precedidos por puntos suspensivos para que se
 * lea como un recorte y no como el valor.
 *
 * Cuatro caracteres alcanzan para que una persona confirme que tecleó la
 * correcta y no alcanzan para reconstruir nada. Un secreto de menos de 8
 * caracteres se tapa ENTERO: enseñar 4 de 6 sería regalar dos tercios.
 */
export function pistasDe(campos: readonly CampoCredencial[], valores: ValoresCredencial): Record<string, string> {
  const pistas: Record<string, string> = {};
  for (const campo of campos) {
    const v = valores[campo.clave];
    if (v === undefined || v === '') continue;
    if (campo.forma === 'secreto') {
      pistas[campo.clave] = v.length >= 8 ? `…${v.slice(-4)}` : '…';
    } else {
      pistas[campo.clave] = v;
    }
  }
  return pistas;
}
