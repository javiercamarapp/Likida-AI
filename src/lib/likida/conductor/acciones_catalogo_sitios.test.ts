import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./repo_validacion', () => ({ asignarSitiosViaje: vi.fn(), cambiarEstadoSitio: vi.fn(), guardarSitio: vi.fn(), importarSitios: vi.fn() }));

const { importarCatalogoDelPanel } = await import('./acciones_sitios');
type Deps = import('./acciones_sitios').DepsSitios;

const ctx = (rol = 'encargado') => ({ tenantId: 't-sesion', rol });
const CSV = ['nombre,lat,lng,estatus,terminal',
  'Sitio A,20.50,-100.50,activo,T1',
  'Sitio B,20.60,-100.60,inactivo,T1',
  'Sitio C,0,0,activo,T2',
  'Sitio D,20.70,-100.70,activo,T2'].join('\n');

const deps = (importar: unknown = { ok: true, creados: 2, actualizados: 0 }) =>
  ({ importar: vi.fn(async () => importar), guardar: vi.fn(), estado: vi.fn(), asignar: vi.fn() }) as unknown as Deps & { importar: ReturnType<typeof vi.fn> };

describe('importarCatalogoDelPanel (T-SYS-25)', () => {
  it('sin permiso no lee ni escribe', async () => {
    const d = deps();
    expect(await importarCatalogoDelPanel(ctx('contador'), { texto: CSV, modo: 'importar' }, d)).toMatchObject({ ok: false });
    expect(d.importar).not.toHaveBeenCalled();
  });

  it('analizar no escribe nada y reporta por terminal', async () => {
    const d = deps();
    const r = await importarCatalogoDelPanel(ctx(), { texto: CSV, modo: 'analizar' }, d);
    expect(d.importar).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.ok && r.mensaje).toMatch(/Análisis sin guardar nada\. 4 filas: 3 activas y 1 inactivas; 1 por validar/);
    expect(r.detalles?.some((x) => x.startsWith('T2: 2 por revisar en 1 día'))).toBe(true);
    expect(r.detalles?.some((x) => x.startsWith('T1: 1 por revisar'))).toBe(true);
  });

  it('importar guarda solo activas y confiables, en la flota de la sesión', async () => {
    const d = deps();
    const r = await importarCatalogoDelPanel(ctx(), { texto: CSV, modo: 'importar' }, d);
    expect(r.ok).toBe(true);
    expect(d.importar).toHaveBeenCalledTimes(1);
    const [tenant, filas] = d.importar.mock.calls[0] as unknown as [string, Array<{ nombre: string }>];
    expect(tenant).toBe('t-sesion');
    expect(filas.map((f) => f.nombre)).toEqual(['Sitio A', 'Sitio D']);
  });

  it('parte en lotes de 2000 y suma lo guardado', async () => {
    const filas = ['nombre,lat,lng'];
    for (let i = 0; i < 4500; i++) filas.push(`Lugar ${i},${16 + Math.floor(i / 100) * 0.002},${-110 + (i % 100) * 0.002}`);
    const d = deps({ ok: true, creados: 1, actualizados: 1 });
    const r = await importarCatalogoDelPanel(ctx(), { texto: filas.join('\n'), modo: 'importar' }, d);
    expect(d.importar).toHaveBeenCalledTimes(3);
    expect(r.ok && r.mensaje).toMatch(/Importado: 3 nuevos y 3 actualizados/);
  });

  it('si la base rechaza un lote, se detiene y lo dice', async () => {
    const d = deps({ ok: false, errores: [{ linea: 3, mensaje: 'x' }] });
    expect(await importarCatalogoDelPanel(ctx(), { texto: CSV, modo: 'importar' }, d)).toMatchObject({ ok: false, error: expect.stringMatching(/Se detuvo/) });
  });

  it('una base que lanza se dice sin tumbar la acción', async () => {
    const d = { importar: vi.fn(async () => { throw new Error('boom'); }), guardar: vi.fn(), estado: vi.fn(), asignar: vi.fn() } as unknown as Deps;
    expect(await importarCatalogoDelPanel(ctx(), { texto: CSV, modo: 'importar' }, d)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude importar/) });
  });

  it('un archivo sin filas legibles dice por qué', async () => {
    expect(await importarCatalogoDelPanel(ctx(), { texto: 'lat,lng\n1,2', modo: 'analizar' }, deps())).toMatchObject({ ok: false, detalles: [expect.stringMatching(/nombre/)] });
  });
});
