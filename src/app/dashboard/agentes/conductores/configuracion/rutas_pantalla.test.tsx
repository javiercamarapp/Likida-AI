import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { valoresDeForma } from '@/lib/likida/conductor/config_forma';
import { VistaConfigConductor } from './vista';

// T-A5-48: la importación de rutas autorizadas está CABLEADA a la pantalla de configuración (METODO §3):
// la vista pinta el formulario y la página lo conecta a `importarRutasDelPanel` → `importarRutas` con el tenant de la SESIÓN.

const sesion = vi.hoisted(() => ({ tenantId: 'tenant-A', rol: 'flota_admin', userId: 'u1' }));
const importar = vi.hoisted(() => vi.fn());
const revalidar = vi.hoisted(() => vi.fn());
const leerRutas = vi.hoisted(() => vi.fn());
const marcarRevisada = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: revalidar }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => ({ ...sesion })) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: vi.fn(() => true) }));
vi.mock('@/lib/likida/conductor/repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/conductor/repo')>()),
  importarRutas: importar,
  leerRutasAutorizadas: leerRutas,
  marcarRutaRevisada: marcarRevisada,
  leerConfigConductor: vi.fn(async () => ({ ...CONFIG_CONDUCTOR_DEFAULT })),
  cargarContactosTrafico: vi.fn(async () => []),
  leerDatosPreflight: vi.fn(async () => { throw new Error('sin preflight en la prueba'); }),
  leerTopeVoluntarios: vi.fn(async () => 5),
  listarVoluntarios: vi.fn(async () => []),
  buscarCandidatosVoluntarios: vi.fn(async () => []),
}));
vi.mock('@/lib/likida/conductor/repo_validacion', () => ({ leerCatalogosFiltro: vi.fn(async () => ({ terminales: [], clientes: [] })) }));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ emailDeUsuario: vi.fn(async () => null) }));

const accion = async () => null;
const baseProps = {
  sufijo: '', config: { ...CONFIG_CONDUCTOR_DEFAULT }, valores: valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT }),
  contactos: [], patios: [], puedeEditar: true, accionGuardar: accion,
};
const URL_OK = 'https://maps.app.goo.gl/RutaDemo123';
const CSV = `corredor,url\nEJEMPLO-corredor,${URL_OK}\nEJEMPLO-malo,http://maps.app.goo.gl/x\n`;

async function accionDeLaPagina(rol: string) {
  sesion.rol = rol;
  const { default: Pagina } = await import('./page');
  const el = await Pagina({ searchParams: Promise.resolve({}) });
  return (el as { props: { accionImportarRutas?: (p: null, fd: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string; detalles?: string[] }> } }).props.accionImportarRutas;
}

describe('rutas autorizadas en la pantalla de configuración del Conductor (T-A5-48)', () => {
  beforeEach(() => { importar.mockReset(); revalidar.mockReset(); leerRutas.mockReset(); marcarRevisada.mockReset(); leerRutas.mockResolvedValue([]); sesion.tenantId = 'tenant-A'; });

  it('la vista pinta el formulario de importar rutas solo si recibe la acción', () => {
    const con = renderToStaticMarkup(<VistaConfigConductor {...baseProps} accionImportarRutas={accion} />);
    expect(con).toContain('Rutas autorizadas de Google Maps');
    expect(con).toContain('aria-label="Importar rutas desde CSV"');
    expect(con).toContain('name="archivo"');
    expect(con).toContain('name="csv"');
    expect(con).toContain('Importar rutas');
    const sin = renderToStaticMarkup(<VistaConfigConductor {...baseProps} />);
    expect(sin).not.toContain('Importar rutas desde CSV');
  });

  it('la página conecta el formulario a la importación: filas válidas al repositorio con el tenant de la sesión, rechazo por fila', async () => {
    importar.mockResolvedValue({ guardadas: 1, nuevas: 1, actualizadas: 0, sinCambios: 0 });
    const accionRutas = await accionDeLaPagina('flota_admin');
    expect(accionRutas).toBeTypeOf('function');
    const fd = new FormData(); fd.set('csv', CSV);
    const r = await accionRutas!(null, fd);
    expect(importar).toHaveBeenCalledTimes(1);
    expect(importar.mock.calls[0][0]).toBe('tenant-A');
    expect(importar.mock.calls[0][1]).toHaveLength(1);
    expect(importar.mock.calls[0][1][0]).toMatchObject({ url: URL_OK });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain('1 nueva');
    expect(r.mensaje).toContain('1 rechazada');
    expect(r.detalles?.join(' ')).toContain('Línea 3');
    expect(revalidar).toHaveBeenCalled();
  });

  it('el archivo subido también se importa', async () => {
    importar.mockResolvedValue({ guardadas: 1, nuevas: 1, actualizadas: 0, sinCambios: 0 });
    const accionRutas = await accionDeLaPagina('flota_admin');
    const fd = new FormData(); fd.set('archivo', new File([`corredor,url\nEJEMPLO-corredor,${URL_OK}\n`], 'rutas.csv', { type: 'text/csv' }));
    const r = await accionRutas!(null, fd);
    expect(r.ok).toBe(true);
    expect(importar.mock.calls[0][1]).toHaveLength(1);
  });

  it('un rol sin permiso de asignar no recibe el formulario', async () => {
    expect(await accionDeLaPagina('operador')).toBeUndefined();
    expect(importar).not.toHaveBeenCalled();
  });
});

