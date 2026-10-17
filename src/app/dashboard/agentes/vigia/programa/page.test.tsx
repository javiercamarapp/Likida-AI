import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// LA CARGA DEL PROGRAMA (server action de la página):
//   · vuelve a resolver sesión, rol y tenant desde la cookie; el tenant nunca sale del formulario;
//   · solo dueño y encargado suben; el contador no entra a la pantalla;
//   · un archivo válido llama a `sincronizarPrograma` con el tenant de la SESIÓN y devuelve el resumen;
//   · un archivo malo, vacío, demasiado grande o un .xlsx devuelve un mensaje llano y NO toca la base;
//   · una falla de la base se dice en llano y no filtra el contenido del archivo.
// Se llama la página, se toma la acción de las props de la vista y se invoca.
// ═══════════════════════════════════════════════════════════════════════════

let sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => sesion) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: (rol: string) => ['superadmin', 'flota_admin', 'encargado', 'contador_ve'].includes(rol) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));

const config = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/repo', () => ({ crearRepoVigia: () => ({ config }) }));
const repoPrograma = vi.hoisted(() => ({ marca: 'repo-programa' }));
vi.mock('@/lib/likida/vigia/programa/repo', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/programa/repo')>('@/lib/likida/vigia/programa/repo');
  return { ...real, crearRepoPrograma: () => repoPrograma };
});
const sincronizarPrograma = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/programa/sincronizar', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/programa/sincronizar')>('@/lib/likida/vigia/programa/sincronizar');
  return { ...real, sincronizarPrograma };
});

const Pagina = (await import('./page')).default;
const { construirProgramaSintetico } = await import('@/lib/likida/vigia/programa/fixtures');
const { ProgramaSinMigrar } = await import('@/lib/likida/vigia/programa/repo');

type Resultado = { ok: true; resumen: Record<string, unknown> & { guardado: Record<string, unknown> } } | { ok: false; error: string } | null;
type Props = { accion: (p: null, f: FormData) => Promise<Resultado>; puedeEscribir: boolean; vigiaEncendido: boolean | null };

async function props(): Promise<Props> {
  const el = (await Pagina({ searchParams: Promise.resolve({}) })) as ReactElement<Props>;
  return el.props;
}

const CSV = construirProgramaSintetico({ semilla: 3, columnas: 40, dias: 2 });
const forma = (campos: { terminal?: string; archivo?: File | null; tenant_id?: string }) => {
  const f = new FormData();
  if (campos.terminal !== undefined) f.append('terminal', campos.terminal);
  if (campos.archivo) f.append('archivo', campos.archivo);
  if (campos.tenant_id) f.append('tenant_id', campos.tenant_id);
  return f;
};
const csv = (texto = CSV, nombre = 'programa.csv') => new File([texto], nombre, { type: 'text/csv' });

const SYNC = { yaCargado: false, nuevas: 9, cambiadas: 1, sinCambio: 2, desaparecidas: 0, sinFecha: 0, clavesRepetidas: 0, camposCambiados: 1 };

beforeEach(() => {
  sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
  vi.clearAllMocks();
  config.mockResolvedValue({ habilitado: true });
  sincronizarPrograma.mockResolvedValue(SYNC);
});

describe('la página', () => {
  it('el encargado y el dueño pueden subir; otro rol que ve la pantalla solo mira', async () => {
    expect((await props()).puedeEscribir).toBe(true);
    sesion = { ...sesion, rol: 'flota_admin' };
    expect((await props()).puedeEscribir).toBe(true);
    sesion = { ...sesion, rol: 'contador_ve' };
    expect((await props()).puedeEscribir).toBe(false);
  });
  it('un rol sin la pantalla rebota (el contador no entra)', async () => {
    sesion = { ...sesion, rol: 'contador' };
    await expect(props()).rejects.toThrow(/REDIRECT \/dashboard/);
  });
  it('dice si el Vigía está apagado, encendido o si no se pudo leer', async () => {
    config.mockResolvedValue({ habilitado: false });
    expect((await props()).vigiaEncendido).toBe(false);
    config.mockResolvedValue({ habilitado: true });
    expect((await props()).vigiaEncendido).toBe(true);
    config.mockRejectedValue(new Error('base caída'));
    expect((await props()).vigiaEncendido).toBeNull();
  });
});

