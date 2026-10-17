import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { valoresDeForma } from '@/lib/likida/conductor/config_forma';
import type { DocumentoCliente } from '@/lib/likida/conductor/documentos_cliente';
import { VistaConfigConductor } from './vista';

// T-A5-52: el catálogo de documentos por cliente está CABLEADO a la pantalla de configuración (METODO §3):
// la página lee el catálogo de la flota de la SESIÓN, la vista lo pinta (básicos / complementarios / sin catálogo) y las acciones
// de alta y baja llegan al repositorio con el tenant de la sesión. Todos los nombres son sintéticos.

const sesion = vi.hoisted(() => ({ tenantId: 'tenant-A', rol: 'flota_admin', userId: 'u1' }));
const leerDocs = vi.hoisted(() => vi.fn());
const altaDoc = vi.hoisted(() => vi.fn());
const bajaDoc = vi.hoisted(() => vi.fn());
const revalidar = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: revalidar }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => ({ ...sesion })) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: vi.fn(() => true) }));
vi.mock('@/lib/likida/conductor/repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/conductor/repo')>()),
  leerDocumentosCliente: leerDocs,
  altaDocumentoCliente: altaDoc,
  bajaDocumentoCliente: bajaDoc,
  leerRutasAutorizadas: vi.fn(async () => []),
  leerConfigConductor: vi.fn(async () => ({ ...CONFIG_CONDUCTOR_DEFAULT })),
  cargarContactosTrafico: vi.fn(async () => []),
  leerDatosPreflight: vi.fn(async () => { throw new Error('sin preflight en la prueba'); }),
  leerTopeVoluntarios: vi.fn(async () => 5),
  listarVoluntarios: vi.fn(async () => []),
  buscarCandidatosVoluntarios: vi.fn(async () => []),
}));
vi.mock('@/lib/likida/conductor/repo_validacion', () => ({
  leerCatalogosFiltro: vi.fn(async () => ({ terminales: [], clientes: [{ id: 'c1', nombre: 'Cliente demo 1' }, { id: 'c2', nombre: 'Cliente demo 2' }] })),
}));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ emailDeUsuario: vi.fn(async () => null) }));

const accion = async () => null;
const baseProps = {
  sufijo: '', config: { ...CONFIG_CONDUCTOR_DEFAULT }, valores: valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT }),
  contactos: [], patios: [], puedeEditar: true, accionGuardar: accion,
};
const clientes = [{ id: 'c1', nombre: 'Cliente demo 1' }, { id: 'c2', nombre: 'Cliente demo 2' }];
const docs: DocumentoCliente[] = [
  { id: 'd1', clienteId: 'c1', nombre: 'Carta porte demo', tipo: 'basico', requiereFirma: true, requiereSello: true },
  { id: 'd2', clienteId: 'c1', nombre: 'Ticket de bascula demo', tipo: 'complementario', requiereFirma: false, requiereSello: false },
];

async function propsDeLaPagina(rol: string) {
  sesion.rol = rol;
  const { default: Pagina } = await import('./page');
  const el = await Pagina({ searchParams: Promise.resolve({}) });
  return (el as { props: Record<string, unknown> }).props;
}
type Accion = (p: null, fd: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string }>;

