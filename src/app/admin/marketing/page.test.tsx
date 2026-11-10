import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// /admin/marketing — el estudio. Lo que se fija ANTES de migrar la pantalla (toca el consentimiento de personas reales y su baja):
// subir un personaje exige el consentimiento y deja huella; borrarlo borra fila y foto con huella; publicar/rechazar usan la misma
// aprobación de siempre; una lectura caída se dice y no se pinta como «sin nada». Las acciones de servidor viven en la página, así que se
// extraen del árbol ya renderizado (mismo patrón que costos-facturacion).
const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(), listarHooks: vi.fn(), listarReferencias: vi.fn(), pendientes: vi.fn(), aprobadas: vi.fn(),
  guardarReferencia: vi.fn(), subirFoto: vi.fn(), validarFoto: vi.fn(), exigirConsentimiento: vi.fn(), borrarReferencia: vi.fn(),
  aprobarPieza: vi.fn(), rechazarPieza: vi.fn(), anotar: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: dobles.anotar }));
vi.mock('@/lib/likida/agentes/cola', () => ({ aprobarPieza: dobles.aprobarPieza, rechazarPieza: dobles.rechazarPieza }));
vi.mock('@/lib/likida/marketing/estudio', async (importar) => ({
  ...(await importar<typeof import('@/lib/likida/marketing/estudio')>()),
  listarHooks: dobles.listarHooks, listarReferencias: dobles.listarReferencias,
  piezasEstudioPendientes: dobles.pendientes, piezasEstudioAprobadasRecientes: dobles.aprobadas,
  guardarReferencia: dobles.guardarReferencia, subirFotoReferencia: dobles.subirFoto, validarFotoReferencia: dobles.validarFoto,
  exigirConsentimientoReferencia: dobles.exigirConsentimiento, borrarReferencia: dobles.borrarReferencia,
}));

import { FormaConAviso } from '../ui/forma';
import EstudioMarketingPage from './page';
import { SubirReferencia } from './subir-referencia';
import { TarjetaPieza } from './tarjeta-pieza';

type Elemento = ReactElement<Record<string, unknown>>;
type Accion = (previo: unknown, fd: FormData) => Promise<Record<string, unknown> | null>;
function buscar(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const h of nodo) buscar(h, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscar(nodo.props.children as ReactNode, componente, salida);
  return salida;
}
const fd = (c: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const REF = { id: 'r-1', tipo: 'personaje', nombre: 'Chofer Ramón', etiqueta: null, fotoRuta: 'x.jpg', fotoUrl: 'https://f/x.jpg', creadoEn: '2026-11-01T00:00:00Z' };
const PIEZA = { id: 'pz-1', tipo: 'guion_video', agente: 'guiones', titulo: 'Guion semanal', cuerpo: 'HOOK: algo.', fuentes: null, creadoEn: '2026-11-09T12:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', rol: 'superadmin', tenantId: null });
  dobles.listarHooks.mockResolvedValue([]);
  dobles.listarReferencias.mockResolvedValue([REF]);
  dobles.pendientes.mockResolvedValue([PIEZA]);
  dobles.aprobadas.mockResolvedValue([]);
  dobles.guardarReferencia.mockResolvedValue('r-9');
  dobles.subirFoto.mockResolvedValue('ruta.jpg');
  dobles.anotar.mockResolvedValue(true);
});

it('subir un personaje exige foto y consentimiento, y deja la huella en la bitácora', async () => {
  const pagina = await EstudioMarketingPage();
  const accion = buscar(pagina, SubirReferencia)[0].props.accion as Accion;
  const foto = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
  expect(await accion(null, fd({ tipo: 'personaje', nombre: 'Ramón', foto, consentimiento: 'on' }))).toEqual({ ok: true });
  expect(dobles.exigirConsentimiento).toHaveBeenCalledWith('personaje', 'on');
  expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'marketing.referencia_subida', entidadId: 'r-9', detalle: { tipo: 'personaje', consentimiento: true } }), expect.anything());
});

