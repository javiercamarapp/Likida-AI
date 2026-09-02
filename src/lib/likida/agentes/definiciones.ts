// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DECLARATIVO DE AGENTES (`agente_definicion`, 0116).
//
// Un agente nuevo es una FILA, no una migración — la decisión de
// arquitectura del plan hacia el 90% §(b). Este módulo es el único escritor
// del catálogo; la parte pura (validación, dominios) vive separada de la de
// IO, como vendedores.ts.
//
// LO QUE ESTE MÓDULO NO HACE, a propósito: dar de alta un agente NO lo
// ejecuta. Los agentes nacen `disenado` (documento + prompt, corren a mano);
// `vivo` está reservado a los 7 del producto sembrados por la 0116 hasta que
// exista el runner de nivel 2 con sandbox y presupuesto — un agente que se
// activa solo y gasta sin techo es exactamente cómo se rompe una empresa de
// una persona (copiloto-del-fundador.md §4).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { DatoInvalido } from '../errores';

// ── Parte pura ─────────────────────────────────────────────────────────────

export const DEPARTAMENTOS = [
  { valor: 'producto', rotulo: 'Producto' },
  { valor: 'leads', rotulo: 'Leads y Prospección' },
  { valor: 'exito_cliente', rotulo: 'Éxito del Cliente' },
  { valor: 'crecimiento', rotulo: 'Crecimiento' },
  { valor: 'back_office', rotulo: 'Back Office' },
  { valor: 'ingenieria', rotulo: 'Ingeniería' },
  { valor: 'direccion', rotulo: 'Dirección' },
] as const;
export type Departamento = (typeof DEPARTAMENTOS)[number]['valor'];

export const DISPARADORES = ['cron', 'manual', 'correo', 'whatsapp', 'webhook'] as const;
export type Disparador = (typeof DISPARADORES)[number];

export const ESTADOS_AGENTE = [
  { valor: 'disenado', rotulo: 'Diseñado' },
  { valor: 'vivo', rotulo: 'Vivo' },
  { valor: 'pausado', rotulo: 'Pausado' },
  { valor: 'retirado', rotulo: 'Retirado' },
] as const;
export type EstadoAgente = (typeof ESTADOS_AGENTE)[number]['valor'];

export interface DefinicionCruda {
  id: string;
  nombre: string;
  departamento: string;
  descripcion: string;
  disparador: string;
  promptRef: string;
  /** '' = sin tope declarado (NULL — el panel lo dice, nunca lo pinta como $0). */
  presupuestoDiaUsd: string;
}

export interface DefinicionValida {
  id: string;
  nombre: string;
  departamento: Departamento;
  descripcion: string | null;
  disparador: Disparador;
  promptRef: string | null;
  presupuestoDiaUsd: number | null;
}

const ID_RE = /^[a-z0-9_]{2,40}$/;

export function validarDefinicion(d: DefinicionCruda): DefinicionValida {
  const id = d.id.trim().toLowerCase();
  if (!ID_RE.test(id)) {
    throw new DatoInvalido('El id del agente va en minúsculas, números y guiones bajos (2-40): así se nombra en corridas y bitácoras.');
  }
  const nombre = d.nombre.trim();
  if (nombre === '' || nombre.length > 80) throw new DatoInvalido('El nombre del agente es obligatorio (máx. 80).');
  if (!DEPARTAMENTOS.some((x) => x.valor === d.departamento)) {
    throw new DatoInvalido('Ese departamento no existe en el organigrama.');
  }
  const disparador = DISPARADORES.includes(d.disparador as Disparador) ? d.disparador as Disparador : null;
  if (!disparador) throw new DatoInvalido('Ese disparador no existe.');

  let presupuesto: number | null = null;
  if (d.presupuestoDiaUsd.trim() !== '') {
    const n = Number(d.presupuestoDiaUsd);
    if (!Number.isFinite(n) || n <= 0) {
      throw new DatoInvalido('El presupuesto por día es un monto en USD mayor a cero — o vacío para "sin tope declarado".');
    }
    presupuesto = Math.round(n * 100) / 100;
  }
  const descripcion = d.descripcion.trim();
  const promptRef = d.promptRef.trim();
  return {
    id, nombre,
    departamento: d.departamento as Departamento,
    descripcion: descripcion === '' ? null : descripcion.slice(0, 500),
    disparador,
    promptRef: promptRef === '' ? null : promptRef.slice(0, 300),
    presupuestoDiaUsd: presupuesto,
  };
}

// ── Parte con base ─────────────────────────────────────────────────────────

