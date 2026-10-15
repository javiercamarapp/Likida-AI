// ═══════════════════════════════════════════════════════════════════════════
// EL PUERTO REAL DEL CATÁLOGO POR CLIENTE (T-A3-21, compartido con T-A3-22).
//
// Lo único que la importación por CSV, la edición en línea de la pantalla del catálogo y «guardar desde un documento»
// necesitan de la base. Siempre filtra por el tenant que se le pasa: quien lo llama obtiene ese tenant de la SESIÓN,
// nunca de un formulario. Vive fuera del archivo de acciones porque un archivo `'use server'` solo exporta funciones
// asíncronas y el visor de documentos lo reutiliza.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { exigir } from '@/lib/likida/pg';
import { tablaAusente } from './repo';
import { CONFLICTO, TABLA, type PuertoImportacion, type Registro, type TipoPlantilla } from './catalogo_import';

const PAGINA = 1000;
/** Tope de filas existentes que se leen para comparar (≈ el máximo de un archivo × margen). */
const TOPE_LECTURA = 60_000;

const COLUMNAS_LECTURA: Record<TipoPlantilla, string> = {
  producto: 'cliente_id, sku, descripcion_patron, bienes_transp, clave_unidad, embalaje, fraccion, tipo_materia, material_peligroso, clave_material_peligroso',
  parte: 'cliente_id, rol, alias, razon_social, rfc, id_fiscal_extranjero, calle, num_ext, num_int, colonia_clave, colonia, cp, localidad_clave, localidad, municipio_clave, municipio, estado, pais, contacto, telefono, correo',
  cliente_numero: 'cliente_id, numero_interno, numero_pagador, activo',
};
const ORDEN: Record<TipoPlantilla, string[]> = { producto: ['cliente_id', 'sku'], parte: ['cliente_id', 'rol', 'alias'], cliente_numero: ['cliente_id'] };

/** El puerto real: siempre filtra por el tenant de la sesión. */
export function puertoSupabase(): PuertoImportacion {
  return {
    async clientes(tenantId) {
      const r = await acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(5000), 'cpcat.clientes');
      return ((exigir(r, 'cpcat.clientes') ?? []) as unknown as Array<{ id: string; nombre: string }>).map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));
    },
    async existentes(tenantId, tipo, clienteIds) {
      const salida: Registro[] = [];
      for (let desde = 0; desde < TOPE_LECTURA; desde += PAGINA) {
        let q = supabaseAdmin().from(TABLA[tipo]).select(COLUMNAS_LECTURA[tipo]).eq('tenant_id', tenantId).in('cliente_id', clienteIds);
        for (const o of ORDEN[tipo]) q = q.order(o);
        const r = await acotada(q.range(desde, desde + PAGINA - 1), 'cpcat.existentes');
        if (tablaAusente(r.error)) throw new Error('El catálogo todavía no está habilitado en la base (falta aplicar la migración 0792).');
        const filas = (exigir(r, 'cpcat.existentes') ?? []) as unknown as Registro[];
        salida.push(...filas);
        if (filas.length < PAGINA) break;
      }
      return salida;
    },
    async aplicarLote(tenantId, tipo, registros, actorId) {
      const ahora = new Date().toISOString();
      const filas = registros.map((r) => ({ ...r, tenant_id: tenantId, updated_by: actorId, updated_at: ahora }));
      const r = await acotada(supabaseAdmin().from(TABLA[tipo]).upsert(filas, { onConflict: CONFLICTO[tipo] }), 'cpcat.aplicar');
      exigir(r as never, 'cpcat.aplicar');
    },
  };
}

