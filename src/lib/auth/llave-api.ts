import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';

// ═══════════════════════════════════════════════════════════════════════════
// LLAVES DE API — lo que vuelve consumible a /v1 desde un sistema ajeno.
//
// La API v1 autenticaba SOLO por cookie, así que la podía consumir un navegador
// con sesión del panel y nadie más: un TMS headless no tiene cookies. La cuña
// enterprise —"no importa qué TMS uses hoy ni dentro de dos años"— no se podía
// ni demostrar en una llamada.
//
// ── LA LLAVE EN CLARO NO SE GUARDA. NUNCA. ────────────────────────────────
//
// Se guarda su SHA-256 (mig. 0093, con un CHECK que exige 64 hex, así que si
// alguien intentara escribir la llave en claro el insert falla en vez de
// guardarla). Se enseña UNA vez, al crearla; si se pierde, se revoca y se emite
// otra. Guardarla en claro haría que un volcado de esa tabla fuera acceso
// directo a la API de todas las flotas.
//
// ── POR QUÉ SHA-256 Y NO bcrypt/argon2 ────────────────────────────────────
//
// Parece un downgrade y no lo es: bcrypt existe para contraseñas, que las eligen
// personas y tienen poca entropía —por eso hay que hacerlas lentas de probar—.
// Una llave de 32 bytes de `randomBytes` tiene 256 bits de entropía: no hay
// diccionario ni fuerza bruta que la alcance, y un hash lento aquí solo
// castigaría CADA petición legítima de la API. Es el mismo criterio que usan
// GitHub y Stripe con sus tokens.
//
// ── ESTE ARCHIVO ES SOLO EL CAMINO CALIENTE ───────────────────────────────
//
// `resolverLlave` corre en CADA petición de /v1. La emisión, la lista y la
// revocación —el camino frío del panel (/dashboard/llaves-api)— viven en
// `llave-api-escritura.ts`, para que un cambio en la pantalla no pueda
// desestabilizar lo que autentica cada llamada.
// ═══════════════════════════════════════════════════════════════════════════

/** `lk_` + `live_` para que se reconozca de un vistazo en un log o un pegado
 *  accidental, y para que los escáneres de secretos la puedan detectar. */
const PREFIJO_FIJO = 'lk_live_';

/** Cuántos caracteres del cuerpo se guardan en claro para reconocerla. */
const LARGO_PISTA = 6;

export interface LlaveNueva {
  /** La llave COMPLETA. Se enseña una vez y no se vuelve a poder leer. */
  enClaro: string;
  /** Lo que sí se guarda en claro, para reconocerla en la lista. */
  prefijo: string;
  hash: string;
}

/**
 * Genera una llave nueva.
 *
 * 32 bytes de `randomBytes` (no `Math.random`, que no es criptográfico y cuyo
 * estado se puede reconstruir observando salidas).
 */
export function generarLlave(): LlaveNueva {
  const cuerpo = randomBytes(32).toString('base64url');
  const enClaro = `${PREFIJO_FIJO}${cuerpo}`;
  return {
    enClaro,
    prefijo: `${PREFIJO_FIJO}${cuerpo.slice(0, LARGO_PISTA)}`,
    hash: hashDeLlave(enClaro),
  };
}

export function hashDeLlave(enClaro: string): string {
  return createHash('sha256').update(enClaro, 'utf8').digest('hex');
}

/**
 * El prefijo con el que se busca el candidato en la base.
 *
 * `null` si la cadena no tiene ni la forma de una llave: así una petición con
 * basura en el header no gasta un viaje a Supabase.
 */
export function prefijoDe(enClaro: string): string | null {
  const t = enClaro.trim();
  if (!t.startsWith(PREFIJO_FIJO)) return null;
  const cuerpo = t.slice(PREFIJO_FIJO.length);
  if (cuerpo.length < LARGO_PISTA) return null;
  return `${PREFIJO_FIJO}${cuerpo.slice(0, LARGO_PISTA)}`;
}

/**
 * Saca la llave del header `Authorization: Bearer …`.
 *
 * Devuelve `null` para cualquier otra cosa —incluido `Basic`— en vez de
 * intentar adivinar: un esquema que no reconocemos no se trata como si fuera el
 * nuestro.
 */
export function llaveDelHeader(auth: string | null): string | null {
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return null;
  const v = m[1].trim();
  return v.length > 0 ? v : null;
}

/**
 * Compara dos hashes en tiempo CONSTANTE.
 *
 * Un `===` sobre strings corta en el primer caracter distinto, y esa diferencia
 * de microsegundos, medida muchas veces, deja adivinar el hash caracter por
 * caracter. Aquí el atacante controla lo que manda y puede medir: es
 * exactamente el escenario donde el ataque de tiempo aplica.
 */
export function mismoHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` EXIGE el mismo largo o lanza. La comparación de largos no
  // filtra nada útil: el largo del hash es público y siempre 64.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type ResultadoLlave =
  | { ok: true; tenantId: string; area: string; llaveId: string }
  | { ok: false; status: 401 | 503; motivo: string };

/**
 * Resuelve una llave contra la base.
 *
 * FALLA CERRADO en los dos sentidos que importan:
 *  · una llave que no existe, está revocada o no cuadra → 401, y SIEMPRE con el
 *    mismo texto. Distinguir "no existe" de "revocada" le diría a quien prueba
 *    llaves cuál acertó a medias;
 *  · un error de lectura → 503, NUNCA 401. Un bache de red que se responda como
 *    "no autorizado" haría que el TMS del cliente borrara su llave creyéndola
 *    inválida.
 */
export async function resolverLlave(enClaro: string): Promise<ResultadoLlave> {
  const prefijo = prefijoDe(enClaro);
  // Sin la forma correcta ni se consulta: una ráfaga de basura no debe poder
  // gastar el presupuesto de lecturas.
  if (!prefijo) return { ok: false, status: 401, motivo: 'Llave inválida.' };

  const { data, error } = await supabaseAdmin()
    .from('tenant_api_key')
    .select('id, tenant_id, area, hash')
    .eq('prefijo', prefijo)
    .is('revocada_en', null)
    .limit(20);

  if (error) {
    logger.error('llave_api.lectura', { err: error.message });
    return { ok: false, status: 503, motivo: 'No se pudo verificar la llave. Intenta de nuevo.' };
  }

  const esperado = hashDeLlave(enClaro);
  // Se recorren TODAS las candidatas del prefijo aunque la primera cuadre: salir
  // temprano volvería medible cuántas comparten prefijo.
  let hallada: { id: string; tenant_id: string; area: string } | null = null;
  for (const fila of data ?? []) {
    if (mismoHash(String(fila.hash), esperado)) {
      hallada = { id: String(fila.id), tenant_id: String(fila.tenant_id), area: String(fila.area) };
    }
  }
  if (!hallada) return { ok: false, status: 401, motivo: 'Llave inválida.' };

  // Sello de último uso: best-effort a propósito. Sirve para contestar "¿esta
  // llave todavía se usa?" antes de revocarla y para notar una que se filtró,
  // pero si la escritura falla NO se cae la petición — el cliente ya se
  // autenticó y negarle la lectura por no poder anotar la fecha sería el peor
  // intercambio.
  void supabaseAdmin().from('tenant_api_key')
    .update({ ultimo_uso_en: new Date().toISOString() })
    .eq('id', hallada.id)
    .then(({ error: e }) => { if (e) logger.warn('llave_api.sello', { err: e.message }); });

  return { ok: true, tenantId: hallada.tenant_id, area: hallada.area, llaveId: hallada.id };
}
