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

describe('corregir a mano el convenio ligado a un viaje', () => {
  const viaje = (o: Record<string, unknown> = {}) => mundo.poner('viaje', { tenant_id: A, cliente_id: mundo.tablas.cliente[0].id, origen: 'Zapopan', destino: 'Tlaquepaque', estatus: 'abierto', created_at: '2026-10-01T00:00:00Z', ...o });
  const idConvenio = (nombre: string) => String(mundo.tablas.cliente_convenio.find((c) => c.nombre === nombre)!.id);

  beforeEach(async () => {
    await importar([
      ['Cliente Uno', 'Ruta norte', 'Zapopan', 'Tlaquepaque', 'CED-1', 'puerta', 'Puerta 3', 'ambos', 'destino', '', '', ''],
      ['Cliente Uno', 'Ruta sur', 'Zapopan', 'Colima', '', 'reportarse', 'Con el guardia sur', 'despacho', 'ambos', '', '', ''],
    ]);
  });

  it('cambia al otro convenio del cliente: nueva foto, «manual», y los sellos de envío vuelven a cero si se pide reenviar', async () => {
    const v = viaje();
    await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10');
    Object.assign(mundo.tablas.viaje_convenio[0], { despacho_enviado_en: '2026-10-10T10:00:00Z', despacho_canal: 'texto' });
    const r = await repo.corregirConvenioDelViaje(A, String(v.id), idConvenio('Ruta sur'), { reenviar: true });
    expect(r).toEqual({ estado: 'ok', convenioNombre: 'Ruta sur', instrucciones: 1 });
    expect(mundo.tablas.viaje_convenio).toHaveLength(1);
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ convenio_id: idConvenio('Ruta sur'), ligado_por: 'manual', despacho_enviado_en: null, despacho_canal: null });
    expect((mundo.tablas.viaje_convenio[0].instrucciones as Array<{ texto: string }>)[0].texto).toBe('Con el guardia sur');
  });

  it('sin «reenviar» conserva los sellos de lo ya enviado', async () => {
    const v = viaje();
    await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10');
    Object.assign(mundo.tablas.viaje_convenio[0], { despacho_enviado_en: '2026-10-10T10:00:00Z', despacho_canal: 'texto' });
    await repo.corregirConvenioDelViaje(A, String(v.id), idConvenio('Ruta sur'), { reenviar: false });
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ ligado_por: 'manual', despacho_canal: 'texto' });
  });

  it('un viaje que NUNCA se ligó (empate entre convenios) recibe fila nueva con el convenio elegido, y el despacho ya no lo vuelve a elegir solo', async () => {
    const v = viaje();
    expect(mundo.tablas.viaje_convenio).toHaveLength(0);
    expect(await repo.corregirConvenioDelViaje(A, String(v.id), idConvenio('Ruta norte'), { reenviar: false })).toMatchObject({ estado: 'ok', convenioNombre: 'Ruta norte' });
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ viaje_id: v.id, tenant_id: A, convenio_id: idConvenio('Ruta norte'), ligado_por: 'manual' });
    expect(await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10')).toMatchObject({ estado: 'ya_ligado' });
  });

  it('«sin convenio»: la fila queda con convenio nulo y sin instrucciones; nada se manda', async () => {
    const v = viaje();
    await repo.ligarConvenioAViaje(A, String(v.id), '2026-10-10');
    expect(await repo.corregirConvenioDelViaje(A, String(v.id), null, { reenviar: true })).toEqual({ estado: 'ok', convenioNombre: null, instrucciones: 0 });
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ convenio_id: null, ligado_por: 'manual', instrucciones: [] });
  });

  it('los sitios del convenio elegido pasan al viaje SOLO donde no traía', async () => {
    const v = viaje({ destino_geocerca_id: 'sitio-propio' });
    await repo.corregirConvenioDelViaje(A, String(v.id), idConvenio('Ruta norte'), { reenviar: false });
    expect(v.destino_geocerca_id).toBe('sitio-propio'); // ya traía uno: no se pisa
    const w = viaje();
    await repo.corregirConvenioDelViaje(A, String(w.id), idConvenio('Ruta norte'), { reenviar: false });
    expect(w.destino_geocerca_id).toBe(mundo.tablas.geocerca[0].id);
  });

  it('rechaza lo que no se puede: convenio de otro cliente, archivado o de otra flota; viaje liquidado, ajeno o sin cliente', async () => {
    const v = viaje();
    const otroCliente = mundo.poner('cliente', { tenant_id: A, nombre: 'Cliente Dos' });
    const ajeno = mundo.poner('cliente_convenio', { tenant_id: B, cliente_id: mundo.tablas.cliente[1].id, nombre: 'Ruta ajena', activo: true });
    const deOtroCliente = mundo.poner('cliente_convenio', { tenant_id: A, cliente_id: otroCliente.id, nombre: 'De Cliente Dos', activo: true });
    expect(await repo.corregirConvenioDelViaje(A, String(v.id), String(deOtroCliente.id), { reenviar: false })).toEqual({ estado: 'convenio_no_valido' });
    expect(await repo.corregirConvenioDelViaje(A, String(v.id), String(ajeno.id), { reenviar: false })).toEqual({ estado: 'convenio_no_valido' });
    await repo.cambiarEstadoConvenio(A, idConvenio('Ruta sur'), false);
    expect(await repo.corregirConvenioDelViaje(A, String(v.id), idConvenio('Ruta sur'), { reenviar: false })).toEqual({ estado: 'convenio_no_valido' });
    expect(await repo.corregirConvenioDelViaje(A, String(viaje({ estatus: 'liquidado' }).id), idConvenio('Ruta norte'), { reenviar: false })).toEqual({ estado: 'viaje_cerrado' });
    expect(await repo.corregirConvenioDelViaje(A, String(viaje({ cliente_id: null }).id), idConvenio('Ruta norte'), { reenviar: false })).toEqual({ estado: 'sin_cliente' });
    const deB = mundo.poner('viaje', { tenant_id: B, cliente_id: mundo.tablas.cliente[1].id, estatus: 'abierto' });
    expect(await repo.corregirConvenioDelViaje(A, String(deB.id), idConvenio('Ruta norte'), { reenviar: false })).toEqual({ estado: 'viaje_no_encontrado' });
    expect(mundo.tablas.viaje_convenio).toHaveLength(0);
  });

  it('TODA consulta de la corrección ancla el tenant de la sesión', async () => {
    const v = viaje();
    mundo.consultas.length = 0;
    await repo.corregirConvenioDelViaje(A, String(v.id), idConvenio('Ruta sur'), { reenviar: true });
    expect(mundo.consultas.length).toBeGreaterThan(0);
    // El INSERT lleva su tenant en el cuerpo (no en un filtro): se comprueba en la fila que quedó.
    for (const c of mundo.consultas.filter((x) => x.op !== 'insert')) expect(c.filtros.some(([col, val]) => col === 'tenant_id' && val === A), `${c.tabla}/${c.op}`).toBe(true);
    expect(mundo.tablas.viaje_convenio.every((f) => f.tenant_id === A)).toBe(true);
  });

  it('base sin migrar: lo dice (ConveniosNoDisponibles)', async () => {
    const v = viaje();
    mundo.ausentes.add('cliente_convenio');
    await expect(repo.corregirConvenioDelViaje(A, String(v.id), 'cualquiera', { reenviar: false })).rejects.toBeInstanceOf(repo.ConveniosNoDisponibles);
  });
});