// T-A5-50: el mantenimiento por antigüedad está CABLEADO a la misma pantalla (página → lista → botón «Revisada» → repositorio).
const rutaVieja = { id: 'r-vieja', corredor: 'ejemplo-corredor', sitioOrigen: null, sitioDestino: null, url: URL_OK, vigenteHasta: null, revisadaEn: '2020-01-01' };
const rutaAlDia = { ...rutaVieja, id: 'r-hoy', corredor: 'ejemplo-al-dia', revisadaEn: new Date().toISOString().slice(0, 10) };

async function propsDeLaPagina(rol: string) {
  sesion.rol = rol;
  const { default: Pagina } = await import('./page');
  const el = await Pagina({ searchParams: Promise.resolve({}) });
  return (el as { props: Record<string, unknown> }).props;
}

describe('mantenimiento de rutas por antigüedad en la configuración del Conductor (T-A5-50)', () => {
  beforeEach(() => { importar.mockReset(); revalidar.mockReset(); leerRutas.mockReset(); marcarRevisada.mockReset(); leerRutas.mockResolvedValue([]); sesion.tenantId = 'tenant-A'; });

  it('la página lee las rutas de la flota de la SESIÓN y le pasa a la vista solo las pendientes', async () => {
    leerRutas.mockResolvedValue([rutaVieja, rutaAlDia]);
    const props = await propsDeLaPagina('flota_admin');
    expect(leerRutas).toHaveBeenCalledWith('tenant-A');
    expect((props.rutasPendientes as Array<{ ruta: { id: string } }>).map((p) => p.ruta.id)).toEqual(['r-vieja']);
    expect(props.totalRutas).toBe(2);
    expect(props.diasRevisionRutas).toBe(90);
  });

  it('la vista pinta la lista con el botón «Revisada» y el estado vacío en lenguaje llano', () => {
    const accionR = async () => null;
    const pendientes = [{ ruta: rutaVieja, diasSinRevisar: 2000, vencida: false }, { ruta: { ...rutaVieja, id: 'r2', corredor: 'ejemplo-nunca', revisadaEn: null }, diasSinRevisar: null, vencida: true }];
    const con = renderToStaticMarkup(<VistaConfigConductor {...baseProps} accionImportarRutas={accion} rutasPendientes={pendientes} totalRutas={2} accionRutaRevisada={accionR} />);
    expect(con).toContain('Rutas por revisar');
    expect(con).toContain('ejemplo-corredor');
    expect(con).toContain('Sin revisar hace 2000 días');
    expect(con).toContain('Nunca se ha revisado');
    expect(con).toContain('vencida');
    expect(con).toContain('>Revisada<');
    expect(con).toContain('name="id"');
    const vacio = renderToStaticMarkup(<VistaConfigConductor {...baseProps} accionImportarRutas={accion} rutasPendientes={[]} totalRutas={3} />);
    expect(vacio).toContain('Todas las rutas se revisaron en los últimos 90 días. No hay nada pendiente.');
    const sinRutas = renderToStaticMarkup(<VistaConfigConductor {...baseProps} accionImportarRutas={accion} rutasPendientes={[]} totalRutas={0} />);
    expect(sinRutas).toContain('Todavía no hay rutas cargadas');
    const noLeida = renderToStaticMarkup(<VistaConfigConductor {...baseProps} accionImportarRutas={accion} rutasPendientes={null} />);
    expect(noLeida).not.toContain('Rutas por revisar');
  });

  it('el botón «Revisada» llega al repositorio con el tenant de la sesión (no del formulario) y refresca la pantalla', async () => {
    marcarRevisada.mockResolvedValue(true);
    const props = await propsDeLaPagina('flota_admin');
    const accionR = props.accionRutaRevisada as (p: null, fd: FormData) => Promise<{ ok: boolean }>;
    expect(accionR).toBeTypeOf('function');
    const fd = new FormData(); fd.set('id', 'r-vieja'); fd.set('tenant_id', 'tenant-B');
    const r = await accionR(null, fd);
    expect(r.ok).toBe(true);
    expect(marcarRevisada).toHaveBeenCalledTimes(1);
    expect(marcarRevisada.mock.calls[0][0]).toBe('tenant-A');
    expect(marcarRevisada.mock.calls[0][1]).toBe('r-vieja');
    expect(marcarRevisada.mock.calls[0][2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(revalidar).toHaveBeenCalled();
  });

  it('un rol sin permiso de asignar no ve la lista ni recibe el botón, y no se leen las rutas', async () => {
    const props = await propsDeLaPagina('operador');
    expect(props.accionRutaRevisada).toBeUndefined();
    expect(props.rutasPendientes).toBeNull();
    expect(leerRutas).not.toHaveBeenCalled();
  });

  it('si la lectura falla la pantalla sigue (lista omitida), no se cae', async () => {
    leerRutas.mockRejectedValue(new Error('base caída'));
    const props = await propsDeLaPagina('flota_admin');
    expect(props.rutasPendientes).toBeNull();
  });
});

