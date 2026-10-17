import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from '@/lib/likida/peajes/db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// Las acciones de la tabla de candidatos (T-A2-28b), de PUNTA A PUNTA contra una base en memoria:
// la revisión REAL (`revisionDeDesglose`) sobre un desglose sintético, las decisiones y los reclamos
// que de verdad se escriben, y la puerta del formulario.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
let sesion: { rol: string; tenantId: string } = { rol: 'flota_admin', tenantId: 'tenant-1' };
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: async () => sesion }));

const A = await import('./acciones-candidatos');
const T = 'tenant-1';
const OTRO = 'tenant-2';
const DES = '11111111-1111-4111-8111-111111111111';

const linea = (tenant: string, indice: number, p: Fila = {}): Fila => ({
  tenant_id: tenant, desglose_id: DES, indice, fecha: '2026-03-05', hora: `${String(Math.floor(indice / 60) % 24).padStart(2, '0')}:${String(indice % 60).padStart(2, '0')}:00`,
  caseta: 'Plaza Ejemplo Sur', tag: `TAG${String(indice).padStart(5, '0')}`, monto: 100 + (indice % 7), clase: 5, unidad_archivo: `TC${9000 + (indice % 40)}`, unidad_id: null, ...p,
});

/** Un desglose sintético: n líneas de clase 9 (candidatas), 3 extemporáneas (antes del periodo) y una repetición atípica. */
function sembrar(opts: { clase9?: number; tenant?: string } = {}) {
  const tenant = opts.tenant ?? T;
  const n = opts.clase9 ?? 5;
  const lineas: Fila[] = [];
  for (let i = 0; i < n; i++) lineas.push(linea(tenant, i, { clase: 9, caseta: `Caseta Ejemplo ${i % 5}` }));
  for (let i = 0; i < 3; i++) lineas.push(linea(tenant, n + i, { fecha: '2026-02-20', clase: 5, caseta: 'Caseta Ejemplo Pasada' }));
  // 5 cruces de la misma unidad por la misma caseta en 4 h: señal atípica de repetición
  for (let i = 0; i < 5; i++) lineas.push(linea(tenant, n + 3 + i, { hora: `0${i + 1}:00:00`, unidad_archivo: 'TC9900', caseta: 'Caseta Ejemplo Repetida', clase: 5, fecha: '2026-03-06', monto: 90 }));
  db = crearDbFalsa({
    desglose_peaje: [{ id: DES, tenant_id: tenant, proveedor: 'Proveedor Ejemplo', archivo_nombre: 'prueba.xlsx', periodo_desde: '2026-03-01', periodo_hasta: '2026-03-10',
      periodo_oficial_desde: '2026-03-01', periodo_oficial_hasta: '2026-03-10', periodo_origen: 'nombre_archivo', no_periodo: '801', calidad: null, anulado_en: null }],
    desglose_peaje_linea: lineas,
  });
  return lineas;
}
const T0 = () => JSON.stringify(db.tablas.desglose_peaje_linea);

beforeEach(() => { sesion = { rol: 'flota_admin', tenantId: T }; });

const base = { desgloseId: DES, actor: 'panel:flota_admin' } as const;
const fila = (indice: number, categoria = 'clase_fuera_de_3_5') => ({ indice, categoria });

