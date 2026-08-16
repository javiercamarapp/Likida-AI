import { TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR PURO del Agente de Cobranza (0089) — separado de cobranza.ts el
// 14-ago-2026 para que la PÁGINA del agente pueda previsualizar en el
// navegador (la "vista previa del mensaje" del formulario de estrategia es
// exactamente armarMensajeCobranza corriendo en el cliente) sin arrastrar
// supabaseAdmin ni el cliente de Meta al bundle. Aquí no hay I/O: solo
// decisiones. cobranza.ts re-exporta todo esto — los llamadores del servidor
// no cambian.
// ═══════════════════════════════════════════════════════════════════════════

export interface ConfigCobranza {
  activo: boolean;
  /** Días sin comprobar a los que se insiste, ascendentes. */
  tiers: number[];
  horaInicio: number;
  horaFin: number;
  /** Días permitidos, ISO (1 = lunes … 7 = domingo). */
  diasSemana: number[];
  /** La "estrategia" del cliente: una línea extra que viaja en el mensaje. */
  instrucciones: string;
  /** Cómo firma el agente (nombre del despacho o del ejecutivo). */
  firma: string;
}

/** La conducta del 0087, como default: sin fila de config, el agente se
 *  porta EXACTAMENTE como el recordatorio de siempre (primer tier = 3 días)
 *  más los tiers de insistencia que la referencia nos enseñó a cobrar. */
export const CONFIG_COBRANZA_DEFAULT: ConfigCobranza = {
  activo: true,
  tiers: [3, 7, 14],
  horaInicio: 9,
  horaFin: 18,
  diasSemana: [1, 2, 3, 4, 5, 6],
  instrucciones: '',
  firma: '',
};

/** Valida y NORMALIZA una config que viene de un formulario. Devuelve el
 *  error en palabras de pantalla, o la config lista para guardar. */
export function validarConfigCobranza(cruda: Partial<ConfigCobranza>): { ok: ConfigCobranza } | { error: string } {
  const base = { ...CONFIG_COBRANZA_DEFAULT, ...cruda };
  const tiers = (base.tiers ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
  if (tiers.length === 0 || tiers.length > 5) {
    return { error: 'Los tiers necesitan entre 1 y 5 valores, de 1 a 60 días.' };
  }
  const ordenados = [...tiers].sort((a, b) => a - b);
  if (new Set(ordenados).size !== ordenados.length) {
    return { error: 'Los tiers no pueden repetirse.' };
  }
  const horaInicio = Number(base.horaInicio), horaFin = Number(base.horaFin);
  if (!Number.isInteger(horaInicio) || horaInicio < 0 || horaInicio > 23) return { error: 'La hora de inicio va de 0 a 23.' };
  if (!Number.isInteger(horaFin) || horaFin < 1 || horaFin > 24) return { error: 'La hora de fin va de 1 a 24.' };
  if (horaFin <= horaInicio) return { error: 'La ventana necesita terminar después de empezar.' };
  const diasSemana = (base.diasSemana ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (diasSemana.length === 0) return { error: 'El agente necesita al menos un día permitido.' };
  return {
    ok: {
      activo: Boolean(base.activo),
      tiers: ordenados,
      horaInicio,
      horaFin,
      diasSemana: [...new Set(diasSemana)].sort((a, b) => a - b),
      instrucciones: String(base.instrucciones ?? '').trim().slice(0, 300),
      firma: String(base.firma ?? '').trim().slice(0, 80),
    },
  };
}

/** ¿AHORA MISMO el agente puede contactar? Hora y día en México — la ventana
 *  es del chofer, no del servidor. */
export function dentroDeVentana(config: ConfigCobranza, ahora: Date): boolean {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MX, hour12: false, hour: 'numeric', weekday: 'short',
  }).formatToParts(ahora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '-1') % 24;
  const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dia = DIA_ISO[partes.find((p) => p.type === 'weekday')?.value ?? ''] ?? 0;
  return config.diasSemana.includes(dia) && hora >= config.horaInicio && hora < config.horaFin;
}

/** El tier que TOCA para un viaje: el mayor tier ya alcanzado por los días
 *  sin comprobar, SI supera al mayor tier ya contactado. Un contacto consume
 *  también los tiers menores — insistir es escalar, nunca repetir: sin esto,
 *  tras contactar el 14 la corrida siguiente devolvía 7 y la de después 3
 *  (el mismo cobro tres veces en tres horas — AUD3 backend ALTO). El sello
 *  viejo (0087) cuenta como el primer tier contactado — al estrenar tiers
 *  nadie recibe de nuevo el recordatorio que ya recibió. */
export function tierPendiente(
  dias: number,
  tiers: number[],
  tiersContactados: number[],
  selloViejo: boolean,
): number | null {
  const contactados = selloViejo && tiers.length > 0 ? [...tiersContactados, tiers[0]] : tiersContactados;
  const techo = contactados.length > 0 ? Math.max(...contactados) : -Infinity;
  const alcanzados = tiers.filter((t) => dias >= t && t > techo);
  return alcanzados.length > 0 ? Math.max(...alcanzados) : null;
}

/** El mensaje al CHOFER — el texto base honesto del 0087 + la línea de
 *  instrucciones del cliente + la firma. No regaña: el viaje puede estar
 *  detenido por algo que no depende de él. */
export function armarMensajeCobranza(
  folio: string | null,
  dias: number,
  config: ConfigCobranza,
): string {
  const viaje = folio ? `tu viaje *${folio}*` : 'tu viaje abierto';
  const lineas = [
    `Llevas ${dias} días con ${viaje} sin mandarme comprobantes. 📋`,
    '',
    'Mándame las fotos de tus recibos (diésel, casetas, lo que traigas) para irlos anotando.',
    'Si el viaje ya terminó y falta cerrarlo, dime y seguimos con eso.',
  ];
  if (config.instrucciones) lineas.push('', config.instrucciones);
  if (config.firma) lineas.push('', `— ${config.firma}`);
  return lineas.join('\n');
}
