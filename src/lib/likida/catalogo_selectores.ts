import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { traerTodo, conteo } from './pg';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CATÁLOGOS QUE ALIMENTAN UN `<select>` COMPLETO (A37-S18-06).
//
// `Estadías` leía clientes y geocercas con `.limit(500)` y `Facturación` leía los
// clientes SIN límite — y PostgREST recorta a 1,000 (`max_rows`) en silencio. Una
// flota con 500+ clientes no podía pactar la detención de los siguientes, y con
// 1,000+ no podía registrar una factura al cliente 1,001: el `<select required>` no
// lo ofrece y NINGUNA pantalla lo decía (el comentario FE-1 de Facturación cubre solo el
// caso de error, no el recorte).
//
// `traerTodo` pagina hasta el final y DEMUESTRA que no faltó nada contra el `count`
// exacto de la primera página; si no puede demostrarlo, LANZA (`LecturaIncompleta`)
// y la pantalla dice «no se pudo leer» — nunca una lista silenciosamente corta.
// ═══════════════════════════════════════════════════════════════════════════

export interface ClienteSelector {
  id: string;
  nombre: string;
  diasCredito: number | null;
  geocercaId: string | null;
}

export interface GeocercaSelector { id: string; nombre: string }

/** TODOS los clientes activos de la flota, por nombre. LANZA si la lectura no se puede completar. */
export async function clientesActivosCompletos(tenantId: string): Promise<ClienteSelector[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('cliente')
      .select('id, nombre, dias_credito, geocerca_id', conteo(d))
      .eq('tenant_id', tenantId).eq('activo', true)
      .order('nombre').order('id').range(d, h), 'selectores.clientes'),
    'selectores.clientes',
  );
  return filas.map((c) => ({
    id: String(c.id),
    nombre: String(c.nombre),
    diasCredito: typeof c.dias_credito === 'number' ? c.dias_credito : null,
    geocercaId: (c.geocerca_id as string | null) ?? null,
  }));
}

/**
 * TODOS los SITIOS DEL CLIENTE activos de la flota, por nombre. LANZA si la
 * lectura no se puede completar.
 *
 * A39-ARQ-03: va acotada a `catalogo = 'conductor'`. La 0480 separó los dos
 * catálogos de `geocerca` y los declaró inmutables: `'conductor'` son los
 * sitios (cliente, planta, andén, patio, punto de interés) y `'peajes'` son
 * las casetas y los puntos de ruta. Esta función alimenta el desplegable
 * «Sitio del cliente» del pacto de detención (`estadias.tsx:137`), su único
 * consumidor; sin el predicado ofrecía casetas de peaje, y una estadía pactada
 * contra una caseta a 40 km del patio del cliente no abre episodio nunca: la
 * pantalla factura $0.00 afirmando que midió. La separación ya se respetaba en
 * la otra dirección (`peajes/repo.ts:754` se niega a tocar un sitio del
 * conductor); esta era la única puerta sin la reja.
 */
export async function geocercasActivasCompletas(tenantId: string): Promise<GeocercaSelector[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('geocerca')
      .select('id, nombre', conteo(d))
      .eq('tenant_id', tenantId).eq('activa', true).eq('catalogo', 'conductor')
      .order('nombre').order('id').range(d, h), 'selectores.geocercas'),
    'selectores.geocercas',
  );
  return filas.map((g) => ({ id: String(g.id), nombre: String(g.nombre) }));
}
