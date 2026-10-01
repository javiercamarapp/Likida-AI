import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./repo_validacion', () => ({ asignarSitiosViaje: vi.fn(), cambiarEstadoSitio: vi.fn(), guardarSitio: vi.fn(), importarSitios: vi.fn() }));

const { archivarSitioDelPanel, asignarSitiosDelPanel, guardarSitioDelPanel, importarCsvDelPanel, QUITAR_SITIO } = await import('./acciones_sitios');
type Deps = import('./acciones_sitios').DepsSitios;

const U1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const ctx = (rol = 'encargado') => ({ tenantId: 't-sesion', rol });
const fd = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const valido = { nombre: 'Planta Zapopan', tipo: 'planta', lat: '20.72', lng: '-103.39', radio_m: '300' };
const CSV = 'codigo,nombre,tipo,lat,lng,radio_m\nPL-1,Planta Uno,planta,20.72,-103.39,300\nAN-1,Andén Uno,anden,20.7201,-103.3901,60';

function deps(o: { guardar?: unknown; importar?: unknown; estado?: unknown; asignar?: unknown } = {}) {
  return {
    asignar: vi.fn(async () => o.asignar ?? 'ok'),
    guardar: vi.fn(async () => o.guardar ?? 'ok'),
    importar: vi.fn(async () => o.importar ?? { ok: true, creados: 2, actualizados: 0 }),
    estado: vi.fn(async () => o.estado ?? true),
  } as unknown as Deps & { guardar: ReturnType<typeof vi.fn>; importar: ReturnType<typeof vi.fn>; estado: ReturnType<typeof vi.fn>; asignar: ReturnType<typeof vi.fn> };
}

describe('permisos: dueño, encargado y superadmin; nadie más (fail closed)', () => {
  it.each(['flota_admin', 'encargado', 'superadmin'])('%s puede', async (rol) => {
    const d = deps();
    expect((await guardarSitioDelPanel(ctx(rol), fd(valido), d)).ok).toBe(true);
    expect((await importarCsvDelPanel(ctx(rol), { texto: CSV, radioDefecto: null }, d)).ok).toBe(true);
    expect((await archivarSitioDelPanel(ctx(rol), U1, false, d)).ok).toBe(true);
    expect((await asignarSitiosDelPanel(ctx(rol), fd({ viajeId: U1, origen: U1 }), d)).ok).toBe(true);
  });

  it.each(['contador', 'vendedor', 'operador', 'sin_rol', '', 'otro'])('%s NO puede y no toca la base', async (rol) => {
    const d = deps();
    expect(await guardarSitioDelPanel(ctx(rol), fd(valido), d)).toMatchObject({ ok: false });
    expect(await importarCsvDelPanel(ctx(rol), { texto: CSV, radioDefecto: null }, d)).toMatchObject({ ok: false });
    expect(await archivarSitioDelPanel(ctx(rol), U1, false, d)).toMatchObject({ ok: false });
    expect(await asignarSitiosDelPanel(ctx(rol), fd({ viajeId: U1, origen: U1 }), d)).toMatchObject({ ok: false });
    expect(d.asignar).not.toHaveBeenCalled();
    expect(d.guardar).not.toHaveBeenCalled();
    expect(d.importar).not.toHaveBeenCalled();
    expect(d.estado).not.toHaveBeenCalled();
  });
});

