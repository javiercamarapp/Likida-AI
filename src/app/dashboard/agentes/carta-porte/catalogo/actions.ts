'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { exigir } from '@/lib/likida/pg';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { tablaAusente } from '@/lib/likida/carta_porte_docs/repo';
import {
  CONFLICTO, TABLA, TIPOS_PLANTILLA, TOPE_BYTES_IMPORTACION, importarCatalogo,
  type PuertoImportacion, type Registro, type ResultadoImportacion, type TipoPlantilla,
} from '@/lib/likida/carta_porte_docs/catalogo_import';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTAR EL CATÁLOGO DEL CLIENTE POR CSV (T-A3-21).
//
// Server action A NIVEL DE MÓDULO (no cierra sobre nada del componente). Vuelve a resolver sesión, rol y flota
// desde la cookie: JAMÁS acepta un tenant_id del formulario; los campos `tenant`/`vista`/`rol` que viajan son el
// mismo «ver como» firmado que ya trae la URL del superadmin, y `resolverTenantEfectivo` los valida.
// La ruta que gatea es la del agente (clasificada en el perfil cinco_agentes); la pantalla del catálogo (T-A3-22)
// hereda esta acción.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/carta-porte';
const PAGINA = 1000;
/** Tope de filas existentes que se leen para comparar (≈ el máximo de un archivo × margen). */
const TOPE_LECTURA = 60_000;

export type EstadoImportacion = (ResultadoImportacion & { tipo: TipoPlantilla }) | { ok: false; error: string } | null;

const esTipo = (v: string): v is TipoPlantilla => (TIPOS_PLANTILLA as readonly string[]).includes(v);

const COLUMNAS_LECTURA: Record<TipoPlantilla, string> = {
  producto: 'cliente_id, sku, descripcion_patron, bienes_transp, clave_unidad, embalaje, fraccion, tipo_materia, material_peligroso, clave_material_peligroso',
  parte: 'cliente_id, rol, alias, razon_social, rfc, id_fiscal_extranjero, calle, num_ext, num_int, colonia_clave, colonia, cp, localidad_clave, localidad, municipio_clave, municipio, estado, pais, contacto, telefono, correo',
  cliente_numero: 'cliente_id, numero_interno, numero_pagador, activo',
};
const ORDEN: Record<TipoPlantilla, string[]> = { producto: ['cliente_id', 'sku'], parte: ['cliente_id', 'rol', 'alias'], cliente_numero: ['cliente_id'] };

/** El puerto real: siempre filtra por el tenant de la sesión. */
function puertoSupabase(): PuertoImportacion {
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

/**
 * Un solo envío atiende los dos botones: `intencion=previsualizar` (no escribe) o `intencion=confirmar` (escribe,
 * solo si ninguna fila trae error). Campos: `tipo` (producto | parte | cliente_numero) y `archivo` (el CSV).
 */
export async function importarCatalogoCsv(_previo: EstadoImportacion, fd: FormData): Promise<EstadoImportacion> {
  const sp = {
    tenant: typeof fd.get('tenant') === 'string' ? String(fd.get('tenant')) : undefined,
    rol: typeof fd.get('rol') === 'string' ? String(fd.get('rol')) : undefined,
    vista: typeof fd.get('vista') === 'string' ? String(fd.get('vista')) : undefined,
  };
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede administrar el catálogo de Carta Porte.' };
  try {
    const tipo = String(fd.get('tipo') ?? '');
    if (!esTipo(tipo)) return { ok: false, error: 'Elige qué vas a importar: productos, remitentes y destinatarios, o la tabla cliente → número.' };
    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Elige un archivo CSV.' };
    if (archivo.size > TOPE_BYTES_IMPORTACION) return { ok: false, error: `El archivo pesa más de ${TOPE_BYTES_IMPORTACION / 1024 / 1024} MB. Pártelo en varios.` };
    const confirmar = String(fd.get('intencion') ?? '') === 'confirmar';
    if (!(await rateLimit(`cp-catalogo-import:${s.tenantId}`, confirmar ? 10 : 20, 60_000))) {
      return { ok: false, error: 'Demasiadas importaciones en poco tiempo. Espera un minuto.' };
    }
    const r = await importarCatalogo(
      { tenantId: s.tenantId, actorId: s.userId, tipo, bytes: new Uint8Array(await archivo.arrayBuffer()), confirmar },
      puertoSupabase(),
    );
    if (r.aplicado) {
      // Solo conteos: la bitácora sobrevive a un borrado ARCO y no lleva datos de terceros.
      await anotarBitacora(
        { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.catalogo_importado', entidad: 'tenant', entidadId: s.tenantId, detalle: { tipo, nuevas: r.nuevas, cambian: r.cambian } },
        { evento: 'carta_porte_docs.bitacora_no_escribio' },
      );
      revalidatePath(`${RUTA}/catalogo`);
    }
    return { ...r, tipo };
  } catch (e) {
    logger.error('carta_porte_docs.catalogo_import', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error && /migración 0792/.test(e.message) ? e.message : mensajeParaPantalla(e, 'importar el catálogo') };
  }
}
