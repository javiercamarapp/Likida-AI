// El resumen de «sin atender» por correo, sobre el canal genérico de avisos (`enviarAvisoCorreo`). NUNCA lleva texto de mensajes ni
// teléfonos: solo grupo, prioridad, tiempo sin respuesta y motivos en categorías. Asunto fijo y sin cifras. Nunca lanza.
import { createHash } from 'node:crypto';
import { enviarAvisoCorreo, MAX_PARRAFO, type AvisoCorreo } from '@/lib/likida/avisos_correo';
import type { TurnoActual } from '../turnos';
import { resumenHabilitadoParaFlota, type EstadoResumen } from './interruptor';
import type { AlertaSinAtender, MotivoSinAtender, ResultadoSinAtender } from './motor';
import type { DestinatarioResumen } from './destinatarios';

export type MotivoNoEnviadoResumen = 'interruptor_apagado' | 'bandera_apagada' | 'flota_apagada' | 'sin_alertas' | 'sin_destinatarios' | 'sin_configurar' | 'rechazado' | 'red' | 'sin_permiso' | 'sin_fecha_corte' | 'enfriamiento';
export type ResultadoEnvioResumen = { ok: true; destinatarios: number; alertas: number; clave: string } | { ok: false; motivo: MotivoNoEnviadoResumen };

export interface EntradaResumenCorreo {
  tenantId: string;
  resultado: ResultadoSinAtender;
  destinatarios: readonly DestinatarioResumen[];
  liga: string;
  /** grupo (chatId) -> cliente dueño. Con él, quien está ligado a un cliente solo recibe SUS alertas; sin él (o sin el grupo) no recibe ninguna. */
  clienteDeChat?: ReadonlyMap<string, string>;
  /** Turno y día local del ENVÍO: junto con el contenido forman la clave de idempotencia. */
  turno: TurnoActual;
  fechaLocal: string;
}
export interface DepsResumen {
  enviar?: typeof enviarAvisoCorreo;
  habilitado?: () => Promise<EstadoResumen>;
}

export const ASUNTO_RESUMEN = 'Vigía: conversaciones sin atender';
const TOPE_LINEAS = 12;
const MAX_BLOQUES = 3;
const ETIQUETA_MOTIVO: Record<MotivoSinAtender, string> = {
  espera_sobre_umbral: 'plazo vencido', insistencia: 'el cliente insiste', urgencia: 'urgente', pregunta: 'pregunta', palabra_clave: 'tema importante',
};

export function claveDelResumen(turno: TurnoActual, fechaLocal: string, alertas: readonly AlertaSinAtender[]): string {
  return createHash('sha256').update(`${turno}|${fechaLocal}|${alertas.map((a) => a.clave).sort().join(',')}`).digest('hex').slice(0, 40);
}

const horas = (min: number): string => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

export function parrafosDelResumen(r: ResultadoSinAtender): string[] {
  const { resumen } = r;
  // Sin nada pendiente: una sola línea, sin cifras ni grupos. Solo se listan grupos con algo sin atender (el detector nunca devuelve otros).
  if (r.alertas.length === 0) return ['No hay conversaciones sin atender por ahora.'];
  const encabezado = `Hay ${resumen.alertas} conversaciones sin atender en ${resumen.chatsConAlerta} grupos (${resumen.altas} de prioridad alta). Se midió contra la hora de la última exportación de cada chat, no contra este momento.`;
  // Se empacan las líneas en a lo más MAX_BLOQUES bloques; lo que no cabe se cuenta como «resto» (nunca se descarta en silencio).
  const bloques: string[] = [];
  let actual = '';
  let incluidas = 0;
  for (const a of r.alertas.slice(0, TOPE_LINEAS)) {
    const l = `${a.nivel === 'alta' ? 'Alta' : 'Normal'} · ${a.chatNombre.slice(0, 60)}${a.critico ? ' (crítico)' : ''} · ${horas(a.antiguedadMin)} sin respuesta · ${a.motivos.map((m) => ETIQUETA_MOTIVO[m]).join(', ')}`.slice(0, MAX_PARRAFO);
    if (actual !== '' && actual.length + l.length + 1 > MAX_PARRAFO) {
      if (bloques.length + 1 >= MAX_BLOQUES) break;
      bloques.push(actual);
      actual = l;
    } else actual = actual === '' ? l : `${actual}\n${l}`;
    incluidas++;
  }
  if (actual) bloques.push(actual);
  const resto = r.alertas.length - incluidas;
  const pie = `${resto > 0 ? `Y ${resto} más en la pantalla. ` : ''}Este aviso sale de chats exportados que se subieron a Likida: no hay conexión en tiempo real. Los mensajes no se incluyen; ábrelos en la pantalla.`;
  return [encabezado, ...bloques, pie];
}

