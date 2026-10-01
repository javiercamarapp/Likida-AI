import { estaResuelto, TIPOS_HITO, indiceHito, type HitoFila, type TipoHito } from './tipos';
import { dentroDeVentana, type ConfigConductor } from './config';
import { hitoActivo } from './maquina';
import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// CUÁNDO TOCA PEDIR, PERSEGUIR Y ESCALAR — decisión pura, sin I/O.
//
// El cron (ejecutor.ts) lee el estado, llama a `planificar` y ejecuta lo que
// esto dice. Aquí viven las reglas que NO pueden fallar en silencio:
//
//   · SOLO SE PERSIGUE EL HITO ACTIVO (el primero pendiente de la secuencia).
//   · EL ANCLA de cada hito sale de la cita/ETA del viaje y de los hitos
//     previos; sin cita se usan los plazos por defecto de la flota (supuestos).
//   · LA ESCALERA (0/+15/+30/+45 min por defecto) manda UN mensaje por corrida
//     como máximo y SIEMPRE el nivel más alto ya vencido: insistir es escalar,
//     nunca repetir (si el cron estuvo caído no se manda el recordatorio 1, el 2
//     y el 3 de golpe).
//   · NUNCA FUERA DE LA VENTANA de la flota (de madrugada no se insiste), ni más
//     de `topeDiarioChofer` mensajes al día a un mismo chofer.
//   · ESCALAR: después de la escalera (90 min), al patio responsable; si nadie
//     lo atiende tras `segundoNivelMin`, al jefe general. «Ya lo atiendo» lo detiene.
// ═══════════════════════════════════════════════════════════════════════════

export interface AvisoReclamado {
  clase: 'solicitud' | 'recordatorio' | 'escalacion' | 'confirmacion' | 'aviso_oficina';
  nivel: number;
  /** El claim es del ciclo ACTUAL del hito. */
  ciclo: number;
}

export type MotivoNada =
  | 'viaje_no_aplica' | 'flota_apagada' | 'completo' | 'sin_ancla' | 'no_toca'
  | 'espera' | 'fuera_de_ventana' | 'tope_diario' | 'atendido' | 'ya_escalado';

export type AccionPlan =
  | { tipo: 'chofer'; hito: HitoFila; clase: 'solicitud' | 'recordatorio'; nivel: number; minutosPendiente: number; ancla: Date }
  | { tipo: 'escalar'; hito: HitoFila; nivel: 1 | 2; minutosPendiente: number; motivo: 'sin_respuesta' | 'sin_telefono'; ancla: Date }
  | { tipo: 'nada'; motivo: MotivoNada };

export interface EntradaPlan {
  viaje: ViajeContexto;
  hitos: readonly HitoFila[];
  config: ConfigConductor;
  ahora: Date;
  /** Mensajes proactivos (solicitud/recordatorio) que ESTE chofer ya recibió hoy (día de México). */
  enviadosHoyChofer: number;
  /** Los avisos ya reclamados para los hitos de este viaje (cualquier ciclo). */
  avisos: readonly (AvisoReclamado & { hitoId: string })[];
}

const ms = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);

/** La hora del hito registrado: la del mensaje del chofer; si no hay, la de recepción. */
function horaDe(h: HitoFila | undefined): number | null {
  if (!h || !estaResuelto(h)) return null;
  return ms(h.mensajeEn) ?? ms(h.recibidoEn);
}

/** El último hito registrado ANTES de `tipo` en la secuencia (su hora ancla al siguiente). */
function horaPrevia(hitos: readonly HitoFila[], tipo: TipoHito): { tipo: TipoHito; t: number } | null {
  for (let i = indiceHito(tipo) - 1; i >= 0; i--) {
    const h = hitos.find((x) => x.tipo === TIPOS_HITO[i]);
    const t = horaDe(h);
    if (t !== null) return { tipo: TIPOS_HITO[i], t };
  }
  return null;
}

/**
 * El instante desde el cual el hito «toca». `null` = no hay ancla (el viaje no ha
 * sido aceptado y no hay nada de qué colgarse): el cron no lo persigue todavía.
 */
