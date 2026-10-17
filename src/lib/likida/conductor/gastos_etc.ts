import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import type { BotonAcuse } from '@/lib/meta/client';
import type { ConfigConductor } from './config';
import type { PuertosConductor } from './ejecutor';
import { puertosReales } from './ejecutor';
import type { ViajeContexto } from './repo';
import type { Salida } from './mensajes';
import type { MensajeSaliente } from './solicitudes';
import { PREFIJO_BOTON } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-51 — PREGUNTA PRE-VIAJE DE GASTOS / ETC (R07).
//
// Requisito del cliente (reunión 15-oct, audio ~23:09–23:56): «antes de que inicie el viaje, cuando le dan los gastos de viaje, que le llegue
// un mensaje al operador: si va a querer gastos de viaje o ETC, para que se le genere el vale; y si no, no se le genere». Lo pide el coordinador
// y lo DIFIERE él mismo («pero ya vemos ese proceso»): P2, no bloquea nada, y NO emite ni calcula ningún vale.
//
// ── CÓMO ENCAJA ────────────────────────────────────────────────────────────
//   · Salida: al ACEPTAR el viaje (`asignacion.ts → responderAsignacion`, ya con sus instrucciones enviadas) y SOLO si la flota tiene la perilla
//     `gastosEtcActiva`, sale la plantilla N03 `viaje_gastos_etc_v1` con «Sí, necesito gastos» (`gastos_si`) y «No necesito» (`gastos_no`).
//     Un viaje se acepta una sola vez (la base lo decide), así que la pregunta sale una sola vez. Si no sale o el chofer no contesta, NADA se
//     retiene: ni la aceptación, ni las instrucciones, ni la salida del viaje.
//   · Entrada: `atender.ts` lee los dos botones y llama a `responderGastos`, que guarda la respuesta por el puerto `guardar`.
//   · Nunca se pide un monto ni se calcula nada (guardia de la ficha).
//
// ── RULINGS (reversibles) ──────────────────────────────────────────────────
//   · Dónde se guarda: la ficha pide guardarla EN EL VIAJE y exponerla en `/v1`. `viaje` no tiene columna para eso y el slot de migración lo
//     decide la orquestadora (preguntas-javier.md, T-A5-51). Hasta entonces el puerto real devuelve `sin_almacen` SIN tocar la base y la
//     respuesta del chofer dice solo «recibí tu respuesta» (no finge que quedó anotada). Con la perilla apagada por omisión (fase 2) nadie
//     recibe la pregunta, así que no hay chofer contestando a ciegas. Costo si me equivoco: cambiar el cuerpo de `guardar` real.
//   · El botón se atiende aunque la perilla se apague después de mandar N03 (no dejar un botón muerto), igual que T-A5-47.
//   · «Qué es ETC» y cómo se emite el vale es la definición externa D-7: aquí solo se pregunta y se guarda si/no.
// ═══════════════════════════════════════════════════════════════════════════

export type RespuestaGastos = 'si' | 'no';
export type ResultadoGuardarGastos = 'guardado' | 'ya_respondio' | 'sin_almacen' | 'no_encontrado' | 'fallo';

const una = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** La pregunta N03: texto con dos botones dentro de la ventana de 24 h, la plantilla `viaje_gastos_etc_v1` si ya cerró. Pura. */
export function armarPreguntaGastos(v: Pick<ViajeContexto, 'id' | 'folio' | 'operadorNombre'>): MensajeSaliente {
  const folio = una(v.folio, 30) || v.id.slice(0, 8);
  const nombre = una(v.operadorNombre, 40).split(' ')[0] || 'chofer';
  const botones: BotonAcuse[] = [
    { id: `${PREFIJO_BOTON.gastosSi}:${v.id}`, titulo: 'Sí, necesito gastos' },
    { id: `${PREFIJO_BOTON.gastosNo}:${v.id}`, titulo: 'No necesito' },
  ];
  return {
    texto: `Hola ${nombre}, antes de iniciar el viaje ${folio} necesitamos saber si requieres gastos de viaje o ETC para generar tu vale. Elige una opción.`,
    botones,
    plantilla: {
      nombre: 'viaje_gastos_etc_v1',
      ...opcionesDeEnvio('viaje_gastos_etc_v1', { cuerpo: [nombre, folio], idsBotones: v.id }),
    },
  };
}

