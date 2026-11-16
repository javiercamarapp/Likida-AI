// Contratistas de Likida (tabla `bo_contratista`, migración 1012): REGISTRO LIGERO. La nómina se compra (Runa HR u otro): aquí no se calcula ni se timbra nada.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rfcChecksumOk } from '@/lib/likida/intake/cfdi';
import { esTablaAusente, leerSeguro, type Lectura } from './lectura';

export type EsquemaContratista = 'honorarios' | 'comision' | 'sueldo_fijo' | 'proveedor_nomina';
export const ESQUEMAS_CONTRATISTA: readonly EsquemaContratista[] = ['honorarios', 'comision', 'sueldo_fijo', 'proveedor_nomina'];

export interface Contratista {
  id: string;
  nombre: string;
  rol: string | null;
  esquema: EsquemaContratista;
  rfc: string | null;
  cfdiHonorariosVigente: boolean | null;
  constanciaSituacionFiscalEn: string | null;
  contratoId: string | null;
  vendedorId: string | null;
  activo: boolean;
  nota: string | null;
}

/** Estado del CFDI de honorarios. `ausente` = sin dato (null) o sin RFC; `vencido` = marcado como no vigente. Solo aplica a honorarios y comisión. */
export type EstadoCfdiHonorarios = 'no_aplica' | 'vigente' | 'vencido' | 'ausente';
export type HallazgoContratista = 'cfdi_vencido' | 'cfdi_ausente' | 'sin_rfc' | 'sin_constancia';

export function estadoCfdiHonorarios(c: Pick<Contratista, 'esquema' | 'cfdiHonorariosVigente'>): EstadoCfdiHonorarios {
  if (c.esquema !== 'comision' && c.esquema !== 'honorarios') return 'no_aplica';
  if (c.cfdiHonorariosVigente === true) return 'vigente';
  if (c.cfdiHonorariosVigente === false) return 'vencido';
  return 'ausente';
}

/** Lo que hay que atender de un contratista activo. Un esquema sin CFDI de honorarios (sueldo fijo, proveedor de nómina) no genera hallazgos de CFDI ni de constancia. */
export function hallazgosContratista(c: Contratista): HallazgoContratista[] {
  if (!c.activo) return [];
  const h: HallazgoContratista[] = [];
  const cfdi = estadoCfdiHonorarios(c);
  if (cfdi === 'vencido') h.push('cfdi_vencido');
  if (cfdi === 'ausente') h.push('cfdi_ausente');
  if (cfdi !== 'no_aplica') {
    if (!c.rfc) h.push('sin_rfc');
    if (!c.constanciaSituacionFiscalEn) h.push('sin_constancia');
  }
  return h;
}

export interface EntradaContratista {
  nombre: string;
  rol?: string;
  esquema: string;
  rfc?: string;
  /** '' = sin dato, 'si' o 'no'. */
  cfdiVigente?: string;
  constanciaEn?: string;
  contratoId?: string;
  nota?: string;
}

export type ErrorContratista = 'nombre' | 'rol' | 'esquema' | 'rfc' | 'cfdi' | 'constancia' | 'nota' | 'duplicado' | 'tabla' | 'no_encontrado';

export interface ContratistaValido {
  nombre: string; rol: string | null; esquema: EsquemaContratista; rfc: string | null; cfdiHonorariosVigente: boolean | null;
  constanciaEn: string | null; contratoId: string | null; nota: string | null;
}

