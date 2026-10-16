// ═══════════════════════════════════════════════════════════════════════════
// EL PUERTO REAL DEL CATÁLOGO DE DISTANCIAS (T-A3-51, migración 0830).
//
// Lo que la importación por CSV y la lectura por documento necesitan de la base. Siempre filtra por el tenant que se
// le pasa (quien llama lo saca de la SESIÓN, nunca de un formulario). Sin la 0830 aplicada, leer devuelve «sin rutas»
// (la distancia queda como dato faltante, que es el comportamiento seguro) y escribir avisa con un mensaje llano.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { exigir } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';
import { tablaAusente } from './repo';
import { CONFLICTO_DISTANCIA, TABLA_DISTANCIA, type PuertoDistancias, type RegistroDistancia, type RutaDistancia } from './catalogo_distancias';

const PAGINA = 1000;
/** Tope de rutas que se leen por cliente (una tabla de rutas de un cliente no llega a esto: es un seguro). */
export const TOPE_RUTAS_CLIENTE = 20_000;
const COLUMNAS = 'cliente_id, tipo, origen, destino, km';

type Fila = { cliente_id: string; tipo: string; origen: string; destino: string; km: number | string };

export function puertoDistanciasSupabase(): PuertoDistancias {
  return {
    async clientes(tenantId) {
      const r = await acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(5000), 'cpdist.clientes');
      return ((exigir(r, 'cpdist.clientes') ?? []) as unknown as Array<{ id: string; nombre: string }>).map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));
    },
    async existentes(tenantId, clienteIds) {
      const salida: RegistroDistancia[] = [];
      for (let desde = 0; desde < TOPE_RUTAS_CLIENTE * 3; desde += PAGINA) {
        const r = await acotada(
          supabaseAdmin().from(TABLA_DISTANCIA).select(COLUMNAS).eq('tenant_id', tenantId).in('cliente_id', clienteIds)
            .order('cliente_id').order('tipo').order('origen').order('destino').range(desde, desde + PAGINA - 1),
          'cpdist.existentes',
        );
        if (tablaAusente(r.error)) throw new Error('El catálogo de distancias todavía no está habilitado en la base (falta aplicar la migración 0830).');
        const filas = (exigir(r, 'cpdist.existentes') ?? []) as unknown as Fila[];
        salida.push(...filas.map((f): RegistroDistancia => ({ cliente_id: String(f.cliente_id), tipo: f.tipo === 'municipio' ? 'municipio' : 'cp', origen: String(f.origen), destino: String(f.destino), km: String(f.km) })));
        if (filas.length < PAGINA) break;
      }
      return salida;
    },
    async aplicarLote(tenantId, registros, actorId) {
      const ahora = new Date().toISOString();
      const filas = registros.map((x) => ({ ...x, tenant_id: tenantId, updated_by: actorId, updated_at: ahora }));
      const r = await acotada(supabaseAdmin().from(TABLA_DISTANCIA).upsert(filas, { onConflict: CONFLICTO_DISTANCIA }), 'cpdist.aplicar');
      exigir(r as never, 'cpdist.aplicar');
    },
  };
}

/** Las rutas de UN cliente de UNA flota. Filtra por tenant Y cliente. Sin la 0830 aplicada devuelve `[]` y lo registra. */
export async function cargarDistanciasCliente(tenantId: string, clienteId: string): Promise<RutaDistancia[]> {
  const r = await acotada(
    supabaseAdmin().from(TABLA_DISTANCIA).select(COLUMNAS).eq('tenant_id', tenantId).eq('cliente_id', clienteId)
      .order('tipo').order('origen').order('destino').limit(TOPE_RUTAS_CLIENTE),
    'cpdist.cargar',
  );
  if (tablaAusente(r.error)) {
    logger.warn('cartaporte_docs.distancias_sin_migracion', { tenantId });
    return [];
  }
  const filas = (exigir(r, 'cpdist.cargar') ?? []) as unknown as Fila[];
  if (filas.length >= TOPE_RUTAS_CLIENTE) logger.warn('cartaporte_docs.distancias_truncado', { tenantId, filas: filas.length });
  return filas.map((f): RutaDistancia => ({ tenantId, clienteId, tipo: f.tipo === 'municipio' ? 'municipio' : 'cp', origen: String(f.origen), destino: String(f.destino), km: Number(f.km) }));
}
