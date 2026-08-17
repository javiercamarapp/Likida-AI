import { createHash, randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
// ── FASE B (0131, auditoría 5): PERSISTIDO EN `admin_action_intent` ────────
// La Fase A vivía en un Map del proceso: seguro (fallaba cerrado) pero
// molesto en serverless — proponer y confirmar podían caer en instancias
// distintas y el intent "no existía" (409). Ahora el almacén default es la
// tabla, con el CONSUMO ATÓMICO (un UPDATE con las guardas en el WHERE: dos
// POSTs simultáneos no ejecutan dos veces). La LÓGICA del contrato es una
// sola; el almacén es intercambiable, y el de memoria queda como impl de
// referencia para las pruebas del contrato (`_usarAlmacenMemoriaParaPruebas`).
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

/** El hash canónico de los args de una acción. JSON de tupla (no objeto):
 *  sin llaves que reordenar, el mismo input produce el mismo hash siempre. */
export function hashArgsAccion(accion: string, objetivo: string): string {
  return createHash('sha256').update(JSON.stringify([accion, objetivo]), 'utf8').digest('hex');
}

// ── El almacén intercambiable ──────────────────────────────────────────────

interface AlmacenIntents {
  guardar(it: AdminActionIntent): Promise<void>;
  cargar(id: string): Promise<AdminActionIntent | null>;
  /** 'doble' aún no armado → armado=true + motivo. ATÓMICO: true solo si la
   *  fila seguía viva, sin armar y sin gastar. */
  armar(id: string, motivo: string, ahoraMs: number): Promise<boolean>;
  /** Marca usado. ATÓMICO: true solo si seguía viva y sin gastar (y armada,
   *  cuando el gateo lo exige). */
  gastar(id: string, ahoraMs: number, exigeArmado: boolean): Promise<boolean>;
  /** Limpieza de expirados — best-effort, jamás bloquea el camino feliz. */
  barrer(ahoraMs: number): Promise<void>;
}

/** Fase A conservada como referencia del contrato (y para pruebas). */
function almacenMemoria(): AlmacenIntents {
  const intents = new Map<string, AdminActionIntent>();
  return {
    async guardar(it) { intents.set(it.id, it); },
    async cargar(id) { return intents.get(id) ?? null; },
    async armar(id, motivo, ahoraMs) {
      const it = intents.get(id);
      if (!it || it.usado || it.armado || ahoraMs > it.expiresAt) return false;
      it.armado = true; it.motivo = motivo;
      return true;
    },
    async gastar(id, ahoraMs, exigeArmado) {
      const it = intents.get(id);
      if (!it || it.usado || ahoraMs > it.expiresAt || (exigeArmado && !it.armado)) return false;
      it.usado = true;
      return true;
    },
    async barrer(ahoraMs) {
      for (const [id, it] of intents) if (ahoraMs > it.expiresAt) intents.delete(id);
    },
  };
}

/** Fase B: la tabla 0131. El WHERE de cada UPDATE es la atomicidad. */
function almacenTabla(): AlmacenIntents {
  // El cliente se crea AL LLAMAR cada método, no al construir el almacén:
  // las pruebas de contrato (almacén de memoria) importan este módulo sin
  // tocar supabase jamás.
  const admin = () => supabaseAdmin();
  const aFila = (it: AdminActionIntent) => ({
    id: it.id, actor_id: it.actorId, accion: it.accion, args_hash: it.argsHash,
    gateo: it.gateo, motivo: it.motivo, armado: it.armado,
    usado_en: it.usado ? new Date().toISOString() : null,
    creado_en: new Date(it.createdAt).toISOString(),
    expira_en: new Date(it.expiresAt).toISOString(),
  });
  return {
    async guardar(it) {
      const { error } = await admin().from('admin_action_intent').insert(aFila(it));
      if (error) throw new Error(`intent.guardar: ${error.message}`);
    },
    async cargar(id) {
      const { data, error } = await admin().from('admin_action_intent').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`intent.cargar: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id, actorId: data.actor_id, accion: data.accion, argsHash: data.args_hash,
        gateo: data.gateo as Gateo, motivo: data.motivo,
        createdAt: Date.parse(data.creado_en), expiresAt: Date.parse(data.expira_en),
        usado: data.usado_en !== null, armado: data.armado,
      };
    },
    async armar(id, motivo, ahoraMs) {
      const { data, error } = await admin().from('admin_action_intent')
        .update({ armado: true, motivo })
        .eq('id', id).eq('armado', false).is('usado_en', null)
        .gt('expira_en', new Date(ahoraMs).toISOString())
        .select('id');
      if (error) throw new Error(`intent.armar: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async gastar(id, ahoraMs, exigeArmado) {
      let q = admin().from('admin_action_intent')
        .update({ usado_en: new Date(ahoraMs).toISOString() })
        .eq('id', id).is('usado_en', null)
        .gt('expira_en', new Date(ahoraMs).toISOString());
      if (exigeArmado) q = q.eq('armado', true);
      const { data, error } = await q.select('id');
      if (error) throw new Error(`intent.gastar: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async barrer(ahoraMs) {
      // Best-effort: expirado hace más de una hora ya no autoriza nada ni
      // sirve de evidencia caliente. Un fallo aquí no estorba el camino.
      try {
        await admin().from('admin_action_intent').delete()
          .lt('expira_en', new Date(ahoraMs - 3_600_000).toISOString());
      } catch { /* barrido best-effort */ }
    },
  };
}

let almacen: AlmacenIntents = almacenTabla();

/**
 * Crea el intent al momento de PROPONER (lo llama el route cuando la
 * respuesta del copiloto trae un bloque `accion` implementada).
 * `ahoraMs` inyectable para probar los bordes del TTL sin reloj real.
 */
export async function crearIntent(opts: {
  actorId: string;
  accion: string;
  objetivo: string;
  gateo: Gateo;
  ahoraMs?: number;
}): Promise<AdminActionIntent> {
  const ahora = opts.ahoraMs ?? Date.now();
  void almacen.barrer(ahora);
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
  await almacen.guardar(intent);
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
 *
 * La lectura previa solo DISTINGUE errores; la autoridad es la transición
 * atómica del almacén (dos POSTs simultáneos: uno gana, el otro 'invalido').
 */
export async function reclamarIntent(opts: {
  intentId: string;
  actorId: string;
  argsHash: string;
  motivo?: string;
  ahoraMs?: number;
}): Promise<ResultadoReclamo> {
  const ahora = opts.ahoraMs ?? Date.now();
  const it = await almacen.cargar(opts.intentId);
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
      if (!(await almacen.armar(opts.intentId, motivo, ahora))) {
        return { ok: false, codigo: 'invalido', error: MSG_INVALIDO };
      }
      return { ok: true, fase: 'armado' };
    }
    if (!(await almacen.gastar(opts.intentId, ahora, true))) {
      return { ok: false, codigo: 'invalido', error: MSG_INVALIDO };
    }
    return { ok: true, fase: 'ejecutar', accion: it.accion, motivo: it.motivo };
  }
  if (!(await almacen.gastar(opts.intentId, ahora, false))) {
    return { ok: false, codigo: 'invalido', error: MSG_INVALIDO };
  }
  return { ok: true, fase: 'ejecutar', accion: it.accion, motivo: (opts.motivo ?? '').trim() || null };
}

/** SOLO para pruebas: cambia al almacén de memoria (la impl de referencia
 *  del contrato) y lo deja vacío. Las pruebas del adaptador de tabla mockean
 *  supabase y NO llaman esto. */
export function _usarAlmacenMemoriaParaPruebas(): void {
  almacen = almacenMemoria();
}

/** SOLO para pruebas: deja el almacén como recién arrancado el proceso. */
export function _vaciarIntentsParaPruebas(): void {
  almacen = almacenMemoria();
}
