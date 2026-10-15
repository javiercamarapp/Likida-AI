import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./repo_validacion', () => ({
  asignarSitiosViaje: vi.fn(), cambiarEstadoSitio: vi.fn(), guardarSitio: vi.fn(), importarSitios: vi.fn(), importarEquivalencias: vi.fn(), guardarEquivalencia: vi.fn(),
}));

const { asignarEquivalenciaDelPanel, importarEquivalenciasDelPanel, MARCAR_IGNORAR, MARCAR_INSTRUCCION } = await import('./acciones_sitios');
const { planificarEquivalencias } = await import('./sitios');
type Deps = import('./acciones_sitios').DepsEquivalencias;
type Guardada = import('./sitios').EquivalenciaGuardada;
type FilaCsv = import('./sitios').EquivalenciaCsv;

const U1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const ctx = (rol = 'encargado') => ({ tenantId: 't-sesion', rol });
const fd = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const CSV_6 = [
  'texto,geocerca_codigo,tipo,lado',
  'STOP Planta Demo FINAL ACERO,PL-DEMO,sitio,destino',
  'VACIO Cliente Demo,,ignorar,origen',
  'SALIR A RUTA ANTES DE LAS 7 PM,,instruccion,ambos',
  'Patio Oriente,PDO,,',
  'Texto con tipo raro,PL-DEMO,quizas,destino',
  'STOP Otra Planta FINAL HIERRO,PL-FANTASMA,sitio,destino',
].join('\n');

/** Una «base» en memoria que hace lo mismo que el repo real (el mismo planificador), para probar la acción de punta a punta. */
function baseEnMemoria() {
  const guardadas: Guardada[] = [];
  const sitios = new Map([['pl-demo', 'id-planta-demo'], ['pdo', 'id-patio-demo']]);
  let n = 0;
  const deps = {
    importar: vi.fn(async (_t: string, filas: readonly FilaCsv[]) => {
      const plan = planificarEquivalencias(filas, sitios, guardadas);
      for (const x of plan.nuevas) guardadas.push({ id: `e${++n}`, textoNormalizado: x.textoNormalizado, lado: x.lado, tipo: x.tipo, geocercaId: x.geocercaId, clienteId: null });
      for (const c of plan.cambios) Object.assign(guardadas.find((g) => g.id === c.id)!, { tipo: c.tipo, geocercaId: c.geocercaId });
      return { guardadas: plan.nuevas.length + plan.cambios.length, nuevas: plan.nuevas.length, actualizadas: plan.cambios.length, sinCambios: plan.sinCambios, rechazadas: plan.rechazadas };
    }),
    guardar: vi.fn(async () => 'ok'),
  };
  return { deps: deps as unknown as Deps & typeof deps, guardadas };
}