export function anclaDe(
  hito: HitoFila, viaje: ViajeContexto, hitos: readonly HitoFila[], config: ConfigConductor,
): Date | null {
  const min = 60_000;
  const aceptado = ms(viaje.aceptadoEn);
  const previa = horaPrevia(hitos, hito.tipo);
  let ancla: number | null = null;

  switch (hito.tipo) {
    case 'llegada_carga': {
      const cita = ms(viaje.citaOrigenEn) ?? ms(viaje.etaOrigenEn);
      if (cita !== null) ancla = cita - config.anticipoCitaMin * min;
      else if (aceptado !== null) ancla = aceptado + config.esperaSinCitaMin * min;
      if (ancla !== null && aceptado !== null) ancla = Math.max(ancla, aceptado);
      break;
    }
    case 'salida_carga':
      if (previa) ancla = previa.t + config.esperaCargaMin * min;
      break;
    case 'llegada_descarga': {
      const cita = ms(viaje.citaDestinoEn) ?? ms(viaje.etaDestinoEn);
      if (cita !== null) ancla = cita - config.anticipoCitaMin * min;
      else if (previa) ancla = previa.t + config.trayectoSinEtaMin * min;
      // Nunca antes de que se haya salido de la carga.
      if (ancla !== null && previa) ancla = Math.max(ancla, previa.t);
      break;
    }
    case 'salida_descarga':
      if (previa) ancla = previa.t + config.esperaDescargaMin * min;
      break;
    case 'regreso':
      if (previa) ancla = previa.t + config.regresoMin * min;
      break;
  }
  // Sin hito previo registrado y sin cita (p. ej. el primero se omitió): se cuelga de la aceptación.
  if (ancla === null && aceptado !== null) {
    const base = hito.tipo === 'llegada_carga' ? config.esperaSinCitaMin : config.trayectoSinEtaMin;
    ancla = aceptado + base * min;
  }
  if (ancla === null) return null;
  const pospuesto = ms(hito.pospuestoHasta);
  if (pospuesto !== null) ancla = Math.max(ancla, pospuesto);
  return new Date(ancla);
}

/** `N minutos` / `1 hora` / `1 hora y 5 minutos`: lo que lee el chofer en el recordatorio. */
export function textoTiempo(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return m === 1 ? '1 minuto' : `${m} minutos`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  const horas = h === 1 ? '1 hora' : `${h} horas`;
  return r === 0 ? horas : `${horas} y ${r === 1 ? '1 minuto' : `${r} minutos`}`;
}

/** Qué hacer ahora con un viaje. Pura y determinista. */
export function planificar(e: EntradaPlan): AccionPlan {
  const { viaje, hitos, config, ahora } = e;
  if (!config.activo) return { tipo: 'nada', motivo: 'flota_apagada' };
  if (viaje.estatus !== 'abierto') return { tipo: 'nada', motivo: 'viaje_no_aplica' };

  const hito = hitoActivo(hitos);
  if (!hito) return { tipo: 'nada', motivo: 'completo' };

  const ancla = anclaDe(hito, viaje, hitos, config);
  if (!ancla) return { tipo: 'nada', motivo: 'sin_ancla' };
  if (ahora.getTime() < ancla.getTime()) return { tipo: 'nada', motivo: 'no_toca' };
  const transcurridos = (ahora.getTime() - ancla.getTime()) / 60_000;

  if (!dentroDeVentana(config, ahora)) return { tipo: 'nada', motivo: 'fuera_de_ventana' };

  // El jefe ya dijo «ya lo atiendo»: ni a él ni al chofer se les insiste.
  if (hito.escalacionAtendidaEn) return { tipo: 'nada', motivo: 'atendido' };

  const mios = e.avisos.filter((a) => a.hitoId === hito.id && a.ciclo === hito.ciclo);
  const choferEnviados = mios.filter((a) => a.clase === 'solicitud' || a.clase === 'recordatorio').map((a) => a.nivel);
  const escalaciones = new Set(mios.filter((a) => a.clase === 'escalacion').map((a) => a.nivel));
  const tieneTelefono = Boolean(viaje.operadorTelefono);

  // ── 1. ESCALAR, cuando la escalera ya se agotó (o no había a quién escribirle) ──
  const yaSeLeEscribio = choferEnviados.length > 0 || !tieneTelefono;
  if (yaSeLeEscribio && transcurridos >= config.escalarTrasMin) {
    const motivo = tieneTelefono ? 'sin_respuesta' as const : 'sin_telefono' as const;
    if (!escalaciones.has(1)) {
      return { tipo: 'escalar', hito, nivel: 1, minutosPendiente: Math.floor(transcurridos), motivo, ancla };
    }
    if (!escalaciones.has(2) && transcurridos >= config.escalarTrasMin + config.segundoNivelMin) {
      return { tipo: 'escalar', hito, nivel: 2, minutosPendiente: Math.floor(transcurridos), motivo, ancla };
    }
    return { tipo: 'nada', motivo: 'ya_escalado' };
  }

  // ── 2. EL CHOFER: la escalera, un mensaje por corrida y el nivel más alto vencido ──
  if (!tieneTelefono) return { tipo: 'nada', motivo: 'espera' };
  const ultimoEnviado = choferEnviados.length > 0 ? Math.max(...choferEnviados) : -1;
  let nivel = -1;
  config.solicitudesMin.forEach((offset, k) => {
    if (offset <= transcurridos && k > ultimoEnviado) nivel = k;
  });
  if (nivel < 0) return { tipo: 'nada', motivo: 'espera' };
  if (e.enviadosHoyChofer >= config.topeDiarioChofer) return { tipo: 'nada', motivo: 'tope_diario' };
  return {
    tipo: 'chofer', hito, clase: nivel === 0 ? 'solicitud' : 'recordatorio', nivel,
    minutosPendiente: Math.floor(transcurridos), ancla,
  };
}
