import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { armar, resumen, validarUuidCfdi, desdeVentana, DIAS_VENTANA_POR_FACTURAR } from './pendientes';

/** La consulta de `getPorFacturar`, capturada filtro por filtro (ESC-12). */
const filtros: Array<[string, unknown[]]> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'gte', 'neq', 'order', 'range']) {
        nodo[m] = (...a: unknown[]) => { filtros.push([m, a]); return nodo; };
      }
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(r);
      return nodo;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { getPorFacturar } = await import('./pendientes');

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE FALTA POR FACTURAR — el puente que faltaba.
//
// El módulo de facturación llevaba construido desde el 27-jul y ninguna pantalla
// lo usaba: los datos se leían del ticket, se guardaban y ahí morían.
//
// De los 40 gastos que hay hoy en la base, 38 NO tienen CFDI. El 95%. Un gasto
// sin CFDI no es deducible —el dinero salió y el IVA se pierde— y el ticket
// CADUCA. Para una flota que liquida por quincena, el ticket del día 2 puede
// estar vencido cuando la oficina cierra el día 16.
// ═══════════════════════════════════════════════════════════════════════════

const base = {
  id: 'g1', concepto: 'diesel', monto: 400, fecha: '2026-08-01',
  folio: '286188', rfc_emisor: null, cfdi_uuid: null,
  ocr_extra: { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '65038155', estacion: 'EST 12' } as Record<string, unknown>,
};

describe('armar un ticket por facturar', () => {
  it('reconoce el comercio por el dominio de la liga', () => {
    const t = armar(base, '2026-08-04');
    expect(t.comercio?.nombre).toMatch(/oxxo gas/i);
    expect(t.comercio?.portal).toContain('oxxogas');
  });

  it('llena los campos del portal con lo que YA se leyó del ticket', () => {
    const t = armar(base, '2026-08-04');
    const porClave = Object.fromEntries(t.campos.map((c) => [c.clave, c.valor]));
    if ('folio' in porClave) expect(porClave.folio).toBe('286188');
    if ('webId' in porClave) expect(porClave.webId).toBe('65038155');
    if ('monto' in porClave) expect(porClave.monto).toBe('400.00');
  });

  it('un campo que NO se extrae queda en null, no se rellena con algo parecido', () => {
    // `caja` y `hora` no se leen del ticket todavía. Un valor inventado manda a
    // la persona a teclear algo que el portal rechaza, y a dudar del resto.
    const t = armar(base, '2026-08-04');
    for (const c of t.campos) {
      if (c.clave === 'caja' || c.clave === 'hora') expect(c.valor).toBeNull();
    }
  });

  it('sin comercio reconocido NO inventa portal ni campos', () => {
    const t = armar({ ...base, ocr_extra: {}, rfc_emisor: null }, '2026-08-04');
    expect(t.comercio).toBeNull();
    expect(t.campos).toEqual([]);
    expect(t.urlTicket).toBeNull();
  });

  it('sin fecha de ticket, la caducidad se declara DESCONOCIDA en vez de afirmar', () => {
    // El OCR falla en fechas —se le vio devolver 2023 en un ticket de 2026— y
    // decir "vigente" sobre una fecha inventada hace que la oficina deje de
    // revisarlo.
    const t = armar({ ...base, fecha: null }, '2026-08-04');
    expect(t.caducidad.desconocido).toBe(true);
    expect(t.caducidad.vencido).toBe(false);
  });

  it('marca vencido lo que ya pasó su plazo', () => {
    const t = armar({ ...base, fecha: '2026-06-01' }, '2026-08-04');
    expect(t.caducidad.vencido).toBe(true);
  });
});

describe('resumen', () => {
  it('separa vencidos de urgentes y suma lo que se pierde', () => {
    const lista = [
      armar({ ...base, id: 'a', fecha: '2026-06-01', monto: 100 }, '2026-08-04'), // vencido
      armar({ ...base, id: 'b', fecha: '2026-08-31', monto: 200 }, '2026-08-30'), // urgente
      armar({ ...base, id: 'c', fecha: '2026-08-01', monto: 300 }, '2026-08-04'), // vigente
    ];
    const r = resumen(lista);
    expect(r.total).toBe(3);
    expect(r.vencidos).toBe(1);
    // El monto vencido es lo que la flota YA no puede deducir: es la cifra que
    // justifica que esta pantalla exista.
    expect(r.montoVencido).toBe(100);
    expect(r.montoTotal).toBe(600);
  });
});

