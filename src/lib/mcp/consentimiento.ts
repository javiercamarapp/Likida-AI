// ═══════════════════════════════════════════════════════════════════════════
// LAS REGLAS DE LA PANTALLA DE CONSENTIMIENTO MCP — puras, para poder probarlas.
//
// AUDITORÍA OLA 1, #2 (consent phishing). La pantalla /mcp/autorizar pintaba
// «¿Dejar que Claude lea los datos de tu flota?» con el nombre que eligió quien
// se registró, y NO decía a dónde viajaría el código. Estas funciones son lo
// que la pantalla y su server action comparten, para que la regla no viva dos
// veces:
//
//   · `perfilDeDestino` — a qué host irá el código y si Likida lo conoce;
//   · `requiereConfirmacionReforzada` — con el área de DINERO en el alcance, el
//     clic no basta: la persona escribe el host de destino (un enlace de
//     phishing la obliga a LEER el dominio al que entregaría el código);
//   · `evaluarConsentimiento` — la decisión del server action, que re-valida
//     todo (los hidden inputs son mensajería, no autoridad).
// ═══════════════════════════════════════════════════════════════════════════

import { anfitrionDeUri, redirectUriDeConfianza, type EstadoCliente } from './oauth';

export interface PerfilDestino {
  /** host[:puerto], tal cual se le enseña a la persona. */
  host: string;
  /** Solo el nombre de host (sin puerto): lo que se teclea en la confirmación. */
  hostname: string;
  /** ¿Es un destino de la lista de Likida (claude.ai, chatgpt.com…) o loopback? */
  conocido: boolean;
  /** Loopback: el código no sale de la máquina de quien consiente. */
  loopback: boolean;
}

export function perfilDeDestino(redirectUri: string): PerfilDestino | null {
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return null;
  }
  const host = anfitrionDeUri(redirectUri);
  if (!host) return null;
  const loopback = u.protocol === 'http:';
  return { host, hostname: u.hostname, conocido: redirectUriDeConfianza(redirectUri), loopback };
}

/** El área de dinero (cuadres, facturación, estado fiscal) exige confirmación
 *  reforzada; operación y administración, solo el clic. */
export function requiereConfirmacionReforzada(areas: readonly string[]): boolean {
  return areas.includes('dinero');
}

/** ¿Lo que tecleó la persona es EXACTAMENTE el host de destino? (sin distinguir
 *  mayúsculas, espacios ni punto final; sin aceptar subcadenas). */
export function confirmacionValida(redirectUri: string, texto: string | null | undefined): boolean {
  const perfil = perfilDeDestino(redirectUri);
  if (!perfil || typeof texto !== 'string') return false;
  const limpio = texto.trim().toLowerCase().replace(/\.$/, '');
  return limpio.length > 0 && (limpio === perfil.hostname.toLowerCase() || limpio === perfil.host.toLowerCase());
}

export type VeredictoConsentimiento =
  | { ok: true }
  | { ok: false; motivo: 'cliente_no_aprobado' | 'destino_invalido' | 'falta_confirmacion' };

/** La decisión del server action al pulsar «Autorizar». */
export function evaluarConsentimiento(p: {
  estadoCliente: EstadoCliente;
  areas: readonly string[];
  redirectUri: string;
  confirmacion: string | null | undefined;
}): VeredictoConsentimiento {
  if (p.estadoCliente !== 'aprobado') return { ok: false, motivo: 'cliente_no_aprobado' };
  if (!perfilDeDestino(p.redirectUri)) return { ok: false, motivo: 'destino_invalido' };
  if (requiereConfirmacionReforzada(p.areas) && !confirmacionValida(p.redirectUri, p.confirmacion)) {
    return { ok: false, motivo: 'falta_confirmacion' };
  }
  return { ok: true };
}
