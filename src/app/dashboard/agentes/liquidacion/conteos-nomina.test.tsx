import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// LA VISTA DE CONTEOS DEL ROL `nomina` (0949), contra un doble de la base con DOS flotas y con dinero y nombres a la vista.
//
// Lo que se fija:
//   · SOLO se consultan las tres tablas de desgloses/entregas/excepciones, con `count` y `head: true` sobre una columna
//     identificadora: ninguna tabla de dinero (liquidacion, gasto, factura_*...), ninguna columna de dinero o de nombre;
//   · TODA consulta lleva `tenant_id` de la sesión: un nomina de la flota A no cuenta nada de la B (y viceversa);
//   · los conteos son los de la flota, y una consulta caída es `null` («—»), no un cero;
//   · la pantalla no pinta un peso, un nombre, un correo ni un enlace.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
interface Consulta {
  tabla: string; columnas: string; opciones: { count?: string; head?: boolean } | undefined; filtros: Array<[string, string, unknown]>;
}
const A = 'flota-a';
const B = 'flota-b';
const HOY = new Date('2026-10-31T18:00:00Z');
const ISO_HOY = '2026-10-31T16:00:00Z';
const ISO_HACE10 = '2026-10-21T16:00:00Z';
const ISO_HACE60 = '2026-09-01T16:00:00Z';

// Datos CON dinero y nombres a la vista: la prueba demuestra que nada de eso se consulta ni se pinta.
const TABLAS: Record<string, Fila[]> = {
  liquidacion_desglose: [
    { tenant_id: A, liquidacion_externa_id: 'a1', created_at: ISO_HOY, retenida_motivo: null, total_origen: 98765.43, operador: 'Pedro Sintético Neto' },
    { tenant_id: A, liquidacion_externa_id: 'a2', created_at: ISO_HOY, retenida_motivo: 'neto_negativo', total_origen: -1200.5, operador: 'Luisa Sintética' },
    { tenant_id: A, liquidacion_externa_id: 'a3', created_at: ISO_HACE10, retenida_motivo: 'neto_negativo', total_origen: 555.55, operador: 'Marco Sintético' },
    { tenant_id: B, liquidacion_externa_id: 'b1', created_at: ISO_HOY, retenida_motivo: 'neto_negativo', total_origen: 777.77, operador: 'Ajeno B' },
    { tenant_id: B, liquidacion_externa_id: 'b2', created_at: ISO_HOY, retenida_motivo: null, total_origen: 888.88, operador: 'Ajeno B2' },
    { tenant_id: B, liquidacion_externa_id: 'b3', created_at: ISO_HOY, retenida_motivo: null, total_origen: 999.99, operador: 'Ajeno B3' },
  ],
  liquidacion_entrega_correo: [
    { tenant_id: A, id: 'ea1', estado: 'enviada', created_at: ISO_HACE10, correo: 'operador.a@ejemplo.test' },
    { tenant_id: A, id: 'ea2', estado: 'enviada', created_at: ISO_HOY, correo: 'operador.a2@ejemplo.test' },
    { tenant_id: A, id: 'ea3', estado: 'entregada', created_at: ISO_HOY, correo: 'operador.a3@ejemplo.test' },
    { tenant_id: A, id: 'ea4', estado: 'rebotada', created_at: ISO_HOY, correo: 'operador.a4@ejemplo.test' },
    { tenant_id: A, id: 'ea5', estado: 'queja', created_at: ISO_HOY, correo: 'operador.a5@ejemplo.test' },
    { tenant_id: A, id: 'ea6', estado: 'fallida', created_at: ISO_HACE10, correo: 'operador.a6@ejemplo.test' },
    { tenant_id: A, id: 'ea7', estado: 'rebotada', created_at: ISO_HACE60, correo: 'viejo.a@ejemplo.test' }, // fuera de la ventana de 30 días
    { tenant_id: A, id: 'ea8', estado: 'pendiente', created_at: ISO_HOY, correo: 'pendiente.a@ejemplo.test' },
    { tenant_id: B, id: 'eb1', estado: 'enviada', created_at: ISO_HOY, correo: 'ajeno.b@ejemplo.test' },
    { tenant_id: B, id: 'eb2', estado: 'entregada', created_at: ISO_HOY, correo: 'ajeno.b2@ejemplo.test' },
    { tenant_id: B, id: 'eb3', estado: 'rebotada', created_at: ISO_HOY, correo: 'ajeno.b3@ejemplo.test' },
  ],
  liquidacion_excepcion: [
    { tenant_id: A, id: 'xa1', tipo: 'sin_poliza', resuelta_en: null },
    { tenant_id: A, id: 'xa2', tipo: 'sin_poliza', resuelta_en: '2026-10-30T10:00:00Z' }, // resuelta: no cuenta
    { tenant_id: A, id: 'xa3', tipo: 'operador_sin_correo', resuelta_en: null }, // otro tipo: no cuenta
    { tenant_id: B, id: 'xb1', tipo: 'sin_poliza', resuelta_en: null },
    { tenant_id: B, id: 'xb2', tipo: 'sin_poliza', resuelta_en: null },
  ],
};
const PERMITIDAS = new Set(Object.keys(TABLAS));

