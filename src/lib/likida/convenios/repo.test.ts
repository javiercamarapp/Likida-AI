import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mundo } from './mundo.fixture';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const repo = await import('./repo');
const { parsearMatrizConvenios } = await import('./importador');

const A = 'tenant-a';
const B = 'tenant-b';
const ENC = ['Cliente', 'Convenio', 'Origen', 'Destino', 'Sitio destino', 'Categoría', 'Instrucción', 'Momento', 'Lugar', 'Tarifa modo', 'Tarifa precio', 'Requisitos de cobro'];
const importar = (filas: unknown[][], conFinanzas = true) => {
  const p = parsearMatrizConvenios([ENC, ...filas], { puedeVerFinanzas: conFinanzas });
  expect(p.errores).toEqual([]);
  return repo.importarConvenios(A, p.convenios, { conFinanzas });
};

beforeEach(() => {
  mundo = new Mundo();
  mundo.poner('cliente', { tenant_id: A, nombre: 'Cliente Uno' });
  mundo.poner('cliente', { tenant_id: B, nombre: 'Cliente Ajeno' });
  mundo.poner('geocerca', { tenant_id: A, nombre: 'CEDIS Tlaquepaque', codigo: 'CED-1', activa: true });
});

describe('importarConvenios', () => {
  it('no escribe NADA si el cliente o el sitio no existen en la flota (no se inventan)', async () => {
    const r = await importar([['Cliente Inexistente', 'x', '', '', 'CED-9', 'puerta', 'P3', '', '', '', '', '']]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.map((e) => e.motivo).join(' ')).toMatch(/cliente «Cliente Inexistente».*sitio de destino «CED-9»/);
    expect(mundo.tablas.cliente_convenio).toHaveLength(0);
  });

  it('un cliente de OTRA flota no se puede usar', async () => {
    const r = await importar([['Cliente Ajeno', 'x', '', '', '', '', '', '', '', '', '', '']]);
    expect(r.ok).toBe(false);
    expect(mundo.tablas.cliente_convenio).toHaveLength(0);
  });

  it('crea el convenio, resuelve el sitio por código y guarda las instrucciones y el dinero', async () => {
    const r = await importar([
      ['cliente uno', 'Ruta norte', 'Zapopan', 'Tlaquepaque', 'ced-1', 'puerta', 'Puerta 3', 'ambos', 'destino', 'por_viaje', '5000', 'Factura | Carta porte'],
      ['cliente uno', 'Ruta norte', '', '', '', 'reportarse', 'Sr. Ramírez', 'acercamiento', 'destino', '', '', ''],
    ]);
    expect(r).toEqual({ ok: true, creados: 1, actualizados: 0, instrucciones: 2 });
    const c = mundo.tablas.cliente_convenio[0];
    expect(c).toMatchObject({ tenant_id: A, nombre: 'Ruta norte', destino_sitio_id: mundo.tablas.geocerca[0].id });
    expect(mundo.tablas.convenio_instruccion).toHaveLength(2);
    expect(mundo.tablas.convenio_comercial[0]).toMatchObject({ tarifa_modo: 'por_viaje', tarifa_precio: 5000, requisitos_cobro: ['Factura', 'Carta porte'] });
  });

  it('es idempotente: subir el mismo archivo dos veces no duplica nada', async () => {
    const filas = [['Cliente Uno', 'Ruta norte', '', '', '', 'puerta', 'Puerta 3', '', '', '', '', '']];
    await importar(filas);
    const r2 = await importar(filas);
    expect(r2).toMatchObject({ ok: true, creados: 0, actualizados: 1 });
    expect(mundo.tablas.cliente_convenio).toHaveLength(1);
    expect(mundo.tablas.convenio_instruccion).toHaveLength(1);
  });

  it('el archivo manda: la instrucción que ya no trae se quita, y se escribe lo nuevo ANTES de quitar', async () => {
    await importar([
      ['Cliente Uno', 'R', '', '', '', 'puerta', 'Puerta 3', '', '', '', '', ''], ['Cliente Uno', 'R', '', '', '', 'documentos', 'Carta porte', '', '', '', '', ''],
    ]);
    await importar([['Cliente Uno', 'R', '', '', '', 'puerta', 'Puerta 5', '', '', '', '', '']]);
    expect(mundo.tablas.convenio_instruccion.map((i) => i.texto)).toEqual(['Puerta 5']);
  });

  it('sin permiso de finanzas no escribe dinero (y lo que ya había no se toca)', async () => {
    await importar([['Cliente Uno', 'R', '', '', '', 'puerta', 'P3', '', '', 'por_viaje', '5000', '']]);
    const p = parsearMatrizConvenios([ENC.slice(0, 9), ['Cliente Uno', 'R', '', '', '', 'puerta', 'P4', '', '']], { puedeVerFinanzas: false });
    await repo.importarConvenios(A, p.convenios, { conFinanzas: false });
    expect(mundo.tablas.convenio_comercial[0].tarifa_precio).toBe(5000);
  });

  it('base sin migrar: lo dice (ConveniosNoDisponibles), no finge una lista vacía', async () => {
    mundo.ausentes.add('cliente_convenio');
    await expect(repo.listarConvenios(A, { conFinanzas: false })).rejects.toBeInstanceOf(repo.ConveniosNoDisponibles);
  });
});