export interface PuertosGastos extends Pick<PuertosConductor, 'enviar'> {
  /** Guarda la respuesta en el viaje, una sola vez (la primera vale). Puede lanzar: quien llama lo atrapa. */
  guardar(tenantId: string, viajeId: string, operadorId: string, respuesta: RespuestaGastos, ahora: Date): Promise<ResultadoGuardarGastos>;
}

/**
 * Manda la pregunta si la flota tiene la perilla. Nunca lanza y nunca retiene nada: devuelve si salió (o quedó en cola).
 * Quien llama (la aceptación del viaje) ignora el resultado más allá del registro.
 */
export async function preguntarGastosAlAceptar(
  enviar: PuertosGastos['enviar'], config: Partial<Pick<ConfigConductor, 'gastosEtcActiva'>>,
  v: Pick<ViajeContexto, 'id' | 'tenantId' | 'folio' | 'operadorNombre'>, telefono: string, ahora: Date,
): Promise<boolean> {
  if (config.gastosEtcActiva !== true) return false;
  try {
    const r = await enviar(telefono, armarPreguntaGastos(v), 'conductor.gastos_etc_pregunta', v.tenantId, ahora);
    if (!r.ok && !r.encolado) logger.warn('conductor.gastos_etc_pregunta_no_salio', { viaje: v.id, motivo: r.motivo });
    return r.ok || !!r.encolado;
  } catch (err) {
    logger.warn('conductor.gastos_etc_pregunta_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export interface EntradaGastos {
  viaje: Pick<ViajeContexto, 'id' | 'tenantId' | 'folio' | 'operadorId'>;
  respuesta: RespuestaGastos;
  ahora: Date;
}

const FALLO: Salida = { texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' };

/** La respuesta del chofer a la pregunta. Nunca lanza. */
export async function responderGastos(p: PuertosGastos, x: EntradaGastos): Promise<Salida[]> {
  const folio = una(x.viaje.folio, 30) || x.viaje.id.slice(0, 8);
  try {
    const r = await p.guardar(x.viaje.tenantId, x.viaje.id, x.viaje.operadorId, x.respuesta, x.ahora);
    switch (r) {
      case 'guardado':
        return [{
          texto: x.respuesta === 'si'
            ? `Anotado ✅ Pediste gastos de viaje o ETC para el viaje ${folio}. 👍`
            : `Anotado ✅ No necesitas gastos de viaje ni ETC para el viaje ${folio}. 👍`,
        }];
      case 'ya_respondio':
        return [{ texto: `Ya tengo tu respuesta de gastos para el viaje ${folio}. Si quieres cambiarla, avísale a tu supervisor. 🙏` }];
      case 'no_encontrado':
        return [{ texto: 'Ese aviso ya no está vigente. 👍' }];
      case 'sin_almacen':
        logger.warn('conductor.gastos_etc_sin_almacen', { viaje: x.viaje.id });
        return [{ texto: `Recibí tu respuesta, gracias. 👍` }];
      default:
        return [FALLO];
    }
  } catch (err) {
    logger.error('conductor.gastos_etc_respuesta_fallo', { viaje: x.viaje.id, err: err instanceof Error ? err.message : String(err) });
    return [FALLO];
  }
}

export function puertosGastosReales(): PuertosGastos {
  const base = puertosReales();
  return {
    enviar: base.enviar,
    // Pendiente de decisión (T-A5-51 en preguntas-javier.md): `viaje` no tiene dónde guardarla y el slot de migración no está asignado.
    // No se inventa número ni columna; mientras tanto no se toca la base.
    guardar: async () => 'sin_almacen',
  };
}
