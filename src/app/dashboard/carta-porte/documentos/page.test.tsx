import { beforeEach, expect, it, vi } from 'vitest';

// La página de documentos: cada server action RE-RESUELVE la sesión y exige el área (la forma de la página no es
// una puerta), usa el tenant y el usuario de la SESIÓN —jamás los de la forma— y no se traga un error de lectura.
const dobles = vi.hoisted(() => ({
  revalidatePath: vi.fn(), rateLimit: vi.fn(async () => true),
  recibirDocumento: vi.fn(), procesarDocumento: vi.fn(),
}));
let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };

vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => sesion }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidatePath }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: dobles.rateLimit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);
vi.mock('@/lib/likida/carta_porte_docs/servicio', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/carta_porte_docs/servicio')>()),
  recibirDocumento: dobles.recibirDocumento, procesarDocumento: dobles.procesarDocumento,
}));

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import PaginaDocumentos from './page';

type Accion = (previo: null, fd: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string }>;
interface Props { datos: null | { filas: unknown[]; buzon: null | { direccion: string | null; activo: boolean }; metricas: Record<string, unknown>; perfiles: unknown[]; configs: Array<{ nombre: string }> }; acciones: Record<'subir' | 'procesar' | 'activarBuzon' | 'guardarRemitentes' | 'guardarExport' | 'borrarExport' | 'volverVersion', Accion> }
const SP = Promise.resolve({});
const fd = (c: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const U = '11111111-1111-4111-8111-111111111111';
const pagina = async () => (await PaginaDocumentos({ searchParams: SP })) as unknown as { props: Props };

beforeEach(() => {
  vi.clearAllMocks(); reset();
  sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
  dobles.rateLimit.mockResolvedValue(true);
  dobles.recibirDocumento.mockResolvedValue({ ok: true, documentoId: U, duplicado: false, estado: 'recibido', formato: 'pdf_texto' });
  dobles.procesarDocumento.mockResolvedValue({ ok: true, estado: 'por_revisar', origen: 'llm', nivel: 1, costoUsd: 0, listoParaAprobar: true });
  process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.test';
});

it.each(['contador', 'vendedor'])('%s no puede ver la página: redirect antes de leer nada', async (rol) => {
  sesion = { ...sesion, rol };
  await expect(PaginaDocumentos({ searchParams: SP })).rejects.toThrow('REDIRECT:/dashboard');
  expect(estado.llamadas).toEqual([]);
});

it('una lectura caída pasa `datos: null` (nunca una bandeja vacía)', async () => {
  const roto = vi.spyOn(repo, 'listarDocumentos').mockRejectedValueOnce(new Error('base caída'));
  expect((await pagina()).props.datos).toBeNull();
  roto.mockRestore();
});

it('con la base sana arma datos, métricas en null y el buzón con su dirección', async () => {
  await repo.crearBuzon('t-1', 'abcdefghjkmnpqrstvwxyz23');
  const p = await pagina();
  expect(p.props.datos?.filas).toEqual([]);
  expect(p.props.datos?.metricas).toMatchObject({ pctSinCorreccion: null, minutosAhorradosPorEmbarque: null });
  expect(p.props.datos?.buzon).toMatchObject({ direccion: 'cp-abcdefghjkmnpqrstvwxyz23@mail.likida.test', activo: true });
});

it('subir: usa el tenant y el usuario de la SESIÓN (no los de la forma), lee el documento y avisa', async () => {
  const p = await pagina();
  const r = await p.props.acciones.subir(null, fd({ archivo: new File([new Uint8Array([1, 2, 3])], 'orden.pdf'), clienteId: U, tenantId: 'OTRO', userId: 'OTRO-U' }));
  expect(dobles.recibirDocumento).toHaveBeenCalledWith('t-1', expect.objectContaining({ canal: 'manual', nombre: 'orden.pdf', clienteId: U, actorId: 'u-1' }));
  expect(dobles.procesarDocumento).toHaveBeenCalledWith('t-1', U, {});
  expect(r).toMatchObject({ ok: true });
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/dashboard/carta-porte/documentos');
});

it('subir: un cliente que no es uuid se ignora; sin archivo, vacío o pesado se rechaza ANTES de tocar nada', async () => {
  const p = await pagina();
  await p.props.acciones.subir(null, fd({ archivo: new File([new Uint8Array([1])], 'a.pdf'), clienteId: "'; drop table--" }));
  expect(dobles.recibirDocumento).toHaveBeenCalledWith('t-1', expect.objectContaining({ clienteId: null }));
  dobles.recibirDocumento.mockClear();
  expect(await p.props.acciones.subir(null, fd({ clienteId: '' }))).toMatchObject({ ok: false, error: 'Elige un archivo.' });
  expect(await p.props.acciones.subir(null, fd({ archivo: new File([], 'vacio.pdf') }))).toMatchObject({ ok: false, error: 'Elige un archivo.' });
  expect(await p.props.acciones.subir(null, fd({ archivo: new File([new Uint8Array(9 * 1024 * 1024 + 1)], 'gigante.pdf') }))).toMatchObject({ ok: false, error: expect.stringMatching(/9 MB/) });
  expect(dobles.recibirDocumento).not.toHaveBeenCalled();
});

it('subir: el mismo archivo no se duplica ni se vuelve a leer; un rechazo del servicio llega verbatim', async () => {
  const p = await pagina();
  dobles.recibirDocumento.mockResolvedValueOnce({ ok: true, documentoId: U, duplicado: true, estado: 'por_revisar', formato: 'pdf_texto' });
  expect(await p.props.acciones.subir(null, fd({ archivo: new File([new Uint8Array([1])], 'a.pdf') }))).toMatchObject({ ok: true, mensaje: expect.stringMatching(/no se duplicó/) });
  expect(dobles.procesarDocumento).not.toHaveBeenCalled();
  dobles.recibirDocumento.mockResolvedValueOnce({ ok: false, motivo: 'formato', mensaje: 'El archivo está vacío.' });
  expect(await p.props.acciones.subir(null, fd({ archivo: new File([new Uint8Array([1])], 'a.pdf') }))).toEqual({ ok: false, error: 'El archivo está vacío.' });
});

it('subir: si guarda pero no puede leer, lo dice y el documento queda en la bandeja', async () => {
  dobles.procesarDocumento.mockResolvedValueOnce({ ok: false, motivo: 'presupuesto', mensaje: 'El presupuesto de IA de hoy se agotó.', permanente: false });
  const r = await (await pagina()).props.acciones.subir(null, fd({ archivo: new File([new Uint8Array([1])], 'a.pdf') }));
  expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Se guardó, pero no se pudo leer: El presupuesto/) });
});

