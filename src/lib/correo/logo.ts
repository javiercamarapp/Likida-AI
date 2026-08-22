// ⚠️ GENERADO desde public/images/logo.png — no editar a mano.
// Para regenerar:  node -e "…" (ver el comentario de plantilla.ts)
//
// El logo VIAJA CON EL CORREO como adjunto en línea (CID), no se enlaza. Un
// <img src="https://…"> depende de que el cliente autorice imágenes externas,
// y Gmail las bloquea por defecto para remitentes nuevos: el logo llegó roto la
// primera vez justo por eso, aunque el archivo respondía HTTP 200. Incrustado
// no hay red que fallar. Son 4.5 KB por correo — el precio de que la marca
// aparezca siempre.
// El PNG en sí es un ACTIVO DE MARCA (lib/marca/logo.ts, auditoría 18 B1):
// aquí se re-exporta para el correo, que lo adjunta en línea (CID).
export { LOGO_PNG_BASE64 } from '@/lib/marca/logo';

/** El id con el que el HTML lo referencia: <img src="cid:LOGO_CID">. */
export const LOGO_CID = 'likida-logo';
export const LOGO_NOMBRE = 'likida.png';
