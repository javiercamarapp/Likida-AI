import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DECLARADO: lo que la flota escribió, NUNCA el default demo.
//
// El export leía `tenant.perfil.contabilidad.cuentas`, que nadie escribe: 409
// eterno apuntando a una pantalla inexistente, mientras el catálogo vivo estaba
// en `tenant.config.catalogoCuentas` desde el 14-ago.
//
// Y la trampa del arreglo obvio: `getConfig()` FUSIONA `DEMO_CONFIG`, cuyas
// cuentas (600-001…) están marcadas 🔴 demo. Cablear el export ahí habría
// asentado cuentas inventadas en el ERP de una flota real — el modo de falla
// exacto que `poliza.ts` existe para impedir. Por eso se lee el override crudo.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

let configDeLaFlota: unknown = null;
let errorBase: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const f: Record<string, unknown> = {};
      Object.assign(f, {
        select: () => f,
        eq: () => f,
        maybeSingle: async () =>
          errorBase ? { data: null, error: errorBase } : { data: { config: configDeLaFlota }, error: null },
      });
      return f;
    },
  }),
}));

import { readFileSync } from 'node:fs';
import { catalogoDeclarado, armarCatalogo, CUENTAS_BALANCE, AYUDA_BALANCE } from './catalogo';

beforeEach(() => { configDeLaFlota = null; errorBase = null; });

describe('solo cuenta lo que la flota declaró', () => {
  it('una flota sin config NO hereda las cuentas demo', async () => {
    configDeLaFlota = null;
    const r = await catalogoDeclarado('t-1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('sin_declarar');
  });

  it('config sin `catalogoCuentas` tampoco: no es un catálogo vacío, es ninguno', async () => {
    configDeLaFlota = { tabulador: { rendimientoPorDefecto: 3 } };
    const r = await catalogoDeclarado('t-1');
    expect(r.ok).toBe(false);
  });

  it('un mapa vacío se lee como no declarado', async () => {
    configDeLaFlota = { catalogoCuentas: {} };
    expect((await catalogoDeclarado('t-1')).ok).toBe(false);
  });

  it('LAS CUENTAS DEMO NO SON LAS DE NADIE: 600-001 no puede salir sin declararse', async () => {
    // La prueba que guarda el defecto: si alguien cambia esto por getConfig(),
    // este caso truena porque el default trae diesel=600-001. Se lee del
    // ARCHIVO y no se importa: `config.ts` arrastra `conv.ts`, que exige
    // variables de entorno, y esta prueba no necesita ninguna.
    const fuente = readFileSync('src/lib/likida/config.ts', 'utf8');
    expect(fuente, 'DEMO_CONFIG ya no trae diesel=600-001: revisa que esta guarda siga midiendo algo')
      .toContain("diesel: '600-001'");
    configDeLaFlota = null;
    const r = await catalogoDeclarado('t-1');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('600-001');
  });

  it('lo declarado sale tal cual, sin mezclarse con el default', async () => {
    configDeLaFlota = { catalogoCuentas: { diesel: '5010-001' } };
    const r = await catalogoDeclarado('t-1');
    if (!r.ok) throw new Error('debería declarar');
    expect(r.catalogo.gastos.diesel).toBe('5010-001');
    // `caseta` la trae el default demo; aquí NO debe aparecer.
    expect(r.catalogo.gastos.caseta).toBeUndefined();
  });
});

describe('falla cerrado', () => {
  it('una base caída NO se lee como «esta flota no declaró cuentas»', async () => {
    errorBase = { message: 'conexión caída' };
    await expect(catalogoDeclarado('t-1')).rejects.toThrow('conexión caída');
  });
});

describe('la traducción al contrato de la póliza', () => {
  it('separa conceptos de gasto de cuentas de balance', () => {
    const c = armarCatalogo({
      diesel: '5010-001', caseta: '5010-002',
      iva_acreditable: '1190-001', anticipo_operador: '1120-001',
      por_cobrar_operador: '1130-001', por_pagar_operador: '2110-001',
    });
    expect(c.gastos).toEqual({ diesel: '5010-001', caseta: '5010-002' });
    expect(c.ivaAcreditable).toBe('1190-001');
    expect(c.anticipoOperador).toBe('1120-001');
    expect(c.porCobrarOperador).toBe('1130-001');
    expect(c.porPagarOperador).toBe('2110-001');
  });

  it('una llave que no es concepto ni balance se ignora, no tira el catálogo', () => {
    // El textarea es libre y un contador puede dejarse notas.
    const c = armarCatalogo({ diesel: '5010-001', nota_del_contador: 'revisar en enero' });
    expect(c.gastos).toEqual({ diesel: '5010-001' });
  });

  it('una cuenta en blanco es una cuenta que no existe, no una cadena vacía', () => {
    const c = armarCatalogo({ diesel: '   ', caseta: '5010-002', iva_acreditable: '' });
    expect(c.gastos.diesel).toBeUndefined();
    expect(c.gastos.caseta).toBe('5010-002');
    expect(c.ivaAcreditable).toBeUndefined();
  });

  it('un valor que no es texto no se cuela como cuenta', () => {
    const c = armarCatalogo({ diesel: 600001, caseta: null, factura: { a: 1 } });
    expect(c.gastos).toEqual({});
  });

  it('un catálogo PARCIAL sí se devuelve: quién decide si alcanza es la póliza', async () => {
    configDeLaFlota = { catalogoCuentas: { diesel: '5010-001' } };
    const r = await catalogoDeclarado('t-1');
    expect(r.ok).toBe(true);
  });
});

describe('las llaves reservadas son las que la pantalla enseña', () => {
  it('cada cuenta de balance tiene su texto de ayuda — ninguna queda sin explicar', () => {
    for (const llave of Object.keys(CUENTAS_BALANCE)) {
      expect(AYUDA_BALANCE[llave as keyof typeof CUENTAS_BALANCE]).toBeTypeOf('string');
    }
  });

  it('ninguna llave reservada choca con un concepto de gasto', () => {
    // Si `anticipo_operador` fuera también un ConceptoGasto, una cuenta caería
    // en los dos lados y el asiento se duplicaría.
    const c = armarCatalogo(Object.fromEntries(Object.keys(CUENTAS_BALANCE).map((k) => [k, 'X'])));
    expect(Object.keys(c.gastos)).toHaveLength(0);
  });
});

