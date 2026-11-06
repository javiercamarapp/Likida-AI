// Detector de conversaciones sin atender. Puro y determinista: sin red, base, IA, logs ni Date.now().
import { createHash } from 'node:crypto';
import { turnoActual, type TurnoActual } from '../turnos';
import { segmentarHilos } from './hilos';
import { prepararMensajes } from './mensajes';
import { compilarPalabras } from './palabras';
import { ordenarAlertas } from './orden';
import { evaluarHilo } from './reglas';
import { MAX_VISTA_PREVIA } from './config';
import type { AlertaSinAtender, ChatEntrada, ConfigSinAtender, ResultadoSinAtender } from './tipos';

const reloj = (ms: number): number => (Number.isFinite(ms) ? ms : 0);

/** Teléfonos y correos fuera del recorte (el texto ya viene tapado; esto es defensa en profundidad). */
function taparDatos(texto: string): string {
  return texto
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[correo]')
    .replace(/[\d+][\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[tel]' : m));
}

/** Extracto de hasta `max` (tope duro 80) caracteres, sin datos personales evidentes; null si max = 0. Nunca el mensaje completo. */
export function extracto(texto: string, max: number): string | null {
  const tope = Math.min(MAX_VISTA_PREVIA, Math.max(0, Math.floor(max)));
  if (tope === 0) return null;
  const plano = taparDatos(texto.slice(0, 400)).replace(/\s+/g, ' ').trim();
  if (!plano) return null;
  return plano.length <= tope ? plano : `${plano.slice(0, Math.max(1, tope - 1)).trimEnd()}…`;
}

function claveDe(chatId: string, desdeMs: number, nivel: string): string {
  return createHash('sha256').update(`${chatId}|${desdeMs}|${nivel}`).digest('hex').slice(0, 32);
}

/** Un chat sin ningún mensaje del equipo no permite saber quién atiende: el motor no alerta (falla cerrado). */
export function chatSinEquipoConocido(chat: ChatEntrada, config: ConfigSinAtender): boolean {
  const { mensajes } = prepararMensajes(chat.mensajes, config.equipoHashes);
  return mensajes.length > 0 && !mensajes.some((m) => m.rol === 'equipo');
}

/** Desglose por chat/grupo a partir de las alertas (helper puro; no cambia el contrato). Ordenado por la más antigua. */
export function resumenPorChat(alertas: readonly AlertaSinAtender[]): { chatId: string; chatNombre: string; alertas: number; altas: number; masAntiguaMin: number }[] {
  const mapa = new Map<string, { chatId: string; chatNombre: string; alertas: number; altas: number; masAntiguaMin: number }>();
  for (const a of alertas) {
    const f = mapa.get(a.chatId) ?? { chatId: a.chatId, chatNombre: a.chatNombre, alertas: 0, altas: 0, masAntiguaMin: 0 };
    f.alertas += 1;
    if (a.nivel === 'alta') f.altas += 1;
    f.masAntiguaMin = Math.max(f.masAntiguaMin, a.antiguedadMin);
    mapa.set(a.chatId, f);
  }
  return [...mapa.values()].sort((x, y) => y.masAntiguaMin - x.masAntiguaMin || (x.chatId < y.chatId ? -1 : x.chatId > y.chatId ? 1 : 0));
}

/** Un chat. `ahoraMs` es el reloj; `chat.fotoMs` (si viene) manda para medir antigüedad. */
export function detectarSinAtenderChat(chat: ChatEntrada, config: ConfigSinAtender, ahoraMs: number): { alertas: AlertaSinAtender[]; ignorados: number; mensajesAnalizados: number; descartados: number; sinEquipo: boolean } {
  const { mensajes, descartados } = prepararMensajes(chat.mensajes, config.equipoHashes);
  const seg = segmentarHilos(mensajes, config.ventanaRespuestaMin, { urgentes: compilarPalabras(config.palabrasUrgentes), clave: compilarPalabras(config.palabrasClave) });
  const base = { ignorados: seg.ignorados, mensajesAnalizados: mensajes.length, descartados, sinEquipo: mensajes.length > 0 && !seg.hayEquipo };
  if (!seg.hayEquipo) return { alertas: [], ...base };

  const fotoMs = reloj(typeof chat.fotoMs === 'number' && Number.isFinite(chat.fotoMs) ? chat.fotoMs : ahoraMs);
  const alertas: AlertaSinAtender[] = [];
  for (const hilo of seg.hilos) {
    const ev = evaluarHilo(hilo, chat.critico, config, fotoMs);
    if (!ev) continue;
    const primero = hilo[0];
    const ultimo = hilo[hilo.length - 1];
    const turno: TurnoActual = turnoActual(new Date(primero.ms), config.zona, config.festivos, config.noche);
    alertas.push({
      chatId: chat.chatId,
      chatNombre: chat.nombre,
      critico: chat.critico,
      nivel: ev.nivel,
      motivos: ev.motivos,
      desde: new Date(primero.ms).toISOString(),
      ultimoEn: new Date(ultimo.ms).toISOString(),
      fotoEn: new Date(fotoMs).toISOString(),
      antiguedadMin: ev.antiguedadMin,
      umbralAplicadoMin: ev.umbralAplicadoMin,
      excesoMin: ev.excesoMin,
      mensajesSinAtender: hilo.length,
      preguntasSinAtender: ev.preguntas,
      turno,
      clave: claveDe(chat.chatId, primero.ms, ev.nivel),
      vistaPrevia: extracto(ultimo.texto, config.vistaPreviaMax),
    });
  }
  return { alertas: ordenarAlertas(alertas).slice(0, config.maxAlertasPorChat), ...base };
}

/** Todos los chats. Misma entrada (en cualquier orden) => misma salida. */
export function detectarSinAtender(chats: readonly ChatEntrada[], config: ConfigSinAtender, ahoraMs: number): ResultadoSinAtender {
  const ahora = reloj(ahoraMs);
  const todas: AlertaSinAtender[] = [];
  let ignorados = 0; let analizados = 0; let descartados = 0; let conAlerta = 0;
  const sinEquipoIds: string[] = [];
  for (const chat of chats) {
    const r = detectarSinAtenderChat(chat, config, ahora);
    ignorados += r.ignorados; analizados += r.mensajesAnalizados; descartados += r.descartados;
    if (r.alertas.length) conAlerta += 1;
    if (r.sinEquipo) sinEquipoIds.push(chat.chatId);
    todas.push(...r.alertas);
  }
  const alertas = ordenarAlertas(todas);
  const porTurno: Record<TurnoActual, number> = { dia: 0, noche: 0, festivo: 0 };
  let altas = 0; let masAntigua: number | null = null;
  for (const a of alertas) {
    porTurno[a.turno] += 1;
    if (a.nivel === 'alta') altas += 1;
    if (masAntigua === null || a.antiguedadMin > masAntigua) masAntigua = a.antiguedadMin;
  }
  return {
    ahoraEn: new Date(ahora).toISOString(),
    alertas,
    resumen: {
      chatsRevisados: chats.length, chatsConAlerta: conAlerta, alertas: alertas.length, altas, normales: alertas.length - altas,
      ignorados, mensajesAnalizados: analizados, descartados, masAntiguaMin: masAntigua, porTurno,
      chatsSinEquipo: sinEquipoIds.length, chatsSinEquipoIds: [...sinEquipoIds].sort(),
    },
  };
}

