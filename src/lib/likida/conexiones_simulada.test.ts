import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cuenta de demostración: `tenant.config.demo_simulado = true` muestra lo no conectado como «(simulado)», nunca como medición real.
const d = vi.hoisted(() => ({ demo: false as boolean | 'error' }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let columnas = '';
      // Cadena genérica: cualquier filtro devuelve la misma cadena; `maybeSingle` y el `await` entregan el dato de la tabla.
      const cadena: Record<string, unknown> = {};
      const resultado = () => {
        if (tabla === 'tenant' && columnas === 'config') {
          return d.demo === 'error' ? { data: null, error: { message: 'x' } } : { data: { config: d.demo ? { demo_simulado: true } : {} }, error: null };
        }
        if (tabla === 'tenant') return { data: { buzon_token: null }, error: null };
        return { data: [], error: null, count: 0 };
      };
      for (const m of ['eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'neq']) cadena[m] = () => cadena;
      cadena.select = (c: string) => { columnas = c; return cadena; };
      cadena.maybeSingle = async () => resultado();
      cadena.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
      return cadena;
    },
  }),
}));
vi.mock('./presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));
vi.mock('./facturacion/flota_fiscal', () => ({ getFiscalDeFlota: async () => ({ flota: false, falta: ['cuenta de contador'] }) }));
vi.mock('./facturacion/adaptadores/registro', () => ({ portalesVivos: () => [], PORTALES_CONOCIDOS: [] }));
vi.mock('./facturacion/modo', () => ({ modoEfectivo: () => 'ensayo', mandatoFiscalAceptado: () => false }));
vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: () => false }));
vi.mock('./conectores/gps', () => ({ CONECTORES_GPS: [] }));
vi.mock('./conectores/posiciones', () => ({ lectorDe: () => null }));

import { getConexiones } from './conexiones';

describe('getConexiones: cuenta de demostración simulada', () => {
  beforeEach(() => { d.demo = false; });

  it('sin la marca, nada se disfraza: WhatsApp sigue sin configurar', async () => {
    const c = await getConexiones('t-1');
    const wa = c.find((x) => x.id === 'whatsapp');
    expect(wa?.estado).toBe('sin_configurar');
    expect(c.some((x) => x.nombre.includes('(simulado)'))).toBe(false);
  });

  it('con la marca, lo no listo pasa a listo pero rotulado como simulado', async () => {
    d.demo = true;
    const c = await getConexiones('t-1');
    const simulados = c.filter((x) => x.nombre.includes('(simulado)'));
    expect(simulados.length).toBeGreaterThan(0);
    for (const x of simulados) {
      expect(x.estado).toBe('listo');
      expect(x.detalle).toMatch(/Simulado/);
      expect(x.detalle).toMatch(/No es una medición real/);
      expect(x.falta).toEqual([]);
    }
  });

  it('si no se puede leer la marca, falla cerrado: se mide como siempre', async () => {
    d.demo = 'error';
    const c = await getConexiones('t-1');
    expect(c.some((x) => x.nombre.includes('(simulado)'))).toBe(false);
  });
});
