// ═══════════════════════════════════════════════════════════════════════════
// TEMPORAL-INTEGRACION — NO ES EL MOTOR REAL.
//
// El carril «motor» construye en paralelo `../sin_atender/` (config, detectar, orden…). Este archivo solo existe para que el
// carril «avisos» compile y se pruebe sin esperarlo: tiene las MISMAS firmas públicas del contrato y una lógica mínima.
// El integrador lo BORRA y cambia el import de `./motor.ts` por `'../sin_atender'`. Nadie debe construir sobre este archivo.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { TZ_MX } from '@/lib/formato';
import { NOCHE_POR_OMISION, turnoActual } from '../turnos';
import { prioridadDe } from '../prioridad';
import type { AlertaSinAtender, ChatEntrada, ConfigSinAtender, ResultadoSinAtender } from '../sin_atender/tipos';

export const CONFIG_SIN_ATENDER_POR_OMISION: ConfigSinAtender = {
  umbralMin: 30, umbralCriticoMin: 10, umbralUrgenteMin: 10, insistenciaMin: 2, insistenciaVentanaMin: 120,
  palabrasUrgentes: [], palabrasClave: ['embarque', 'embarques'], equipoHashes: [], ventanaRespuestaMin: null,
  zona: TZ_MX, festivos: [], noche: { ...NOCHE_POR_OMISION }, maxAlertasPorChat: 3, vistaPreviaMax: 0,
};

const acotar = (v: unknown, min: number, max: number, por: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : por);

export function normalizarConfigSinAtender(entrada: Partial<ConfigSinAtender> | null | undefined): { config: ConfigSinAtender; avisos: string[] } {
  const b = CONFIG_SIN_ATENDER_POR_OMISION;
  const e = entrada ?? {};
  return {
    config: {
      ...b, ...e,
      umbralMin: acotar(e.umbralMin, 1, 1440, b.umbralMin), umbralCriticoMin: acotar(e.umbralCriticoMin, 1, 1440, b.umbralCriticoMin),
      umbralUrgenteMin: acotar(e.umbralUrgenteMin, 1, 1440, b.umbralUrgenteMin), insistenciaMin: acotar(e.insistenciaMin, 0, 50, b.insistenciaMin),
      insistenciaVentanaMin: acotar(e.insistenciaVentanaMin, 1, 10080, b.insistenciaVentanaMin),
      maxAlertasPorChat: acotar(e.maxAlertasPorChat, 1, 20, b.maxAlertasPorChat), vistaPreviaMax: acotar(e.vistaPreviaMax, 0, 400, b.vistaPreviaMax),
      palabrasUrgentes: (e.palabrasUrgentes ?? b.palabrasUrgentes).slice(0, 30), palabrasClave: (e.palabrasClave ?? b.palabrasClave).slice(0, 30),
      equipoHashes: (e.equipoHashes ?? b.equipoHashes).slice(0, 200), festivos: e.festivos ?? b.festivos,
      noche: e.noche ?? b.noche, zona: e.zona ?? b.zona, ventanaRespuestaMin: e.ventanaRespuestaMin ?? null,
    },
    avisos: [],
  };
}

export function validarConfigSinAtender(entrada: unknown): { ok: true; valor: ConfigSinAtender } | { ok: false; error: string } {
  if (!entrada || typeof entrada !== 'object') return { ok: false, error: 'La configuración no es válida.' };
  const e = entrada as Record<string, unknown>;
  for (const [campo, nombre, min, max] of [['umbralMin', 'El plazo normal', 1, 1440], ['umbralCriticoMin', 'El plazo de clientes críticos', 1, 1440], ['umbralUrgenteMin', 'El plazo de lo urgente', 1, 1440], ['insistenciaMin', 'Las veces que insiste el cliente', 0, 50]] as const) {
    const v = e[campo];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return { ok: false, error: `${nombre} debe ser un número entre ${min} y ${max}.` };
  }
  return { ok: true, valor: normalizarConfigSinAtender(e as Partial<ConfigSinAtender>).config };
}

/** Mínimo: los mensajes del cliente al final del chat que ningún mensaje del equipo siguió, medidos contra la foto. */
export function detectarSinAtender(chats: readonly ChatEntrada[], config: ConfigSinAtender, ahoraMs: number): ResultadoSinAtender {
  const alertas: AlertaSinAtender[] = [];
  const equipo = new Set(config.equipoHashes);
  let analizados = 0;
  let ignorados = 0;
  for (const chat of chats) {
    const ms = chat.mensajes.map((m) => ({ m, t: Date.parse(m.enviadoEn) })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    analizados += ms.length;
    const cola: typeof ms = [];
    for (const x of ms) {
      if (x.m.rol === 'equipo' || equipo.has(x.m.autorHash)) cola.length = 0;
      else if (prioridadDe(x.m.texto, { adjunto: x.m.adjunto === true }).nivel > 0) cola.push(x);
      else ignorados++;
    }
    if (cola.length === 0) continue;
    const foto = chat.fotoMs ?? ahoraMs;
    const primero = cola[0];
    const ultimo = cola[cola.length - 1];
    const antiguedadMin = Math.max(0, Math.floor((foto - primero.t) / 60_000));
    const umbral = chat.critico ? config.umbralCriticoMin : config.umbralMin;
    const urgente = cola.some((x) => prioridadDe(x.m.texto).motivos.includes('urgencia'));
    const aplicado = urgente ? Math.min(umbral, config.umbralUrgenteMin) : umbral;
    if (antiguedadMin < aplicado) continue;
    const nivel = urgente ? 'alta' : 'normal';
    alertas.push({
      chatId: chat.chatId, chatNombre: chat.nombre, critico: chat.critico, nivel, motivos: urgente ? ['urgencia', 'espera_sobre_umbral'] : ['espera_sobre_umbral'],
      desde: primero.m.enviadoEn, ultimoEn: ultimo.m.enviadoEn, fotoEn: new Date(foto).toISOString(), antiguedadMin, umbralAplicadoMin: aplicado,
      excesoMin: Math.max(0, antiguedadMin - aplicado), mensajesSinAtender: cola.length, preguntasSinAtender: cola.filter((x) => x.m.texto.includes('?')).length,
      turno: turnoActual(new Date(primero.t), config.zona, config.festivos, config.noche),
      clave: createHash('sha256').update(`${chat.chatId}|${primero.t}|${nivel}`).digest('hex').slice(0, 32),
      vistaPrevia: config.vistaPreviaMax > 0 ? ultimo.m.texto.slice(0, config.vistaPreviaMax) : null,
    });
  }
  alertas.sort((a, b) => (a.nivel === b.nivel ? b.antiguedadMin - a.antiguedadMin || a.chatId.localeCompare(b.chatId) : a.nivel === 'alta' ? -1 : 1));
  const porTurno = { dia: 0, noche: 0, festivo: 0 };
  for (const a of alertas) porTurno[a.turno]++;
  return {
    ahoraEn: new Date(ahoraMs).toISOString(), alertas,
    resumen: {
      chatsRevisados: chats.length, chatsConAlerta: new Set(alertas.map((a) => a.chatId)).size, alertas: alertas.length,
      altas: alertas.filter((a) => a.nivel === 'alta').length, normales: alertas.filter((a) => a.nivel === 'normal').length, ignorados,
      mensajesAnalizados: analizados, descartados: 0, masAntiguaMin: alertas.length ? Math.max(...alertas.map((a) => a.antiguedadMin)) : null, porTurno,
    },
  };
}
