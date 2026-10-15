// ═══════════════════════════════════════════════════════════════════════════
// PENDIENTES DESDE EL CHAT EXPORTADO — mensajes del cliente que el equipo no contestó.
//
// Requisito (reunión del 14-oct, 12:06): «algo que reconozca la importancia de los mensajes y todo lo demás me lo quite».
// Los grupos no se leen en vivo (docs/operacion/vigia-grupos-decision.md): la única vía real de priorizarlos es la
// exportación que el dueño sube. Esto es una FOTO DEL MOMENTO DE LA EXPORTACIÓN, no un tablero en vivo: la antigüedad se
// mide contra el último mensaje del archivo, nunca contra el reloj de hoy.
//
// PURO y determinista. Reutiliza `prioridadDe` (qué se ignora y qué es alta) y las mismas ventanas que `analisis.ts`.
// PRIVACIDAD: el texto ya llega con teléfonos y correos tapados y el autor solo como hash (`export_whatsapp.ts`);
// este módulo no recibe ni devuelve autores.
// ═══════════════════════════════════════════════════════════════════════════
import { prioridadDe, type MotivoPrioridad, type NivelPrioridad } from '../prioridad';
import type { MensajeHistorial } from './export_whatsapp';

/** Misma ventana que `analizarHistorial`: una respuesta del equipo más allá de esto ya no cuenta como respuesta a ese mensaje. */
export const VENTANA_RESPUESTA_MIN = 60;
export const MAX_TEXTO_PENDIENTE = 240;

export type EntradaPendientes = Pick<MensajeHistorial, 'enviadoEn' | 'rol' | 'texto'> & { grupo?: string };

export interface Pendiente {
  texto: string;
  /** 2 alta (urgencia o pregunta) · 1 normal. Los de nivel 0 (cortesía, monitoreo) nunca llegan aquí. */
  nivel: Exclude<NivelPrioridad, 0>;
  motivos: MotivoPrioridad[];
  /** Minutos entre el mensaje y el último mensaje de la exportación. */
  antiguedadMin: number;
  enviadoEn: string;
  grupo: string | null;
}

export interface ResultadoPendientes {
  pendientes: Pendiente[];
  /** Mensajes del cliente ignorados por la prioridad (gracias, monitoreo, stickers…): se cuentan, no se muestran. */
  ignorados: number;
  /** Instante del último mensaje de la exportación (la «foto»); `null` si el archivo está vacío. */
  fotoEn: string | null;
}

export function pendientesDeHistorial(entrada: readonly EntradaPendientes[], opciones: { ventanaMin?: number } = {}): ResultadoPendientes {
  const ventana = opciones.ventanaMin ?? VENTANA_RESPUESTA_MIN;
  const msgs = [...entrada].sort((a, b) => (a.enviadoEn < b.enviadoEn ? -1 : a.enviadoEn > b.enviadoEn ? 1 : 0));
  if (msgs.length === 0) return { pendientes: [], ignorados: 0, fotoEn: null };
  const fotoEn = msgs[msgs.length - 1].enviadoEn;
  const fotoMs = Date.parse(fotoEn);

  const pendientes: Pendiente[] = [];
  let ignorados = 0;
  msgs.forEach((m, i) => {
    if (m.rol !== 'cliente') return;
    const p = prioridadDe(m.texto);
    if (p.nivel === 0) { ignorados += 1; return; }
    const ms = Date.parse(m.enviadoEn);
    const respondido = msgs.slice(i + 1).some((r) => r.rol === 'equipo' && (Date.parse(r.enviadoEn) - ms) / 60_000 <= ventana);
    if (respondido) return;
    pendientes.push({
      texto: m.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_PENDIENTE),
      nivel: p.nivel,
      motivos: p.motivos,
      antiguedadMin: Math.max(0, Math.round((fotoMs - ms) / 60_000)),
      enviadoEn: m.enviadoEn,
      grupo: m.grupo ?? null,
    });
  });
  // Alta primero; dentro de ella la urgencia declarada (ASAP, «urgente») antes que la simple pregunta; luego el que lleva más esperando.
  const urgente = (p: Pendiente) => (p.motivos.includes('urgencia') ? 1 : 0);
  pendientes.sort((a, b) => b.nivel - a.nivel || urgente(b) - urgente(a) || b.antiguedadMin - a.antiguedadMin || a.texto.localeCompare(b.texto));
  return { pendientes, ignorados, fotoEn };
}
