// ═══════════════════════════════════════════════════════════════════════════
// LOS DOCUMENTOS QUE SE ACEPTAN Y SUS VERSIONES (auditoría ola 1, #48).
//
// `aceptacion_legal` (0443) guarda QUÉ versión de QUÉ documento aceptó quién y
// cuándo. Las versiones viven aquí, a mano, y se suben cuando el texto CAMBIA:
//
//   · 'terminos'          → src/app/terminos/page.tsx
//   · 'aviso_privacidad'  → src/app/privacidad/page.tsx (el aviso de LIKIDA al
//                           cliente; el aviso al chofer lo versiona
//                           `versionAviso` en lib/likida/privacidad.ts, otro registro)
//   · 'mandato_autofacturacion' → el texto de abajo, que es el MISMO párrafo que
//                           publica /terminos §2 (una prueba lo exige).
//
// Subir la versión de Términos o Aviso hace que el dueño vea de nuevo el aviso de
// «acepta la versión vigente» en el panel. Subir la del MANDATO retira de facto
// el mandato de todas las flotas (el candado compara versión exacta): la emisión
// vuelve a ensayo hasta que cada dueño acepte el texto nuevo — que es lo que debe
// pasar si el texto de una autorización cambia.
//
// El texto del mandato NO lo redactó este archivo: es el que ya publicaba
// /terminos (auditoría 10 señaló que no pasó por revisión legal; PENDIENTES-ABOGADO).
// Registrarlo por flota no sustituye esa revisión: solo deja la evidencia de quién
// lo aceptó y con qué texto.
// ═══════════════════════════════════════════════════════════════════════════

export type DocumentoLegal = 'terminos' | 'aviso_privacidad' | 'mandato_autofacturacion';

export const VERSION_TERMINOS = '2026-10-01';
export const VERSION_AVISO_PRIVACIDAD = '2026-10-01';

export const MANDATO_AUTOFACTURACION = {
  version: 'm-2026-10-01',
  /** Huella SHA-256 (hex) de `texto`; `documentos.test.ts` exige que coincida. */
  hashSha256: '9ac1c8c6cb637fd6dacc517a9973a097d626c75c9bad2d28472c07b4a816b3ac',
  texto:
    'Likida sí puede obtener el CFDI de un gasto en nombre de la empresa, cuando la empresa lo autoriza y aporta sus datos fiscales. No timbra ella misma —el comprobante lo emite el PAC del proveedor a través de su propio portal—: lo que Likida hace es operar ese portal por cuenta de la empresa, con el RFC, la razón social, el régimen, el código postal y el uso de CFDI que la propia empresa capturó. La empresa mandata expresamente esa gestión al activarla; puede desactivarla cuando quiera, y sigue siendo la responsable de que sus datos fiscales sean correctos. Donde un portal exige verificación humana —una cuenta con contraseña, un CAPTCHA— Likida no la rodea: prepara todo y le pasa a la persona la liga con los datos listos.',
} as const;

export const ETIQUETA_DOCUMENTO: Record<DocumentoLegal, string> = {
  terminos: 'Términos de Servicio',
  aviso_privacidad: 'Aviso de Privacidad',
  mandato_autofacturacion: 'Mandato de autofacturación',
};

/** La versión vigente de cada documento. */
export function versionVigente(d: DocumentoLegal): string {
  switch (d) {
    case 'terminos': return VERSION_TERMINOS;
    case 'aviso_privacidad': return VERSION_AVISO_PRIVACIDAD;
    case 'mandato_autofacturacion': return MANDATO_AUTOFACTURACION.version;
  }
}