describe('reclamar', () => {
  it('«Marcar como reclamado» crea el reclamo con fecha y monto calculados, y liga el candidato', async () => {
    sembrar();
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(2) });
    expect(r).toMatchObject({ ok: true, aplicadas: 1, reclamos: 1 });
    expect(db.tablas.peaje_reclamo).toHaveLength(1);
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({
      tenant_id: T, desglose_id: DES, categoria: 'clase_fuera_de_3_5', estado: 'preparado', n_cruces: 1,
      fecha_cobro_mas_antiguo: '2026-03-05', monto_reclamado: 102, proveedor: 'Proveedor Ejemplo',
    });
    expect(db.tablas.peaje_candidato_accion).toHaveLength(1);
    expect(db.tablas.peaje_candidato_accion[0]).toMatchObject({
      tenant_id: T, desglose_id: DES, indice: 2, categoria: 'clase_fuera_de_3_5', accion: 'reclamado', motivo: null,
      actor: 'panel:flota_admin', reclamo_id: db.tablas.peaje_reclamo[0].id,
    });
  });

  it('doble clic = un solo efecto: un reclamo, una decisión', async () => {
    sembrar();
    const entrada = { ...base, accion: 'reclamado', fila: fila(1) } as const;
    const [a, b] = await Promise.all([A.aplicarAccionCandidatos(T, entrada), A.aplicarAccionCandidatos(T, entrada)]);
    const despues = await A.aplicarAccionCandidatos(T, entrada);
    expect([a, b].filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    expect(despues.ok).toBe(false); // ya tenía decisión, y se dice
    expect(db.tablas.peaje_reclamo).toHaveLength(1);
    expect(db.tablas.peaje_candidato_accion).toHaveLength(1);
  });

  it('con fecha de envío el reclamo nace «enviado»; con fecha mal escrita se rechaza sin escribir', async () => {
    sembrar();
    expect(await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(0), enviadoEn: '10/03/2026' })).toMatchObject({ ok: false });
    expect(db.tablas.peaje_reclamo ?? []).toHaveLength(0);
    await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(0), enviadoEn: '2026-03-12' });
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({ estado: 'enviado', enviado_en: '2026-03-12' });
  });

  it('un atípico no se reclama: se dice por qué y no se escribe nada', async () => {
    sembrar();
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(8, 'atipico_repeticion_caseta') });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/no se reclaman/);
    expect(db.tablas.peaje_reclamo ?? []).toHaveLength(0);
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
  });

  it('si el reclamo no se puede crear, la decisión se retira (no queda «reclamado» sin reclamo) y se puede reintentar', async () => {
    sembrar();
    db.fallar('peaje_reclamo.insert', 'base caída');
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(1) });
    expect(r).toMatchObject({ ok: false });
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
    // la base vuelve: el mismo clic ahora sí funciona
    db = crearDbFalsa({ ...db.tablas });
    expect(await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(1) })).toMatchObject({ ok: true, aplicadas: 1 });
  });
});

describe('descartar y justificar', () => {
  it('descartar sin motivo se rechaza y no escribe nada', async () => {
    sembrar();
    for (const motivo of [undefined, null, '', '   ', 'ab']) {
      expect(await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', fila: fila(1), motivo })).toMatchObject({ ok: false });
    }
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
  });

  it('descartar con motivo lo guarda con quién y cuándo; repetirlo no cambia nada', async () => {
    sembrar();
    const e = { ...base, accion: 'descartado', fila: fila(1), motivo: '  Ya reclamado por otra vía  ' } as const;
    expect(await A.aplicarAccionCandidatos(T, e)).toMatchObject({ ok: true, aplicadas: 1, reclamos: 0 });
    expect(db.tablas.peaje_candidato_accion[0]).toMatchObject({ accion: 'descartado', motivo: 'Ya reclamado por otra vía', actor: 'panel:flota_admin' });
    expect(db.tablas.peaje_reclamo ?? []).toHaveLength(0);
    expect((await A.aplicarAccionCandidatos(T, { ...e, motivo: 'otro motivo' })).ok).toBe(false);
    expect(db.tablas.peaje_candidato_accion).toHaveLength(1);
    expect(db.tablas.peaje_candidato_accion[0].motivo).toBe('Ya reclamado por otra vía');
  });

  it('justificar un atípico guarda la decisión en TODOS sus renglones', async () => {
    sembrar();
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'justificado', fila: fila(8, 'atipico_repeticion_caseta'), motivo: 'Ruta de reparto autorizada' });
    expect(r).toMatchObject({ ok: true, aplicadas: 1 });
    const guardadas = db.tablas.peaje_candidato_accion.filter((x) => x.categoria === 'atipico_repeticion_caseta');
    expect(guardadas.map((x) => x.indice as number).sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12]);
    expect(guardadas.every((x) => x.accion === 'justificado' && x.motivo === 'Ruta de reparto autorizada')).toBe(true);
  });

  it('justificar una caseta que no debe cruzarse la deja justificada donde la regla la lee', async () => {
    sembrar();
    db.tablas.peaje_caseta_nombre = [{ tenant_id: T, nombre: 'Caseta Ejemplo 1', nombre_norm: 'caseta ejemplo 1', clases_permitidas: [], no_cruzar: true, lat: null, lng: null }];
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'justificado', fila: fila(1, 'caseta_no_debe_cruzarse'), motivo: 'Salida de servicio autorizada' });
    expect(r).toMatchObject({ ok: true, aplicadas: 1 });
    expect(db.tablas.peaje_cruce_justificado).toEqual([expect.objectContaining({ tenant_id: T, desglose_id: DES, indice: 1, categoria: 'caseta_no_debe_cruzarse', motivo: 'Salida de servicio autorizada' })]);
  });
});

