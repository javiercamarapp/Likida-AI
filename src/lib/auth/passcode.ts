// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL PANEL. Un passcode compartido, sin Supabase Auth.
//
// El panel dejó de ser un demo el día que salió a producción con la
// contabilidad y los datos personales de una flota detrás. El diseño de antes
// era "candado suave" y tenía tres defectos que la auditoría 5 juntó en un solo
// ALTO:
//
//   1. ADIVINABLE. `DASHBOARD_PASSCODE=likida-demo-2026` es `<marca>-demo-<año>`:
//      una lista de 50 candidatos obvios lo contiene. El límite de 10 intentos /
//      5 min vive en un `Map` en memoria POR INSTANCIA (ratelimit.ts:7), así que
//      el techo real es 10 × (instancias que el atacante abra en paralelo), no
//      10. La única defensa que no depende de estado compartido es que el
//      passcode no esté en ninguna lista: por eso ahora la FUERZA se exige aquí
//      y se falla ruidoso en producción si no la tiene.
//
//   2. ETERNO. El token era `HMAC("likida-access:" + passcode)`: determinista.
//      La misma cookie valía para todos, desde cualquier IP, para siempre. El
//      `maxAge: 60*60*8` de `/acceso` es una pista para el navegador, no una
//      expiración de servidor: un valor copiado de las devtools hace un año
//      seguía entrando. Ahora el token lleva su hora de emisión FIRMADA y el
//      servidor la comprueba; a las 8 horas deja de valer aunque el navegador
//      lo conserve.
//
//   3. IRREVOCABLE. Al ser determinista no había nada que revocar: la única
//      palanca era cambiar `DASHBOARD_PASSCODE`, o sea repartir uno nuevo a los
//      que sí deben entrar. Ahora hay dos que no obligan a eso: las sesiones
//      caducan solas a las 8 h, y rotar `DASHBOARD_SECRET` —un valor que nadie
//      teclea, solo vive en Vercel— invalida TODAS las cookies vivas de golpe
//      dejando el passcode intacto. Es la que hay que usar después del demo del
//      6-ago para cerrarle la puerta a quien vio el código en la sala.
//
// LO QUE ESTO SIGUE SIN SER, Y HAY QUE DECIRLO. Es UN secreto para TODOS: no
// hay identidad, así que "cortarle el acceso a una persona" sigue siendo
// imposible por construcción — lo más fino que se puede hacer es cortarlos a
// todos. Eso solo lo arregla auth por usuario (Supabase Auth + RLS con
// `auth.uid()`), que es bloqueante de SEGUNDO CLIENTE, no de este demo.
//
// FORMATO DEL TOKEN (v2):
//
//     2.<emitido-en-base36>.<nonce-hex-32>.<hmac-hex-64>
//     └─ versión         └─ Date.now()  └─ 16 bytes    └─ firma de los tres
//
// El HMAC cubre la versión, la hora, el nonce y el passcode, con
// `DASHBOARD_SECRET` como clave. Nada del token es reversible y nada de lo que
// va dentro se puede mover sin invalidar la firma. El nonce hace que dos
// entradas con el MISMO passcode produzcan cookies distintas: una cookie filtrada
// es una sesión, no la llave maestra.
//
// Usa Web Crypto (crypto.subtle), disponible en edge Y node → el proxy funciona
// en cualquier runtime.
// ═══════════════════════════════════════════════════════════════════════════

export const ACCESS_COOKIE = 'likida_access';

/**
 * Vida máxima de una sesión del panel, comprobada EN EL SERVIDOR.
 *
 * Es el mismo valor que el `maxAge` de la cookie en `/acceso` (60*60*8) a
 * propósito: si fuera mayor, la cookie moriría en el navegador y el servidor
 * seguiría aceptando una copia; si fuera menor, el usuario vería una sesión
 * "viva" que ya no lo deja pasar. El que manda es este.
 */
export const SESION_MAX_MS = 8 * 60 * 60 * 1000;

