// Helpers puros del endpoint del chat — viven FUERA de route.ts porque Next
// valida los exports de una ruta (la misma trampa que cobró con
// InicioContenido en page.tsx, 12-ago-2026) y porque así se prueban solos.
import { hoyMx } from '@/lib/formato';

/** Medianoche de HOY en México, como ISO — el día del contralor, no el UTC. */
export function inicioDiaMxIso(ms: number): string {
  const fecha = hoyMx(new Date(ms));
  // CDMX es UTC-6 fijo (sin horario de verano desde 2022).
  return new Date(`${fecha}T00:00:00-06:00`).toISOString();
}

export interface MensajeChat { rol: 'usuario' | 'asistente'; texto: string }

/** Valida y recorta el historial que manda el cliente — nunca se confía:
 *  máximo 12 turnos, 2,000 caracteres por turno, y el último habla el
 *  usuario. Cualquier otra forma es petición malformada, no "se intenta". */
export function validarMensajes(crudo: unknown): MensajeChat[] | null {
  if (!Array.isArray(crudo) || crudo.length === 0) return null;
  const ultimos = crudo.slice(-12);
  const limpios: MensajeChat[] = [];
  for (const m of ultimos) {
    const rol = (m as { rol?: unknown })?.rol;
    const texto = (m as { texto?: unknown })?.texto;
    if ((rol !== 'usuario' && rol !== 'asistente') || typeof texto !== 'string' || !texto.trim()) return null;
    limpios.push({ rol, texto: texto.trim().slice(0, 2_000) });
  }
  if (limpios[limpios.length - 1].rol !== 'usuario') return null;
  return limpios;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El id de conversación que manda el cliente: UUID o nada. Cualquier otra
 *  cosa se descarta a `null` (se abre conversación nueva) en vez de viajar
 *  a la base — el cliente no es frontera de confianza. */
export function validarConversacionId(crudo: unknown): string | null {
  return typeof crudo === 'string' && UUID.test(crudo) ? crudo : null;
}