describe('guardar sitio', () => {
  it('escribe en la flota de la SESIÓN (el formulario no puede traer otra)', async () => {
    const d = deps();
    await guardarSitioDelPanel(ctx(), fd({ ...valido, tenant_id: 't-otra' }), d);
    expect(d.guardar.mock.calls[0][0]).toBe('t-sesion');
    expect(d.guardar.mock.calls[0][1]).not.toHaveProperty('tenant_id');
  });
  it('crear vs editar se dice distinto', async () => {
    expect(await guardarSitioDelPanel(ctx(), fd(valido), deps())).toEqual({ ok: true, mensaje: 'Sitio creado.' });
    expect(await guardarSitioDelPanel(ctx(), fd({ ...valido, id: U1 }), deps())).toEqual({ ok: true, mensaje: 'Sitio actualizado.' });
  });
  it('datos inválidos no llegan a la base y dicen por qué (sin inventar coordenadas)', async () => {
    const d = deps();
    const r = await guardarSitioDelPanel(ctx(), fd({ ...valido, lat: '' }), d);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/No se calculan/) });
    expect(d.guardar).not.toHaveBeenCalled();
  });
  it.each([
    ['duplicado', /nombre o ese código/], ['referencia_ajena', /no es de tu flota/], ['no_encontrado', /ya no existe/], ['datos_invalidos', /rechazó/],
  ])('resultado %s → mensaje en palabras', async (res, re) => {
    expect(await guardarSitioDelPanel(ctx(), fd(valido), deps({ guardar: res }))).toMatchObject({ ok: false, error: expect.stringMatching(re) });
  });
  it('una base que lanza se dice sin filtrar el detalle', async () => {
    const d = { guardar: vi.fn(async () => { throw new Error('relation geocerca'); }), importar: vi.fn(), estado: vi.fn(), asignar: vi.fn() } as unknown as Deps;
    const r = await guardarSitioDelPanel(ctx(), fd(valido), d);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/No pude guardarlo/) });
    expect(JSON.stringify(r)).not.toContain('relation');
  });
});

describe('importar CSV (todo o nada)', () => {
  it('archivo válido: importa en la flota de la sesión y reporta creados y actualizados', async () => {
    const d = deps({ importar: { ok: true, creados: 1, actualizados: 1 } });
    const r = await importarCsvDelPanel(ctx(), { texto: CSV, radioDefecto: null }, d);
    expect(r).toEqual({ ok: true, mensaje: 'Importado: 1 nuevo y 1 actualizado.' });
    expect(d.importar.mock.calls[0][0]).toBe('t-sesion');
    expect(d.importar.mock.calls[0][1]).toHaveLength(2);
  });
  it('un error en el archivo: NO se llama a la base y se listan las líneas', async () => {
    const d = deps();
    const r = await importarCsvDelPanel(ctx(), { texto: `${CSV}\nX-1,Sin coordenadas,planta,,,300`, radioDefecto: null }, d);
    expect(r).toMatchObject({ ok: false, error: 'No se importó nada: 1 problema en el archivo.' });
    expect((r as { detalles: string[] }).detalles[0]).toMatch(/Línea 4: Faltan coordenadas/);
    expect(d.importar).not.toHaveBeenCalled();
  });
  it('los errores que solo la base ve (cliente que no existe) también son todo-o-nada y con su línea', async () => {
    const d = deps({ importar: { ok: false, errores: [{ linea: 3, mensaje: 'El cliente «X» no existe en tu catálogo de clientes.' }] } });
    const r = await importarCsvDelPanel(ctx(), { texto: CSV, radioDefecto: null }, d);
    expect(r).toMatchObject({ ok: false, detalles: ['Línea 3: El cliente «X» no existe en tu catálogo de clientes.'] });
  });
  it('limita la lista de detalles a 30', async () => {
    const filas = Array.from({ length: 50 }, (_, i) => `S${i},Sitio ${i},planta,,,300`);
    const r = await importarCsvDelPanel(ctx(), { texto: `codigo,nombre,tipo,lat,lng,radio_m\n${filas.join('\n')}`, radioDefecto: null }, deps());
    expect((r as { detalles: string[] }).detalles).toHaveLength(30);
    expect((r as { error: string }).error).toContain('50 problemas');
  });
  it('el radio por defecto declarado por quien importa se respeta', async () => {
    const d = deps();
    await importarCsvDelPanel(ctx(), { texto: 'codigo,nombre,tipo,lat,lng\nP,Planta,planta,20.72,-103.39', radioDefecto: 200 }, d);
    expect(d.importar.mock.calls[0][1][0].radio_m).toBe(200);
  });
  it('archivo vacío o con hostilidades: error, no excepción', async () => {
    expect(await importarCsvDelPanel(ctx(), { texto: '', radioDefecto: null }, deps())).toMatchObject({ ok: false });
    expect(await importarCsvDelPanel(ctx(), { texto: '\u0000\u0001<<<<', radioDefecto: null }, deps())).toMatchObject({ ok: false });
  });
  it('una base que lanza: no se guardó nada, y se dice', async () => {
    const d = { guardar: vi.fn(), importar: vi.fn(async () => { throw new Error('boom'); }), estado: vi.fn(), asignar: vi.fn() } as unknown as Deps;
    expect(await importarCsvDelPanel(ctx(), { texto: CSV, radioDefecto: null }, d)).toMatchObject({ ok: false, error: expect.stringMatching(/No se guardó nada/) });
  });
});

