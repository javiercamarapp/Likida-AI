// ═══════════════════════════════════════════════════════════════════════════
// EL ACCESO A DATOS DEL PROGRAMA DE DESPACHO (mig. 0795) — todo en UN archivo.
//
// Implementa `RepoPrograma`, lo que `sincronizar.ts` necesita para guardar el
// programa de forma idempotente y registrar qué cambió entre cargas. Sigue el
// patrón de `vigia/repo.ts` (no se edita): la frontera de datos cuenta este
// archivo como el `repo.ts` que es.
//
// ── REGLAS QUE ESTE ARCHIVO CUMPLE (y `repo.test.ts` comprueba) ─────────────
//   1. TODA consulta lleva `tenant_id` (filtro o valor escrito).
//   2. Toda consulta pasa por `acotada` (tope de tiempo) y un error de la base
//      LANZA: «no pude preguntar» nunca se lee como «no hay nada».
//   3. Lecturas sin `select *` y sin tope mudo: `traerTodo` pagina y lanza si no
//      puede demostrar que trajo todo. Escrituras por lotes de ≤ 500 filas.
//   4. Si la 0795 aún no está en la base (42P01 / PGRST205), se lanza
//      `ProgramaSinMigrar` (mensaje llano), nunca un error genérico de base.
//   5. Nada de contenido del archivo en los logs.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../../presupuesto';
import { IDS_POR_TANDA, traerTodo } from '../../pg';

/** Filas por llamada de escritura. */
export const LOTE_ESCRITURA = 500;

/** La 0795 aún no está en la base: no hay tabla. */
const SIN_0795 = new Set(['42P01', 'PGRST205']);

export class ProgramaSinMigrar extends Error {
  constructor() {
    super('El programa de despacho aún no está habilitado en esta base (falta aplicar la migración 0795).');
    this.name = 'ProgramaSinMigrar';
  }
}

type ErrorBase = { message: string; code?: string } | null | undefined;

function exigir(op: string, error: ErrorBase): void {
  if (!error) return;
  if (error.code && SIN_0795.has(error.code)) throw new ProgramaSinMigrar();
  throw new Error(`programa.${op}: ${error.message}`);
}

export type OrigenCarga = 'subida' | 'drive' | 'api';

export interface NuevaCarga {
  terminal: string;
  origen: OrigenCarga;
  archivoSha256: string;
  filasLeidas: number;
  filasValidas: number;
  /** Resumen acotado de la calidad de lectura (sin valores del archivo). */
  avisos: Array<{ codigo: string; cuantas: number }>;
  creadoPor?: string | null;
}

/** Lo que se lee de una fila ya guardada para decidir si cambió. */
export interface FilaGuardada {
  id: string;
  claveNatural: string;
  cliente: string | null;
  consignatario: string | null;
  caja: string | null;
  unidad: string | null;
  citaEn: string | null;
  citaTexto: string | null;
  transito: string;
  ccp: string;
  huella: string;
  visible: boolean;
}

/** Lo que se escribe de una fila (sin `tenant_id`: lo pone el repo). */
export interface FilaParaGuardar {
  cargaId: string;
  terminal: string;
  fecha: string;
  tipo: string;
  bloque: string | null;
  num: number | null;
  claveNatural: string;
  cliente: string | null;
  consignatario: string | null;
  linea: string | null;
  caja: string | null;
  unidad: string | null;
  citaEn: string | null;
  citaTexto: string | null;
  transito: string;
  ccp: string;
  comentarios: string | null;
  huella: string;
  /** ISO del momento de la carga. */
  vistaEn: string;
}

export interface CambioParaGuardar {
  filaId: string;
  campo: string;
  antes: string | null;
  despues: string | null;
  cargaId: string;
}

export interface RepoPrograma {
  /** Reclama la carga (único por flota + terminal + sha256). `null` = ya existía: no se hace nada más. */
  registrarCarga(tenantId: string, carga: NuevaCarga): Promise<{ id: string } | null>;
  /** Deshace el reclamo de una carga cuya sincronización falló, para que se pueda reintentar. */
  descartarCarga(tenantId: string, cargaId: string): Promise<void>;
  /** Todas las filas de la terminal con fecha en [desde, hasta] (visibles o no). */
  filasEnRango(tenantId: string, terminal: string, desde: string, hasta: string): Promise<FilaGuardada[]>;
  /** Filas nuevas (con `primera_vez`). Lotes de ≤ LOTE_ESCRITURA. */
  insertarFilas(tenantId: string, filas: FilaParaGuardar[]): Promise<void>;
  /** Filas ya existentes: refresca valores y `ultima_vez`, sin tocar `primera_vez`. Lotes de ≤ LOTE_ESCRITURA. */
  actualizarFilas(tenantId: string, filas: FilaParaGuardar[]): Promise<void>;
  registrarCambios(tenantId: string, cambios: CambioParaGuardar[]): Promise<void>;
  /** Marca `visible = false` (no borra). */
  ocultarFilas(tenantId: string, ids: string[], cargaId: string): Promise<void>;
}