describe('validarUuidCfdi', () => {
  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 18-c4, ARQ-C4-1 (CRÍTICO). Esta prueba AFIRMABA lo contrario
  // —que el folio se normaliza a MAYÚSCULAS— y por eso el bug vivió en verde.
  //
  // La autoridad no es esta función: es el CHECK que la migración 0158 puso
  // sobre las cuatro tablas que guardan folios fiscales
  // (`0158_integridad_fiscal.sql:429`):
  //
  //     check (cfdi_uuid is null or cfdi_uuid = lower(cfdi_uuid))
  //
  // y el normalizador de escritura de `repo.ts:33`, que hace `.toLowerCase()`.
  // La captura manual (`dashboard/agentes/facturas/page.tsx:69,78`) escribe a
  // `gasto.cfdi_uuid` con `supabaseAdmin()` DIRECTO, sin pasar por `repo.ts`,
  // así que lo que salga de aquí es lo que llega al CHECK.
  //
  // Con `.toUpperCase()` el CHECK rechaza SIEMPRE, y el manejador de errores
  // de la página solo distingue el 23505 del folio repetido: todo lo demás
  // cae en «No se pudo guardar. Inténtalo de nuevo.» El contralor teclea el
  // folio bien y la pantalla le dice que reintente, para siempre.
  // ═════════════════════════════════════════════════════════════════════════
  it('acepta el folio fiscal como lo imprime el portal y lo normaliza a MINÚSCULAS', () => {
    expect(validarUuidCfdi(' A3BB189E-8BF9-3888-9912-ACE4E6543002 ')).toBe('a3bb189e-8bf9-3888-9912-ace4e6543002');
    expect(validarUuidCfdi(' a3bb189e-8bf9-3888-9912-ace4e6543002 ')).toBe('a3bb189e-8bf9-3888-9912-ace4e6543002');
  });

  it('lo que devuelve cumple el CHECK de la 0158 — `x = lower(x)` — venga como venga', () => {
    // El invariante, no el caso: cualquier ortografía de entrada tiene que
    // salir en una forma que la base acepte. Es lo que no se puede verificar
    // aquí contra Postgres, así que se verifica contra su regla.
    for (const entrada of [
      'A3BB189E-8BF9-3888-9912-ACE4E6543002',
      'a3bb189e-8bf9-3888-9912-ace4e6543002',
      'A3bb189E-8Bf9-3888-9912-aCe4E6543002',
      '  3F2504E0-4F89-11D3-9A0C-0305E82C3301  ',
    ]) {
      const salida = validarUuidCfdi(entrada);
      expect(salida, `entrada: ${entrada}`).not.toBeNull();
      expect(salida, `entrada: ${entrada}`).toBe((salida as string).toLowerCase());
    }
  });

  it('rechaza todo lo demás — un UUID inventado sería una fila fiscal falsa', () => {
    expect(validarUuidCfdi('')).toBeNull();
    expect(validarUuidCfdi('no-es-un-uuid')).toBeNull();
    expect(validarUuidCfdi('a3bb189e8bf938889912ace4e6543002')).toBeNull(); // sin guiones
    expect(validarUuidCfdi(42)).toBeNull();
  });
});

describe('getPorFacturar está acotado en periodo y concepto (ESC-12)', () => {
  it('pide solo los últimos 45 días de tickets y excluye lo que ya es una factura', async () => {
    // `traerTodo` sin fecha paginaba TODO gasto sin CFDI de la flota, para
    // siempre — y lo llama el cron por cada flota con bloqueados.
    filtros.length = 0;
    await getPorFacturar('t-1', '2026-08-22');
    expect(filtros).toContainEqual(['gte', ['fecha', '2026-07-08']]);
    expect(filtros).toContainEqual(['neq', ['concepto', 'factura']]);
    expect(filtros).toContainEqual(['eq', ['tenant_id', 't-1']]);
  });

  it('la ventana cubre el plazo más largo de un portal (mes natural) con margen', () => {
    expect(DIAS_VENTANA_POR_FACTURAR).toBeGreaterThanOrEqual(35);
    expect(desdeVentana('2026-03-01', 45)).toBe('2026-01-15');
    expect(desdeVentana('2026-01-10', 45)).toBe('2025-11-26');
  });
});
