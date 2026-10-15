// ═══════════════════════════════════════════════════════════════════════════
// ACCESO A DATOS DEL AVISO DE VIAJE (mig. 0797) — todo en UN archivo (T-A4-17).
//
// Lee la configuración (`vigia_aviso_config`), las filas visibles del programa (0795) y los avisos ya creados, y
// guarda avisos nuevos en `vigia_aviso`. Sigue el patrón de `programa/repo.ts`:
//   1. TODA consulta lleva `tenant_id` (filtro o valor escrito).
//   2. Toda consulta pasa por `acotada` y un error de la base LANZA («no pude preguntar» ≠ «no hay nada»).
//   3. Sin `select *`; lecturas en páginas acotadas; ids en tandas de ≤ IDS_POR_TANDA.
//   4. Si la 0797 aún no está en la base (42P01 / PGRST205) se lanza `AvisoSinMigrar`.
//   5. Nada de contenido del aviso ni del programa en los logs.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../../presupuesto';
import { IDS_POR_TANDA } from '../../pg';

const SIN_0797 = new Set(['42P01', 'PGRST205']);

export class AvisoSinMigrar extends Error {
  constructor() {
    super('El aviso de viaje aún no está habilitado en esta base (falta aplicar la migración 0797).');
    this.name = 'AvisoSinMigrar';
  }
}

type ErrorBase = { message: string; code?: string } | null | undefined;

function exigir(op: string, error: ErrorBase): void {
  if (!error) return;
  if (error.code && SIN_0797.has(error.code)) throw new AvisoSinMigrar();
  throw new Error(`aviso.${op}: ${error.message}`);
}

export type ModoAviso = 'confirmar' | 'autonomo';
export type CanalAviso = 'ejecutivo_copia' | 'cliente_1a1';
export type EstadoAviso =
  | 'borrador' | 'pendiente_confirmacion' | 'aprobado' | 'enviado' | 'fallido'
  | 'descartado' | 'reemplazado' | 'sin_destinatario';

/** Configuración del aviso de una flota. Sin fila = apagado (el repo devuelve `null`). */
export interface ConfigAviso {
  habilitado: boolean;
  modo: ModoAviso;
  canalDefault: CanalAviso;
  ccpListos: string[];
  exigirTransito: boolean;
  secciones: string[];
  horasAntesCita: number | null;
  zona: string;
}

/** Lo que se lee de una fila del programa para decidir el aviso. */
export interface FilaDelPrograma {
  id: string;
  fecha: string;
  tipo: string;
  cliente: string | null;
  consignatario: string | null;
  caja: string | null;
  unidad: string | null;
  citaEn: string | null;
  citaTexto: string | null;
  transito: string;
  ccp: string;
}

export interface AvisoExistente {
  filaId: string;
  estado: EstadoAviso;
}

export interface NuevoAviso {
  filaId: string;
  clienteId: string | null;
  version: number;
  huella: string;
  estado: 'pendiente_confirmacion' | 'aprobado' | 'sin_destinatario';
  canal: CanalAviso;
  texto: string;
  datos: Record<string, unknown>;
  motivo: string;
  /** ISO; obligatorio si `estado` = 'aprobado' (lo exige el CHECK de la 0797). */
  aprobadoEn?: string | null;
}

export interface RepoAviso {
  /** `null` = la flota no tiene fila de configuración = APAGADO. */
  leerConfig(tenantId: string): Promise<ConfigAviso | null>;
  /** Una página de filas VISIBLES con fecha en [desde, hasta] (AAAA-MM-DD), orden estable. */
  filasVisibles(tenantId: string, desde: string, hasta: string, desplazamiento: number, limite: number): Promise<FilaDelPrograma[]>;
  /** Avisos que ya existen para esas filas (cualquier estado). */
  avisosDeFilas(tenantId: string, filaIds: string[]): Promise<AvisoExistente[]>;
  /** `duplicado` = ya existía (misma huella o misma versión de esa fila): no es un error. */
  insertarAviso(tenantId: string, aviso: NuevoAviso): Promise<'creado' | 'duplicado'>;
}

