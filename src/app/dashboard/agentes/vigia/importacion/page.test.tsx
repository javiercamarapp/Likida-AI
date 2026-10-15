import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// La página: vuelve a resolver sesión y rol; un archivo válido devuelve el tablero SIN tocar la base; archivos malos,
// vacíos, grandes o .xlsx devuelven un mensaje llano; el CSV de salida neutraliza fórmulas.

let sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => sesion) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: (rol: string) => ['superadmin', 'flota_admin', 'encargado'].includes(rol) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }) }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));

const Pagina = (await import('./page')).default;
const { construirProgramaSintetico } = await import('@/lib/likida/vigia/programa/fixtures');

type Resultado = { ok: true; resumen: { totalCajas: number; csv: string; terminal: string } } | { ok: false; error: string } | null;
type Props = { accion: (p: null, f: FormData) => Promise<Resultado>; sufijo: string };

async function props(): Promise<Props> {
  const el = (await Pagina({ searchParams: Promise.resolve({}) })) as ReactElement<Props>;
  return el.props;
}
const forma = (terminal: string | undefined, archivo: File | null) => {
  const f = new FormData();
  if (terminal !== undefined) f.append('terminal', terminal);
  if (archivo) f.append('archivo', archivo);
  return f;
};
const csv = (texto: string, nombre = 'programa.csv') => new File([texto], nombre, { type: 'text/csv' });
const CSV = construirProgramaSintetico({ semilla: 3, columnas: 40, dias: 2 });

beforeEach(() => { sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' }; vi.clearAllMocks(); });

describe('página de estatus de importación', () => {
  it('quien no ve la ruta es redirigido', async () => {
    sesion = { ...sesion, rol: 'contador' };
    await expect(props()).rejects.toThrow('REDIRECT /dashboard');
  });

  it('un programa válido devuelve el tablero y el CSV con el rótulo de derivado', async () => {
    const { accion } = await props();
    const r = await accion(null, forma(' gdl ', csv(CSV)));
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.resumen.terminal).toBe('GDL');
    expect(r.resumen.totalCajas).toBeGreaterThan(0);
    expect(r.resumen.csv).toContain('Derivado del programa, no verificado contra Track & Trace.');
  });

  it('la acción vuelve a comprobar el rol: si cambió, no calcula', async () => {
    const { accion } = await props();
    sesion = { ...sesion, rol: 'contador' };
    const r = await accion(null, forma('GDL', csv(CSV)));
    expect(r).toEqual({ ok: false, error: 'No tienes permiso para ver esta pantalla.' });
  });

  it.each([
    ['terminal inválida', forma('¿?', csv(CSV)), /código corto/],
    ['sin archivo', forma('GDL', null), /Elige el archivo/],
    ['archivo vacío', forma('GDL', csv('')), /Elige el archivo/],
    ['xlsx', forma('GDL', csv('x', 'programa.xlsx')), /\.xlsx/],
    ['no es un programa', forma('GDL', csv('hola,mundo\n1,2\n')), /no parece un programa/],
  ])('%s → mensaje llano', async (_n, fd, patron) => {
    const { accion } = await props();
    const r = await accion(null, fd);
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error).toMatch(patron);
  });

  it('un archivo de más de 12 MB se rechaza sin leerlo', async () => {
    const { accion } = await props();
    const grande = new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'p.csv', { type: 'text/csv' });
    const r = await accion(null, forma('GDL', grande));
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error).toContain('12 MB');
  });
});
