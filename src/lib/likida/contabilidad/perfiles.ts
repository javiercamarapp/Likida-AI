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

/**
 * EL ESCRITOR QUE FALTABA (plan maestro 26-ago, sección B). La tabla
 * `erp_export_perfil` (0178) existía con lector y ruta cableados, pero sin un
 * solo camino de inserción en todo el repo: el export a SAP B1/CONTPAQi
 * respondía 409 "pide a tu contador que confirme una plantilla" y esa
 * confirmación no tenía dónde hacerse. Para cualquier cliente — incluido uno
 * con SAP Business One — el archivo estaba permanentemente bloqueado.
 *
 * Se valida con EL MISMO `interpretarPerfilExportacion` que usa el lector,
 * ANTES de escribir: una fila que el lector rechazaría no debe poder entrar,
 * porque produciría el mismo 409 con una fila de por medio — peor que sin
 * fila, porque parecería confirmada.
 *
 * `confirmadoEn` lo pone el servidor (ahora), no el cliente: la fecha ES el
 * acto de confirmación del contador, no un dato que se captura.
 */
export async function guardarPerfilExportacionErp(
  tenantId: string,
  sistema: unknown,
  plantilla: unknown,
  confirmadoPor: string | null,
): Promise<PerfilExportacionErp> {
  const confirmadoEn = new Date().toISOString();
  const perfil = interpretarPerfilExportacion(sistema, plantilla, confirmadoEn);
  if (!perfil) {
    throw new Error(
      'La plantilla no tiene la forma que el export exige (CONTPAQi: tipo, número inicial, separador y encabezado de 9 columnas; SAP B1: las cuatro filas de la plantilla DTW con columnas parejas). No se guarda una plantilla que el export rechazaría.',
    );
  }
  const { error } = await acotada(
    supabaseAdmin().from('erp_export_perfil').upsert({
      tenant_id: tenantId,
      sistema: perfil.sistema,
      plantilla: perfil.sistema === 'contpaqi'
        ? { tipo: perfil.opciones.tipo, numeroInicial: perfil.opciones.numero, separador: perfil.opciones.separador, encabezado: perfil.opciones.encabezado }
        : perfil.plantilla,
      confirmado_en: confirmadoEn,
      confirmado_por: confirmadoPor,
      actualizado_en: confirmadoEn,
    }, { onConflict: 'tenant_id,sistema' }),
    'contabilidad.perfil_erp.guardar',
  );
  if (error) throw new Error(`guardarPerfilExportacionErp: ${error.message}`);
  return perfil;
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