const lim = (s: string | undefined) => (s ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validarContratista(e: EntradaContratista): { ok: true; valor: ContratistaValido } | { ok: false; error: ErrorContratista } {
  const nombre = lim(e.nombre);
  if (nombre === '' || nombre.length > 160) return { ok: false, error: 'nombre' };
  const rol = lim(e.rol);
  if (rol.length > 120) return { ok: false, error: 'rol' };
  const esquema = lim(e.esquema) as EsquemaContratista;
  if (!ESQUEMAS_CONTRATISTA.includes(esquema)) return { ok: false, error: 'esquema' };
  const rfc = lim(e.rfc).toUpperCase();
  if (rfc !== '' && !rfcChecksumOk(rfc)) return { ok: false, error: 'rfc' };
  const cfdi = lim(e.cfdiVigente);
  if (cfdi !== '' && cfdi !== 'si' && cfdi !== 'no') return { ok: false, error: 'cfdi' };
  const constancia = lim(e.constanciaEn);
  // Un mes o día imposible («2026-13-01») hace que `toISOString()` LANCE RangeError: se mira el instante antes de formatearlo.
  const instante = /^\d{4}-\d{2}-\d{2}$/.test(constancia) ? new Date(`${constancia}T00:00:00Z`) : null;
  if (constancia !== '' && !(instante !== null && !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === constancia)) return { ok: false, error: 'constancia' };
  const nota = lim(e.nota);
  if (nota.length > 500) return { ok: false, error: 'nota' };
  const contratoId = lim(e.contratoId);
  return {
    ok: true,
    valor: {
      nombre, rol: rol === '' ? null : rol, esquema, rfc: rfc === '' ? null : rfc,
      cfdiHonorariosVigente: cfdi === '' ? null : cfdi === 'si',
      constanciaEn: constancia === '' ? null : constancia,
      contratoId: UUID.test(contratoId) ? contratoId : null,
      nota: nota === '' ? null : nota,
    },
  };
}

interface FilaBd {
  id: string; nombre: string; rol: string | null; esquema: EsquemaContratista; rfc: string | null; cfdi_honorarios_vigente: boolean | null;
  constancia_situacion_fiscal_en: string | null; contrato_id: string | null; vendedor_id: string | null; activo: boolean; nota: string | null;
}

export const contratistaDeFila = (f: FilaBd): Contratista => ({
  id: f.id, nombre: f.nombre, rol: f.rol, esquema: f.esquema, rfc: f.rfc, cfdiHonorariosVigente: f.cfdi_honorarios_vigente,
  constanciaSituacionFiscalEn: f.constancia_situacion_fiscal_en, contratoId: f.contrato_id, vendedorId: f.vendedor_id, activo: f.activo, nota: f.nota,
});

export async function listarContratistas(): Promise<Lectura<Contratista[]>> {
  return leerSeguro(async () => {
    const r = await supabaseAdmin().from('bo_contratista')
      .select('id,nombre,rol,esquema,rfc,cfdi_honorarios_vigente,constancia_situacion_fiscal_en,contrato_id,vendedor_id,activo,nota')
      .order('activo', { ascending: false }).order('nombre', { ascending: true }).order('id').limit(500);
    if (r.error) throw r.error;
    return ((r.data ?? []) as unknown as FilaBd[]).map(contratistaDeFila);
  });
}

type Resultado = { ok: true; id: string } | { ok: false; error: ErrorContratista };

export async function crearContratista(entrada: EntradaContratista, actorId: string | null): Promise<Resultado> {
  const v = validarContratista(entrada);
  if (!v.ok) return v;
  const x = v.valor;
  const r = await supabaseAdmin().from('bo_contratista').insert({
    nombre: x.nombre, rol: x.rol, esquema: x.esquema, rfc: x.rfc, cfdi_honorarios_vigente: x.cfdiHonorariosVigente,
    constancia_situacion_fiscal_en: x.constanciaEn, contrato_id: x.contratoId, nota: x.nota, creado_por: actorId,
  }).select('id').single();
  if (r.error) {
    if (esTablaAusente(r.error)) return { ok: false, error: 'tabla' };
    if (r.error.code === '23505') return { ok: false, error: 'duplicado' };
    throw r.error;
  }
  return { ok: true, id: (r.data as { id: string }).id };
}

/** Desactiva (no borra): la fila queda como historial y libera el nombre. */
export async function desactivarContratista(id: string): Promise<Resultado> {
  const r = await supabaseAdmin().from('bo_contratista').update({ activo: false }).eq('id', id).eq('activo', true).select('id').maybeSingle();
  if (r.error) {
    if (esTablaAusente(r.error)) return { ok: false, error: 'tabla' };
    throw r.error;
  }
  return r.data ? { ok: true, id } : { ok: false, error: 'no_encontrado' };
}