export interface AgenteDefinido {
  id: string;
  nombre: string;
  departamento: Departamento;
  descripcion: string | null;
  disparador: Disparador;
  estado: EstadoAgente;
  presupuestoDiaUsd: number | null;
  promptRef: string | null;
  /** El rol de modelo que lo corre (matriz 0125) — null = sin declarar. */
  modeloRol: string | null;
  /** AGB (auditoría 24, 0301): true = el catálogo promete un motor que el
   *  código no tiene todavía (o, como en los 9 de "agentes teatro", uno
   *  deliberadamente acotado) — el runner NO lo despacha en automático hasta
   *  que se gradúe. Antes de esta pieza no se veía en ningún panel: un
   *  agente `vivo` con `experimental = true` se pintaba idéntico a uno que
   *  sí corre, y nadie podía saber por qué nunca aparecía una corrida. */
  experimental: boolean;
  creadoEn: string;
}

/** El catálogo completo, vivos primero y luego por departamento. LANZA ante
 *  error de lectura: "no hay agentes" con la base caída sería mentira. */
export async function listarAgentes(): Promise<AgenteDefinido[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('agente_definicion')
      .select('id, nombre, departamento, descripcion, disparador, estado, presupuesto_dia_usd, prompt_ref, modelo_rol, experimental, creado_en', conteo(d))
      .order('id').range(d, h), 'listarAgentes'),
    'listarAgentes',
  );
  const orden: Record<EstadoAgente, number> = { vivo: 0, pausado: 1, disenado: 2, retirado: 3 };
  return filas.map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    departamento: f.departamento as Departamento,
    descripcion: (f.descripcion as string) ?? null,
    disparador: f.disparador as Disparador,
    estado: f.estado as EstadoAgente,
    presupuestoDiaUsd: f.presupuesto_dia_usd === null || f.presupuesto_dia_usd === undefined ? null : Number(f.presupuesto_dia_usd),
    promptRef: (f.prompt_ref as string) ?? null,
    modeloRol: (f.modelo_rol as string) ?? null,
    experimental: f.experimental === true,
    creadoEn: String(f.creado_en),
  })).sort((a, b) => orden[a.estado] - orden[b.estado] || a.departamento.localeCompare(b.departamento) || a.id.localeCompare(b.id));
}

/**
 * Da de alta un agente NUEVO — siempre nace `disenado`. Es el criterio de
 * terminado de la pieza: un agente pasa de idea a fila del catálogo sin
 * migración. LANZA con texto de pantalla si el id ya existe.
 */
export async function darDeAltaAgente(v: DefinicionValida, actorId: string): Promise<void> {
  const { error } = await supabaseAdmin().from('agente_definicion').insert({
    id: v.id, nombre: v.nombre, departamento: v.departamento,
    descripcion: v.descripcion, disparador: v.disparador,
    estado: 'disenado', presupuesto_dia_usd: v.presupuestoDiaUsd, prompt_ref: v.promptRef,
  });
  if (error) {
    if (error.code === '23505') throw new DatoInvalido(`Ya existe un agente con el id "${v.id}".`);
    throw new Error(`darDeAltaAgente: ${error.message}`);
  }
  // La bitácora (0053), best-effort con el criterio de interruptores.ts: el
  // alta YA quedó; perder la anotación es mejor que deshacerla.
  await anotarBitacora(
    { tenantId: null, actor: { id: actorId }, accion: 'agente.alta', entidad: 'agente_definicion', entidadId: v.id,
      detalle: { departamento: v.departamento, disparador: v.disparador } },
    { evento: 'agentes.bitacora_no_escribio', contexto: { agente: v.id } },
  );
}

/**
 * Gradúa un agente `experimental`: quita la marca para que el runner
 * empiece a despacharlo (candado 2 de `runner.ts`). Antes de esta función
 * graduar era un `UPDATE` a mano contra la base — sin registro, sin
 * bitácora, y sin el candado de "el id existe de verdad" que sí tiene
 * `darDeAltaAgente`. LANZA si el id no está en el catálogo: graduar algo
 * que no existe sería una fila fantasma en la bitácora.
 */
export async function graduarAgente(id: string, actorId: string): Promise<void> {
  const { data, error } = await supabaseAdmin().from('agente_definicion')
    .update({ experimental: false })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`graduarAgente: ${error.message}`);
  if (!data) throw new DatoInvalido(`No existe ningún agente con el id "${id}" — no hay qué graduar.`);
  // Best-effort, mismo criterio que darDeAltaAgente: la graduación YA
  // quedó; perder la anotación es mejor que deshacerla.
  await anotarBitacora(
    { tenantId: null, actor: { id: actorId }, accion: 'agente.graduado', entidad: 'agente_definicion', entidadId: id, detalle: {} },
    { evento: 'agentes.bitacora_no_escribio', contexto: { agente: id } },
  );
}
