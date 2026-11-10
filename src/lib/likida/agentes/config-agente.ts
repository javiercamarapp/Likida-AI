// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAR UN AGENTE DESDE EL ADMIN (F5, auditoría 10-nov-2026, P0).
//
// Antes cambiar `estado`, `runner_habilitado`, `presupuesto_dia_usd` o
// `modelo_rol` exigía SQL. Esta pieza es la única puerta: valida, exige un
// MOTIVO, lee el valor anterior, escribe y firma `agente.config` en la
// bitácora con antes/después. No mueve palancas (eso es `interruptores.ts`) y
// no toca el nivel de autonomía (es código versionado, ver `autonomia.ts`).
//
// Falla cerrado: sin poder leer la fila actual no se escribe nada.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { DatoInvalido } from '@/lib/likida/errores';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { ESTADOS_AGENTE, type EstadoAgente } from './definiciones';

export const PRESUPUESTO_DIA_MAX_USD = 500;
const ID_RE = /^[a-z0-9_]{2,40}$/;
const MODELO_RE = /^[a-z0-9_.:-]{2,60}$/;

export interface CambioConfigCrudo {
  estado?: string;
  /** 'si' | 'no' | '' (sin cambio). */
  runnerHabilitado?: string;
  /** '' = sin cambio; 'sin_tope' = quitar el tope declarado. */
  presupuestoDiaUsd?: string;
  /** '' = sin cambio; 'sin_declarar' = quitar. */
  modeloRol?: string;
}

export interface CambioConfigValido {
  estado?: EstadoAgente;
  runner_habilitado?: boolean;
  presupuesto_dia_usd?: number | null;
  modelo_rol?: string | null;
}

/** Pura. Valida y normaliza; LANZA `DatoInvalido` con texto de pantalla. Un campo vacío significa «sin cambio». */
export function validarCambioConfig(c: CambioConfigCrudo): CambioConfigValido {
  const out: CambioConfigValido = {};
  const estado = (c.estado ?? '').trim();
  if (estado) {
    if (!ESTADOS_AGENTE.some((e) => e.valor === estado)) throw new DatoInvalido(`"${estado}" no es un estado de agente.`);
    out.estado = estado as EstadoAgente;
  }
  const runner = (c.runnerHabilitado ?? '').trim();
  if (runner) {
    if (runner !== 'si' && runner !== 'no') throw new DatoInvalido('El runner se habilita con «si» o se deshabilita con «no».');
    out.runner_habilitado = runner === 'si';
  }
  const pres = (c.presupuestoDiaUsd ?? '').trim().replace(',', '.');
  if (pres) {
    if (pres === 'sin_tope') out.presupuesto_dia_usd = null;
    else {
      const n = Number(pres);
      if (!Number.isFinite(n) || n < 0) throw new DatoInvalido('El presupuesto por día debe ser un número de USD igual o mayor que cero.');
      if (n > PRESUPUESTO_DIA_MAX_USD) throw new DatoInvalido(`El presupuesto por día no puede pasar de ${PRESUPUESTO_DIA_MAX_USD} USD desde esta pantalla.`);
      out.presupuesto_dia_usd = Math.round(n * 100) / 100;
    }
  }
  const modelo = (c.modeloRol ?? '').trim();
  if (modelo) {
    if (modelo === 'sin_declarar') out.modelo_rol = null;
    else {
      if (!MODELO_RE.test(modelo)) throw new DatoInvalido('El rol de modelo solo admite minúsculas, números y . _ : -.');
      out.modelo_rol = modelo;
    }
  }
  if (Object.keys(out).length === 0) throw new DatoInvalido('No hay ningún cambio que guardar: elige al menos un campo.');
  return out;
}

export interface ResultadoConfig { cambios: Record<string, { antes: unknown; despues: unknown }> }

/** Pura. Qué cambió de verdad (valores iguales no cuentan). */
export function diferencias(antes: Record<string, unknown>, nuevo: CambioConfigValido): ResultadoConfig['cambios'] {
  const out: ResultadoConfig['cambios'] = {};
  for (const [k, v] of Object.entries(nuevo)) {
    const a = antes[k] === undefined ? null : antes[k];
    if (a !== v) out[k] = { antes: a, despues: v };
  }
  return out;
}

/** Aplica el cambio con motivo y bitácora. LANZA con texto de pantalla; no devuelve éxito si no escribió. */
export async function actualizarAgente(id: string, crudo: CambioConfigCrudo, motivo: string, actorId: string): Promise<ResultadoConfig> {
  if (!ID_RE.test(id)) throw new DatoInvalido('Agente inválido.');
  const m = motivo.trim();
  if (!m) throw new DatoInvalido('Configurar un agente exige un motivo: queda en la bitácora.');
  const nuevo = validarCambioConfig(crudo);

  const previo = await acotada(
    // orden-no-importa: filtra por `id` exacto (clave primaria), la consulta deja una sola fila.
    supabaseAdmin().from('agente_definicion').select('estado, runner_habilitado, presupuesto_dia_usd, modelo_rol').eq('id', id).limit(1),
    'actualizarAgente.leer',
  );
  if (previo.error) throw new Error(`actualizarAgente: no se pudo leer el agente (${previo.error.message}).`);
  const fila = ((previo.data ?? [])[0] ?? null) as Record<string, unknown> | null;
  if (!fila) throw new DatoInvalido(`No existe el agente "${id}".`);
  if (fila.presupuesto_dia_usd !== null && fila.presupuesto_dia_usd !== undefined) fila.presupuesto_dia_usd = Number(fila.presupuesto_dia_usd);

  const cambios = diferencias(fila, nuevo);
  if (Object.keys(cambios).length === 0) throw new DatoInvalido('Ese agente ya está así: no hay nada que cambiar.');

  const parche: Record<string, unknown> = {};
  for (const k of Object.keys(cambios)) parche[k] = (nuevo as Record<string, unknown>)[k];
  const { error } = await acotada(supabaseAdmin().from('agente_definicion').update(parche).eq('id', id), 'actualizarAgente.escribir');
  if (error) throw new Error(`actualizarAgente(${id}): ${error.message}`);

  await anotarBitacora(
    { tenantId: null, actor: { id: actorId }, accion: 'agente.config', entidad: 'agente_definicion', entidadId: id, detalle: { motivo: m, cambios } },
    { evento: 'agentes.bitacora_no_escribio', contexto: { agente: id } },
  );
  return { cambios };
}
