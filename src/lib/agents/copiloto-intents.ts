import { createHash, randomUUID } from 'node:crypto';
import type { Gateo } from './copiloto-acciones';

// ═══════════════════════════════════════════════════════════════════════════
// AdminActionIntent — la confirmación deja de ser un booleano del cliente.
//
// ANTES: /api/admin/copiloto ejecutaba con `{accion, confirmado: true}`. El
// `confirmado` lo mandaba el CLIENTE, así que cualquier POST con sesión de
// superadmin ejecutaba directo, sin haber visto previsualización alguna — y
// el `gateo: 'doble'` del catálogo era pura metadata.
//
// AHORA: al PROPONER una acción, el SERVIDOR crea un intent de un solo uso y
// vida corta; EJECUTAR exige presentar ese intent. El servidor valida que
// exista, que no se haya usado, que no haya expirado, que sea del MISMO actor
// que lo pidió y que los args no hayan cambiado desde la previsualización
// (argsHash) — recién entonces marca usado y ejecuta. El botón del cliente ya
// no es la autoridad: es solo el mensajero del intent.
//
// `gateo: 'doble'` deja de ser metadata: esas acciones exigen motivo no vacío
// Y dos POSTs con el mismo intent — el primero lo ARMA, el segundo ejecuta.
// (Sin MFA todavía: eso es de una fase posterior.)
//
// ── FASE A: EN MEMORIA DEL PROCESO, A PROPÓSITO ──────────────────────────
// El Map vive en el proceso (mismo criterio que el rate limiter local): en
// serverless, proponer y confirmar pueden caer en instancias distintas y el
// intent "no existe" → 409 con instrucción de re-proponer. Molesto, jamás
// inseguro: el fallo es CERRADO. La FASE B persiste esto en una tabla
// (`admin_action_intent`) — el diseño quedó encapsulado en este módulo para
// que ese cambio sea local: mismas funciones, otro almacén.
// ═══════════════════════════════════════════════════════════════════════════

export interface AdminActionIntent {
  id: string;
  /** El userId de la sesión que RECIBIÓ la previsualización — nadie más
   *  puede gastar este intent. */
  actorId: string;
  accion: string;
  /** sha256 de (accion, objetivo): la acción que se ejecuta es EXACTAMENTE
   *  la que se previsualizó, no una editada en el camino. */
  argsHash: string;
  gateo: Gateo;
  /** El motivo con el que se armó (solo 'doble' lo guarda al armar). */
  motivo: string | null;
  createdAt: number;
  expiresAt: number;
  usado: boolean;
  /** Solo para 'doble': el primer POST válido lo arma; el segundo ejecuta. */
  armado: boolean;
}

/** 2 minutos: lo que tarda un humano en leer la previsualización y apretar.
 *  Un intent viejo no es una confirmación — es una pestaña olvidada. */
export const INTENT_TTL_MS = 2 * 60_000;

const intents = new Map<string, AdminActionIntent>();

/** El hash canónico de los args de una acción. JSON de tupla (no objeto):
 *  sin llaves que reordenar, el mismo input produce el mismo hash siempre. */
export function hashArgsAccion(accion: string, objetivo: string): string {
  return createHash('sha256').update(JSON.stringify([accion, objetivo]), 'utf8').digest('hex');
}

/** Barrido de expirados — en cada operación, no con un timer: un Map chico
 *  (un humano proponiendo acciones) no amerita un intervalo vivo. */
function barrer(ahoraMs: number): void {
  for (const [id, it] of intents) {
    if (ahoraMs > it.expiresAt) intents.delete(id);
  }
}

/**
 * Crea el intent al momento de PROPONER (lo llama el route cuando la
 * respuesta del copiloto trae un bloque `accion` implementada).
 * `ahoraMs` inyectable para probar los bordes del TTL sin reloj real.
 */
export function crearIntent(opts: {
  actorId: string;
  accion: string;
  objetivo: string;
  gateo: Gateo;
  ahoraMs?: number;
}): AdminActionIntent {
  const ahora = opts.ahoraMs ?? Date.now();
  barrer(ahora);
  const intent: AdminActionIntent = {
    id: randomUUID(),
    actorId: opts.actorId,
    accion: opts.accion,
    argsHash: hashArgsAccion(opts.accion, opts.objetivo),
    gateo: opts.gateo,
    motivo: null,
    createdAt: ahora,
    expiresAt: ahora + INTENT_TTL_MS,
    usado: false,
    armado: false,
  };
  intents.set(intent.id, intent);
  return intent;
}

export type ResultadoReclamo =
  /** Ejecutar YA — el intent quedó marcado usado ANTES de devolver esto:
   *  dos POSTs simultáneos no ejecutan dos veces. */
  | { ok: true; fase: 'ejecutar'; accion: string; motivo: string | null }
  /** 'doble' recién armado: falta el segundo POST con el mismo intentId. */
  | { ok: true; fase: 'armado' }
  | { ok: false; codigo: 'invalido' | 'args' | 'motivo'; error: string };

const MSG_INVALIDO = 'Esa propuesta ya no es válida (expiró, ya se usó o no es de esta sesión) — pide la acción de nuevo al copiloto y confirma la previsualización fresca.';

/**
 * Valida y GASTA un intent. Todo camino dudoso es rechazo (fallar cerrado):
 *  · inexistente / expirado / ya usado / de otro actor → 'invalido' (409).
 *    Un solo mensaje para los cuatro a propósito: distinguirlos le diría a
 *    quien sondea qué intents existen y de quién son.
 *  · args distintos de los propuestos → 'args' (409).
 *  · 'doble' sin motivo → 'motivo' (400): el motivo es parte del contrato.
 *
 * Para 'confirma': un POST válido marca usado y ejecuta. Para 'doble': el
 * primer POST válido ARMA (guarda el motivo), el segundo marca usado y
 * ejecuta con el motivo guardado — el que se leyó al armar es el que firma.
 */
export function reclamarIntent(opts: {
  intentId: string;
  actorId: string;
  argsHash: string;
  motivo?: string;
  ahoraMs?: number;
}): ResultadoReclamo {
  const ahora = opts.ahoraMs ?? Date.now();
  barrer(ahora);
  const it = intents.get(opts.intentId);
  if (!it || ahora > it.expiresAt || it.usado || it.actorId !== opts.actorId) {
    return { ok: false, codigo: 'invalido', error: MSG_INVALIDO };
  }
  if (it.argsHash !== opts.argsHash) {
    return {
      ok: false, codigo: 'args',
      error: 'La acción no coincide con la previsualización propuesta — pide la acción de nuevo al copiloto.',
    };
  }
  if (it.gateo === 'doble') {
    if (!it.armado) {
      const motivo = (opts.motivo ?? '').trim();
      if (!motivo) {
        return {
          ok: false, codigo: 'motivo',
          error: 'Esta acción exige doble confirmación y el motivo es obligatorio — escribe por qué antes de armarla.',
        };
      }
      it.armado = true;
      it.motivo = motivo;
      return { ok: true, fase: 'armado' };
    }
    it.usado = true;
    return { ok: true, fase: 'ejecutar', accion: it.accion, motivo: it.motivo };
  }
  it.usado = true;
  return { ok: true, fase: 'ejecutar', accion: it.accion, motivo: (opts.motivo ?? '').trim() || null };
}

/** SOLO para pruebas: deja el almacén como recién arrancado el proceso. */
export function _vaciarIntentsParaPruebas(): void {
  intents.clear();
}