it('sin consentimiento del personaje NO se sube ni se guarda nada', async () => {
  dobles.exigirConsentimiento.mockImplementation(() => { throw new Error('Falta el consentimiento'); });
  const pagina = await EstudioMarketingPage();
  const accion = buscar(pagina, SubirReferencia)[0].props.accion as Accion;
  const r = await accion(null, fd({ tipo: 'personaje', nombre: 'Ramón', foto: new File(['x'], 'p.jpg', { type: 'image/jpeg' }) }));
  expect(r).toHaveProperty('error');
  expect(dobles.subirFoto).not.toHaveBeenCalled();
  expect(dobles.guardarReferencia).not.toHaveBeenCalled();
});

it('un tipo que no es personaje ni lugar, o sin foto, se rechaza sin subir', async () => {
  const pagina = await EstudioMarketingPage();
  const accion = buscar(pagina, SubirReferencia)[0].props.accion as Accion;
  expect(await accion(null, fd({ tipo: 'otro', nombre: 'x', foto: new File(['x'], 'p.jpg') }))).toEqual({ error: 'El tipo debe ser personaje o lugar.' });
  expect(await accion(null, fd({ tipo: 'lugar', nombre: 'x' }))).toEqual({ error: 'Elige una foto.' });
  expect(dobles.subirFoto).not.toHaveBeenCalled();
});

it('borrar una referencia borra fila y foto y deja la huella (es la baja de quien dio su consentimiento)', async () => {
  const pagina = await EstudioMarketingPage();
  const forma = buscar(pagina, FormaConAviso).find((f) => /Borrar/.test(String(f.props.boton)))!;
  const r = await (forma.props.accion as Accion)(null, fd({ referencia: 'r-1' }));
  expect(r).toEqual({ ok: 'Referencia borrada: fila y foto.' });
  expect(dobles.borrarReferencia).toHaveBeenCalledWith('r-1');
  expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'marketing.referencia_borrada', entidadId: 'r-1' }), expect.anything());
});

it('si borrar falla, se dice y NO se asienta como borrada', async () => {
  dobles.borrarReferencia.mockRejectedValue(new Error('caída'));
  const pagina = await EstudioMarketingPage();
  const forma = buscar(pagina, FormaConAviso).find((f) => /Borrar/.test(String(f.props.boton)))!;
  const r = await (forma.props.accion as Accion)(null, fd({ referencia: 'r-1' }));
  expect(r).toHaveProperty('error');
  expect(dobles.anotar).not.toHaveBeenCalled();
});

it('cada acción de servidor exige superadmin antes de tocar nada', async () => {
  const pagina = await EstudioMarketingPage();
  const publicar = buscar(pagina, TarjetaPieza)[0].props.publicar as Accion;
  dobles.requireSuperadmin.mockRejectedValue(new Error('REDIRECT'));
  await expect(publicar(null, fd({ pieza: 'pz-1' }))).rejects.toThrow('REDIRECT');
  expect(dobles.aprobarPieza).not.toHaveBeenCalled();
});

it('publicar es la aprobación de siempre; rechazar pasa el motivo', async () => {
  const pagina = await EstudioMarketingPage();
  const t = buscar(pagina, TarjetaPieza)[0];
  expect(await (t.props.publicar as Accion)(null, fd({ pieza: 'pz-1' }))).toHaveProperty('ok');
  expect(dobles.aprobarPieza).toHaveBeenCalledWith('pz-1', 'u-1');
  expect(await (t.props.rechazar as Accion)(null, fd({ pieza: 'pz-1', motivo: 'tono' }))).toHaveProperty('ok');
  expect(dobles.rechazarPieza).toHaveBeenCalledWith('pz-1', 'u-1', 'tono');
});

it('lecturas caídas: cada sección lo dice y NO afirma que esté vacía', async () => {
  dobles.listarHooks.mockRejectedValue(new Error('caída'));
  dobles.listarReferencias.mockRejectedValue(new Error('caída'));
  dobles.pendientes.mockRejectedValue(new Error('caída'));
  const h = renderToStaticMarkup(await EstudioMarketingPage());
  expect(h).toContain('NO significa que esté vacío');
  expect(h).toContain('NO significa que no haya');
  expect(h).not.toContain('Sin hooks guardados todavía');
  expect(h).not.toContain('Sin personajes ni lugares subidos todavía');
  expect(h).not.toContain('Nada pendiente ahora mismo');
});
