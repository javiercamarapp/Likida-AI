// ═══════════════════════════════════════════════════════════════════════════
// AVISO DE PRIVACIDAD EN EL CANAL — modalidad simplificada.
//
// QUIÉN lo debe: el RESPONSABLE, y ese es la FLOTA (LFPDPPP art. 14). Likida es
// persona encargada —trata los datos por cuenta de ella (art. 2 fr. XII)— y no
// le toca redactarlo ni responde por su omisión. Este módulo NO es "el aviso de
// Likida": es el mecanismo para que la flota ponga el suyo, que sin producto no
// puede aunque quiera.
//
// QUÉ exige el canal: los datos entran por WhatsApp, o sea por medio
// electrónico, así que aplica el art. 16 fr. II — modalidad SIMPLIFICADA con al
// menos las fracciones I a IV del art. 15, y señalar dónde se consulta el
// integral. El aviso completo NO cabe ni debe ir en un mensaje de WhatsApp.
//
// Verificado contra el texto vigente (DOF 20-mar-2025, últ. reforma 14-nov-2025)
// en normas/lfpdppp-15-16.yaml.
// ═══════════════════════════════════════════════════════════════════════════

/** Los datos de la FLOTA. Sin ellos no hay aviso: el responsable es ella. */
export interface DatosResponsable {
  /** Razón social tal cual está en el RFC. */
  razonSocial: string;
  /** Domicilio fiscal. Art. 15 fr. I lo pide junto con la identidad. */
  domicilio: string;
  /** Dónde vive el aviso integral. Art. 16 fr. II obliga a señalarlo. */
  urlAvisoIntegral: string;
}

/**
 * Estado de la liga al aviso integral.
 *
 * - `ok`        — la liga tiene forma de sitio público consultable.
 * - `ausente`   — la flota no capturó ninguna.
 * - `inservible`— hay algo escrito, pero no es una dirección que alguien pueda
 *                 abrir desde WhatsApp (no parsea, no es http/https, el host no
 *                 tiene dominio de primer nivel, o es un marcador de relleno).
 */
export type EstadoAvisoIntegral = 'ok' | 'ausente' | 'inservible';

/**
 * Marcadores de relleno que la gente deja al configurar un tenant. No es una
 * lista de "dominios prohibidos": es la lista de cosas que NADIE quiso publicar
 * como aviso y que solo llegan aquí porque alguien no terminó de capturar.
 */
const RELLENOS = [
  'example.com', 'example.org', 'example.net', 'ejemplo.com', 'ejemplo.mx',
  'dominio.com', 'tudominio', 'tu-dominio', 'midominio', 'mi-dominio',
  'localhost', 'test.com', 'changeme', 'cambiar', 'pendiente', 'por-definir',
  'pordefinir', 'todo',
];

/**
 * ¿La liga del aviso integral sirve para ponerla en un mensaje?
 *
 * ES UNA REVISIÓN DE FORMA, Y HAY QUE LEERLA COMO TAL: dice que la cadena tiene
 * pinta de dirección pública, NO que el sitio exista. Un dominio bien escrito y
 * sin registrar (NXDOMAIN) pasa esta función y el operador igual se topa con un
 * error de red. Lo único que prueba existencia es `sondearAvisoIntegral`, que
 * sale a la red y por eso no puede correr en el camino de cada mensaje.
 *
 * Por qué existe de todos modos: el art. 16 fr. II obliga a "señalar el sitio
 * donde se podrá consultar el aviso integral". Señalar `pendiente` o
 * `www.ejemplo` no es señalar un sitio, y mandarlo como si lo fuera convierte
 * el aviso en una constancia de algo que no ocurrió.
 */
export function revisarAvisoIntegral(url: string | null | undefined): EstadoAvisoIntegral {
  const s = url?.trim();
  if (!s) return 'ausente';

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return 'inservible';
  }
  // Solo web. Un `mailto:` o un `ftp:` no es "el sitio donde se podrá consultar".
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'inservible';

  // El host tiene que tener dominio de primer nivel alfabético: eso descarta de
  // un golpe `localhost`, los nombres internos sin punto y las IP desnudas
  // (cuyo último tramo es numérico), que no son un sitio público consultable.
  const host = u.hostname.toLowerCase();
  if (!/\.[a-z]{2,}$/.test(host)) return 'inservible';

  const completa = s.toLowerCase();
  if (RELLENOS.some((r) => host === r || host.endsWith(`.${r}`) || completa.includes(r))) {
    return 'inservible';
  }
  return 'ok';
}