/** El mismo resultado con solo las alertas dadas y el resumen recontado (sin texto de mensajes). */
export function acotarResultado(r: ResultadoSinAtender, alertas: readonly AlertaSinAtender[]): ResultadoSinAtender {
  const porTurno = { dia: 0, noche: 0, festivo: 0 };
  for (const a of alertas) porTurno[a.turno]++;
  return {
    ...r, alertas: [...alertas],
    resumen: {
      ...r.resumen, alertas: alertas.length, chatsConAlerta: new Set(alertas.map((a) => a.chatId)).size,
      altas: alertas.filter((a) => a.nivel === 'alta').length, normales: alertas.filter((a) => a.nivel === 'normal').length,
      masAntiguaMin: alertas.length ? Math.max(...alertas.map((a) => a.antiguedadMin)) : null, porTurno,
    },
  };
}

/**
 * Reparte a los destinatarios por lo que PUEDEN ver (A2): quien está ligado a uno o más clientes solo ve las alertas de esos clientes; un
 * grupo sin cliente conocido no se le muestra (falla cerrado). Quien ve toda la flota ve todo. Quienes ven exactamente las mismas alertas
 * comparten un correo; sin alertas visibles, no se manda. Cada grupo lleva otra clave porque la clave sale de sus alertas.
 */
export function repartirPorAlcance(r: ResultadoSinAtender, destinatarios: readonly DestinatarioResumen[], clienteDeChat: ReadonlyMap<string, string> | undefined): Array<{ resultado: ResultadoSinAtender; destinatarios: DestinatarioResumen[] }> {
  const grupos = new Map<string, { alertas: AlertaSinAtender[]; destinatarios: DestinatarioResumen[] }>();
  for (const d of destinatarios) {
    const alertas = d.clientes == null ? r.alertas : r.alertas.filter((a) => { const c = clienteDeChat?.get(a.chatId); return c !== undefined && d.clientes!.includes(c); });
    if (alertas.length === 0) continue;
    const firma = alertas.map((a) => a.clave).sort().join('\u0000');
    const g = grupos.get(firma) ?? { alertas: [...alertas], destinatarios: [] };
    g.destinatarios.push(d);
    grupos.set(firma, g);
  }
  return [...grupos.values()].map((g) => ({ resultado: g.alertas.length === r.alertas.length ? r : acotarResultado(r, g.alertas), destinatarios: g.destinatarios }));
}

export async function enviarResumenSinAtender(e: EntradaResumenCorreo, deps: DepsResumen = {}): Promise<ResultadoEnvioResumen> {
  try {
    if (e.resultado.alertas.length === 0) return { ok: false, motivo: 'sin_alertas' };
    if (e.destinatarios.length === 0) return { ok: false, motivo: 'sin_destinatarios' };
    // Sin `habilitado` inyectado se comprueban TODAS las capas, incluido el interruptor propio de la flota (falla cerrado).
    const estado = await (deps.habilitado ?? (async () => {
      const { leerConfigSinAtender } = await import('../repo');
      return resumenHabilitadoParaFlota(e.tenantId, async (id) => (await leerConfigSinAtender(id)).resumenCorreoHabilitado);
    }))();
    if (!estado.ok) return { ok: false, motivo: estado.motivo };
    const grupos = repartirPorAlcance(e.resultado, e.destinatarios, e.clienteDeChat);
    if (grupos.length === 0) return { ok: false, motivo: 'sin_destinatarios' };
    // Un correo por grupo de alcance. Si uno falla se corta y se reporta; los ya enviados llevan clave propia, así que reintentar no los duplica.
    let enviados = 0;
    let claveTotal = '';
    for (const g of grupos) {
      const clave = claveDelResumen(e.turno, e.fechaLocal, g.resultado.alertas);
      claveTotal = claveTotal === '' ? clave : claveTotal;
      const aviso: AvisoCorreo = {
        tenantId: e.tenantId, agente: 'vigia', tipo: 'sin_atender', asunto: ASUNTO_RESUMEN, titulo: 'Conversaciones sin atender',
        parrafos: parrafosDelResumen(g.resultado), referencia: clave.slice(0, 8), liga: e.liga, para: g.destinatarios.map((d) => d.correo), clave,
      };
      const r = await (deps.enviar ?? enviarAvisoCorreo)(aviso);
      if (!r.ok) {
        const m = r.motivo;
        return { ok: false, motivo: m === 'sin_configurar' ? 'sin_configurar' : m === 'red' ? 'red' : m === 'sin_destinatarios' ? 'sin_destinatarios' : 'rechazado' };
      }
      enviados += r.destinatarios;
    }
    return { ok: true, destinatarios: enviados, alertas: e.resultado.alertas.length, clave: claveTotal };
  } catch {
    return { ok: false, motivo: 'red' };
  }
}
