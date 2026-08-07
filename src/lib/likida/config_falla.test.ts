import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 — EL QUINTO SITIO DEL PATRÓN, y el único que compone dos rubros.
//
// La ronda 5 encontró cuatro veces en un día el mismo error de diseño: *un
// fallo de consulta disfrazado del valor que significa "no hay"*. La 6 lo
// buscó explícitamente y lo encontró aquí, donde dos auditores independientes
// vieron cada uno la mitad:
//
//   · operabilidad: "getConfig descarta el error y liquida con la política de
//     la demo" — marcado CRÍTICO.
//   · backend: lo miró y lo descartó con buen argumento ("degradación a
//     valores seguros, no una afirmación falsa sobre el mundo; hoy el riesgo
//     es cero").
//   · fiscal, sin saber de los otros dos: `DEMO_CONFIG.empresa.rfc` es el RFC
//     GENÉRICO del SAT, y con el genérico el motor apaga LAS DOS ramas de
//     validación de receptor.
//
// Juntas, no por separado: un hipo de Supabase y ese viaje se liquida con la
// política del demo Y con la validación de receptor apagada. Un CFDI de
// $11,600 timbrado a un TERCERO sale deducible, con $1,600 de IVA acreditable,
// en verde y citando el artículo.
//
// La primera puerta no necesitaba ni que se cayera la red: PostgREST devuelve
// los errores POR VALOR y `const { data } = ...` los tiraba.
// ═══════════════════════════════════════════════════════════════════════════

const maybeSingle = vi.fn();
/** Cuando está puesto, el cliente truena al construirse: un fallo de red real. */
let explotaAlConectar: Error | null = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    if (explotaAlConectar) throw explotaAlConectar;
    return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) };
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getConfig, DEMO_CONFIG } = await import('./config');
const { ConsultaFallida } = await import('./conv');

beforeEach(() => { maybeSingle.mockReset(); explotaAlConectar = null; });

describe('un fallo al leer la config NO puede volverse la política de la demo', () => {
  it('el error POR VALOR de PostgREST se lanza, no se descarta', async () => {
    // Este es el caso que no requiere que se caiga nada: la consulta "responde"
    // con `{ data: null, error }` y el destructuring viejo se quedaba con el
    // null. Ni excepción, ni log, ni rastro.
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'canceling statement due to statement timeout' } });
    await expect(getConfig('t1')).rejects.toBeInstanceOf(ConsultaFallida);
  });

  it('y el mensaje dice QUÉ no se pudo consultar', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied for table tenant' } });
    await expect(getConfig('t1')).rejects.toThrow(/config del tenant/);
  });

  it('una excepción de red también sale como ConsultaFallida', async () => {
    // El cliente truena al construirse — el modo en que se manifiesta un fallo
    // de red de verdad, y el único camino que llega al `catch` en vez de al
    // `if (error)`.
    explotaAlConectar = new TypeError('fetch failed');
    const e = await getConfig('t1').then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(ConsultaFallida);
    expect((e as Error).message).toContain('fetch failed');
  });

  it('NUNCA devuelve DEMO_CONFIG ante un fallo', async () => {
    // La aserción que resume el hallazgo. Devolver los defaults es afirmar que
    // el tenant no tiene override — un hecho que nadie comprobó.
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await getConfig('t1').catch((e) => e);
    expect(r).not.toBe(DEMO_CONFIG);
    expect(r).toBeInstanceOf(Error);
  });
});

describe('el camino bueno sigue igual', () => {
  it('sin override, un tenant real usa los defaults (eso SÍ es legítimo)', async () => {
    // `data` con la fila y `config: null` significa de verdad "no hay override".
    maybeSingle.mockResolvedValue({ data: { rfc: null, config: null }, error: null });
    const cfg = await getConfig('t1');
    expect(cfg.politica).toEqual(DEMO_CONFIG.politica);
  });

  it('con RFC en la columna, se usa el del tenant y no el genérico', async () => {
    maybeSingle.mockResolvedValue({ data: { rfc: 'MAT9012159X6', config: null }, error: null });
    const cfg = await getConfig('t1');
    expect(cfg.empresa.rfc).toBe('MAT9012159X6');
    expect(cfg.empresa.rfc).not.toBe(DEMO_CONFIG.empresa.rfc);
  });

  it('un override del tenant gana sobre el default', async () => {
    maybeSingle.mockResolvedValue({
      data: { rfc: null, config: { estimulos: { viaticosTopeFiscalDiarioMxn: 999 } } },
      error: null,
    });
    const cfg = await getConfig('t1');
    expect(cfg.estimulos.viaticosTopeFiscalDiarioMxn).toBe(999);
  });
});

// ── FUGA ENTRE TENANTS, encontrada al escribir las pruebas de arriba ────────
//
// `fusionarConfig` devuelve la MISMA referencia cuando no hay override, así
// que `cfg` ES `DEMO_CONFIG`. `getConfig` le escribía el RFC encima, y el
// objeto del módulo sobrevive entre peticiones y entre tenants.
describe('la config de un tenant no puede contaminar al siguiente', () => {
  it('leer el RFC de un tenant no toca DEMO_CONFIG', async () => {
    const antes = DEMO_CONFIG.empresa.rfc;
    maybeSingle.mockResolvedValue({ data: { rfc: 'MAT9012159X6', config: null }, error: null });
    await getConfig('flota-norte');
    expect(DEMO_CONFIG.empresa.rfc, 'el singleton del módulo quedó escrito').toBe(antes);
  });

  it('y el siguiente tenant SIN rfc no hereda el del anterior', async () => {
    // El escenario completo, en el orden en que ocurre en producción.
    maybeSingle.mockResolvedValue({ data: { rfc: 'MAT9012159X6', config: null }, error: null });
    const a = await getConfig('flota-norte');
    expect(a.empresa.rfc).toBe('MAT9012159X6');

    maybeSingle.mockResolvedValue({ data: { rfc: null, config: null }, error: null });
    const b = await getConfig('flota-sur');
    // Sin esto, B liquida validando sus CFDI contra el RFC de A: todas sus
    // facturas legítimas salen con problema de receptor.
    expect(b.empresa.rfc).not.toBe('MAT9012159X6');
    expect(b.empresa.rfc).toBe(DEMO_CONFIG.empresa.rfc);
  });

  it('tampoco lo toca un override de política', async () => {
    const antes = JSON.stringify(DEMO_CONFIG.politica);
    maybeSingle.mockResolvedValue({
      data: { rfc: null, config: { politica: [{ concepto: 'diesel', topeMonto: 1 }] } },
      error: null,
    });
    await getConfig('flota-sur');
    expect(JSON.stringify(DEMO_CONFIG.politica)).toBe(antes);
  });
});
