// ═══════════════════════════════════════════════════════════════════════════
// CLIENTE POR REMITENTE (OLA1-A3) — de quién viene el documento → a qué cliente de la flota pertenece.
//
// Por qué existe: todo el catálogo por cliente (número interno, SKU → clave SAT, remitentes y destinatarios con RFC,
// distancias) solo se aplica cuando el documento trae `cliente_id`. Hasta hoy solo lo traía la subida manual con el
// cliente elegido; los documentos de correo y de WhatsApp quedaban sin cliente y salían con huecos.
//
// Regla (conservadora, sin adivinar): el cliente se fija SOLO si el remitente apunta a UN cliente.
//   1. Coincidencia exacta con el correo de contacto del cliente (`cliente.correo`, puede traer varios).
//   2. Si no, el dominio del remitente igual al dominio del correo de UN solo cliente. Los dominios de correo público
//      (gmail, hotmail…) NUNCA identifican a un cliente: el dominio lo comparte medio mundo.
//   3. Dos o más clientes con el mismo correo o dominio = ambiguo = sin cliente (una persona lo asigna en el visor).
//
// PURO: sin E/S. Quien llama trae los clientes de la flota (con tope) y decide qué hacer con `null`.
// ═══════════════════════════════════════════════════════════════════════════

export interface ClienteContacto { id: string; correo: string | null }

export type ViaCliente = 'correo' | 'dominio';

export type ResolucionCliente =
  | { clienteId: string; via: ViaCliente }
  | { clienteId: null; motivo: 'sin_remitente' | 'sin_coincidencia' | 'ambiguo' | 'dominio_publico' };

/** Dominios de correo de uso general: nunca identifican a una empresa cliente. */
export const DOMINIOS_PUBLICOS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.mx', 'hotmail.es', 'outlook.com', 'outlook.es', 'outlook.com.mx', 'live.com', 'live.com.mx',
  'msn.com', 'yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'prodigy.net.mx', 'telmexmail.com', 'zoho.com', 'mail.com',
]);

const CORREO = /[a-z0-9._%+\-']+@[a-z0-9.\-]+\.[a-z]{2,}/gi;

/** Todos los correos que aparecen en un texto (`Ana <ana@x.com>; luis@x.com`), en minúsculas y sin repetir. */
export function correosEn(texto: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(texto ?? '').matchAll(CORREO)) out.add(m[0].toLowerCase());
  return [...out];
}

export const dominioDeCorreo = (correo: string): string => correo.slice(correo.lastIndexOf('@') + 1).toLowerCase();

/** El remitente de un correo reenviado a mano o pegado por WhatsApp: la línea `De:` / `From:` del encabezado, si la trae. */
export function remitenteDeEncabezado(texto: string | null | undefined): string | null {
  const m = /^[ \t]*(?:de|from)[ \t]*:[ \t]*(.{3,300})$/im.exec(String(texto ?? '').slice(0, 4000));
  if (!m) return null;
  return correosEn(m[1])[0] ?? null;
}

export function resolverClientePorRemitente(remitente: string | null | undefined, clientes: readonly ClienteContacto[]): ResolucionCliente {
  const del = correosEn(remitente)[0];
  if (!del) return { clienteId: null, motivo: 'sin_remitente' };

  const porCorreo = new Set<string>();
  const porDominio = new Set<string>();
  const dominio = dominioDeCorreo(del);
  for (const c of clientes) {
    for (const correo of correosEn(c.correo)) {
      if (correo === del) porCorreo.add(c.id);
      if (dominioDeCorreo(correo) === dominio) porDominio.add(c.id);
    }
  }
  if (porCorreo.size === 1) return { clienteId: [...porCorreo][0], via: 'correo' };
  if (porCorreo.size > 1) return { clienteId: null, motivo: 'ambiguo' };
  if (DOMINIOS_PUBLICOS.has(dominio)) return { clienteId: null, motivo: 'dominio_publico' };
  if (porDominio.size === 1) return { clienteId: [...porDominio][0], via: 'dominio' };
  if (porDominio.size > 1) return { clienteId: null, motivo: 'ambiguo' };
  return { clienteId: null, motivo: 'sin_coincidencia' };
}
