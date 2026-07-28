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
 * Arma el aviso simplificado, o devuelve `null` si a la flota le falta algún
 * dato.
 *
 * Null y no un texto a medias: un aviso con el responsable equivocado —o sin
 * él— es peor que no tenerlo, porque justo lo que el aviso sirve para decir es a
 * quién reclamarle. Que falte se resuelve configurando el tenant; que esté mal
 * no se resuelve, porque nadie lo nota.
 */
export function avisoSimplificado(r: DatosResponsable): string | null {
  const razonSocial = r.razonSocial?.trim();
  const domicilio = r.domicilio?.trim();
  const url = r.urlAvisoIntegral?.trim();
  if (!razonSocial || !domicilio || !url) return null;

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
    // Fr. III — finalidades.
    `Para qué: liquidar los viajes y comprobar los gastos ante el SAT. Nada más.`,
    ``,
    // Fr. IV — opciones y medios para limitar el uso o divulgación.
    `Cómo limitarlo o ejercer tus derechos ARCO: escribe *PRIVACIDAD* por este chat y te pasamos con la empresa.`,
    ``,
    // Encargada. No es transferencia (art. 2 fr. XX excluye a la persona
    // encargada), pero el operador tiene derecho a saber por dónde pasan sus
    // fotos, y decirlo cuesta un renglón.
    `Likida procesa esta información por cuenta de la empresa, siguiendo sus instrucciones.`,
    ``,
    // Art. 16 fr. II — señalar dónde está el integral.
    `Aviso completo: ${url}`,
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
 * ¿El operador está ejerciendo el medio que el aviso le prometió?
 *
 * Determinístico y ANTES del agente, a propósito. Un derecho ARCO no se deja a
 * que el LLM decida si el mensaje "califica": si el aviso dice que escribiendo
 * PRIVACIDAD se le atiende, tiene que atenderse siempre, no casi siempre.
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
  return /\b(privacidad|arco|mis datos personales|dar de baja mis datos)\b/.test(t);
}

/**
 * Respuesta al ejercicio del medio. Remite al aviso INTEGRAL de la flota, que
 * es donde por ley (art. 15 fr. V) viven los mecanismos y procedimientos ARCO.
 *
 * Likida no puede resolver un ARCO por su cuenta: es persona encargada y actúa
 * por instrucciones del responsable. Prometer aquí que "ya lo dimos de baja"
 * sería mentir sobre quién puede hacerlo.
 */
export function respuestaPrivacidad(r: DatosResponsable): string {
  return [
    `Claro. El responsable de tus datos es *${r.razonSocial}*.`,
    ``,
    `Ahí vienen los pasos para acceder, corregir, cancelar u oponerte al uso de tus datos (derechos ARCO):`,
    r.urlAvisoIntegral,
    ``,
    `Ya le avisé a la empresa que lo preguntaste. Tu liquidación sigue igual, esto no la afecta. 👍`,
  ].join('\n');
}
