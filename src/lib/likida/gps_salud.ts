// ═══════════════════════════════════════════════════════════════════════════
// SALUD DEL GPS — lógica PURA (sin base de datos): el semáforo de obsolescencia
// de una posición y el estado de una integración, con las frases que se le
// dicen a la flota. La lectura de datos vive en `gps_push/datos.ts`.
//
// Reglas de honestidad:
//  · Una posición vieja SIGUE SIENDO la última conocida: se marca obsoleta, no
//    se esconde ni se presenta como actual.
//  · «Sin datos» no es «sana»: una integración que nunca sincronizó no es verde.
//  · Un camión parado puede tener la posición vieja SIN que nada falle (los
//    dispositivos reportan al moverse); por eso el umbral de «obsoleta» es de
//    horas, no de minutos, y la frase lo dice.
// ═══════════════════════════════════════════════════════════════════════════

/** Hasta aquí, la posición es de «ahora» (el poll corre cada 5 min). */
export const MINUTOS_EN_VIVO = 30;
/** Hasta aquí, atrasada. Más allá, obsoleta. Es el umbral que ya usaba el mapa (6 h). */
export const MINUTOS_ATRASADA = 360;

export type NivelFrescura = 'en_vivo' | 'atrasada' | 'obsoleta';

export function nivelDePosicion(minutos: number): NivelFrescura {
  if (!Number.isFinite(minutos) || minutos < 0) return 'obsoleta';
  if (minutos <= MINUTOS_EN_VIVO) return 'en_vivo';
  if (minutos <= MINUTOS_ATRASADA) return 'atrasada';
  return 'obsoleta';
}

export const ROTULO_FRESCURA: Readonly<Record<NivelFrescura, string>> = {
  en_vivo: 'En vivo',
  atrasada: 'Atrasada',
  obsoleta: 'Obsoleta',
};
export const TONO_FRESCURA: Readonly<Record<NivelFrescura, 'ok' | 'warn' | 'bad'>> = {
  en_vivo: 'ok', atrasada: 'warn', obsoleta: 'bad',
};

export function contarPorFrescura(minutos: readonly number[]): Record<NivelFrescura, number> {
  const c: Record<NivelFrescura, number> = { en_vivo: 0, atrasada: 0, obsoleta: 0 };
  for (const m of minutos) c[nivelDePosicion(m)] += 1;
  return c;
}

export type ClaseFalla = 'credencial' | 'proveedor' | 'formato';

export interface SaludPoll {
  proveedor: string;
  ultimoPollEn: string | null;
  ultimoCompletoEn: string | null;
  erroresSeguidos: number;
  ultimaFalla: ClaseFalla | null;
  proximoIntentoEn: string | null;
  ultimoError: string | null;
  backlogPendiente: boolean;
}

export type EstadoIntegracion = 'sana' | 'en_espera' | 'con_falla' | 'parcial' | 'sin_sincronizar';

export interface VeredictoIntegracion { estado: EstadoIntegracion; tono: 'ok' | 'warn' | 'bad' | 'neutral'; texto: string }

const FRASE_FALLA: Record<ClaseFalla, string> = {
  credencial: 'la credencial fue rechazada o venció: hay que recapturarla en Conexiones',
  proveedor: 'el proveedor no contestó bien (caída o límite de peticiones); se reintenta solo',
  formato: 'el proveedor contestó algo distinto a lo que documenta su API (o el mapeo de campos ya no corresponde)',
};

function minutosEntre(a: number, b: string | null): number | null {
  if (!b) return null;
  const t = Date.parse(b);
  return Number.isFinite(t) ? Math.max(0, Math.round((a - t) / 60_000)) : null;
}