/** Tolerancia de reloj entre instancias, para no tirar cookies recién emitidas. */
const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;

const VERSION = '2';

function secret(): string {
  const s = process.env.DASHBOARD_SECRET;
  if (s) return s;

  // EN PRODUCCIÓN NO HAY FALLBACK, Y ES A PROPÓSITO.
  //
  // Antes caía a `likida:${DASHBOARD_PASSCODE}`: la cookie era HMAC(passcode) con
  // una clave DERIVADA del propio passcode. Quien capture UNA cookie puede probar
  // candidatos offline —sin tocar /acceso, sin su rate-limit— hasta dar con el
  // passcode, y entrar por el formulario normal indefinidamente. Un passcode de
  // demo tiene poca entropía: eso son minutos de cómputo.
  //
  // Un candado que parece cerrado y no lo está es peor que uno que avisa que no
  // está puesto.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DASHBOARD_SECRET es obligatorio en producción: sin él el HMAC de la cookie se deriva del propio passcode, y una cookie capturada permite crackearlo offline.',
    );
  }
  return `likida:${process.env.DASHBOARD_PASSCODE || 'dev'}`;
}

async function hmacHex(msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── La fuerza del passcode, exigida por código ──────────────────────────────
//
// Esta es la parte del arreglo que no se puede delegar al rate-limit, porque el
// rate-limit no sobrevive al reparto en varias instancias. Un passcode que no
// está en ninguna lista de candidatos obvios sí.
//
// El mínimo es 24 caracteres porque lo que se busca no es "que sea difícil de
// teclear" sino que NO sea derivable de la marca, del producto ni del año. Un
// valor generado al azar cumple las tres reglas sin pensarlo:
//
//     openssl rand -base64 24 | tr -d '=+/'
//
// Solo se exige en producción. En desarrollo estorbaría todos los días y el
// panel local no tiene datos de nadie.

const LARGO_MINIMO = 24;
const DISTINTOS_MINIMO = 10;

// Palabras que un humano prueba primero. La comparación es sobre el passcode en
// minúsculas y SIN separadores, así que 'likida-demo-2026', 'Likida.Demo.2026' y
// 'LIKIDADEMO2026' caen las tres con la misma entrada.
const PALABRAS_ADIVINABLES = [
  'likida', 'cuadra', 'demo', 'prueba', 'test', 'passcode', 'password',
  'contrasena', 'clave', 'acceso', 'admin', 'panel', 'dashboard', 'flota',
  'qwerty', 'asdf', '1234', 'abcd', '2024', '2025', '2026', '2027',
];

/**
 * Devuelve por qué el passcode es adivinable, o `null` si aguanta.
 *
 * NO devuelve el fragmento culpable: el motivo acaba en los logs de Vercel y
 * decir «contiene "demo"» sería escribir un trozo del secreto ahí. La regla
 * incumplida basta para arreglarlo.
 */
export function motivoPasscodeDebil(passcode: string): string | null {
  if (passcode.length < LARGO_MINIMO) {
    return `tiene ${passcode.length} caracteres y el mínimo son ${LARGO_MINIMO}`;
  }
  const plano = passcode.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (PALABRAS_ADIVINABLES.some((w) => plano.includes(w))) {
    return 'contiene una palabra predecible (la marca, el producto, "demo", un año, una secuencia de teclado)';
  }
  if (new Set(passcode).size < DISTINTOS_MINIMO) {
    return `usa ${new Set(passcode).size} caracteres distintos y hacen falta ${DISTINTOS_MINIMO}`;
  }
  if (process.env.DASHBOARD_SECRET && passcode === process.env.DASHBOARD_SECRET) {
    return 'es el mismo valor que DASHBOARD_SECRET, y entonces conocer uno es conocer los dos';
  }
  return null;
}

function exigirPasscodeFuerte(passcode: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  const motivo = motivoPasscodeDebil(passcode);
  if (motivo) {
    // Ruidoso a propósito, igual que la ausencia de DASHBOARD_SECRET. Detrás de
    // este candado hay datos fiscales y el nombre propio de cada operador; un
    // panel que responde 500 es recuperable, uno que abre con la quinta
    // adivinanza no.
    throw new Error(
      `DASHBOARD_PASSCODE es adivinable (${motivo}) y el panel de producción tiene datos fiscales y personales detrás. Pon un valor aleatorio de al menos ${LARGO_MINIMO} caracteres —\`openssl rand -base64 24 | tr -d '=+/'\`— en las variables de entorno de Vercel y vuelve a desplegar.`,
    );
  }
}

/**
 * El passcode configurado, o null si no hay ninguno (desarrollo).
 *
 * Lanza si hay uno y es adivinable en producción: es el único punto por el que
 * pasan las dos capas del panel (el proxy y `exigirAcceso`), así que es donde la
 * exigencia no se puede olvidar.
 */
function passcodeConfigurado(): string | null {
  const p = process.env.DASHBOARD_PASSCODE;
  if (!p) return null;
  exigirPasscodeFuerte(p);
  return p;
}

/** ¿Hay candado puesto? Sin passcode (desarrollo) el panel no bloquea. */
export function hayPasscode(): boolean {
  return passcodeConfigurado() !== null;
}

function nonceHex(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function firma(emitidoEn: number, nonce: string, passcode: string): Promise<string> {
  // El passcode entra en el MENSAJE además de estar en la clave, para que las dos
  // rotaciones sirvan y sirvan para cosas distintas: cambiar DASHBOARD_PASSCODE
  // corta y obliga a repartir código nuevo; cambiar DASHBOARD_SECRET corta sin
  // que nadie tenga que aprenderse nada.
  return hmacHex(`likida-access.v${VERSION}|${emitidoEn}|${nonce}|${passcode}`);
}

/**
 * Emite una sesión nueva. La firma no cambió —`/acceso` la llama igual— pero el
 * valor sí: ya no es determinista, lleva su hora dentro y caduca sola.
 */
export async function accessToken(passcode: string): Promise<string> {
  exigirPasscodeFuerte(passcode);
  const emitidoEn = Date.now();
  const nonce = nonceHex();
  return `${VERSION}.${emitidoEn.toString(36)}.${nonce}.${await firma(emitidoEn, nonce, passcode)}`;
}

/**
 * Comparación en tiempo constante (evita fuga por timing).
 *
 * Se exporta para que `/acceso` la use también: comparaba el passcode con `===`,
 * que sale al primer carácter distinto. El rate-limit hace la explotación
 * difícil, pero teniendo el helper al lado no hay razón para no usarlo.
 */
export function constTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * ¿Esta cookie es una sesión viva emitida por nosotros?
 *
 * Rechaza, en este orden y todo con `false` (nunca con una excepción que
 * distinga un caso de otro):
 *
 *   · el formato viejo —64 hex, determinista—, que es lo que cierra el agujero
 *     de "una cookie copiada de las devtools hace un año sigue entrando";
 *   · una emisión de hace más de 8 horas, o del futuro más allá de la
 *     tolerancia de reloj;
 *   · cualquier cambio en la hora, el nonce, el passcode o el secreto, porque
 *     los cuatro están dentro de la firma.
 */
export async function tokenMatches(cookie: string | undefined | null): Promise<boolean> {
  const passcode = passcodeConfigurado();
  if (!passcode || !cookie) return false;

  const partes = cookie.split('.');
  if (partes.length !== 4 || partes[0] !== VERSION) return false;

  const emitidoEn = Number.parseInt(partes[1], 36);
  if (!Number.isSafeInteger(emitidoEn) || emitidoEn <= 0) return false;
  if (!/^[0-9a-f]{32}$/.test(partes[2])) return false;
  if (!/^[0-9a-f]{64}$/.test(partes[3])) return false;

  const edad = Date.now() - emitidoEn;
  if (edad > SESION_MAX_MS || edad < -TOLERANCIA_RELOJ_MS) return false;

  return constTimeEq(partes[3], await firma(emitidoEn, partes[2], passcode));
}
