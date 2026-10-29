// Textos estáticos copiables del asistente (sin datos de la flota, sin secretos). Se pegan en un correo o chat:
// el secreto NUNCA viaja por aquí, solo se pide que se entregue por el canal seguro de Conexiones.

export interface NombresSolicitud {
  /** A quién va dirigida la solicitud técnica (p. ej. el nombre de la persona de TI). */
  paraTi: string;
  /** Quien firma la carta de autorización. */
  gerencia: string;
  /** Nombre de la flota, para que la carta diga de quién habla. */
  flota: string;
}

export function solicitudParaTi(n: NombresSolicitud): string {
  return [
    `Hola ${n.paraTi},`,
    '',
    `Estamos poniendo en marcha Likida para ${n.flota}. Likida va a LEER (solo lectura, nunca escribir) la información de viajes y liquidaciones de nuestro sistema de transporte. Para eso necesitamos tres cosas:`,
    '',
    '1. La dirección de la API de lectura (por ejemplo https://api.tuempresa.com) y su documentación.',
    '2. Una cuenta de servicio de SOLO LECTURA creada para Likida: sin correo personal, sin permisos de escritura.',
    '3. Autorizar en el firewall la dirección IP de salida de Likida (Likida te la comparte). Si ustedes prefieren otra vía de red, nos adaptamos.',
    '',
    'La contraseña de la cuenta de servicio no la mandes por correo ni por chat: se captura una sola vez en la pantalla Conexiones de Likida, donde queda cifrada.',
    '',
    'Mientras eso se libera seguimos con archivos de muestra, así que no hay prisa por romper nada. Gracias.',
  ].join('\n');
}

export function cartaAutorizacion(n: NombresSolicitud): string {
  return [
    `Asunto: Autorización para conectar ${n.flota} con Likida`,
    '',
    'A quien corresponda:',
    '',
    `Yo, ${n.gerencia}, autorizo al equipo de ${n.flota} a entregar a Likida accesos de SOLO LECTURA a nuestro sistema de transporte, con el único fin de armar liquidaciones, conciliar peajes y preparar borradores de Carta Porte.`,
    '',
    'Entiendo que Likida no modifica información en nuestro sistema, que las claves se guardan cifradas y que puedo pedir que se desactiven cuando quiera.',
    '',
    'Atentamente,',
    n.gerencia,
  ].join('\n');
}