export const PAGINA_FILAS = 500;

const COLS_CONFIG = 'habilitado, modo, canal_default, ccp_listos, exigir_transito, secciones, horas_antes_cita, zona';
const COLS_FILA = 'id, fecha, tipo, cliente, consignatario, caja, unidad, cita_en, cita_texto, transito, ccp';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function aConfig(r: Record<string, unknown>): ConfigAviso {
  return {
    habilitado: r.habilitado === true,
    modo: r.modo === 'autonomo' ? 'autonomo' : 'confirmar',
    canalDefault: r.canal_default === 'cliente_1a1' ? 'cliente_1a1' : 'ejecutivo_copia',
    ccpListos: lista(r.ccp_listos),
    exigirTransito: r.exigir_transito === true,
    secciones: lista(r.secciones),
    horasAntesCita: typeof r.horas_antes_cita === 'number' ? r.horas_antes_cita : null,
    zona: str(r.zona) ?? 'America/Mexico_City',
  };
}

function aFila(r: Record<string, unknown>): FilaDelPrograma {
  return {
    id: String(r.id), fecha: String(r.fecha), tipo: String(r.tipo),
    cliente: str(r.cliente), consignatario: str(r.consignatario), caja: str(r.caja), unidad: str(r.unidad),
    citaEn: str(r.cita_en), citaTexto: str(r.cita_texto),
    transito: String(r.transito ?? 'vacio'), ccp: String(r.ccp ?? 'vacio'),
  };
}

export function crearRepoAviso(): RepoAviso {
  return {
    async leerConfig(tenantId) {
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso_config')
        .select(COLS_CONFIG).eq('tenant_id', tenantId).maybeSingle(), 'aviso.leer_config');
      exigir('leer_config', error);
      return data ? aConfig(data as Record<string, unknown>) : null;
    },

    async filasVisibles(tenantId, desde, hasta, desplazamiento, limite) {
      const { data, error } = await acotada(supabaseAdmin().from('programa_despacho_fila')
        .select(COLS_FILA).eq('tenant_id', tenantId).eq('visible', true)
        .gte('fecha', desde).lte('fecha', hasta)
        .order('fecha').order('id').range(desplazamiento, desplazamiento + limite - 1), 'aviso.filas_visibles');
      exigir('filas_visibles', error);
      return ((data ?? []) as Record<string, unknown>[]).map(aFila);
    },

    async avisosDeFilas(tenantId, filaIds) {
      const out: AvisoExistente[] = [];
      for (let i = 0; i < filaIds.length; i += IDS_POR_TANDA) {
        const tanda = filaIds.slice(i, i + IDS_POR_TANDA);
        const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso')
          .select('fila_id, estado').eq('tenant_id', tenantId).in('fila_id', tanda), 'aviso.avisos_de_filas');
        exigir('avisos_de_filas', error);
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          out.push({ filaId: String(r.fila_id), estado: String(r.estado) as EstadoAviso });
        }
      }
      return out;
    },

    async insertarAviso(tenantId, a) {
      const { error } = await acotada(supabaseAdmin().from('vigia_aviso').insert({
        tenant_id: tenantId, fila_id: a.filaId, cliente_id: a.clienteId, version: a.version, huella: a.huella,
        estado: a.estado, canal: a.canal, texto: a.texto, datos: a.datos, motivo: a.motivo,
        aprobado_en: a.aprobadoEn ?? null,
      }), 'aviso.insertar');
      // 23505 = la misma huella (o la misma versión) de esa fila ya entró: gana la primera, no es un fallo.
      if (error?.code === '23505') return 'duplicado';
      exigir('insertar', error);
      return 'creado';
    },
  };
}