describe('listarConvenios', () => {
  beforeEach(async () => {
    await importar([['Cliente Uno', 'Ruta norte', '', '', 'CED-1', 'puerta', 'Puerta 3', '', '', 'por_km', '12.5', 'Factura']]);
    // un convenio de OTRA flota, con el mismo nombre
    const cb = mundo.tablas.cliente.find((c) => c.tenant_id === B)!;
    const ajeno = mundo.poner('cliente_convenio', { tenant_id: B, cliente_id: cb.id, nombre: 'Ruta norte', activo: true });
    mundo.poner('convenio_instruccion', { tenant_id: B, convenio_id: ajeno.id, categoria: 'puerta', texto: 'SECRETO DE B', momento: 'ambos', lugar: 'ambos', orden: 0, activa: true });
  });

  it('solo trae lo de SU flota', async () => {
    const l = await repo.listarConvenios(A, { conFinanzas: false });
    expect(l).toHaveLength(1);
    expect(JSON.stringify(l)).not.toContain('SECRETO DE B');
    expect(l[0]).toMatchObject({ cliente: 'Cliente Uno', sitioDestinoNombre: 'CEDIS Tlaquepaque' });
  });

  it('el dinero solo sale con finanzas, y ni siquiera se consulta sin ellas', async () => {
    mundo.consultas.length = 0;
    const sin = await repo.listarConvenios(A, { conFinanzas: false });
    expect(sin[0].comercial).toBeUndefined();
    expect(mundo.consultas.some((c) => c.tabla === 'convenio_comercial')).toBe(false);
    const con = await repo.listarConvenios(A, { conFinanzas: true });
    expect(con[0].comercial).toMatchObject({ modo: 'por_km', precio: 12.5, requisitos: ['Factura'] });
  });

  it('TODA consulta ancla el tenant de la sesión', async () => {
    mundo.consultas.length = 0;
    await repo.listarConvenios(A, { conFinanzas: true });
    for (const q of mundo.consultas) expect(q.filtros.some(([c, v]) => c === 'tenant_id' && v === A), `${q.tabla} ${q.op}`).toBe(true);
  });
});

