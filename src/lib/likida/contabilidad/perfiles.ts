import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import type { OpcionesContpaqi, PerfilSapB1 } from './formatos';

export type PerfilExportacionErp =
  | { sistema: 'contpaqi'; confirmadoEn: string; opciones: OpcionesContpaqi }
  | { sistema: 'sap_b1'; confirmadoEn: string; plantilla: PerfilSapB1 };

const texto = (v: unknown): string | null => typeof v === 'string' && v.trim().length > 0 && v.length <= 100 && !/[\r\n\t]/.test(v) ? v.trim() : null;
const columnas = (v: unknown, minimo: number): string[] | null => {
  if (!Array.isArray(v) || v.length < minimo || v.length > 40) return null;
  const r = v.map(texto);
  return r.every((x): x is string => x !== null) ? r : null;
};

/**
 * Convierte una fila confirmada por el contador en un perfil usable. Cualquier
 * forma extraña se rechaza: usar encabezados "parecidos" es peor que pedir la
 * plantilla correcta antes del primer import.
 */
export function interpretarPerfilExportacion(sistema: unknown, plantilla: unknown, confirmadoEn: unknown): PerfilExportacionErp | null {
  if (typeof confirmadoEn !== 'string' || Number.isNaN(Date.parse(confirmadoEn)) || !plantilla || typeof plantilla !== 'object') return null;
  const p = plantilla as Record<string, unknown>;
  if (sistema === 'contpaqi') {
    const tipo = texto(p.tipo);
    const numero = Number(p.numeroInicial ?? 1);
    const separador = p.separador === ',' || p.separador === '\t' || p.separador === '|' ? p.separador : null;
    const encabezado = columnas(p.encabezado, 9);
    if (!tipo || !Number.isInteger(numero) || numero < 1 || !separador || !encabezado || encabezado.length !== 9) return null;
    return { sistema: 'contpaqi', confirmadoEn, opciones: { tipo, numero, separador, encabezado } };
  }
  if (sistema === 'sap_b1') {
    const cabeceraTecnica = columnas(p.cabeceraTecnica, 5);
    const cabeceraVisible = columnas(p.cabeceraVisible, 5);
    const lineasTecnica = columnas(p.lineasTecnica, 7);
    const lineasVisible = columnas(p.lineasVisible, 7);
    if (!cabeceraTecnica || !cabeceraVisible || !lineasTecnica || !lineasVisible || cabeceraTecnica.length !== cabeceraVisible.length || lineasTecnica.length !== lineasVisible.length) return null;
    return { sistema: 'sap_b1', confirmadoEn, plantilla: { cabeceraTecnica, cabeceraVisible, lineasTecnica, lineasVisible } };
  }
  return null;
}

/** Lee solo una plantilla ya confirmada; no interpreta una credencial como listo. */
export async function perfilExportacionDeclarado(tenantId: string, sistema: 'contpaqi' | 'sap_b1'): Promise<PerfilExportacionErp | null> {
  const { data, error } = await acotada(
    supabaseAdmin().from('erp_export_perfil').select('sistema, plantilla, confirmado_en').eq('tenant_id', tenantId).eq('sistema', sistema).maybeSingle(),
    'contabilidad.perfil_erp',
  );
  if (error) throw new Error(`perfilExportacionDeclarado: ${error.message}`);
  if (!data) return null;
  return interpretarPerfilExportacion(data.sistema, data.plantilla, data.confirmado_en);
}