const consultas: Consulta[] = [];
let tablaCaida: string | null = null;

function builder(tabla: string) {
  const c: Consulta = { tabla, columnas: '', opciones: undefined, filtros: [] };
  consultas.push(c);
  const b: Record<string, unknown> = {};
  b.select = (cols: string, opts?: Consulta['opciones']) => { c.columnas = cols; c.opciones = opts; return b; };
  b.eq = (col: string, v: unknown) => { c.filtros.push([col, 'eq', v]); return b; };
  b.in = (col: string, v: unknown) => { c.filtros.push([col, 'in', v]); return b; };
  b.gte = (col: string, v: unknown) => { c.filtros.push([col, 'gte', v]); return b; };
  b.lt = (col: string, v: unknown) => { c.filtros.push([col, 'lt', v]); return b; };
  b.not = (col: string, op: string, v: unknown) => { c.filtros.push([col, `not.${op}`, v]); return b; };
  b.is = (col: string, v: unknown) => { c.filtros.push([col, 'is', v]); return b; };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    if (!PERMITIDAS.has(tabla)) return Promise.reject(new Error(`La vista de nomina consultó una tabla NO permitida: ${tabla}`)).then(ok, ko);
    if (tabla === tablaCaida) return Promise.resolve({ count: null, error: { message: 'caída', code: 'XX000' } }).then(ok, ko);
    const filas = (TABLAS[tabla] ?? []).filter((f) => c.filtros.every(([col, op, v]) => {
      const x = f[col];
      switch (op) {
        case 'eq': return x === v;
        case 'in': return (v as unknown[]).includes(x);
        case 'gte': return String(x) >= String(v);
        case 'lt': return String(x) < String(v);
        case 'is': return v === null ? x === null : x === v;
        case 'not.is': return v === null ? x !== null : x !== v;
        default: throw new Error(`filtro no soportado por el doble: ${op}`);
      }
    }));
    return Promise.resolve({ count: filas.length, data: null, error: null }).then(ok, ko);
  };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerConteosNomina, ventanaNomina, PaginaConteosNomina } = await import('./conteos-nomina');
const { contarParaNomina } = await import('@/lib/likida/liquidacion_externa/repo');

beforeEach(() => { consultas.length = 0; tablaCaida = null; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(HOY); });

const NOMBRES_DE_DINERO = /total|neto|monto|importe|precio|sueldo|salario|pago|tarifa|costo|saldo|ingreso|iva|anticipo/i;

describe('contarParaNomina — qué se consulta', () => {
  it('SOLO las tres tablas de desgloses, entregas y excepciones; cada consulta es un count con head:true sobre UNA columna identificadora', async () => {
    await leerConteosNomina(A);
    expect(consultas.length).toBe(6);
    for (const c of consultas) {
      expect(PERMITIDAS.has(c.tabla), c.tabla).toBe(true);
      expect(c.opciones, c.tabla).toEqual({ count: 'exact', head: true });
      expect(['liquidacion_externa_id', 'id'], c.tabla).toContain(c.columnas);
      expect(c.columnas).not.toMatch(NOMBRES_DE_DINERO);
      expect(c.columnas).not.toContain('*');
    }
  });

  it('no se toca ninguna tabla de dinero (el doble revienta si se consulta una fuera de las tres)', async () => {
    await expect(leerConteosNomina(A)).resolves.toBeDefined();
    const tablas = new Set(consultas.map((c) => c.tabla));
    for (const t of ['liquidacion', 'gasto', 'factura_emitida', 'factura', 'cotizacion', 'cliente_tarifa', 'viaje', 'operador', 'app_user']) {
      expect(tablas.has(t), t).toBe(false);
    }
  });

  it('TODA consulta va anclada al tenant de la sesión', async () => {
    await leerConteosNomina(A);
    for (const c of consultas) expect(c.filtros, c.tabla).toContainEqual(['tenant_id', 'eq', A]);
    consultas.length = 0;
    await leerConteosNomina(B);
    for (const c of consultas) expect(c.filtros, c.tabla).toContainEqual(['tenant_id', 'eq', B]);
  });
});

