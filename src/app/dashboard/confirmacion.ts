// ═══════════════════════════════════════════════════════════════════════════
// ¿EL CHOFER YA DIJO QUE SÍ? — las cuatro marcas de la 0058, leídas.
//
// La migración 0058 le puso cuatro columnas a `viaje` (`avisado_en`,
// `aceptado_en`, `escalado_en`, `avisos_enviados`) y NINGUNA se veía en el
// panel: el jefe seguía sin saber si el chofer contestó, que es justo el hueco
// que la 0058 abrió para tapar.
//
// ── POR QUÉ ESTO ES UN MÓDULO PURO Y NO UN `?:` DENTRO DE LA TABLA ─────────
//
// Porque la decisión tiene cinco ramas y cada una es una afirmación distinta
// sobre la operación de alguien. `estado.ts` nació del mismo motivo: dos
// booleanos dentro del componente que nadie podía probar. Aquí se separa la
// DECISIÓN del render para poder fijarla con pruebas, sin base y sin navegador.
//
// ── LOS CINCO ESTADOS, Y POR QUÉ SON CINCO Y NO CUATRO ────────────────────
//
// Los cuatro que se pidieron —sin avisar, esperando, confirmado, escalado—
// salen de leer las tres marcas de tiempo. El quinto sale de una pregunta que
// el dato no puede contestar: `avisado_en` es NULL tanto cuando el aviso FALLÓ
// (número mal, WhatsApp caído) como en TODO viaje anterior al 4-ago-2026, que
// es cuando la columna empezó a existir. Pintar los dos casos del mismo rojo
// llenaría la pantalla de alarmas falsas el primer día, y una columna que
// siempre grita se aprende a ignorar en dos días.
//
// Se separan por el ÚNICO dato que de verdad los distingue, y no por una fecha
// de corte escrita a mano: si el viaje sigue `abierto`, la alarma es correcta
// aunque sea viejo —está vivo y la escalación de las 5 h NO LO VE, porque
// filtra por `avisado_en no es null` (`escalar_viaje.ts:64`)—. Si el viaje ya
// pasó a `en_cuadre` o `liquidado`, arrancó igual: lo que falta es el registro,
// no el chofer, y eso se dice en gris sin acusar a nadie.
//
// NINGÚN RÓTULO AFIRMA MÁS DE LO QUE LA BASE SABE. "Sin avisar" dice que no hay
// registro del aviso; no dice que el chofer no se enteró (pudo llamarle el jefe
// por teléfono). El detalle que se pinta es la consecuencia comprobable —"la
// escalación no lo ve"—, no una conjetura sobre lo que pasó en la carretera.
// ═══════════════════════════════════════════════════════════════════════════

import { fechaHoraMx } from '@/lib/formato';
import type { Estado } from '../admin/ui/kit';

/** Las cuatro columnas de la 0058 más el estatus, que es lo que decide si un
 *  viaje sin aviso sigue vivo o ya arrancó por otro lado. */
export interface MarcasViaje {
  estatus: string;
  avisadoEn: string | null;
  aceptadoEn: string | null;
  escaladoEn: string | null;
  avisosEnviados: number;
}

export type ClaveConfirmacion =
  | 'confirmado'    // el chofer contestó que sí
  | 'sin_avisar'    // viaje ABIERTO sin registro de aviso: no escala solo
  | 'sin_registro'  // sin aviso, pero el viaje ya avanzó: falta el dato, no el chofer
  | 'escalado'      // se pasó el plazo y ya se le avisó al jefe
  | 'esperando';    // avisado, sin respuesta todavía

export interface Confirmacion {
  clave: ClaveConfirmacion;
  /** Lo que dice la píldora. Cabe en una celda y es literalmente cierto. */
  label: string;
  estado: Estado;
  /** Segunda línea de la celda: la hora, el tiempo transcurrido o la
   *  consecuencia. Nunca una conjetura. */
  detalle: string;
}

/**
 * Cuánto tiempo pasó, en palabras. Vive AQUÍ y no en `lib/formato.ts` a
 * propósito: aquel archivo es la fuente única de las cifras que el contralor
 * cruza contra su PDF (pesos, litros, fechas de corte) y ninguna duración
 * aparece en un PDF. Esto es copy de pantalla, no una cifra fiscal.
 *
 * Un timestamp en el FUTURO no se aplana a "hace un momento": eso convertiría
 * un reloj desfasado —o una marca puesta a mano— en un dato que se lee normal.
 * Se dice que está en el futuro y se acabó.
 */
