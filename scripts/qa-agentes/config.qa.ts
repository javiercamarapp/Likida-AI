// ═══════════════════════════════════════════════════════════════════════════
// CONFIG DEL EJÉRCITO DE QA — Fase 1 (agente Operador, sin navegador).
//
// Calca el patrón de scripts/auditoria/config.audit.ts: carga de .env.local
// sin exponer secretos, tope de gasto REAL por corrida, y —lo nuevo aquí— el
// GUARD del tenant sintético: cualquier función que borre o modifique en lote
// debe pasar por `exigirTenantZZZ` antes de tocar una fila, o lanzar. Es la
// mitigación de la Opción A del diseño (§8): el orquestador corre contra el
// ÚNICO proyecto de Supabase, el mismo que algún día tendrá datos reales.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

export const REPO = process.cwd();

// ── El tenant sintético ─────────────────────────────────────────────────────
// UUID propio, DISTINTO del aaaaaaaa-...-000015000 de carga-15k.sql para no
// chocar si algún día corren juntos. El nombre DEBE empezar con 'ZZZ ' — es
// la llave del guard de abajo y el criterio de limpieza de verificaciones.sql.
export const TENANT_QA_ID = 'aaaaaaaa-0000-4000-8000-000000009901';
export const TENANT_QA_NOMBRE = 'ZZZ QA';

// Teléfonos del rango imposible 5215559xxxxxx (mismo criterio que
// carga-15k.sql), pero en el sub-rango 9xxxxx para no chocar con los
// 000001..000200 de ZZZ CARGA.
export const TELEFONOS_QA = ['5215559900001', '5215559900002'] as const;

// Prefijo de TODO identificador que el QA escribe fuera del árbol del tenant
// (wa_mensaje_procesado no tiene tenant_id): el guard de esas filas es este
// prefijo, análogo al 'ZZZ %' del tenant.
export const PREFIJO_QA = 'ZZZQA-';

// ── Presupuesto ─────────────────────────────────────────────────────────────
/** Tope duro de gasto REAL por corrida, USD. Mismo comportamiento que
 *  ledger.audit.ts: si se rebasa, la corrida ABORTA y dice cuánto gastó. */
export const TOPE_CORRIDA_USD = 2;

/** Repeticiones por escenario con la MISMA semilla (criterio N/N del diseño
 *  §3: 3/3 = reproducible; menos = intermitente y se reporta con el conteo). */
export const REPETICIONES = 3;

// ── Carpeta de salida ───────────────────────────────────────────────────────
export function fechaCorrida(): string {
  return process.env.QA_FECHA || new Date().toISOString().slice(0, 10);
}
export const dirCorrida = (fecha: string) => join(REPO, 'docs', 'qa', fecha);
/**
 * `familia` era el literal `'operador'`, porque la Fase 1 sólo tenía ese agente.
 * Con los Modos 4 y 5 (fuzzing y caos) hay tres familias de escenario sobre el
 * MISMO arnés, y un nombre de ataque podría repetirse entre ellas: sin este
 * segmento, dos escenarios distintos escribirían su evidencia encima del otro
 * y el reporte citaría una carpeta con el contenido del que corrió después.
 *
 * Sigue con `'operador'` por default: los llamadores viejos —incluido
 * `pruebas-manuales/qa-agentes/operador-un-escenario.prueba.ts`— no cambian.
 */
export const dirEvidencia = (fecha: string, escenario: string, rep: number, familia = 'operador') =>
  join(dirCorrida(fecha), 'evidencia', familia, `${escenario}-rep${rep}`);

// ── Carga de .env.local (patrón de pruebas-manuales/*.prueba.ts) ────────────
export function cargaEnvLocal(base: string = REPO): void {
  const p = join(base, '.env.local');
  if (!existsSync(p)) return;
  for (const linea of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, '');
    if (valor && process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
  // HALLAZGO documentado (16-ago): en .env.local el valor de
  // LIKIDA_DEDUP_FOTOS trae el comentario DENTRO de las comillas
  // ("1   # dedup..."), así que `=== '1'` es false y el pre-check de dedup
  // queda apagado en local. El QA lo necesita encendido para ejercitar el
  // índice único; se normaliza aquí, solo en este proceso.
  if (process.env.LIKIDA_DEDUP_FOTOS && process.env.LIKIDA_DEDUP_FOTOS !== '1') {
    process.env.LIKIDA_DEDUP_FOTOS = '1';
  }
}

/** Claves sin las cuales la corrida no puede ni empezar. Fallar cerrado. */
export function exigirClaves(): void {
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY']) {
    if (!process.env[k]) throw new Error(`falta ${k} en el entorno — corre con .env.local presente`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL GUARD — sin esto, un bug del propio orquestador podría tocar datos
// fuera del tenant sintético. Obligatorio ANTES de cualquier DELETE/UPDATE
// en lote. Verifica en la BASE (no en una constante local) que el tenant
// exista y su nombre empiece con 'ZZZ ' — si alguien reutilizó el uuid para
// otra cosa, esto LANZA en vez de llevarse datos reales (mismo espíritu que
// carga-15k-limpiar.sql).
// ═══════════════════════════════════════════════════════════════════════════
export async function exigirTenantZZZ(db: SupabaseClient, tenantId: string): Promise<void> {
  const { data, error } = await db.from('tenant').select('nombre').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`GUARD ZZZ: no se pudo leer el tenant ${tenantId}: ${error.message}`);
  if (!data) throw new Error(`GUARD ZZZ: el tenant ${tenantId} no existe — nada que tocar`);
  const nombre = String(data.nombre ?? '');
  if (!nombre.startsWith('ZZZ ')) {
    throw new Error(`GUARD ZZZ: el tenant ${tenantId} se llama "${nombre}" y NO empieza con 'ZZZ ' — se aborta antes de tocar una fila`);
  }
}

/** Guard gemelo para filas sin tenant_id (wa_mensaje_procesado): el patrón
 *  de borrado DEBE empezar con el prefijo QA, o se lanza. */
export function exigirPrefijoQA(patron: string): void {
  if (!patron.startsWith(PREFIJO_QA)) {
    throw new Error(`GUARD PREFIJO: "${patron}" no empieza con "${PREFIJO_QA}" — borrado en lote rechazado`);
  }
}

// ── El contrato de los oráculos ─────────────────────────────────────────────
// Función pura sobre la DB: compara esperado vs real y NUNCA es un LLM.
// `no_verificado` existe por la regla "fallar cerrado y decirlo": si no se
// pudo leer la base, el escenario NO se reporta como "pasó".
export interface VeredictoOraculo {
  oraculo: string;
  estado: 'ok' | 'fallo' | 'no_verificado';
  esperado: unknown;
  real: unknown;
  detalle?: string;
}
