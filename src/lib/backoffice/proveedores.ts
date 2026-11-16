// PROVEEDORES de Likida como empresa (no de una flota). PURO arriba (validación, sugeridos); IO abajo con `Lectura<T>`:
// una tabla ausente es «No disponible. No es cero.», no «no hay proveedores».
import { supabaseAdmin } from '@/lib/supabase/admin';
import { esRfcValido } from '@/lib/likida/intake/cfdi';
import { desdeRespuesta, type Lectura } from './lectura';
import { CATEGORIAS_GASTO, normalizarTexto, type CategoriaGasto } from './clasificador';
import { errBo } from './utiles-c';
import { CADENCIAS_PROVEEDOR, type CadenciaProveedor } from './constantes-c';

export { CADENCIAS_PROVEEDOR, type CadenciaProveedor };

export interface Proveedor {
  id: string;
  nombre: string;
  rfc: string | null;
  categoria: CategoriaGasto;
  cuentaContable: string | null;
  cadencia: CadenciaProveedor;
  activo: boolean;
  /** Cuándo se dio de alta (instante ISO): un proveedor recién creado aún no puede tener «dos meses sin gasto». */
  creadoEn: string | null;
}

/**
 * Proveedores fijos conocidos (prompts/clasificador-de-gastos.md). Se ofrecen como botón «Agregar proveedor» con el nombre precargado y
 * CERO montos: los ~$6,500/mes del paquete son una estimación, no un dato, y no se siembran como gasto.
 */
export const PROVEEDORES_SUGERIDOS: ReadonlyArray<{ nombre: string; categoria: CategoriaGasto; cadencia: CadenciaProveedor }> = [
  { nombre: 'Vercel', categoria: 'infraestructura', cadencia: 'mensual' },
  { nombre: 'Supabase', categoria: 'infraestructura', cadencia: 'mensual' },
  { nombre: 'Resend', categoria: 'correo_observabilidad', cadencia: 'mensual' },
  { nombre: 'Sentry', categoria: 'correo_observabilidad', cadencia: 'mensual' },
  { nombre: 'Dominio', categoria: 'infraestructura', cadencia: 'anual' },
  { nombre: 'Claude Code', categoria: 'ia_modelos', cadencia: 'mensual' },
  { nombre: 'Facturapi', categoria: 'legal_firma', cadencia: 'por_uso' },
  { nombre: 'Mifiel', categoria: 'legal_firma', cadencia: 'por_uso' },
  { nombre: 'WhatsApp / Meta', categoria: 'whatsapp', cadencia: 'por_uso' },
];

/** Los sugeridos que todavía no están dados de alta (compara el nombre sin acentos ni mayúsculas). */
export function sugeridosFaltantes(existentes: ReadonlyArray<{ nombre: string }>): typeof PROVEEDORES_SUGERIDOS {
  const tengo = new Set(existentes.map((p) => normalizarTexto(p.nombre)));
  return PROVEEDORES_SUGERIDOS.filter((s) => !tengo.has(normalizarTexto(s.nombre)));
}

export interface EntradaProveedor {
  nombre: string;
  rfc?: string | null;
  categoria?: string | null;
  cadencia?: string | null;
  cuentaContable?: string | null;
}

export type ProveedorValido = { nombre: string; rfc: string | null; categoria: CategoriaGasto; cadencia: CadenciaProveedor; cuentaContable: string | null };

/** PURA. Valida y normaliza; LANZA `ErrorBo` con la clave del diccionario. El RFC es opcional (un proveedor extranjero no tiene). */
export function validarProveedor(e: EntradaProveedor): ProveedorValido {
  const nombre = (e.nombre ?? '').trim();
  if (nombre.length < 1 || nombre.length > 120) throw errBo('proveedores.err_nombre');
  const rfcCrudo = (e.rfc ?? '').trim().toUpperCase();
  if (rfcCrudo && !esRfcValido(rfcCrudo)) throw errBo('proveedores.err_rfc');
  const categoria = (e.categoria ?? 'otro') as CategoriaGasto;
  if (!CATEGORIAS_GASTO.includes(categoria)) throw errBo('proveedores.err_categoria');
  const cadencia = (e.cadencia ?? 'mensual') as CadenciaProveedor;
  if (!CADENCIAS_PROVEEDOR.includes(cadencia)) throw errBo('proveedores.err_cadencia');
  return { nombre, rfc: rfcCrudo || null, categoria, cadencia, cuentaContable: (e.cuentaContable ?? '').trim() || null };
}

const COLUMNAS = 'id, nombre, rfc, categoria, cuenta_contable, cadencia, activo, creado_en';

function aProveedor(f: Record<string, unknown>): Proveedor {
  return {
    id: String(f.id),
    nombre: String(f.nombre),
    rfc: typeof f.rfc === 'string' && f.rfc ? f.rfc : null,
    categoria: (CATEGORIAS_GASTO.includes(f.categoria as CategoriaGasto) ? f.categoria : 'otro') as CategoriaGasto,
    cuentaContable: typeof f.cuenta_contable === 'string' && f.cuenta_contable ? f.cuenta_contable : null,
    cadencia: (CADENCIAS_PROVEEDOR.includes(f.cadencia as CadenciaProveedor) ? f.cadencia : 'mensual') as CadenciaProveedor,
    activo: f.activo !== false,
    creadoEn: typeof f.creado_en === 'string' ? f.creado_en : null,
  };
}

/** Todos los proveedores (activos e inactivos), por nombre. `no_disponible` si la tabla aún no existe. */
export async function listarProveedores(): Promise<Lectura<Proveedor[]>> {
  try {
    const r = await supabaseAdmin().from('bo_proveedor').select(COLUMNAS).order('nombre').order('id').limit(500);
    const l = desdeRespuesta<Record<string, unknown>[]>({ data: r.data as Record<string, unknown>[] | null, error: r.error });
    if (l.estado !== 'ok') return l;
    return { estado: 'ok', dato: (l.dato ?? []).map(aProveedor) };
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** Da de alta un proveedor. Un nombre repetido (sin importar mayúsculas) se rechaza con mensaje claro, no con el error de Postgres. */
export async function crearProveedor(entrada: EntradaProveedor): Promise<string> {
  const v = validarProveedor(entrada);
  const { data, error } = await supabaseAdmin().from('bo_proveedor').insert({
    nombre: v.nombre, rfc: v.rfc, categoria: v.categoria, cadencia: v.cadencia, cuenta_contable: v.cuentaContable,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') throw errBo('proveedores.err_duplicado', { nombre: v.nombre });
    throw new Error(`crearProveedor: ${error.message}`);
  }
  return String((data as { id: string }).id);
}