const COLS_FILA = 'id, clave_natural, cliente, consignatario, caja, unidad, cita_en, cita_texto, transito, ccp, huella, visible';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function aFilaGuardada(f: Record<string, unknown>): FilaGuardada {
  return {
    id: String(f.id), claveNatural: String(f.clave_natural),
    cliente: str(f.cliente), consignatario: str(f.consignatario), caja: str(f.caja), unidad: str(f.unidad),
    citaEn: str(f.cita_en), citaTexto: str(f.cita_texto),
    transito: String(f.transito ?? 'vacio'), ccp: String(f.ccp ?? 'vacio'),
    huella: String(f.huella ?? ''), visible: f.visible !== false,
  };
}

function aRegistro(tenantId: string, f: FilaParaGuardar): Record<string, unknown> {
  return {
    tenant_id: tenantId, carga_ultima_id: f.cargaId, terminal: f.terminal, fecha: f.fecha, tipo: f.tipo,
    bloque: f.bloque, num: f.num, clave_natural: f.claveNatural, cliente: f.cliente, consignatario: f.consignatario,
    linea: f.linea, caja: f.caja, unidad: f.unidad, cita_en: f.citaEn, cita_texto: f.citaTexto,
    transito: f.transito, ccp: f.ccp, comentarios: f.comentarios, huella: f.huella, ultima_vez: f.vistaEn, visible: true,
  };
}

function lotes<T>(items: T[], tam: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += tam) out.push(items.slice(i, i + tam));
  return out;
}

export function crearRepoPrograma(): RepoPrograma {
  return {
    async registrarCarga(tenantId, c) {
      const { data, error } = await acotada(supabaseAdmin().from('programa_despacho_carga').insert({
        tenant_id: tenantId, terminal: c.terminal, origen: c.origen, archivo_sha256: c.archivoSha256,
        filas_leidas: c.filasLeidas, filas_validas: c.filasValidas, avisos: c.avisos, creado_por: c.creadoPor ?? null,
      }).select('id').maybeSingle(), 'programa.registrar_carga');
      // 23505 = la misma subida ya entró (o entró justo ahora desde otra invocación): gana la primera.
      if (error?.code === '23505') return null;
      exigir('registrar_carga', error);
      if (!data?.id) throw new Error('programa.registrar_carga: la base no devolvió el id de la carga');
      return { id: String(data.id) };
    },

    async descartarCarga(tenantId, cargaId) {
      const { error } = await acotada(supabaseAdmin().from('programa_despacho_carga')
        .delete().eq('tenant_id', tenantId).eq('id', cargaId), 'programa.descartar_carga');
      exigir('descartar_carga', error);
    },

    async filasEnRango(tenantId, terminal, desde, hasta) {
      const filas = await traerTodo<Record<string, unknown>>(async (d, h) => {
        const r = await acotada(supabaseAdmin().from('programa_despacho_fila')
          .select(COLS_FILA).eq('tenant_id', tenantId).eq('terminal', terminal)
          .gte('fecha', desde).lte('fecha', hasta)
          .order('id').range(d, h), 'programa.filas_en_rango');
        // `traerTodo` solo conserva el mensaje del error: la tabla sin migrar se traduce aquí, donde aún está el código.
        exigir('filas_en_rango', r.error);
        return r as { data: Record<string, unknown>[] | null; error: { message: string } | null };
      }, 'programa.filas_en_rango');
      return filas.map(aFilaGuardada);
    },

    async insertarFilas(tenantId, filas) {
      for (const lote of lotes(filas, LOTE_ESCRITURA)) {
        const { error } = await acotada(supabaseAdmin().from('programa_despacho_fila').upsert(
          lote.map((f) => ({ ...aRegistro(tenantId, f), primera_vez: f.vistaEn })),
          { onConflict: 'tenant_id,terminal,clave_natural' },
        ), 'programa.insertar_filas');
        exigir('insertar_filas', error);
      }
    },

    async actualizarFilas(tenantId, filas) {
      for (const lote of lotes(filas, LOTE_ESCRITURA)) {
        const { error } = await acotada(supabaseAdmin().from('programa_despacho_fila').upsert(
          lote.map((f) => aRegistro(tenantId, f)),
          { onConflict: 'tenant_id,terminal,clave_natural' },
        ), 'programa.actualizar_filas');
        exigir('actualizar_filas', error);
      }
    },

    async registrarCambios(tenantId, cambios) {
      for (const lote of lotes(cambios, LOTE_ESCRITURA)) {
        const { error } = await acotada(supabaseAdmin().from('programa_despacho_cambio').insert(
          lote.map((c) => ({
            tenant_id: tenantId, fila_id: c.filaId, campo: c.campo, antes: c.antes, despues: c.despues, carga_id: c.cargaId,
          })),
        ), 'programa.registrar_cambios');
        exigir('registrar_cambios', error);
      }
    },

    async ocultarFilas(tenantId, ids, cargaId) {
      for (const tanda of lotes(ids, IDS_POR_TANDA)) {
        const { error } = await acotada(supabaseAdmin().from('programa_despacho_fila')
          .update({ visible: false, carga_ultima_id: cargaId }).eq('tenant_id', tenantId).in('id', tanda), 'programa.ocultar_filas');
        exigir('ocultar_filas', error);
      }
    },
  };
}
