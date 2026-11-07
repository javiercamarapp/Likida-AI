// Preparación de mensajes: fechas ilegibles fuera, texto limpio, reclasificación por hash, dedupe y orden total.
import { limpiarTexto } from '../entrada';
import type { MensajeChat } from './tipos';

/** Milisegundos de un ISO; NaN si es ilegible. */
export function msDe(iso: unknown): number {
  return typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
}

const ORDEN_ROL = { cliente: 0, equipo: 1 } as const;

/**
 * Deduplica por (enviadoEn, autorHash, texto) —dos exportaciones solapadas del mismo chat no deben contar doble—, ordena de
 * forma total (misma salida con cualquier orden de entrada), aplica `equipoHashes` y descarta fechas ilegibles.
 * Si el mismo mensaje aparece como cliente y como equipo, gana equipo (no depende del orden).
 */
export function prepararMensajes(mensajes: readonly MensajeChat[], equipoHashes: readonly string[]): { mensajes: MensajeChat[]; descartados: number } {
  const equipo = new Set(equipoHashes.map((h) => h.toLowerCase()));
  const vistos = new Map<string, MensajeChat>();
  let descartados = 0;
  for (const m of mensajes) {
    const ms = msDe(m?.enviadoEn);
    if (!Number.isFinite(ms) || typeof m.autorHash !== 'string') { descartados += 1; continue; }
    const texto = limpiarTexto(m.texto);
    const rol = m.rol === 'equipo' || equipo.has(m.autorHash.toLowerCase()) ? 'equipo' : 'cliente';
    const clave = `${ms}|${m.autorHash}|${texto}`;
    const previo = vistos.get(clave);
    if (previo) {
      descartados += 1;
      if (rol === 'equipo') previo.rol = 'equipo';
      if (m.adjunto) previo.adjunto = true;
      continue;
    }
    vistos.set(clave, { enviadoEn: new Date(ms).toISOString(), rol, autorHash: m.autorHash, texto, ...(m.adjunto ? { adjunto: true } : {}) });
  }
  const lista = [...vistos.values()];
  lista.sort((a, b) => {
    const d = Date.parse(a.enviadoEn) - Date.parse(b.enviadoEn);
    if (d !== 0) return d;
    if (a.rol !== b.rol) return ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol];
    if (a.autorHash !== b.autorHash) return a.autorHash < b.autorHash ? -1 : 1;
    return a.texto < b.texto ? -1 : a.texto > b.texto ? 1 : 0;
  });
  return { mensajes: lista, descartados };
}
