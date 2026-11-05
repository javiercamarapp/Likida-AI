// El resumen de «sin atender» por correo, sobre el canal genérico de avisos (`enviarAvisoCorreo`). NUNCA lleva texto de mensajes ni
// teléfonos: solo grupo, prioridad, tiempo sin respuesta y motivos en categorías. Asunto fijo y sin cifras. Nunca lanza.
import { createHash } from 'node:crypto';
import { enviarAvisoCorreo, MAX_PARRAFO, type AvisoCorreo } from '@/lib/likida/avisos_correo';
import type { TurnoActual } from '../turnos';
import { resumenHabilitado, type EstadoResumen } from './interruptor';
import type { AlertaSinAtender, MotivoSinAtender, ResultadoSinAtender } from './motor';
import type { DestinatarioResumen } from './destinatarios';

export type MotivoNoEnviadoResumen = 'interruptor_apagado' | 'bandera_apagada' | 'sin_alertas' | 'sin_destinatarios' | 'sin_configurar' | 'rechazado' | 'red' | 'sin_permiso' | 'sin_fecha_corte';
export type ResultadoEnvioResumen = { ok: true; destinatarios: number; alertas: number; clave: string } | { ok: false; motivo: MotivoNoEnviadoResumen };

export interface EntradaResumenCorreo {
  tenantId: string;
  resultado: ResultadoSinAtender;
  destinatarios: readonly DestinatarioResumen[];
  liga: string;
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

export async function enviarResumenSinAtender(e: EntradaResumenCorreo, deps: DepsResumen = {}): Promise<ResultadoEnvioResumen> {
  try {
    if (e.resultado.alertas.length === 0) return { ok: false, motivo: 'sin_alertas' };
    if (e.destinatarios.length === 0) return { ok: false, motivo: 'sin_destinatarios' };
    const estado = await (deps.habilitado ?? resumenHabilitado)();
    if (!estado.ok) return { ok: false, motivo: estado.motivo };
    const clave = claveDelResumen(e.turno, e.fechaLocal, e.resultado.alertas);
    const aviso: AvisoCorreo = {
      tenantId: e.tenantId, agente: 'vigia', tipo: 'sin_atender', asunto: ASUNTO_RESUMEN, titulo: 'Conversaciones sin atender',
      parrafos: parrafosDelResumen(e.resultado), referencia: clave.slice(0, 8), liga: e.liga, para: e.destinatarios.map((d) => d.correo), clave,
    };
    const r = await (deps.enviar ?? enviarAvisoCorreo)(aviso);
    if (r.ok) return { ok: true, destinatarios: r.destinatarios, alertas: e.resultado.alertas.length, clave };
    const m = r.motivo;
    return { ok: false, motivo: m === 'sin_configurar' ? 'sin_configurar' : m === 'red' ? 'red' : m === 'sin_destinatarios' ? 'sin_destinatarios' : 'rechazado' };
  } catch {
    return { ok: false, motivo: 'red' };
  }
}