/** Lo que el sondeo de red encontró. El motivo es para el log, no para el operador. */
export type SondeoAvisoIntegral = { abre: true } | { abre: false; motivo: string };

/**
 * Abre de verdad la liga del aviso integral. Es lo ÚNICO que distingue un
 * dominio bien escrito de un dominio que no existe.
 *
 * NO va en el camino de cada mensaje: es una llamada de red con latencia y con
 * falsos negativos por corte transitorio, y hacer depender de ella el envío del
 * aviso sería cambiar un incumplimiento por otro. Va en un arranque, en un
 * preflight de despliegue o en un cron, donde un fallo se puede mirar.
 *
 * `fetchImpl` se inyecta para poder probarlo sin red.
 */
export async function sondearAvisoIntegral(
  url: string | null | undefined,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SondeoAvisoIntegral> {
  const estado = revisarAvisoIntegral(url);
  if (estado !== 'ok') return { abre: false, motivo: `liga ${estado}` };

  const f = opts.fetchImpl ?? fetch;
  const destino = (url as string).trim();
  const señal = () => AbortSignal.timeout(opts.timeoutMs ?? 5000);

  try {
    let res = await f(destino, { method: 'HEAD', redirect: 'follow', signal: señal() });
    // Hay servidores que no implementan HEAD y contestan 405/501 teniendo la
    // página. Se reintenta con GET antes de declarar muerta una liga que vive.
    if (res.status === 405 || res.status === 501) {
      res = await f(destino, { method: 'GET', redirect: 'follow', signal: señal() });
    }
    if (!res.ok) return { abre: false, motivo: `http ${res.status}` };
    return { abre: true };
  } catch (e) {
    // Aquí cae el NXDOMAIN: sin zona DNS, `fetch` falla antes de hablar con nadie.
    return { abre: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Arma el aviso simplificado, o devuelve `null` si a la flota le falta la
 * identidad del responsable.
 *
 * Null y no un texto a medias: un aviso con el responsable equivocado —o sin
 * él— es peor que no tenerlo, porque justo lo que el aviso sirve para decir es a
 * quién reclamarle. Que falte se resuelve configurando el tenant; que esté mal
 * no se resuelve, porque nadie lo nota.
 *
 * LA LIGA DEL INTEGRAL NO SE TRATA IGUAL, y es a propósito. Sin razón social o
 * sin domicilio el aviso no puede decir lo único que el art. 15 fr. I persigue.
 * Sin liga utilizable, en cambio, las fracciones I a IV del art. 15 —que son las
 * que el art. 16 fr. II exige en la modalidad simplificada— caben enteras en el
 * mensaje: lo que falta es el puntero al integral, no el aviso. Callarse por eso
 * dejaría al titular sin nada, cuando puede quedarse con casi todo. Así que se
 * manda el aviso completo y se le dice la verdad sobre la liga, en vez de
 * pegarle una dirección que no abre y anotar en la base que se le informó.
 *
 * Efecto secundario buscado: el texto degradado y el texto con liga son
 * distintos, así que `versionAviso` les da hash distinto. El día que la flota
 * publique su integral, el aviso bueno se reenvía solo (art. 15 fr. VI).
 */
export function avisoSimplificado(r: DatosResponsable): string | null {
  const razonSocial = r.razonSocial?.trim();
  const domicilio = r.domicilio?.trim();
  if (!razonSocial || !domicilio) return null;

  const estado = revisarAvisoIntegral(r.urlAvisoIntegral);
  const url = r.urlAvisoIntegral?.trim();

  return [
    `🔒 *Aviso de privacidad*`,
    ``,
    // Fr. I — identidad y domicilio del responsable.
    `Responsable de tus datos: *${razonSocial}*, con domicilio en ${domicilio}.`,
    ``,
    // Fr. II — qué datos. En cristiano, no en abstracto: el operador tiene que
    // reconocer lo que va a mandar.
    `Qué se trata: tu nombre y teléfono, y las fotos de comprobantes de gasto que envíes por aquí (diésel, casetas, alimentación, hospedaje) con sus montos y fechas.`,
    ``,
    // Fr. III — finalidades, DISTINGUIENDO. La fracción vigente no se conforma
    // con enumerarlas: pide separar las que requieren consentimiento. Y el
    // art. 11 vigente perdió las palabras "compatible o análogo" de la ley
    // abrogada, así que una finalidad que no esté escrita aquí no tiene válvula:
    // exige consentimiento nuevo. Por eso la revisión de comprobantes entre
    // viajes —que corre y que el contralor ve— se enuncia, en vez de esconderse
    // detrás de un "nada más" que el producto desmiente.
    `Para qué, y sin esto no hay liquidación: liquidar tus viajes y comprobar los gastos ante el SAT.`,
    ``,
    `Para qué más: revisar si un comprobante viene repetido o alterado —incluyendo la comparación contra los de tus viajes anteriores— y entregarle ese resultado a la empresa.`,
    ``,
    // Art. 26 fr. II — el derecho de oposición al tratamiento automatizado. Es
    // el elemento 11 del checklist de docs/conocimiento/11-datos-personales.md
    // §5.4, que la tabla ubica en el integral. Se pone aquí igual porque la
    // revisión que lo activa ya corre hoy y porque un derecho que solo vive en
    // un documento que el titular no ha visto no se ejerce nunca.
    `Esa revisión la hace un programa, sin que una persona la mire antes. Tienes derecho a oponerte a que se decida así y a pedir que la revise alguien.`,
    ``,
    // Fr. IV — opciones y medios para limitar el uso o divulgación. Es también
    // el medio para ejercer la oposición del renglón de arriba: un solo camino,
    // el mismo que el operador ya tiene abierto.
    `Cómo limitarlo, oponerte o ejercer tus derechos ARCO: escribe *PRIVACIDAD* por este chat y te pasamos con la empresa.`,
    ``,
    // Encargada. No es transferencia (art. 2 fr. XX excluye a la persona
    // encargada), pero el operador tiene derecho a saber por dónde pasan sus
    // fotos, y decirlo cuesta un renglón.
    `Likida procesa esta información por cuenta de la empresa, siguiendo sus instrucciones.`,
    ``,
    // Art. 16 fr. II — señalar dónde está el integral. Si no hay dónde, se dice
    // que no hay dónde. Prometer una liga rota es peor que reconocer el hueco:
    // el titular pierde el tiempo y la base guarda una constancia falsa.
    estado === 'ok'
      ? `Aviso completo: ${url}`
      : `Aviso completo: la empresa aún no lo publica. Escríbeme *PRIVACIDAD* y queda registrado para que te lo hagan llegar.`,
  ].join('\n');
}

/**
 * Versión del texto, para saber si el operador vio ESTE aviso o uno viejo.
 *
 * Se deriva del contenido, no de un número que alguien tenga que acordarse de
 * subir: si la flota cambia su domicilio o la liga del integral, la versión
 * cambia sola y el aviso se vuelve a enviar. El art. 15 fr. VI obliga a
 * comunicar los cambios, y confiar en que alguien recuerde incrementar un
 * contador es exactamente como no comunicarlos.
 *
 * No es criptografía: solo tiene que cambiar cuando el texto cambia. Un hash
 * corto y determinístico (FNV-1a) basta y no arrastra dependencias.
 */
export function versionAviso(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Cómo se ejerce la OPOSICIÓN del art. 26 fr. II en un chat.
 *
 * El aviso anuncia el derecho con estas palabras: *"Esa revisión la hace un
 * programa, sin que una persona la mire antes. Tienes derecho a oponerte a que
 * se decida así y a pedir que la revise alguien."* Quien acaba de leer eso no
 * contesta `PRIVACIDAD`: contesta con la frase que acaba de leer. Reconocer
 * solo la palabra clave dejaba el ejercicio del derecho en manos del LLM, que
 * es exactamente lo que el resto de este módulo decidió no hacer. §6 de
 * `docs/conocimiento/11-datos-personales.md` lo pide con todas sus letras: un
 * mecanismo de oposición documentado en el aviso *y accesible desde WhatsApp*.
 *
 * Calibrado a favor de la cobertura y no de la precisión, porque los dos errores
 * no cuestan lo mismo: un falso positivo manda una respuesta que además dice
 * "tu liquidación sigue igual, esto no la afecta" y el operador repite su
 * mensaje; un falso negativo deja sin atender un derecho. Aun así se exige la
 * forma de PETICIÓN ("que lo revise una persona"), no la mención suelta de una
 * persona, para no secuestrar la conversación normal de la caseta.
 */
const OPOSICION: RegExp[] = [
  /\bme opongo\b/,
  /\boponerme\b/,
  /\boposicion\b/,
  /\brevision humana\b/,
  /\bque (lo |la )?(revise|revisen|vea|vean) (un |una )?(persona|humano|humana|alguien|gente)\b/,
  /\b(un|una) (persona|humano|humana|gente) (lo |la )?(revise|vea|revisara)\b/,
];

/**
 * ¿El operador está ejerciendo el medio que el aviso le prometió?
 *
 * Determinístico y ANTES del agente, a propósito. Un derecho ARCO no se deja a
 * que el LLM decida si el mensaje "califica": si el aviso dice que escribiendo
 * PRIVACIDAD se le atiende, tiene que atenderse siempre, no casi siempre. Lo
 * mismo vale para la oposición del art. 26 fr. II, que el aviso anuncia con una
 * frase que induce otras palabras (ver `OPOSICION`).
 *
 * Tolerante con cómo se escribe de verdad en WhatsApp: mayúsculas o no, con o
 * sin acento, con signos alrededor. No hace falta que sea el mensaje entero
 * ("quiero privacidad", "PRIVACIDAD porfa").
 */
export function pideAtencionPrivacidad(texto: string): boolean {
  const t = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // quita acentos
    .toLowerCase();
  return (
    /\b(privacidad|arco|mis datos personales|dar de baja mis datos)\b/.test(t) ||
    OPOSICION.some((r) => r.test(t))
  );
}

/**
 * Respuesta al ejercicio del medio. Remite al aviso INTEGRAL de la flota, que
 * es donde por ley (art. 15 fr. V) viven los mecanismos y procedimientos ARCO.
 *
 * Likida no puede resolver un ARCO por su cuenta: es persona encargada y actúa
 * por instrucciones del responsable. Prometer aquí que "ya lo dimos de baja"
 * sería mentir sobre quién puede hacerlo.
 *
 * Y si la liga no sirve, NO se manda igual. Este es el único camino que el
 * producto le ofrece a alguien que ejerce un derecho: contestarle con una
 * dirección que no abre es dejarlo sin ejercerlo y creyendo que ya lo hizo. Se
 * le da entonces lo que sí se tiene —a quién reclamarle y dónde emplazarlo,
 * que es lo que el art. 15 fr. I persigue— y se le dice que la liga no existe.
 */
export function respuestaPrivacidad(r: DatosResponsable): string {
  const partes = [
    `Claro. El responsable de tus datos es *${r.razonSocial}*, con domicilio en ${r.domicilio}.`,
    ``,
  ];

  if (revisarAvisoIntegral(r.urlAvisoIntegral) === 'ok') {
    partes.push(
      // La oposición a la revisión automática se nombra aquí también, y no solo
      // en la rama degradada: es el único derecho que este producto activa por
      // sí mismo (art. 26 fr. II), y quien escribe suele estar ejerciéndolo
      // precisamente porque el aviso se lo acaba de anunciar. Si solo se
      // nombrara cuando la liga no sirve, el día que la flota publique su
      // integral el producto diría MENOS sobre ese derecho que hoy.
      `Ahí vienen los pasos para acceder, corregir, cancelar u oponerte al uso de tus datos (derechos ARCO), incluida la revisión automática de tus comprobantes:`,
      r.urlAvisoIntegral.trim(),
    );
  } else {
    partes.push(
      `Puedes pedirle acceder, corregir, cancelar u oponerte al uso de tus datos (derechos ARCO), incluida la revisión automática de tus comprobantes.`,
      ``,
      `La empresa todavía no publica la liga con el procedimiento, así que no tengo a dónde mandarte: te lo digo en vez de darte una dirección que no abre.`,
    );
  }

  partes.push(
    ``,
    // "Queda registrada" y no "ya le avisé": lo que ocurre es un registro que la
    // empresa consulta, no una notificación que salga hacia ella. Decir lo
    // segundo sería afirmar un estado que el producto no produce.
    `Queda registrada tu solicitud para la empresa. Tu liquidación sigue igual, esto no la afecta. 👍`,
  );
  return partes.join('\n');
}