describe('documentos por cliente en la configuración del Conductor (T-A5-52)', () => {
  beforeEach(() => { leerDocs.mockReset(); altaDoc.mockReset(); bajaDoc.mockReset(); revalidar.mockReset(); leerDocs.mockResolvedValue([]); sesion.tenantId = 'tenant-A'; });

  it('la vista pinta básicos y complementarios del cliente, con firma/sello, y dice cuántos clientes siguen con solo el POD', () => {
    const html = renderToStaticMarkup(<VistaConfigConductor {...baseProps} documentosCliente={docs} clientes={clientes} accionAltaDocumento={accion} accionBajaDocumento={accion} />);
    expect(html).toContain('Documentos que pide cada cliente');
    expect(html).toContain('Documentos de Cliente demo 1');
    expect(html).toContain('Carta porte demo');
    expect(html).toContain('firmado y sellado');
    expect(html).toContain('Ticket de bascula demo');
    expect(html).toContain('sin firma ni sello');
    expect(html).toContain('Básicos: sin ellos no se cierra el viaje');
    expect(html).toContain('Complementarios: se piden, pero no frenan el cierre');
    expect(html).toContain('1 cliente sin documentos propios');
    expect(html).toContain('aria-label="Agregar documento de un cliente"');
    expect(html).toContain('name="clienteId"');
    expect(html).toContain('>Quitar<');
    expect(html).not.toContain('Documentos de Cliente demo 2');
  });

  it('estados vacío y no leído en lenguaje llano; sin la acción no se pinta la sección', () => {
    const vacio = renderToStaticMarkup(<VistaConfigConductor {...baseProps} documentosCliente={[]} clientes={clientes} accionAltaDocumento={accion} />);
    expect(vacio).toContain('Ningún cliente tiene documentos propios todavía. A todos se les pide solo el comprobante de entrega de siempre.');
    const noLeido = renderToStaticMarkup(<VistaConfigConductor {...baseProps} documentosCliente={null} clientes={clientes} />);
    expect(noLeido).toContain('No se pudo leer el catálogo de documentos');
    expect(noLeido).not.toContain('Ningún cliente tiene documentos propios');
    const sinClientes = renderToStaticMarkup(<VistaConfigConductor {...baseProps} documentosCliente={[]} clientes={[]} accionAltaDocumento={accion} />);
    expect(sinClientes).toContain('Todavía no hay clientes dados de alta');
    const sinSeccion = renderToStaticMarkup(<VistaConfigConductor {...baseProps} />);
    expect(sinSeccion).not.toContain('Documentos que pide cada cliente');
  });

  it('un documento de un cliente que ya no está activo se sigue mostrando (no se pierde de vista)', () => {
    const html = renderToStaticMarkup(<VistaConfigConductor {...baseProps} documentosCliente={[{ ...docs[0], clienteId: 'c9' }]} clientes={clientes} />);
    expect(html).toContain('Cliente dado de baja');
    expect(html).toContain('Carta porte demo');
  });

  it('la página lee el catálogo de la flota de la SESIÓN y se lo pasa a la vista junto con los clientes', async () => {
    leerDocs.mockResolvedValue(docs);
    const props = await propsDeLaPagina('flota_admin');
    expect(leerDocs).toHaveBeenCalledWith('tenant-A');
    expect(props.documentosCliente).toEqual(docs);
    expect(props.clientes).toEqual(clientes);
    expect(props.accionAltaDocumento).toBeTypeOf('function');
    expect(props.accionBajaDocumento).toBeTypeOf('function');
  });

  it('si la lectura falla, la vista recibe null (se dice, no se finge vacío)', async () => {
    leerDocs.mockRejectedValue(new Error('timeout'));
    expect((await propsDeLaPagina('flota_admin')).documentosCliente).toBeNull();
  });

  it('el alta llega al repositorio con el tenant de la sesión (no del formulario) y refresca la pantalla', async () => {
    altaDoc.mockResolvedValue('ok');
    const props = await propsDeLaPagina('flota_admin');
    const fd = new FormData();
    fd.set('clienteId', 'c1'); fd.set('nombre', ' Pedimento   demo '); fd.set('tipo', 'basico'); fd.set('requiereFirma', 'on'); fd.set('tenant_id', 'tenant-B');
    const r = await (props.accionAltaDocumento as Accion)(null, fd);
    expect(r.ok).toBe(true);
    expect(altaDoc).toHaveBeenCalledWith('tenant-A', { clienteId: 'c1', nombre: 'Pedimento demo', tipo: 'basico', requiereFirma: true, requiereSello: false });
    expect(revalidar).toHaveBeenCalled();
  });

  it('un alta inválida no llega al repositorio ni refresca', async () => {
    const props = await propsDeLaPagina('flota_admin');
    const fd = new FormData(); fd.set('clienteId', 'c1'); fd.set('nombre', 'X'); fd.set('tipo', 'raro');
    const r = await (props.accionAltaDocumento as Accion)(null, fd);
    expect(r.ok).toBe(false);
    expect(altaDoc).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('la baja llega al repositorio con el tenant de la sesión y refresca la pantalla', async () => {
    bajaDoc.mockResolvedValue(true);
    const props = await propsDeLaPagina('flota_admin');
    const fd = new FormData(); fd.set('id', 'd1');
    const r = await (props.accionBajaDocumento as Accion)(null, fd);
    expect(r.ok).toBe(true);
    expect(bajaDoc).toHaveBeenCalledWith('tenant-A', 'd1');
    expect(revalidar).toHaveBeenCalled();
  });

  it('un rol sin permiso de asignar no lee el catálogo ni recibe las acciones', async () => {
    const props = await propsDeLaPagina('operador');
    expect(props.documentosCliente).toBeUndefined();
    expect(props.accionAltaDocumento).toBeUndefined();
    expect(props.accionBajaDocumento).toBeUndefined();
    expect(leerDocs).not.toHaveBeenCalled();
  });
});
