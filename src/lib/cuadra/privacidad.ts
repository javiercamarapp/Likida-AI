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
/** Dominios enteros de plantilla: se comparan contra el HOST, no contra la URL. */
const HOSTS_DE_RELLENO = [
  'example.com', 'example.org', 'example.net', 'ejemplo.com', 'ejemplo.mx',
  'dominio.com', 'localhost', 'test.com',
];

/**
 * Palabras que solo son marcador de relleno cuando están SUELTAS.
 *
 * ── POR QUÉ NO ES UN `includes` (auditoría 6, legal) ────────────────────────
 *
 * Antes se buscaban como substring sobre la URL completa, y `'pendiente'` y
 * `'todo'` viven dentro de palabras españolas normales. Medido con el módulo
 * real, contra dominios plausibles del sector que el censo de Likida cubre:
 *
 *   https://transportistaindependiente.mx/aviso   → inservible  (in-de-PENDIENTE)
 *   https://autotransportesindependientes.com.mx  → inservible
 *   https://operadorindependiente.mx/aviso        → inservible
 *   https://metodologiatransporte.mx/aviso        → inservible  (me-TODO-logía)
 *
 * "Independiente" es exactamente como se anuncia media flota mexicana. Y el
 * coste no es cosmético: al marcar la liga inservible, el aviso simplificado
 * sale diciendo que la empresa NO ha publicado su aviso integral —una
 * afirmación falsa sobre el cumplimiento del cliente— y el operador se queda
 * sin el canal ARCO que el art. 15 fr. V exige, teniendo uno publicado.
 *
 * Con frontera de palabra, `independiente` y `metodología` pasan, y
 * `/aviso-pendiente` o `?url=todo` siguen cayendo.
 */