describe('listarViajesConConvenio', () => {
  beforeEach(async () => {
    await importar([
      ['Cliente Uno', 'Ruta norte', 'Zapopan', 'Tlaquepaque', '', 'puerta', 'Puerta 3', 'ambos', 'destino', '', '', ''],
      ['Cliente Uno', 'Ruta sur', 'Zapopan', 'Colima', '', 'reportarse', 'Guardia sur', 'despacho', 'ambos', '', '', ''],
    ]);
  });

  it('lista los viajes abiertos con cliente, su convenio ligado y las opciones activas del cliente; ignora liquidados, sin cliente y de otra flota', async () => {
    const cliente = mundo.tablas.cliente[0].id;
    const op = mundo.poner('operador', { tenant_id: A, nombre: 'Juan Pérez' });
    const ligado = mundo.poner('viaje', { tenant_id: A, cliente_id: cliente, operador_id: op.id, folio: 'F-1', estatus: 'abierto', created_at: '2026-10-02T00:00:00Z' });
    const suelto = mundo.poner('viaje', { tenant_id: A, cliente_id: cliente, folio: 'F-2', estatus: 'abierto', created_at: '2026-10-01T00:00:00Z' });
    mundo.poner('viaje', { tenant_id: A, cliente_id: cliente, folio: 'F-3', estatus: 'liquidado' });
    mundo.poner('viaje', { tenant_id: A, cliente_id: null, folio: 'F-4', estatus: 'abierto' });
    mundo.poner('viaje', { tenant_id: B, cliente_id: mundo.tablas.cliente[1].id, folio: 'F-B', estatus: 'abierto' });
    // Con dos convenios del mismo cliente el despacho automático empata y no liga: la oficina lo corrige a mano.
    await repo.corregirConvenioDelViaje(A, String(ligado.id), String(mundo.tablas.cliente_convenio.find((c) => c.nombre === 'Ruta norte')!.id), { reenviar: false });

    const filas = await repo.listarViajesConConvenio(A);
    expect(filas.map((f) => f.folio)).toEqual(['F-1', 'F-2']); // más reciente primero
    expect(filas[0]).toMatchObject({ cliente: 'Cliente Uno', operador: 'Juan Pérez', ligadoPor: 'manual', instrucciones: 1, despachoEnviado: false });
    expect(filas[0].convenioNombre).toBe('Ruta norte');
    expect(filas[0].opciones.map((o) => o.nombre)).toEqual(['Ruta norte', 'Ruta sur']);
    expect(filas[1]).toMatchObject({ viajeId: suelto.id, ligadoPor: null, convenioId: null, convenioNombre: null, instrucciones: 0 });
  });

  it('el nombre de un convenio ya archivado se sigue leyendo, aunque no sea una opción para elegir', async () => {
    const cliente = mundo.tablas.cliente[0].id;
    const v = mundo.poner('viaje', { tenant_id: A, cliente_id: cliente, folio: 'F-1', estatus: 'abierto' });
    const conv = mundo.tablas.cliente_convenio.find((c) => c.nombre === 'Ruta sur')!;
    await repo.corregirConvenioDelViaje(A, String(v.id), String(conv.id), { reenviar: false });
    await repo.cambiarEstadoConvenio(A, String(conv.id), false);
    const [fila] = await repo.listarViajesConConvenio(A);
    expect(fila).toMatchObject({ convenioNombre: 'Ruta sur', ligadoPor: 'manual' });
    expect(fila.opciones.map((o) => o.nombre)).toEqual(['Ruta norte']);
  });

  it('sin viajes devuelve vacío y NO consulta el resto; la base sin migrar lo dice; toda consulta ancla el tenant', async () => {
    expect(await repo.listarViajesConConvenio(A)).toEqual([]);
    const v = mundo.poner('viaje', { tenant_id: A, cliente_id: mundo.tablas.cliente[0].id, estatus: 'abierto' });
    mundo.consultas.length = 0;
    await repo.listarViajesConConvenio(A);
    for (const c of mundo.consultas) expect(c.filtros.some(([col, val]) => col === 'tenant_id' && val === A), `${c.tabla}/${c.op}`).toBe(true);
    mundo.ausentes.add('viaje_convenio');
    await expect(repo.listarViajesConConvenio(A)).rejects.toBeInstanceOf(repo.ConveniosNoDisponibles);
    expect(v).toBeDefined();
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
    expect(await repo.reclamarEnvio(B, viajeId, 'acercamiento_origen', T0)).toBe('perdido');
  });

  it('cada acercamiento (a la planta de carga y a la de descarga) tiene su propio claim, independiente del despacho y del otro', async () => {
    await repo.reclamarEnvio(A, viajeId, 'despacho', T0);
    expect(await repo.reclamarEnvio(A, viajeId, 'acercamiento_origen', T0)).toBe('ganado');
    expect(await repo.reclamarEnvio(A, viajeId, 'acercamiento_destino', T0)).toBe('ganado');
    expect(await repo.reclamarEnvio(A, viajeId, 'acercamiento_origen', T0)).toBe('perdido');
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

describe('guardarConvenio y refrescarViajesDeConvenio (0656/0657)', () => {
  const datos = (o: Partial<import('./edicion').DatosConvenio> = {}): import('./edicion').DatosConvenio => ({
    convenioId: null, clienteId: String(mundo.tablas.cliente[0].id), nombre: 'Ruta norte', origen: 'Zapopan', destino: null, sitioOrigenId: null, sitioDestinoId: null,
    vigenteDesde: null, vigenteHasta: null, notas: null, version: null,
    instrucciones: [{ categoria: 'puerta', texto: 'Puerta 3', momento: 'ambos', lugar: 'destino', orden: 1 }], ...o,
  });

  it('el alta crea el convenio con su lista y devuelve la versión; la llamada lleva el tenant de la sesión', async () => {
    const r = await repo.guardarConvenio(A, datos());
    expect(r).toMatchObject({ estado: 'ok', creado: true, version: 1 });
    expect(mundo.tablas.convenio_instruccion).toHaveLength(1);
    expect(mundo.rpcLlamadas[0]).toMatchObject({ nombre: 'guardar_convenio', args: { p_tenant: A, p_convenio: null } });
  });

  it('editar con la versión vigente funciona y sube la versión; con una vieja es conflicto y no escribe', async () => {
    const alta = await repo.guardarConvenio(A, datos());
    if (alta.estado !== 'ok') throw new Error('alta');
    const viejo = await repo.guardarConvenio(A, datos({ convenioId: alta.id, clienteId: null, nombre: 'Otro nombre', version: 99, instrucciones: [] }));
    expect(viejo).toEqual({ estado: 'conflicto', version: 1 });
    expect(mundo.tablas.cliente_convenio[0]).toMatchObject({ nombre: 'Ruta norte' });
    expect(mundo.tablas.convenio_instruccion).toHaveLength(1);
    const ok = await repo.guardarConvenio(A, datos({ convenioId: alta.id, clienteId: null, nombre: 'Ruta norte 2', version: 1, instrucciones: [{ categoria: 'documentos', texto: 'Carta porte', momento: 'despacho', lugar: 'ambos', orden: 1 }] }));
    expect(ok).toMatchObject({ estado: 'ok', creado: false, version: 2 });
    expect(mundo.tablas.convenio_instruccion.map((i) => i.texto)).toEqual(['Carta porte']);
  });

  it('el importador del Excel también sube la versión: una forma abierta antes de re-importar ya no guarda', async () => {
    const alta = await repo.guardarConvenio(A, datos());
    if (alta.estado !== 'ok') throw new Error('alta');
    await importar([['Cliente Uno', 'Ruta norte', '', '', '', 'puerta', 'Puerta 3', '', '', '', '', '']]);
    const r = await repo.guardarConvenio(A, datos({ convenioId: alta.id, clienteId: null, version: alta.version }));
    expect(r.estado).toBe('conflicto');
  });

  it('nombre repetido, cliente de otra flota y convenio de otra flota se distinguen', async () => {
    const alta = await repo.guardarConvenio(A, datos());
    if (alta.estado !== 'ok') throw new Error('alta');
    expect(await repo.guardarConvenio(A, datos())).toEqual({ estado: 'duplicado' });
    expect(await repo.guardarConvenio(A, datos({ nombre: 'x', clienteId: String(mundo.tablas.cliente[1].id) }))).toEqual({ estado: 'referencia_invalida' });
    expect(await repo.guardarConvenio(B, datos({ convenioId: alta.id, clienteId: null, version: 1 }))).toEqual({ estado: 'no_existe' });
  });

  it('la base sin la 0656/0657 se dice (EdicionNoDisponible), no se confunde con un fallo', async () => {
    mundo.rpcAusentes.add('guardar_convenio');
    await expect(repo.guardarConvenio(A, datos())).rejects.toMatchObject({ name: 'EdicionNoDisponible', migracion: '0656' });
    mundo.rpcAusentes.add('refrescar_viajes_de_convenio');
    await expect(repo.refrescarViajesDeConvenio(A, 'x', false)).rejects.toMatchObject({ name: 'EdicionNoDisponible', migracion: '0657' });
  });

  it('listarConvenios trae la versión; sin la columna la lista sigue y la versión es null (la edición se apaga, no la pantalla)', async () => {
    await repo.guardarConvenio(A, datos());
    expect((await repo.listarConvenios(A, { conFinanzas: false }))[0]).toMatchObject({ version: 1 });
    mundo.columnasAusentes.set('cliente_convenio', new Set(['version']));
    const sin = await repo.listarConvenios(A, { conFinanzas: false });
    expect(sin).toHaveLength(1);
    expect(sin[0].version).toBeNull();
  });

  it('refrescar vuelve a tomar la foto solo de los viajes abiertos de ESE convenio que cambian, reabre el despacho si se pide y respeta otras flotas', async () => {
    const alta = await repo.guardarConvenio(A, datos());
    if (alta.estado !== 'ok') throw new Error('alta');
    const cli = mundo.tablas.cliente[0].id;
    const mk = (estatus: string, enviado: boolean) => {
      const v = mundo.poner('viaje', { tenant_id: A, folio: `F-${mundo.tablas.viaje.length}`, estatus, cliente_id: cli });
      mundo.poner('viaje_convenio', { viaje_id: v.id, tenant_id: A, convenio_id: alta.id, instrucciones: [], despacho_enviado_en: enviado ? '2026-10-01T10:00:00Z' : null, despacho_canal: enviado ? 'texto' : null, acercamiento_origen_enviado_en: enviado ? '2026-10-01T11:00:00Z' : null });
      return String(v.id);
    };
    const despachado = mk('abierto', true); const sinDespachar = mk('abierto', false); const liquidado = mk('liquidado', true);
    expect(await repo.refrescarViajesDeConvenio(B, String(alta.id), true)).toEqual([]);
    const r = await repo.refrescarViajesDeConvenio(A, String(alta.id), true);
    expect(r).toEqual(expect.arrayContaining([{ viajeId: despachado, reenviar: true }, { viajeId: sinDespachar, reenviar: false }]));
    expect(r).toHaveLength(2);
    const fila = (id: string) => mundo.tablas.viaje_convenio.find((x) => x.viaje_id === id)!;
    expect(fila(despachado)).toMatchObject({ despacho_enviado_en: null, despacho_canal: null, acercamiento_origen_enviado_en: '2026-10-01T11:00:00Z' });
    expect(fila(liquidado).instrucciones).toEqual([]);
    expect(await repo.refrescarViajesDeConvenio(A, String(alta.id), true)).toEqual([]);
  });
});