describe('importarEquivalenciasDelPanel', () => {
  it('CSV de 6 filas (2 inválidas) → 4 guardadas y 2 rechazadas, con el motivo exacto de cada una', async () => {
    const { deps, guardadas } = baseEnMemoria();
    const r = await importarEquivalenciasDelPanel(ctx(), { texto: CSV_6 }, deps);
    expect(r).toEqual({
      ok: true,
      mensaje: 'Equivalencias: 4 guardadas (4 nuevas, 0 actualizadas), 0 sin cambios, 2 rechazadas.',
      detalles: [
        'Línea 6: El tipo «quizas» no es válido. Usa: sitio, sin_sitio (o instruccion), ignorar.',
        'Línea 7: El sitio "PL-FANTASMA" no existe en tu catálogo. Impórtalo primero en Sitios.',
      ],
    });
    expect(guardadas).toHaveLength(4);
  });

  it('reimportar el mismo archivo = 0 cambios (nada nuevo, nada actualizado)', async () => {
    const { deps, guardadas } = baseEnMemoria();
    await importarEquivalenciasDelPanel(ctx(), { texto: CSV_6 }, deps);
    const antes = JSON.stringify(guardadas);
    const r = await importarEquivalenciasDelPanel(ctx(), { texto: CSV_6 }, deps);
    expect(r).toMatchObject({ ok: true, mensaje: 'Equivalencias: 0 guardadas (0 nuevas, 0 actualizadas), 4 sin cambios, 2 rechazadas.' });
    expect(JSON.stringify(guardadas)).toBe(antes);
  });

  it('el tenant sale de la sesión: el archivo no puede nombrarlo', async () => {
    const { deps } = baseEnMemoria();
    await importarEquivalenciasDelPanel(ctx(), { texto: 'texto,geocerca_codigo,tipo,tenant_id\nA B,PDO,sitio,otra-flota' }, deps);
    expect(deps.importar.mock.calls[0][0]).toBe('t-sesion');
  });

  it('si ninguna fila se pudo guardar es un error con los motivos; un archivo malo no toca la base', async () => {
    const { deps } = baseEnMemoria();
    const solo = await importarEquivalenciasDelPanel(ctx(), { texto: 'texto,geocerca_codigo,tipo\nA B,PL-FANTASMA,sitio' }, deps);
    expect(solo).toEqual({ ok: false, error: 'No se guardó ninguna fila: 1 rechazada.', detalles: ['Línea 2: El sitio "PL-FANTASMA" no existe en tu catálogo. Impórtalo primero en Sitios.'] });
    const malo = await importarEquivalenciasDelPanel(ctx(), { texto: 'otra,cosa\n1,2' }, deps);
    expect(malo).toMatchObject({ ok: false, error: 'No se importó nada: 1 problema en el archivo.' });
    const vacias = await importarEquivalenciasDelPanel(ctx(), { texto: 'texto,geocerca_codigo,tipo\nA B,,' }, deps);
    expect(vacias).toMatchObject({ ok: false });
    expect(deps.importar).toHaveBeenCalledTimes(1);
  });

  it('permisos: dueño, encargado y superadmin; el contador y un rol desconocido, no', async () => {
    for (const rol of ['flota_admin', 'encargado', 'superadmin']) {
      expect((await importarEquivalenciasDelPanel(ctx(rol), { texto: CSV_6 }, baseEnMemoria().deps)).ok).toBe(true);
    }
    for (const rol of ['contador', 'operador', '', 'inventado']) {
      const { deps } = baseEnMemoria();
      const r = await importarEquivalenciasDelPanel(ctx(rol), { texto: CSV_6 }, deps);
      expect(r.ok).toBe(false);
      expect(deps.importar).not.toHaveBeenCalled();
    }
  });

  it('una base caída no se disfraza de éxito', async () => {
    const { deps } = baseEnMemoria();
    deps.importar.mockRejectedValueOnce(new Error('boom'));
    const r = await importarEquivalenciasDelPanel(ctx(), { texto: CSV_6 }, deps);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain('boom');
  });
});

describe('asignarEquivalenciaDelPanel', () => {
  it('un sitio, una instrucción o ignorar: normaliza el texto y manda el tipo correcto', async () => {
    const { deps } = baseEnMemoria();
    await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'STOP  Planta Demo, FINAL', lado: 'destino', asignar: U1.toUpperCase() }), deps);
    await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'VACIO X', lado: 'origen', asignar: MARCAR_INSTRUCCION }), deps);
    await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'SALIR A RUTA', lado: 'ambos', asignar: MARCAR_IGNORAR }), deps);
    expect(deps.guardar.mock.calls).toEqual([
      ['t-sesion', { textoNormalizado: 'stop planta demo final', lado: 'destino', tipo: 'sitio', geocercaId: U1 }],
      ['t-sesion', { textoNormalizado: 'vacio x', lado: 'origen', tipo: 'sin_sitio', geocercaId: null }],
      ['t-sesion', { textoNormalizado: 'salir a ruta', lado: 'ambos', tipo: 'ignorar', geocercaId: null }],
    ]);
  });

  it('entradas inválidas no llegan a la base', async () => {
    const { deps } = baseEnMemoria();
    const sinElegir = await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'A', lado: 'destino', asignar: '' }), deps);
    expect(sinElegir).toEqual({ ok: false, error: 'Elige un sitio, o marca el texto como instrucción o como ignorar.' });
    expect((await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'A', lado: 'destino', asignar: 'no-es-uuid' }), deps)).ok).toBe(false);
    expect((await asignarEquivalenciaDelPanel(ctx(), fd({ texto: '!!!', lado: 'destino', asignar: U1 }), deps)).ok).toBe(false);
    expect((await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'A', lado: 'arriba', asignar: U1 }), deps)).ok).toBe(false);
    expect((await asignarEquivalenciaDelPanel(ctx('contador'), fd({ texto: 'A', lado: 'destino', asignar: U1 }), deps)).ok).toBe(false);
    expect(deps.guardar).not.toHaveBeenCalled();
  });

  it('un sitio que no es del catálogo de la flota dice qué hacer', async () => {
    const { deps } = baseEnMemoria();
    deps.guardar.mockResolvedValueOnce('sitio_no_encontrado');
    const r = await asignarEquivalenciaDelPanel(ctx(), fd({ texto: 'A', lado: 'destino', asignar: U1 }), deps);
    expect(r).toEqual({ ok: false, error: 'Ese sitio no existe en tu catálogo. Impórtalo primero en Sitios.' });
  });
});