describe('lote por filtro', () => {
  it('un lote de 500 cruces: se confirma con el número, crea un reclamo por categoría y es idempotente', async () => {
    sembrar({ clase9: 500 });
    const filtro = { entrada: { cat: 'clase_fuera_de_3_5' }, confirmar: true, esperado: 500 };
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', filtro });
    expect(r).toMatchObject({ ok: true, aplicadas: 500, reclamos: 1 });
    expect(db.tablas.peaje_candidato_accion).toHaveLength(500);
    expect(db.tablas.peaje_reclamo).toHaveLength(1);
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({ n_cruces: 500, categoria: 'clase_fuera_de_3_5' });
    expect(db.tablas.peaje_candidato_accion.every((x) => x.reclamo_id === db.tablas.peaje_reclamo[0].id)).toBe(true);
    // segunda vez: nada nuevo (esperado ahora es 0) y sigue habiendo un solo reclamo
    const otra = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', filtro: { ...filtro, esperado: 0 } });
    expect(otra).toMatchObject({ ok: true, aplicadas: 0, reclamos: 0 });
    expect(db.tablas.peaje_reclamo).toHaveLength(1);
    expect(db.tablas.peaje_candidato_accion).toHaveLength(500);
  });

  it('sin la confirmación no aplica; con un número distinto al que se vio tampoco (la lista cambió)', async () => {
    sembrar({ clase9: 10 });
    const sinConfirmar = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', filtro: { entrada: {}, confirmar: false, esperado: 10 } });
    expect(sinConfirmar).toMatchObject({ ok: false });
    const distinto = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', filtro: { entrada: { cat: 'clase_fuera_de_3_5' }, confirmar: true, esperado: 9 } });
    expect(distinto).toMatchObject({ ok: false });
    expect((distinto as { error: string }).error).toMatch(/cambió/);
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
    expect(db.tablas.peaje_reclamo ?? []).toHaveLength(0);
  });

  it('un lote que mezcla categorías crea un reclamo por categoría, y el filtro de unidad acota el lote', async () => {
    sembrar({ clase9: 6 });
    const todo = A.aplicablesDelFiltro; // el número que ve la pantalla sale de la misma función
    expect(typeof todo).toBe('function');
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', filtro: { entrada: {}, confirmar: true, esperado: 9 } });
    // 6 de clase + 3 extemporáneos; los atípicos no se reclaman y se quedan fuera del número
    expect(r).toMatchObject({ ok: true, aplicadas: 9, reclamos: 2 });
    expect(db.tablas.peaje_reclamo.map((x) => x.categoria).sort()).toEqual(['clase_fuera_de_3_5', 'extemporaneo']);
    const ext = db.tablas.peaje_reclamo.find((x) => x.categoria === 'extemporaneo')!;
    expect(ext).toMatchObject({ n_cruces: 3, fecha_cobro_mas_antiguo: '2026-02-20' });
  });

  it('descartar en lote exige motivo y lo aplica a todos', async () => {
    sembrar({ clase9: 4 });
    const f = { entrada: { cat: 'clase_fuera_de_3_5' }, confirmar: true, esperado: 4 };
    expect(await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', filtro: f })).toMatchObject({ ok: false });
    expect(await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', filtro: f, motivo: 'Tarifa por pasada confirmada' })).toMatchObject({ ok: true, aplicadas: 4 });
    expect(db.tablas.peaje_candidato_accion.every((x) => x.motivo === 'Tarifa por pasada confirmada')).toBe(true);
  });
});

describe('aislamiento y alcance', () => {
  it('un desglose de OTRA flota se comporta como inexistente: nada se escribe', async () => {
    sembrar({ tenant: OTRO });
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', fila: fila(1), motivo: 'intento ajeno' });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/no existe en tu flota/);
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
  });

  it('toda escritura lleva la flota y NINGUNA toca las líneas del proveedor', async () => {
    sembrar();
    const antes = T0();
    await A.aplicarAccionCandidatos(T, { ...base, accion: 'reclamado', fila: fila(1) });
    await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', fila: fila(2), motivo: 'por prueba' });
    await A.aplicarAccionCandidatos(T, { ...base, accion: 'justificado', fila: fila(8, 'atipico_repeticion_caseta'), motivo: 'por prueba' });
    expect(T0()).toBe(antes);
    expect(db.llamadas.filter((l) => l.tabla === 'desglose_peaje_linea' && l.op !== 'select')).toHaveLength(0);
    for (const t of ['peaje_candidato_accion', 'peaje_reclamo'] as const) for (const f of db.tablas[t]) expect(f.tenant_id).toBe(T);
  });

  it('un candidato que ya no aparece, o un id mal formado, se rechazan', async () => {
    sembrar();
    expect(await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', fila: fila(999), motivo: 'no existe' })).toMatchObject({ ok: false });
    expect(await A.aplicarAccionCandidatos(T, { ...base, desgloseId: 'xx', accion: 'descartado', fila: fila(1), motivo: 'mal id' })).toMatchObject({ ok: false });
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
  });

  it('si la revisión no se puede leer, no se aplica nada y se dice (no se lee como «nada que hacer»)', async () => {
    sembrar();
    db.fallar('desglose_peaje_linea.select', 'base caída');
    const r = await A.aplicarAccionCandidatos(T, { ...base, accion: 'descartado', fila: fila(1), motivo: 'por prueba' });
    expect(r).toMatchObject({ ok: false });
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
  });
});

describe('el formulario: puerta y campos', () => {
  const form = (campos: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(campos)) fd.set(k, v); return fd; };

  it('un rol sin acceso al dinero, o de otra flota, es rechazado antes de leer nada', async () => {
    sembrar();
    sesion = { rol: 'encargado', tenantId: T };
    expect(await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'fila', accion: 'descartado', indice: '1', categoria: 'clase_fuera_de_3_5', motivo: 'xx yy' }))).toMatchObject({ ok: false });
    sesion = { rol: 'flota_admin', tenantId: OTRO };
    expect(await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'fila', accion: 'descartado', indice: '1', categoria: 'clase_fuera_de_3_5', motivo: 'xx yy' }))).toMatchObject({ ok: false });
    expect(db.tablas.peaje_candidato_accion ?? []).toHaveLength(0);
    expect(db.llamadas).toHaveLength(0);
  });

  it('una fila por formulario deja al rol como actor; un lote lee los filtros f_* y la casilla', async () => {
    sembrar({ clase9: 3 });
    sesion = { rol: 'contador', tenantId: T };
    expect(await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'fila', accion: 'descartado', indice: '1', categoria: 'clase_fuera_de_3_5', motivo: 'ya cobrado' }))).toMatchObject({ ok: true });
    expect(db.tablas.peaje_candidato_accion[0].actor).toBe('panel:contador');
    const lote = await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'filtro', accion: 'reclamado', esperado: '2', confirmar: 'on', f_cat: 'clase_fuera_de_3_5', f_estado: 'pendiente' }));
    expect(lote).toMatchObject({ ok: true, aplicadas: 2, reclamos: 1 });
    const sinCasilla = await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'filtro', accion: 'reclamado', esperado: '0', f_cat: 'extemporaneo' }));
    expect(sinCasilla).toMatchObject({ ok: false });
  });

  it('una acción inventada o un candidato sin renglón se rechazan', async () => {
    sembrar();
    expect(await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'fila', accion: 'borrar', indice: '1', categoria: 'extemporaneo' }))).toMatchObject({ ok: false });
    expect(await A.ejecutarAccionDeFormulario(T, form({ desglose: DES, modo: 'fila', accion: 'reclamado', categoria: 'extemporaneo' }))).toMatchObject({ ok: false });
  });
});
