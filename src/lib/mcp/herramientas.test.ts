import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL DESPACHADOR Y EL CATÁLOGO — las guardas que hacen o rompen la puerta.
//
//   · el ÁREA se exige ANTES de ejecutar: una llave de tablero (operacion)
//     que pide una herramienta de dinero se queda sin ejecutar NADA;
//   · argumentos que no pasan el esquema no llegan al lector;
//   · el catálogo entero es de solo lectura y sus DESCRIPCIONES —que las lee
//     un modelo de terceros— no filtran estructura interna: ni nombres de
//     tablas, ni columnas, ni la palabra Supabase.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('el despachador negó y AUN ASÍ se tocó la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { describirHerramientas, despacharHerramienta, catalogoHerramientas } from './herramientas';
import type { Area } from '@/lib/auth/visibilidad';

const SOLO_OPERACION = (a: Area) => a === 'operacion';
const NADA = () => false;

describe('despacharHerramienta — las guardas', () => {
  it('una herramienta desconocida es error de protocolo, no ejecución', async () => {
    const r = await despacharHerramienta('borrar_todo', {}, 't-1', SOLO_OPERACION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe('desconocida');
  });

  it('el área se exige ANTES de ejecutar: llave de operación vs. cada herramienta de dinero', async () => {
    for (const nombre of ['cuadre_viaje', 'por_facturar', 'resumen_fiscal', 'metricas_flota']) {
      const r = await despacharHerramienta(nombre, { viaje: 'F-1' }, 't-1', SOLO_OPERACION);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.tipo).toBe('sin_permiso');
        // El mensaje dice qué falta sin filtrar nada interno.
        expect(r.tipo === 'sin_permiso' && r.mensaje).toContain('dinero');
      }
    }
    // El mock de supabase LANZA si alguien lo toca: llegar aquí sin explotar
    // es la prueba de que negar no ejecutó ninguna lectura.
  });

  it('una credencial sin áreas no alcanza NINGUNA herramienta', async () => {
    for (const h of catalogoHerramientas()) {
      const r = await despacharHerramienta(h.nombre, {}, 't-1', NADA);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.tipo).toBe('sin_permiso');
    }
  });

  it('argumentos inválidos no llegan al lector', async () => {
    // `limite` fuera de rango y `estatus` fuera del dominio.
    const r1 = await despacharHerramienta('listar_viajes', { limite: 5000 }, 't-1', SOLO_OPERACION);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.tipo).toBe('argumentos');
    const r2 = await despacharHerramienta('listar_viajes', { estatus: 'cancelado' }, 't-1', SOLO_OPERACION);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.tipo).toBe('argumentos');
  });
});

describe('el catálogo — lo que un modelo de terceros va a leer', () => {
  const descritas = describirHerramientas();

  it('las ocho herramientas esperadas, ni una más', () => {
    expect(descritas.map((d) => d.name).sort()).toEqual([
      'cuadre_viaje', 'fetch', 'listar_viajes', 'metricas_flota',
      'por_facturar', 'resumen_fiscal', 'search', 'unidades_vigencias',
    ]);
  });

  it('TODAS se declaran de solo lectura y ninguna destructiva', () => {
    for (const d of descritas) {
      const a = d.annotations as Record<string, unknown>;
      expect(a.readOnlyHint, String(d.name)).toBe(true);
      expect(a.destructiveHint, String(d.name)).toBe(false);
      expect(a.openWorldHint, String(d.name)).toBe(false);
    }
  });

  it('las descripciones no filtran estructura interna ni invitan a escribir', () => {
    // Nombres de tablas/columnas reales y vocabulario de infraestructura que
    // jamás debe viajar a un modelo ajeno.
    const PROHIBIDAS = [
      'tenant_id', 'supabase', 'postgres', 'sql', 'service_role',
      'factura_emitida', 'pago_recibido', 'app_user', 'bitacora_auditoria',
      'ingreso_flete', 'cfdi_uuid', 'total_comprobado', 'select ', 'insert ',
    ];
    for (const d of descritas) {
      const texto = `${String(d.description)} ${JSON.stringify(d.inputSchema)}`.toLowerCase();
      for (const p of PROHIBIDAS) {
        expect(texto.includes(p), `«${p}» apareció en ${String(d.name)}`).toBe(false);
      }
    }
  });

  it('cada inputSchema es un objeto JSON Schema con additionalProperties cerrado', () => {
    for (const d of descritas) {
      const s = d.inputSchema as Record<string, unknown>;
      expect(s.type, String(d.name)).toBe('object');
    }
  });

  it('search y fetch tienen la forma que ChatGPT exige (query / id)', () => {
    const search = descritas.find((d) => d.name === 'search');
    const fetch_ = descritas.find((d) => d.name === 'fetch');
    const propsDe = (d: Record<string, unknown> | undefined) =>
      Object.keys(((d?.inputSchema as Record<string, unknown>)?.properties as Record<string, unknown>) ?? {});
    expect(propsDe(search)).toEqual(['query']);
    expect(propsDe(fetch_)).toEqual(['id']);
  });
});