it('subir: el límite de ritmo se aplica por flota', async () => {
  dobles.rateLimit.mockResolvedValueOnce(false);
  const r = await (await pagina()).props.acciones.subir(null, fd({ archivo: new File([new Uint8Array([1])], 'a.pdf') }));
  expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Demasiados/) });
  expect(dobles.rateLimit).toHaveBeenCalledWith('cp-docs-subir:t-1', 30, 60_000);
  expect(dobles.recibirDocumento).not.toHaveBeenCalled();
});

it.each(['contador', 'vendedor'])('TODAS las acciones rechazan a %s aunque se invoquen directo', async (rol) => {
  const p = await pagina();
  sesion = { ...sesion, rol };
  for (const [nombre, a] of Object.entries(p.props.acciones)) {
    const r = await a(null, fd({ archivo: new File([new Uint8Array([1])], 'a.pdf'), documentoId: U, nombre: 'x', formato: 'csv', config: '{}', id: U, perfilId: U, version: '1' }));
    expect(r, nombre).toEqual({ ok: false, error: 'Tu rol no puede administrar los documentos de Carta Porte.' });
  }
  expect(dobles.recibirDocumento).not.toHaveBeenCalled();
  expect(estado.buzones.size).toBe(0);
});

it('procesar: solo documentos de LA flota y con uuid', async () => {
  const p = await pagina();
  expect(await p.props.acciones.procesar(null, fd({ documentoId: 'no-uuid' }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.procesar(null, fd({ documentoId: U }))).toMatchObject({ ok: false, error: 'Ese documento no está en tu flota.' });
  expect(dobles.procesarDocumento).not.toHaveBeenCalled();
});

it('activar el buzón crea UNO por flota (idempotente) con un token del alfabeto de la casa', async () => {
  const p = await pagina();
  await p.props.acciones.activarBuzon(null, fd({}));
  await p.props.acciones.activarBuzon(null, fd({}));
  expect(estado.buzones.size).toBe(1);
  expect(estado.buzones.get('t-1')!.token).toMatch(/^[abcdefghjkmnpqrstvwxyz2-9]{24}$/);
});

it('remitentes: se normalizan, se quitan duplicados y se validan', async () => {
  await repo.crearBuzon('t-1', 'abcdefghjkmnpqrstvwxyz23');
  const p = await pagina();
  expect(await p.props.acciones.guardarRemitentes(null, fd({ remitentes: 'Ana@Cliente.com\n@cliente.com\ncliente.com\nana@cliente.com\n' }))).toMatchObject({ ok: true });
  expect(estado.buzones.get('t-1')!.remitentesPermitidos).toEqual(['ana@cliente.com', '@cliente.com', 'cliente.com']);
  expect(await p.props.acciones.guardarRemitentes(null, fd({ remitentes: 'esto no es un correo' }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.guardarRemitentes(null, fd({ remitentes: Array.from({ length: 51 }, (_, i) => `a${i}@x.com`).join('\n') }))).toMatchObject({ ok: false, error: 'Máximo 50 remitentes.' });
  expect(estado.buzones.get('t-1')!.remitentesPermitidos).toHaveLength(3);
});

it('exportación: valida el mapeo (JSON, formato, campos) y lo guarda ligado a la flota', async () => {
  const p = await pagina();
  const bueno = JSON.stringify({ columnas: [{ encabezado: 'Folio', campo: 'folio_cliente' }] });
  expect(await p.props.acciones.guardarExport(null, fd({ nombre: 'Cliente demo', formato: 'csv', config: bueno }))).toMatchObject({ ok: true });
  expect(estado.exportConfigs).toEqual([expect.objectContaining({ tenantId: 't-1', nombre: 'Cliente demo', formato: 'csv' })]);
  expect(await p.props.acciones.guardarExport(null, fd({ nombre: 'X', formato: 'csv', config: '{no json' }))).toEqual({ ok: false, error: 'El mapeo no es un JSON válido.' });
  expect(await p.props.acciones.guardarExport(null, fd({ nombre: 'X', formato: 'xml', config: bueno }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.guardarExport(null, fd({ nombre: '', formato: 'csv', config: bueno }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.guardarExport(null, fd({ nombre: 'X', formato: 'csv', config: JSON.stringify({ columnas: [{ encabezado: 'A', campo: 'password' }] }) }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es un campo exportable/) });
  expect(estado.exportConfigs).toHaveLength(1);
  const id = estado.exportConfigs[0].id;
  expect(await p.props.acciones.borrarExport(null, fd({ id: 'no-uuid' }))).toMatchObject({ ok: false });
  void id;
});

it('volver de versión: solo con uuid y versión válida', async () => {
  const p = await pagina();
  expect(await p.props.acciones.volverVersion(null, fd({ perfilId: 'x', version: '1' }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.volverVersion(null, fd({ perfilId: U, version: '0' }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.volverVersion(null, fd({ perfilId: U, version: '1' }))).toMatchObject({ ok: false, error: 'Esa versión no existe en tu flota.' });
});
