import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// E1-B (M2, M5) · LOS ACCESORIOS DEL CIERRE VAN FUERA DE LA RUTA CRÍTICA.
//
// Peor caso real del acuse: telefonoJefeDe (2×9.5 s) + upload 9.5 + firma 9.5 +
// sendDocument 10 ≈ 48 s sobre un margen de cierre ya consumido; con una base lenta
// el cierre del chofer y el sello de entrega (que se pone DESPUÉS) quedaban colgados
// detrás de un accesorio. Ahora `avisarCierreAlJefe` devuelve sin esperarlos.
// ═══════════════════════════════════════════════════════════════════════════

const m = vi.hoisted(() => ({
  cola: [] as Array<() => unknown>,
  afterLanza: false,
  acuse: vi.fn(),
  avisoPerfil: vi.fn(),
  sendDocument: vi.fn(),
  avisarOficina: vi.fn(),
  telefonoParaDineroDe: vi.fn(),
}));

vi.mock('next/server', () => ({
  after: (f: () => unknown) => { if (m.afterLanza) throw new Error('`after` was called outside a request scope'); m.cola.push(f); },
}));
vi.mock('./acuse_folio', () => ({ acuseSoloFolioAlEncargado: (...a: unknown[]) => m.acuse(...a) }));
vi.mock('./aviso_perfil_tarjetas', () => ({ avisarPerfilTarjetasUnaVez: (...a: unknown[]) => m.avisoPerfil(...a) }));
vi.mock('@/lib/meta/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/client')>();
  return { sendDocument: m.sendDocument, esReintentableMeta: actual.esReintentableMeta };
});
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: m.avisarOficina, parametrosAvisoOficina: () => [] }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn(async () => {}) }));
vi.mock('./contactos', () => ({ telefonoParaDineroDe: m.telefonoParaDineroDe, telefonoJefeDe: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let diferencias: unknown[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const nodo: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'order', 'limit']) nodo[k] = () => nodo;
      nodo.maybeSingle = () => Promise.resolve({ data: { total_comprobado: 1000, total_anticipo: 1000, diferencia: 0, diferencias, created_at: '2026-09-20T15:00:00Z', folio: 'F-1', operador: { nombre: 'Juan' } }, error: null });
      return nodo;
    },
  }),
}));

const { avisarCierreAlJefe, enSegundoPlano, TECHO_ACCESORIOS_SIN_AFTER_MS } = await import('./avisar_cierre');
const args = { tenantId: 't1', viajeId: 'v1', urlPdf: 'https://x/completo.pdf', telefonoOperador: '5215500002222' };

beforeEach(() => {
  m.cola.length = 0;
  m.afterLanza = false;
  diferencias = [];
  Object.values(m).forEach((f) => { if (typeof f === 'function') (f as ReturnType<typeof vi.fn>).mockReset(); });
  m.telefonoParaDineroDe.mockResolvedValue('5215500001111');
  m.sendDocument.mockResolvedValue({ ok: true, id: 'w1' });
  m.avisarOficina.mockResolvedValue({ ok: true, via: 'texto' });
  m.acuse.mockResolvedValue('enviado');
  m.avisoPerfil.mockResolvedValue('enviado');
});

describe('M2 · el acuse no retrasa el cierre', () => {
  it('con ámbito de petición: devuelve SIN esperar el acuse, que corre en after()', async () => {
    let soltar!: () => void;
    m.acuse.mockImplementation(() => new Promise<string>((r) => { soltar = () => r('enviado'); }));
    const r = await avisarCierreAlJefe(args); // si esperara el acuse, esta línea no volvería nunca
    expect(r.enviado).toBe(true);
    expect(m.acuse).not.toHaveBeenCalled(); // programado, no ejecutado
    expect(m.cola).toHaveLength(1);
    const corrida = m.cola[0]() as Promise<void>;
    await Promise.resolve();
    expect(m.acuse).toHaveBeenCalledTimes(1);
    soltar();
    await corrida;
  });

  it('un acuse que lanza dentro de after() no rompe nada ni se propaga', async () => {
    m.acuse.mockRejectedValue(new Error('base caída'));
    await avisarCierreAlJefe(args);
    await expect((m.cola[0]() as Promise<void>)).resolves.toBeUndefined();
  });

  it('sin ámbito de petición: se espera, pero con TECHO duro (un acuse colgado no cuelga el cierre)', async () => {
    vi.useFakeTimers();
    try {
      m.afterLanza = true;
      m.acuse.mockImplementation(() => new Promise(() => {})); // nunca termina
      let listo = false;
      const p = avisarCierreAlJefe(args).then((r) => { listo = true; return r; });
      await vi.advanceTimersByTimeAsync(TECHO_ACCESORIOS_SIN_AFTER_MS - 100);
      expect(listo).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect((await p).enviado).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enSegundoPlano nunca lanza aunque la tarea falle', async () => {
    m.afterLanza = true;
    await expect(enSegundoPlano('prueba', async () => { throw new Error('x'); })).resolves.toBeUndefined();
  });
});

describe('M5 · un solo aviso al dueño por la causa «tarjeta sin declarar»', () => {
  const sinDeclarar = { tipo: 'tarjeta_sin_declarar', concepto: 'Diésel', monto: 0, nota: 'n' };
  it('si el cierre trae tarjeta_sin_declarar, el accesorio avisa al de dinero (la unicidad la pone el claim por flota)', async () => {
    diferencias = [sinDeclarar];
    await avisarCierreAlJefe(args);
    await (m.cola[0]() as Promise<void>);
    expect(m.avisoPerfil).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', telefonoDinero: '5215500001111', folio: 'F-1' }));
  });
  it('sin esa diferencia no se manda nada de perfil', async () => {
    await avisarCierreAlJefe(args);
    await (m.cola[0]() as Promise<void>);
    expect(m.avisoPerfil).not.toHaveBeenCalled();
  });
  it('y por sí sola esa diferencia no pide decisión por WhatsApp: no sale un texto «necesita tu decisión» por viaje', async () => {
    diferencias = [sinDeclarar];
    await avisarCierreAlJefe(args);
    expect(m.avisarOficina).not.toHaveBeenCalled();
  });
});