describe('ligarConvenioAViaje', () => {
  const viaje = (o: Record<string, unknown> = {}) => mundo.poner('viaje', { tenant_id: A, cliente_id: mundo.tablas.cliente[0].id, origen: 'Zapopan', destino: 'Tlaquepaque', estatus: 'abierto', ...o });

  beforeEach(async () => {
    await importar([
      ['Cliente Uno', 'Ruta norte', 'Zapopan', 'Tlaquepaque', 'CED-1', 'puerta', 'Puerta 3', 'ambos', 'destino', '', '', ''],
    ]);
  });

  it('elige el convenio, FOTOGRAFÍA las instrucciones y le pasa al viaje el sitio que no traía', async () => {
    const v = viaje();
    const r = await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10');
    expect(r.estado).toBe('ligado');
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ viaje_id: v.id, tenant_id: A, ligado_por: 'auto' });
    expect((mundo.tablas.viaje_convenio[0].instrucciones as unknown[])).toHaveLength(1);
    expect(v.destino_geocerca_id).toBe(mundo.tablas.geocerca[0].id);
    expect(v.origen_geocerca_id).toBeUndefined(); // el convenio no define sitio de origen: no se inventa
  });

  it('es idempotente y editar el convenio DESPUÉS no cambia lo que ya se le dijo al operador', async () => {
    const v = viaje();
    await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10');
    await importar([['Cliente Uno', 'Ruta norte', '', '', '', 'puerta', 'Puerta 9', '', '', '', '', '']]);
    const r = await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10');
    expect(r.estado).toBe('ya_ligado');
    if (r.estado === 'ya_ligado') expect(r.ligado.instrucciones[0].texto).toBe('Puerta 3');
    expect(mundo.tablas.viaje_convenio).toHaveLength(1);
  });

  it('sin cliente o sin convenio: no liga y lo dice', async () => {
    expect(await repo.ligarConvenioAViaje(A, String(viaje({ cliente_id: null }).id), '2026-10-10')).toMatchObject({ estado: 'sin_convenio' });
    const otro = mundo.poner('cliente', { tenant_id: A, nombre: 'Sin convenios' });
    expect(await repo.ligarConvenioAViaje(A, String(viaje({ cliente_id: otro.id }).id), '2026-10-10')).toMatchObject({ estado: 'sin_convenio' });
    expect(mundo.tablas.viaje_convenio).toHaveLength(0);
  });

  it('un viaje de OTRA flota es «no existe»', async () => {
    const ajeno = mundo.poner('viaje', { tenant_id: B, cliente_id: mundo.tablas.cliente[1].id });
    expect(await repo.ligarConvenioAViaje(A, String(ajeno.id), '2026-10-10')).toEqual({ estado: 'viaje_no_encontrado' });
  });

  it('un convenio vencido no se liga', async () => {
    mundo.tablas.cliente_convenio[0].vigente_hasta = '2026-01-01';
    expect(await repo.ligarConvenioAViaje(A, String(viaje().id), '2026-10-10')).toMatchObject({ estado: 'sin_convenio', motivo: 'sin_vigentes' });
  });
});

describe('el claim del envío', () => {
  let viajeId: string;
  beforeEach(() => {
    viajeId = 'v1';
    mundo.poner('viaje_convenio', { viaje_id: viajeId, tenant_id: A, convenio_id: null, instrucciones: [], despacho_reclamado_en: null, despacho_enviado_en: null });
  });
  const T0 = new Date('2026-10-10T12:00:00Z');

  it('de dos reclamos sobre el mismo viaje gana exactamente uno', async () => {
    const [x, y] = await Promise.all([repo.reclamarEnvio(A, viajeId, 'despacho', T0), repo.reclamarEnvio(A, viajeId, 'despacho', T0)]);
    expect([x, y].sort()).toEqual(['ganado', 'perdido']);
  });

  it('un reclamo caído (más de 10 min sin cerrarse) se puede volver a tomar; uno fresco no', async () => {
    await repo.reclamarEnvio(A, viajeId, 'despacho', T0);
    expect(await repo.reclamarEnvio(A, viajeId, 'despacho', new Date(T0.getTime() + 5 * 60_000))).toBe('perdido');
    expect(await repo.reclamarEnvio(A, viajeId, 'despacho', new Date(T0.getTime() + 11 * 60_000))).toBe('ganado');
  });

  it('enviado ya no se reclama; liberar devuelve el reclamo; el de otra flota no toca nada', async () => {
    await repo.reclamarEnvio(A, viajeId, 'despacho', T0);
    await repo.liberarEnvio(A, viajeId, 'despacho');
    expect(await repo.reclamarEnvio(A, viajeId, 'despacho', T0)).toBe('ganado');
    await repo.cerrarEnvio(A, viajeId, 'despacho', 'texto', T0);
    expect(await repo.reclamarEnvio(A, viajeId, 'despacho', new Date(T0.getTime() + 60 * 60_000))).toBe('perdido');
    expect(await repo.reclamarEnvio(B, viajeId, 'acercamiento', T0)).toBe('perdido');
  });

  it('el acercamiento tiene su propio claim, independiente del despacho', async () => {
    await repo.reclamarEnvio(A, viajeId, 'despacho', T0);
    expect(await repo.reclamarEnvio(A, viajeId, 'acercamiento', T0)).toBe('ganado');
  });
});

describe('ladoDelViaje', () => {
  it('antes de salir de la carga es el origen; después, el destino; sin hitos, se ignora', async () => {
    expect(await repo.ladoDelViaje(A, 'v1')).toBeNull();
    const h = mundo.poner('viaje_hito', { tenant_id: A, viaje_id: 'v1', tipo: 'salida_carga', estado: 'esperado' });
    expect(await repo.ladoDelViaje(A, 'v1')).toBe('origen');
    h.estado = 'recibido';
    expect(await repo.ladoDelViaje(A, 'v1')).toBe('destino');
    expect(await repo.ladoDelViaje(B, 'v1')).toBeNull();
  });
});