describe('contarParaNomina — los conteos y el aislamiento entre flotas', () => {
  it('la flota A cuenta lo suyo y nada de la B', async () => {
    expect(await leerConteosNomina(A)).toEqual({
      recibidosHoy: 2, // a1, a2 (a3 es de hace 10 días)
      enviados: 2, // ea1, ea2
      entregados: 1, // ea3
      rebotados: 3, // ea4 rebotada, ea5 queja, ea6 fallida (ea7 quedó fuera de los 30 días)
      retenidos: 2, // a2, a3
      sinPoliza: 1, // xa1 (xa2 resuelta, xa3 de otro tipo)
    });
  });

  it('la flota B cuenta lo suyo y nada de la A: un nomina de A no ve ni un número de B, ni al revés', async () => {
    expect(await leerConteosNomina(B)).toEqual({
      recibidosHoy: 3, enviados: 1, entregados: 1, rebotados: 1, retenidos: 1, sinPoliza: 2,
    });
  });

  it('una flota sin filas cuenta ceros MEDIDOS (0, no null)', async () => {
    expect(await leerConteosNomina('flota-vacia')).toEqual({
      recibidosHoy: 0, enviados: 0, entregados: 0, rebotados: 0, retenidos: 0, sinPoliza: 0,
    });
  });

  it('una tabla caída da null en SUS conteos (jamás un cero sin medir) y no tumba los demás', async () => {
    tablaCaida = 'liquidacion_entrega_correo';
    expect(await leerConteosNomina(A)).toEqual({
      recibidosHoy: 2, enviados: null, entregados: null, rebotados: null, retenidos: 2, sinPoliza: 1,
    });
  });

  it('las ventanas son las del dueño: hoy y los últimos 30 días (hoy y los 29 anteriores) en hora de México', () => {
    const v = ventanaNomina(HOY);
    expect(v.manana.getTime() - v.hoyDesde.getTime()).toBe(24 * 3600 * 1000);
    expect(v.hoyDesde.getTime() - v.desde30.getTime()).toBe(29 * 24 * 3600 * 1000);
    expect(contarParaNomina).toBeTypeOf('function');
  });
});

describe('la pantalla del rol nomina', () => {
  it('pinta los seis conteos y NADA más: ni un peso, ni un nombre, ni un correo, ni un enlace', async () => {
    const html = renderToStaticMarkup(await PaginaConteosNomina({ tenantId: A }));
    for (const etiqueta of ['Recibidos hoy', 'Enviados', 'Entregados', 'Rebotados', 'Retenidos', 'Sin póliza']) expect(html).toContain(etiqueta);
    // Dinero y nombres de los datos sintéticos de ARRIBA: ninguno llega a la pantalla.
    for (const prohibido of ['98765', '98,765', '1200', '555.55', 'Pedro', 'Luisa', 'Marco', 'Ajeno', '@ejemplo.test', '$', 'MXN']) {
      expect(html, prohibido).not.toContain(prohibido);
    }
    // Las fichas no son enlaces: la lista a la que llevarían trae nombres y netos.
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    // Sin formularios ni botones: no opera nada.
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });

  it('una lectura caída se pinta como «—, no se pudo contar», no como cero', async () => {
    tablaCaida = 'liquidacion_desglose';
    const html = renderToStaticMarkup(await PaginaConteosNomina({ tenantId: A }));
    expect(html).toContain('—');
    expect(html).toContain('no se pudo contar');
  });
});