describe('archivar y reactivar', () => {
  it('pasa el id en minúsculas y la flota de la sesión', async () => {
    const d = deps();
    await archivarSitioDelPanel(ctx(), U1.toUpperCase(), false, d);
    expect(d.estado).toHaveBeenCalledWith('t-sesion', U1, false);
  });
  it('un id que no es uuid ni se consulta', async () => {
    const d = deps();
    expect(await archivarSitioDelPanel(ctx(), "x'; drop table geocerca;--", true, d)).toMatchObject({ ok: false });
    expect(d.estado).not.toHaveBeenCalled();
  });
  it('un sitio de otra flota (la base no lo encuentra) es «ya no existe»', async () => {
    expect(await archivarSitioDelPanel(ctx(), U1, true, deps({ estado: false }))).toMatchObject({ ok: false, error: expect.stringMatching(/ya no existe/) });
  });
});

describe('asignar sitios a un viaje desde el tablero', () => {
  const U2 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d002';
  const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0aa';
  it('cada lado: vacío no se toca, __quitar desasigna, un id se asigna; siempre en la flota de la SESIÓN', async () => {
    const d = deps();
    await asignarSitiosDelPanel(ctx(), fd({ viajeId: V.toUpperCase(), origen: U1.toUpperCase(), destino: QUITAR_SITIO, tenant_id: 't-otra' }), d);
    expect(d.asignar).toHaveBeenCalledWith('t-sesion', V, { origen: U1, destino: null });
    d.asignar.mockClear();
    await asignarSitiosDelPanel(ctx(), fd({ viajeId: V, destino: U2 }), d);
    expect(d.asignar).toHaveBeenCalledWith('t-sesion', V, { destino: U2 });
  });
  it('sin ningún lado elegido, o con ids que no son uuid, no llega a la base', async () => {
    const d = deps();
    expect(await asignarSitiosDelPanel(ctx(), fd({ viajeId: V }), d)).toMatchObject({ ok: false, error: expect.stringMatching(/Elige el sitio/) });
    expect(await asignarSitiosDelPanel(ctx(), fd({ viajeId: V, origen: "x'; --" }), d)).toMatchObject({ ok: false });
    expect(await asignarSitiosDelPanel(ctx(), fd({ viajeId: 'no-uuid', origen: U1 }), d)).toMatchObject({ ok: false });
    expect(d.asignar).not.toHaveBeenCalled();
  });
  it('un viaje o un sitio que no son de la flota se dicen en palabras (la base los resuelve dentro de la flota)', async () => {
    expect(await asignarSitiosDelPanel(ctx(), fd({ viajeId: V, origen: U1 }), deps({ asignar: 'viaje_no_encontrado' }))).toMatchObject({ ok: false, error: expect.stringMatching(/viaje ya no existe/) });
    expect(await asignarSitiosDelPanel(ctx(), fd({ viajeId: V, origen: U1 }), deps({ asignar: 'sitio_no_encontrado' }))).toMatchObject({ ok: false, error: expect.stringMatching(/catálogo/) });
  });
  it('una base que lanza se dice', async () => {
    const d = { asignar: vi.fn(async () => { throw new Error('boom'); }), guardar: vi.fn(), importar: vi.fn(), estado: vi.fn() } as unknown as Deps;
    expect(await asignarSitiosDelPanel(ctx(), fd({ viajeId: V, origen: U1 }), d)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude guardarlo/) });
  });
});