describe('subir el programa', () => {
  it('archivo válido → llama sincronizarPrograma con el tenant de la SESIÓN (no el del formulario) y la terminal normalizada', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: ' gdl ', archivo: csv(), tenant_id: 'otro-tenant' }));
    expect(sincronizarPrograma).toHaveBeenCalledTimes(1);
    const [tenant, terminal, lectura, deps] = sincronizarPrograma.mock.calls[0];
    expect(tenant).toBe('t-sesion');
    expect(terminal).toBe('GDL');
    expect(lectura).toMatchObject({ origen: 'subida', creadoPor: 'u-sesion' });
    expect(lectura.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lectura.filas.length).toBeGreaterThan(0);
    expect(deps.repo).toBe(repoPrograma);
    expect(r?.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/agentes/vigia/programa');
  });

  it('el resumen cuenta filas, días y lo guardado; los días van ordenados', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: csv() }));
    if (!r?.ok) throw new Error('debía salir bien');
    const res = r.resumen as unknown as { terminal: string; leidas: number; validas: number; dias: number; porDia: Array<{ fecha: string; filas: number }>; guardado: Record<string, number> };
    expect(res.terminal).toBe('GDL');
    expect(res.dias).toBe(2);
    expect(res.porDia.map((d) => d.fecha)).toEqual([...res.porDia.map((d) => d.fecha)].sort());
    expect(res.porDia.reduce((s, d) => s + d.filas, 0)).toBeLessThanOrEqual(res.validas);
    expect(res.leidas).toBeGreaterThanOrEqual(res.validas);
    expect(res.guardado).toEqual({ yaCargado: false, nuevas: 9, cambiadas: 1, sinCambio: 2, desaparecidas: 0 });
  });

  it('el mismo archivo otra vez: pasa el «ya estaba cargado» de la sincronización', async () => {
    sincronizarPrograma.mockResolvedValue({ ...SYNC, yaCargado: true, nuevas: 0, cambiadas: 0, sinCambio: 0 });
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: csv() }));
    expect(r?.ok && r.resumen.guardado).toMatchObject({ yaCargado: true });
  });

  it('archivo malo (no es un programa): mensaje llano y NO toca la base', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: csv('hola;mundo\n1;2\n', 'otra-cosa.csv') }));
    expect(r).toMatchObject({ ok: false });
    expect(r && !r.ok && r.error).toMatch(/no parece un programa de despacho/);
    expect(r && !r.ok && r.error).toMatch(/encabezados/);
    expect(sincronizarPrograma).not.toHaveBeenCalled();
  });

  it('archivo vacío o sin archivo: pide elegirlo', async () => {
    const { accion } = await props();
    for (const archivo of [null, new File([], 'vacio.csv')]) {
      const r = await accion(null, forma({ terminal: 'GDL', archivo }));
      expect(r && !r.ok && r.error).toMatch(/Elige el archivo/);
    }
    expect(sincronizarPrograma).not.toHaveBeenCalled();
  });

  it('un .xlsx: dice que todavía no se lee y cómo guardarlo como CSV', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: new File(['PK'], 'programa.xlsx') }));
    expect(r && !r.ok && r.error).toMatch(/Excel \(\.xlsx\) todavía no se pueden leer/);
    expect(r && !r.ok && r.error).toMatch(/CSV/);
    expect(sincronizarPrograma).not.toHaveBeenCalled();
  });

  it('más de 12 MB: lo rechaza antes de leerlo', async () => {
    const { accion } = await props();
    const grande = new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'grande.csv');
    const r = await accion(null, forma({ terminal: 'GDL', archivo: grande }));
    expect(r && !r.ok && r.error).toMatch(/más de 12 MB/);
    expect(sincronizarPrograma).not.toHaveBeenCalled();
  });

  it('terminal ausente o rara: la pide con ejemplo', async () => {
    const { accion } = await props();
    for (const terminal of ['', '   ', '¡¡', '<script>']) {
      const r = await accion(null, forma({ terminal, archivo: csv() }));
      expect(r && !r.ok && r.error).toMatch(/terminal/);
    }
    expect(sincronizarPrograma).not.toHaveBeenCalled();
  });

  it('un CSV en Windows-1252 (acentos de Excel) se lee, no se rompe', async () => {
    const { accion } = await props();
    const bytes = new Uint8Array([...Buffer.from(CSV.replace('CLIENTE SINT 01', 'CLIENTE SINT 01 ')) , 0xe9]); // 0xE9 = «é» en 1252, UTF-8 inválido
    const r = await accion(null, forma({ terminal: 'GDL', archivo: new File([bytes], 'w1252.csv') }));
    expect(r?.ok).toBe(true);
  });

  it('el contador (sin permiso de subir) no sube aunque forje la acción; no toca la base', async () => {
    sesion = { ...sesion, rol: 'contador_ve' };
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: csv() }));
    expect(r && !r.ok && r.error).toMatch(/Solo el dueño o el encargado/);
    expect(sincronizarPrograma).not.toHaveBeenCalled();
  });

  it('falla la base: mensaje llano, sin el contenido del archivo en el log', async () => {
    sincronizarPrograma.mockRejectedValue(new Error('base caída'));
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: csv() }));
    expect(r && !r.ok && r.error).toBe('No se pudo cargar el programa');
    const log = JSON.stringify(logger.error.mock.calls);
    expect(log).toContain('base caída');
    expect(log).not.toContain('CLIENTE SINT');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('la migración 0795 sin aplicar: lo dice en llano', async () => {
    sincronizarPrograma.mockRejectedValue(new ProgramaSinMigrar());
    const { accion } = await props();
    const r = await accion(null, forma({ terminal: 'GDL', archivo: csv() }));
    expect(r && !r.ok && r.error).toMatch(/todavía no está lista/);
  });
});