export function transcurrido(desdeIso: string, ahora: Date): string {
  const t = Date.parse(desdeIso);
  if (Number.isNaN(t)) return 'fecha ilegible';
  const ms = ahora.getTime() - t;
  if (ms < 0) return 'con fecha futura';

  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;

  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `hace ${h} h ${m} min` : `hace ${h} h`;

  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `hace ${d} d ${hr} h` : `hace ${d} d`;
}

/** "· 2 avisos" — el conteo de la cuarta columna, o nada si no hay ninguno. */
function conAvisos(base: string, n: number): string {
  if (!Number.isFinite(n) || n < 1) return base;
  return `${base} · ${n} aviso${n === 1 ? '' : 's'}`;
}

/**
 * El estado de confirmación de UN viaje.
 *
 * EL ORDEN DE LAS RAMAS IMPORTA. `aceptado_en` se mira PRIMERO porque es el
 * único hecho que no se puede desmentir: solo se escribe cuando el chofer
 * contesta. Un viaje escalado a las 5 h y confirmado a las 6 sale "Confirmado"
 * —que es lo que el jefe necesita saber— y el detalle no esconde que se escaló.
 *
 * `ahora` se inyecta para que la prueba no dependa del reloj de la máquina,
 * igual que `viajesSinAceptar()` en `escalar_viaje.ts`.
 */
export function confirmacionDeViaje(v: MarcasViaje, ahora: Date = new Date()): Confirmacion {
  if (v.aceptadoEn) {
    return {
      clave: 'confirmado',
      label: 'Confirmado',
      estado: 'ok',
      // Si se había escalado, se dice: el jefe ya movió algo por ese aviso y
      // enseñarle "Confirmado" a secas lo dejaría creyendo que no pasó nada.
      detalle: v.escaladoEn
        ? `${fechaHoraMx(v.aceptadoEn)} · se había escalado`
        : fechaHoraMx(v.aceptadoEn),
    };
  }

  if (!v.avisadoEn) {
    // Vivo y sin aviso registrado: el caso urgente. `escalar_viaje.ts` filtra
    // por `estatus = 'abierto'` Y `avisado_en no es null`, así que este viaje
    // no está en ninguna cola — o lo ve un humano aquí, o no lo ve nadie.
    if (v.estatus === 'abierto') {
      return {
        clave: 'sin_avisar',
        label: 'Sin avisar',
        estado: 'bad',
        detalle: 'la escalación no lo ve',
      };
    }
    return {
      clave: 'sin_registro',
      label: 'Sin registro',
      estado: 'neutral',
      detalle: 'el viaje ya avanzó',
    };
  }

  if (v.escaladoEn) {
    return {
      clave: 'escalado',
      label: 'Escalado',
      estado: 'bad',
      detalle: conAvisos(`jefe avisado ${fechaHoraMx(v.escaladoEn)}`, v.avisosEnviados),
    };
  }

  return {
    clave: 'esperando',
    label: 'Esperando confirmación',
    estado: 'warn',
    detalle: conAvisos(`avisado ${transcurrido(v.avisadoEn, ahora)}`, v.avisosEnviados),
  };
}

export interface ResumenConfirmacion {
  sinAvisar: number;
  esperando: number;
  confirmados: number;
  escalados: number;
  sinRegistro: number;
}

/**
 * Los conteos de la tira de arriba. Se calculan SOBRE LAS FILAS QUE SE PINTAN,
 * no con una consulta aparte: `getViajes` trae como máximo 100 viajes, y un
 * conteo hecho por otro camino diría un número que no cuadra con lo que se ve
 * abajo. El rótulo de la sección dice sobre cuántos viajes está contando.
 */
export function resumenConfirmacion(viajes: MarcasViaje[], ahora: Date = new Date()): ResumenConfirmacion {
  const r: ResumenConfirmacion = { sinAvisar: 0, esperando: 0, confirmados: 0, escalados: 0, sinRegistro: 0 };
  for (const v of viajes) {
    switch (confirmacionDeViaje(v, ahora).clave) {
      case 'sin_avisar': r.sinAvisar += 1; break;
      case 'esperando': r.esperando += 1; break;
      case 'confirmado': r.confirmados += 1; break;
      case 'escalado': r.escalados += 1; break;
      case 'sin_registro': r.sinRegistro += 1; break;
    }
  }
  return r;
}