export function describirDuracion(minutos: number): string {
  if (minutos < 1) return 'menos de un minuto';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.round(minutos / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} días`;
}

/** El veredicto de UNA integración de GPS por poll. Falla cerrado: sin dato, no es verde. */
export function veredictoDePoll(p: SaludPoll, ahoraMs: number): VeredictoIntegracion {
  if (p.erroresSeguidos > 0 && p.ultimaFalla) {
    const espera = p.proximoIntentoEn ? Date.parse(p.proximoIntentoEn) : NaN;
    const cuando = Number.isFinite(espera) && espera > ahoraMs
      ? `Próximo intento en ${describirDuracion(Math.ceil((espera - ahoraMs) / 60_000))}.`
      : 'Se reintenta en la siguiente corrida.';
    const visto = minutosEntre(ahoraMs, p.ultimoCompletoEn);
    return {
      estado: Number.isFinite(espera) && espera > ahoraMs ? 'en_espera' : 'con_falla',
      tono: p.ultimaFalla === 'proveedor' ? 'warn' : 'bad',
      texto: `${p.erroresSeguidos} ${p.erroresSeguidos === 1 ? 'falla seguida' : 'fallas seguidas'}: ${FRASE_FALLA[p.ultimaFalla]}. ${cuando}${visto === null ? ' Nunca ha sincronizado completo.' : ` Última sincronización completa hace ${describirDuracion(visto)}.`}`,
    };
  }
  if (!p.ultimoPollEn) return { estado: 'sin_sincronizar', tono: 'neutral', texto: 'Todavía no se ha sincronizado: el primer poll corre en minutos.' };
  if (p.backlogPendiente) {
    return { estado: 'parcial', tono: 'warn', texto: `La última sincronización quedó incompleta${p.ultimoError ? ` (${p.ultimoError.slice(0, 100)})` : ''}. Suele ser dispositivos sin unidad ligada o unidades sin aviso de privacidad.` };
  }
  const hace = minutosEntre(ahoraMs, p.ultimoCompletoEn);
  return { estado: 'sana', tono: 'ok', texto: hace === null ? 'Sincronizando.' : `Sincronizó completo hace ${describirDuracion(hace)}.` };
}

export interface EstadoPushVista {
  configurado: boolean;
  ultimaRecepcionEn: string | null;
  ultimoRechazoEn: string | null;
  ultimoRechazoMotivo: string | null;
}

const MOTIVO_RECHAZO: Record<string, string> = {
  firma_invalida: 'firma inválida (secreto equivocado o cuerpo alterado)',
  reloj_desfasado: 'reloj del dispositivo desfasado más de 5 min',
  json_invalido: 'cuerpo que no es JSON',
  sobre_invalido: 'cuerpo con forma inválida',
  fallo_interno: 'falló nuestra base (el dispositivo reintenta)',
};

/** El push no tiene poll: su salud es «¿está entrando algo y qué rechazamos?». */
export function veredictoDePush(p: EstadoPushVista, ahoraMs: number): VeredictoIntegracion {
  if (!p.configurado) return { estado: 'sin_sincronizar', tono: 'neutral', texto: 'Sin secreto generado: el GPS propio todavía no puede enviar posiciones.' };
  const rec = minutosEntre(ahoraMs, p.ultimaRecepcionEn);
  const rech = minutosEntre(ahoraMs, p.ultimoRechazoEn);
  const motivo = p.ultimoRechazoMotivo ? (MOTIVO_RECHAZO[p.ultimoRechazoMotivo] ?? p.ultimoRechazoMotivo) : null;
  if (rec === null) {
    return rech === null
      ? { estado: 'sin_sincronizar', tono: 'neutral', texto: 'Secreto generado, pero todavía no llega ninguna posición.' }
      : { estado: 'con_falla', tono: 'bad', texto: `Nada ha entrado y hubo un rechazo hace ${describirDuracion(rech)}: ${motivo ?? 'motivo no registrado'}.` };
  }
  if (rech !== null && rech < rec) return { estado: 'con_falla', tono: 'warn', texto: `El último envío fue rechazado hace ${describirDuracion(rech)}: ${motivo ?? 'motivo no registrado'}. Lo último que entró fue hace ${describirDuracion(rec)}.` };
  return { estado: 'sana', tono: rec > MINUTOS_ATRASADA ? 'warn' : 'ok', texto: `Última recepción hace ${describirDuracion(rec)}.` };
}