const PALABRAS_DE_RELLENO = [
  'tudominio', 'tu-dominio', 'midominio', 'mi-dominio',
  'changeme', 'cambiar', 'pendiente', 'por-definir', 'pordefinir', 'todo',
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

  if (HOSTS_DE_RELLENO.some((r) => host === r || host.endsWith(`.${r}`))) return 'inservible';

  // Frontera de palabra sobre la URL completa: en una dirección los separadores
  // son `/`, `-`, `_`, `.`, `?`, `=`, `&`, así que la palabra cuenta como suelta
  // cuando no está pegada a otras letras. `independiente` deja de disparar
  // `pendiente`; `/aviso-pendiente` y `?url=todo` siguen cayendo.
  const completa = s.toLowerCase();
  const suelta = (r: string) =>
    new RegExp(`(?<![a-z0-9])${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(completa);
  if (PALABRAS_DE_RELLENO.some(suelta)) return 'inservible';

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
  // AUDITORÍA 6: faltaba la conjugación más natural del español hablado. El
  // detector solo veía el presente ("me opongo") y el infinitivo con clítico
  // pegado ("oponerme"), y la forma que un operador usa de verdad es la
  // perifrástica: "me quiero oponer", "no me quiero oponer" —que también es
  // ejercicio del derecho, aunque la primera lectura despiste—, "quisiera
  // oponerme", "me voy a oponer". Sin esto, el derecho del art. 26 fr. II se
  // pierde sin dejar rastro: el mensaje pasa al agente como una frase normal.
  //
  // El clítico va SUELTO y antes del verbo, que es donde el español lo pone en
  // la perífrasis, así que `\boponerme\b` no puede casarlo.
  /\bme\s+(?:\w+\s+){0,3}opon(?:go|er|ga)\b/,
  // Solo con el clítico. `opongo` a secas no es ejercicio del derecho —"opongo
  // mi camión al muro" lo disparaba— y la forma real siempre lo lleva.
  /\bopon(?:erme|erse)\b/,
  /\boposicion\b/,
  /\bno\s+(?:quiero|autorizo|acepto)\s+que\s+(?:me\s+)?(?:revisen|analicen|usen|traten)\b/,
  /\brevision humana\b/,
];

/**
 * AUDITORÍA 8, ALTO: "que lo revise una persona" es sintácticamente idéntica
 * tanto para oponerse a una decisión automatizada (art. 26 fr. II) como para
 * pedirle a alguien que revise un ticket mal leído por el OCR — el motivo de
 * queja más común de este producto. Estos dos patrones son AMBIGUOS a
 * propósito, y solo cuentan como oposición si el mensaje NO trae vocabulario
 * de "esto es sobre un papel, no sobre mí" (ver `OBJETO_DE_PAPEL` abajo). Se
 * separan de `OPOSICION` —que sigue siendo inequívoca— para no perder
 * cobertura ahí.
 */
const OPOSICION_AMBIGUA: RegExp[] = [
  /\bque (lo |la )?(revise|revisen|vea|vean) (un |una )?(persona|humano|humana|alguien|gente)\b/,
  /\b(un|una) (persona|humano|humana|gente) (lo |la )?(revise|vea|revisara)\b/,
];

/** El objeto de la revisión es un PAPEL, no una decisión sobre la persona. */
const OBJETO_DE_PAPEL = /\b(ticket|folio|comprobante|recibo|factura|foto|imagen|lectura)\b/;

/**
 * AUDITORÍA 9, ALTO: `OBJETO_DE_PAPEL` cerró el falso positivo de la ronda 8
 * (la queja de ticket) abriendo un falso negativo del otro lado — el que el
 * aviso mismo induce con estas palabras: *"Tienes derecho a oponerte a que se
 * decida así [un programa] y a pedir que la revise alguien."* Quien contesta
 * "que lo revise una persona **en vez del programa**" está nombrando lo que
 * se está revisando —es inevitable, la revisión automatizada ES sobre
 * comprobantes— y ESO no puede seguir descalificando la oposición.
 *
 * La distinción no es "menciona un papel", es "rechaza explícitamente lo
 * automatizado". "que revise una persona el folio porque el sistema lo leyó
 * mal" solo describe un error (`sistema` es el sujeto de una queja, no algo
 * que se rechaza); "que lo revise una persona, no el programa" SÍ lo rechaza.
 * Con el contraste explícito presente, `OBJETO_DE_PAPEL` deja de excluir.
 */
const RECHAZA_AUTOMATIZADO = /\b(?:no\s+(?:el\s+|un\s+|confio\s+en\s+el\s+)?(?:programa|sistema|robot|bot)\b|en\s+vez\s+del?\s+(?:programa|sistema))/;

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
    OPOSICION.some((r) => r.test(t)) ||
    (OPOSICION_AMBIGUA.some((r) => r.test(t)) && (!OBJETO_DE_PAPEL.test(t) || RECHAZA_AUTOMATIZADO.test(t)))
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

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO INTEGRAL. 31-jul-2026.
//
// Faltaba entero. `tenant.url_aviso_privacidad` apuntaba a
// `transportesinnovativos.mx`, que responde NXDOMAIN: el operador recibía una
// liga rota, y la respuesta a *PRIVACIDAD* tenía que confesar que no había a
// dónde mandarlo. El art. 16 fr. II obliga a "señalar el sitio donde se podrá
// consultar el aviso integral", y no había sitio.
//
// Seis de los once elementos del checklist (docs/conocimiento/11-datos-
// personales.md §5.4) viven SOLO en el integral, así que sin él no existían en
// ningún lado:
//
//     5   procedimiento ARCO ................... art. 15 fr. V
//     6   cómo se comunican los cambios ........ art. 15 fr. VI
//     7   cláusula de transferencias ........... art. 35
//     8   revocación del consentimiento ........ art. 7 último párr.; Regl. 21
//     10  contacto de datos personales ......... art. 29
//     11  oposición al tratamiento automatizado  art. 26 fr. II
//
// ── POR QUÉ LO ALOJA LIKIDA Y NO LA FLOTA ─────────────────────────────────
//
// El responsable es la FLOTA (art. 14) y Likida es persona encargada (art. 2
// fr. XX). Pero el obligado de la fr. II es señalar un sitio, no ser el dueño
// del dominio: alojarlo aquí no traslada la responsabilidad, igual que un
// despacho que publica el aviso de su cliente no se vuelve el responsable. El
// texto lo dice en la primera línea, para que quien lo lea sepa a quién le
// reclama.
//
// La alternativa era esperar a que cada flota publique el suyo. Eso es lo que
// llevaba dos meses sin pasar, y mientras tanto el operador recibía una liga
// muerta — que ante la autoridad es peor que no señalar ninguna, porque
// aparenta cumplimiento.
//
// ── LO QUE ESTE TEXTO NO PUEDE INVENTAR ───────────────────────────────────
//
// El contacto del art. 29 es un dato de la flota. Si no está capturado, la
// sección lo DICE en vez de rellenarla con el chat de WhatsApp y dar por
// cumplido el artículo. Es el mismo criterio que ya rige a la liga rota:
// decirle la verdad al titular cumple más que una dirección que no abre.
// ═══════════════════════════════════════════════════════════════════════════

/** Una sección del integral. `pendiente` = falta un dato de la flota. */
export interface SeccionAviso {
  titulo: string;
  /** Fundamento legal, para que quien lo revise pueda comprobarlo. */
  fundamento: string;
  parrafos: string[];
  /** Cierto cuando la flota no ha capturado lo que la sección necesita. */
  pendiente?: boolean;
}

/** Datos del integral: los del simplificado más el contacto del art. 29. */
export interface DatosIntegral extends DatosResponsable {
  /** Persona o departamento de datos personales. Art. 29. */
  contactoPrivacidad?: string | null;
}

/**
 * El aviso integral de una flota, sección por sección.
 *
 * Devuelve datos y no HTML a propósito: así se puede probar el CONTENIDO —que
 * los once elementos estén, que ninguno se invente— sin renderizar una página.
 * La vista solo lo pinta.
 */
export function avisoIntegral(r: DatosIntegral): SeccionAviso[] {
  const razonSocial = r.razonSocial.trim();
  const domicilio = r.domicilio.trim();
  const contacto = r.contactoPrivacidad?.trim();

  return [
    {
      titulo: 'Quién es responsable de tus datos',
      fundamento: 'LFPDPPP art. 15 fr. I',
      parrafos: [
        `**${razonSocial}**, con domicilio en ${domicilio}, es la responsable de tus datos personales. A ella le reclamas y ante ella ejerces tus derechos.`,
        `Likida opera la herramienta con la que se procesan: es **persona encargada** (art. 2 fr. XX), trata los datos por cuenta de la empresa y siguiendo sus instrucciones, y no decide sobre ellos. Este aviso está alojado en el sitio de Likida por encargo de la empresa; eso no cambia quién responde.`,
      ],
    },
    {
      titulo: 'Qué datos se tratan',
      fundamento: 'LFPDPPP art. 15 fr. II',
      parrafos: [
        `Tu **nombre** y tu **número de teléfono**.`,
        `Las **fotos de comprobantes** que envías por WhatsApp —diésel, casetas, alimentación, hospedaje, refacciones— y lo que viene escrito en ellas: montos, fechas, folios, RFC del establecimiento y datos fiscales del comprobante.`,
        `El **contenido de tus mensajes** en esa conversación, y los **viajes y liquidaciones** en los que participas.`,
        `**No se tratan datos sensibles.** Ni salud, ni origen racial o étnico, ni creencias, ni afiliación sindical, ni preferencias sexuales, ni datos biométricos. Si en una foto aparece algo así por accidente, no se usa para nada y puedes pedir que se borre.`,
      ],
    },
    {
      titulo: 'Para qué se usan',
      fundamento: 'LFPDPPP art. 15 fr. III',
      parrafos: [
        `**Finalidades necesarias — sin ellas no puede haber liquidación:**`,
        `· Liquidar tus viajes: cuadrar lo que gastaste contra el anticipo que recibiste y emitir el documento de liquidación.`,
        `· Comprobar los gastos ante el SAT y conservar los comprobantes fiscales el tiempo que la ley obliga (Código Fiscal de la Federación art. 30: cinco años).`,
        `· Responderte por WhatsApp.`,
        `**Finalidades que NO son necesarias, y a las que puedes oponerte sin que eso afecte tu liquidación:**`,
        `· Revisar si un comprobante viene repetido o alterado, comparándolo contra los de tus viajes anteriores, y entregarle ese resultado a la empresa.`,
        `· Medir cómo funciona el servicio para mejorarlo (estadísticas de uso, sin identificarte en los reportes).`,
        `Cualquier finalidad que no esté escrita aquí requiere que te vuelvan a pedir permiso. La ley vigente ya no permite ampararse en usos "compatibles o análogos".`,
      ],
    },
    {
      titulo: 'Un programa revisa tus comprobantes, y puedes oponerte',
      fundamento: 'LFPDPPP art. 26 fr. II',
      parrafos: [
        `La revisión de tus comprobantes —si están repetidos, si el monto de la foto no coincide con el del comprobante fiscal, si la fecha cae fuera del viaje— **la hace un programa, sin que una persona la mire antes**.`,
        `Ese resultado llega a la empresa y puede influir en cómo te liquidan. Por eso tienes derecho a **oponerte a que se decida así** y a pedir que una persona lo revise.`,
        `Oponerte a esta revisión no detiene tu liquidación: la empresa la hará a mano.`,
      ],
    },
    {
      titulo: 'Cómo limitar el uso de tus datos',
      fundamento: 'LFPDPPP art. 15 fr. IV',
      parrafos: [
        `Escribe **PRIVACIDAD** por el mismo chat de WhatsApp. Tu solicitud queda registrada para la empresa y tu liquidación sigue igual.`,
        `También puedes pedirlo directamente en el domicilio de la empresa que aparece arriba.`,
      ],
    },
    {
      titulo: 'Cómo ejercer tus derechos ARCO',
      fundamento: 'LFPDPPP art. 15 fr. V',
      parrafos: [
        `Tienes derecho a **Acceder** a tus datos, **Rectificarlos** si están mal, **Cancelarlos** cuando ya no deban tratarse y **Oponerte** a un uso concreto.`,
        `**Cómo:** escribe PRIVACIDAD por WhatsApp, o preséntalo por escrito en el domicilio de la empresa. Tu solicitud debe traer tu nombre, un medio para contestarte, copia de una identificación oficial, qué datos son y qué pides que se haga con ellos.`,
        `**Plazos de la ley:** la empresa tiene **20 días hábiles** para contestarte y **15 días hábiles** más para hacerlo efectivo si procede. Ejercerlos es gratuito; solo puedes tener que pagar el envío o la copia.`,
        `Si no te contestan o la respuesta no te satisface, puedes acudir a la autoridad garante en materia de protección de datos personales.`,
      ],
    },
    {
      titulo: 'Cómo revocar tu consentimiento',
      fundamento: 'LFPDPPP art. 7 último párrafo; Reglamento art. 21',
      parrafos: [
        `Puedes retirar tu consentimiento en cualquier momento, por el mismo medio: escribe **PRIVACIDAD** por WhatsApp o preséntalo en el domicilio de la empresa.`,
        `**Lo que la revocación no alcanza:** los comprobantes fiscales que ya se usaron para liquidar viajes pasados. La ley obliga a la empresa a conservarlos cinco años (CFF art. 30), y esa obligación no se puede revocar. Se te dice aquí para que no te sorprenda después.`,
        `Revocar el consentimiento significa dejar de usar este canal para liquidar; la empresa te dirá por qué otro medio hacerlo.`,
      ],
    },
    {
      titulo: 'Transferencias a terceros',
      fundamento: 'LFPDPPP art. 35',
      // AUDITORÍA 8, ALTO: decía "contratados con retención cero", una garantía
      // contractual que nadie negoció con OpenRouter — `data_collection: 'deny'`
      // (openrouter.ts) es una preferencia de ruteo que se PIDE en cada llamada,
      // no un contrato de Zero Data Retention firmado. El texto ahora describe
      // lo que el código hace (pedirlo), no lo que no se ha confirmado (que se
      // cumpla del lado del proveedor).
      parrafos: [
        `**Tus datos no se venden, ni se comparten con nadie para que los use por su cuenta.**`,
        `Sí pasan por proveedores que trabajan por instrucción de la empresa y no pueden usarlos para otra cosa —lo que la ley llama personas encargadas, y que **no es una transferencia** (art. 2 fr. XX)—: el proveedor de mensajería de WhatsApp, el de alojamiento de la base de datos, y los modelos de lenguaje que leen las fotos, a los que en cada llamada se les pide explícitamente que no retengan lo que procesan.`,
        `Transferencias que sí lo son y no necesitan tu consentimiento: a la autoridad fiscal cuando la ley lo exige, y al contador de la empresa para cumplir sus obligaciones.`,
        `**Si algún día se quisiera transferir tus datos para algo distinto, se te pedirá permiso antes.** No hacer nada al leer esto no cuenta como haber aceptado.`,
      ],
    },
    {
      titulo: 'A quién dirigirte en la empresa',
      fundamento: 'LFPDPPP art. 29',
      pendiente: !contacto,
      parrafos: contacto
        ? [
            contacto,
            `También puedes escribir **PRIVACIDAD** por WhatsApp y tu solicitud queda registrada.`,
          ]
        : [
            `**La empresa todavía no ha designado a la persona o departamento de datos personales que el art. 29 exige.** Se dice aquí en vez de dejarlo en blanco o de poner un contacto que no existe.`,
            `Mientras tanto, el camino que sí funciona: escribe **PRIVACIDAD** por WhatsApp, o preséntalo en el domicilio de la empresa que aparece arriba.`,
          ],
    },
    {
      titulo: 'Cómo te avisamos si este aviso cambia',
      fundamento: 'LFPDPPP art. 15 fr. VI',
      parrafos: [
        `Cuando este aviso cambie, **recibes el aviso nuevo por el mismo WhatsApp**, sin que tengas que venir a revisarlo.`,
        `No es una promesa: el sistema calcula una firma del texto y reenvía en cuanto deja de coincidir con la última que se te entregó. Por eso un cambio aquí llega solo.`,
        `En esta página siempre está la versión vigente.`,
      ],
    },
  ];
}
