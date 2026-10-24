import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { generarLibroIave, CASETAS_FIXTURE } from './fixtures/generar_desglose_iave';

// ═══════════════════════════════════════════════════════════════════════════
// El I/O de la revisión de cobros contra una base en memoria, de PUNTA A PUNTA:
// importa un archivo con la forma del decenal del proveedor, declara las reglas de la
// flota, abre la revisión, cierra el mes y lleva un reclamo hasta su nota de crédito.
// Verifica la lógica de la app y que TODA consulta lleve el filtro de la flota.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));

const { importarDesglose } = await import('../intake/desglose_peaje');
const R = await import('./revision_cobros');

const T = 'tenant-1';
const OTRO = 'tenant-2';
// Estas pruebas ejercen el camino anterior (leer-sumar-escribir): la base falsa simula que la migración 0860 aún NO está aplicada.
// El camino con la función atómica se prueba en `nota_credito_rpc.test.ts`.
beforeEach(() => { db = crearDbFalsa({}, { peaje_nota_credito_registrar: () => ({ error: { message: 'Could not find the function', code: 'PGRST202' } }) }); });

async function subir(nombre: string, op: Parameters<typeof generarLibroIave>[0], tenant = T) {
  const { buffer, esperado } = generarLibroIave({ hojaSecundaria: true, ...op });
  const r = await importarDesglose(tenant, { nombre, buffer });
  if (!r.ok) throw new Error(r.motivo);
  return { id: r.desgloseId, esperado };
}

describe('revisionDeDesglose', () => {
  it('con las reglas de la flota, las cifras coinciden con lo que el generador inyectó', async () => {
    const { id, esperado } = await subir('01 A 10 DE MARZO.xlsx', { filas: 9000, inicio: '2026-03-01', extemporaneos: 40, duplicadosExactos: 12 });
    // la flota declara sus casetas de tarifa por pasada
    for (const c of CASETAS_FIXTURE.filter((x) => x.porPasada)) {
      expect(await R.guardarReglaCaseta(T, { nombre: c.nombre, clasesPermitidas: [1], noCruzar: false })).toEqual({ ok: true });
    }
    const rep = await R.revisionDeDesglose(T, id);
    if (!rep) throw new Error('sin reporte');
    expect(rep.periodoOficialDesde).toBe('2026-03-01');
    expect(rep.periodoOrigen).toBe('nombre_archivo');
    expect(rep.noPeriodo).toBe('801');
    const r = rep.revision;
    expect(r.lineasRevisadas).toBe(esperado.cruces);
    expect(r.montoRevisado).toBe(esperado.monto);
    expect(r.porCategoria.extemporaneo).toEqual({ n: esperado.extemporaneos, monto: esperado.montoExtemporaneos });
    expect(r.porCategoria.duplicado_exacto.n).toBe(esperado.duplicadosExactos);
    const esperadasClase = Object.entries(esperado.porClase).filter(([c]) => !['1', '3', '5'].includes(c)).reduce((s, [, n]) => s + n, 0);
    expect(r.porCategoria.clase_fuera_de_3_5.n).toBe(esperadasClase);
    expect(r.sugerenciasPasada).toHaveLength(0); // ya las declaró
    expect(rep.rotulo).toMatch(/validar con el proveedor/);
  }, 60_000);

  it('TAG dado de baja y caseta que no debe cruzarse: salen de la configuración de la flota', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 1500, inicio: '2026-03-01', extemporaneos: 0 });
    const antes = await R.revisionDeDesglose(T, id);
    expect(antes?.revision.porCategoria.tag_dado_de_baja.n).toBe(0);
    expect(antes?.revision.porCategoria.caseta_no_debe_cruzarse.n).toBe(0); // nada precargado

    const tag = db.tablas.desglose_peaje_linea[0].tag as string;
    expect(await R.altaBajaDeTag(T, { tag, bajaEn: '2026-03-04', motivo: 'Unidad siniestrada' })).toEqual({ ok: true });
    expect(await R.guardarReglaCaseta(T, { nombre: 'PLAZA ORIENTE', clasesPermitidas: [], noCruzar: true })).toEqual({ ok: true });
    const rep = await R.revisionDeDesglose(T, id);
    const posteriores = db.tablas.desglose_peaje_linea.filter((l) => l.tag === tag && (l.fecha as string) > '2026-03-04').length;
    expect(posteriores).toBeGreaterThan(0);
    expect(rep?.revision.porCategoria.tag_dado_de_baja.n).toBe(posteriores);
    const oriente = db.tablas.desglose_peaje_linea.filter((l) => l.caseta === 'PLAZA ORIENTE').length;
    expect(rep?.revision.porCategoria.caseta_no_debe_cruzarse.n).toBe(oriente);
    expect(oriente).toBeGreaterThan(0);
  });

  it('un desglose de OTRA flota, inexistente o anulado → null', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 50 });
    expect(await R.revisionDeDesglose(OTRO, id)).toBeNull();
    expect(await R.revisionDeDesglose(T, 'no-existe')).toBeNull();
    db.tablas.desglose_peaje[0].anulado_en = '2026-03-12T00:00:00Z';
    expect(await R.revisionDeDesglose(T, id)).toBeNull();
  });

  it('una falla de lectura LANZA (no se lee como "sin candidatos")', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 50 });
    db.fallar('desglose_peaje_linea.select', 'base caída');
    await expect(R.revisionDeDesglose(T, id)).rejects.toThrow();
  });

  it('TODA consulta de la revisión lleva el filtro de la flota', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 200 });
    const antes = db.llamadas.length;
    await R.revisionDeDesglose(T, id);
    for (const l of db.llamadas.slice(antes)) {
      expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T), `${l.tabla}.${l.op} sin tenant`).toBe(true);
    }
  });
});

describe('las reglas: validación', () => {
  it('clases y nombres inválidos se rechazan; el texto libre de clases se entiende', async () => {
    expect((await R.guardarReglaCaseta(T, { nombre: '  ', clasesPermitidas: [], noCruzar: false })).ok).toBe(false);
    expect((await R.guardarReglaCaseta(T, { nombre: 'X', clasesPermitidas: [100], noCruzar: false })).ok).toBe(false);
    expect((await R.guardarReglaCaseta(T, { nombre: 'X', clasesPermitidas: [1.5], noCruzar: false })).ok).toBe(false);
    expect(R.parsearClases('1, 6 y 7')).toEqual([1, 6, 7]);
    expect(R.parsearClases('')).toEqual([]);
    expect(R.parsearClases('uno')).toBeNull();
    expect(R.parsearClases('123')).toBeNull();
  });
  it('un TAG o una fecha de baja inválidos se rechazan; dar de baja dos veces cambia la fecha, no duplica', async () => {
    expect((await R.altaBajaDeTag(T, { tag: '--', bajaEn: '2026-03-04' })).ok).toBe(false);
    expect((await R.altaBajaDeTag(T, { tag: 'IMDM 0000 0001', bajaEn: '04/03/2026' })).ok).toBe(false);
    await R.altaBajaDeTag(T, { tag: 'IMDM 0000 0001', bajaEn: '2026-03-04' });
    await R.altaBajaDeTag(T, { tag: 'imdm-00000001', bajaEn: '2026-03-08' });
    const bajas = await R.listarTagsBaja(T);
    expect(bajas).toHaveLength(1);
    expect(bajas[0]).toMatchObject({ tag: 'IMDM00000001', bajaEn: '2026-03-08' });
  });
  it('las coordenadas son OPCIONALES y se validan: fuera de México o invertidas no entran', async () => {
    const csv = 'nombre;lat;lng;fuente\nCASETA UNO;25.67;-100.31;captura propia\nCASETA DOS;-100.3;25.6;x\nCASETA TRES;51.5;-0.12;x\nCASETA CUATRO;abc;1;x\n';
    const r = await R.cargarCoordenadasDeCasetas(T, Buffer.from(csv));
    expect(r.ok).toBe(true);
    expect(r.guardadas).toBe(1);
    expect(r.rechazadas.map((x) => x.fila)).toEqual([3, 4, 5]);
    const c = db.tablas.peaje_caseta_nombre.find((x) => x.nombre_norm === 'caseta uno')!;
    expect(c).toMatchObject({ lat: 25.67, lng: -100.31, fuente_coordenada: 'captura propia' });
    // y cargar coordenadas NO pisa una regla ya declarada sobre esa caseta
    await R.guardarReglaCaseta(T, { nombre: 'CASETA UNO', clasesPermitidas: [1], noCruzar: true });
    await R.cargarCoordenadasDeCasetas(T, Buffer.from('nombre;lat;lng\nCASETA UNO;25.68;-100.32\n'));
    expect(db.tablas.peaje_caseta_nombre.find((x) => x.nombre_norm === 'caseta uno')).toMatchObject({ lat: 25.68, clases_permitidas: [1], no_cruzar: true });
  });
});

describe('cierreMensualDeFlota', () => {
  it('junta las 3 decenas del mes y compara contra el mes anterior cargado', async () => {
    const d1 = await subir('01 A 10 DE MARZO.xlsx', { filas: 3000, inicio: '2026-03-01', extemporaneos: 20, semilla: 1 });
    const d2 = await subir('11 A 20 DE MARZO.xlsx', { filas: 2500, inicio: '2026-03-11', extemporaneos: 10, semilla: 2 });
    const d3 = await subir('21 A 31 DE MARZO.xlsx', { filas: 2800, inicio: '2026-03-21', extemporaneos: 10, semilla: 3 });
    await subir('21 A 28 DE FEBRERO 2026.xlsx', { filas: 500, inicio: '2026-02-21', extemporaneos: 0, semilla: 4 });
    const c = await R.cierreMensualDeFlota(T, '2026-03');
    if ('error' in c) throw new Error(c.error);
    expect(c.completo).toBe(true);
    expect(c.cruces).toBe(d1.esperado.cruces + d2.esperado.cruces + d3.esperado.cruces);
    expect(c.monto).toBe(d1.esperado.monto + d2.esperado.monto + d3.esperado.monto);
    expect(c.mesAnteriorCargado).toBe(true);
    expect(c.tardiosMesAnterior.n + c.tardiosDecenaAnterior.n).toBe(40);
    expect(c.decenas.map((d) => d.cubierta)).toEqual([true, true, true]);
  }, 60_000);

  it('un mes con solo dos decenas se dice incompleto; el de OTRA flota no se mezcla', async () => {
    await subir('01 A 10 DE MARZO.xlsx', { filas: 300, inicio: '2026-03-01' });
    await subir('21 A 31 DE MARZO.xlsx', { filas: 300, inicio: '2026-03-21' });
    await subir('11 A 20 DE MARZO.xlsx', { filas: 300, inicio: '2026-03-11' }, OTRO);
    const c = await R.cierreMensualDeFlota(T, '2026-03');
    if ('error' in c) throw new Error(c.error);
    expect(c.completo).toBe(false);
    expect(c.decenasFaltantes).toEqual(['11 a 20']);
    expect(c.cruces).toBe(600);
  });

  it('un mes inválido es un error, no un cierre vacío', async () => {
    expect(await R.cierreMensualDeFlota(T, '2026-13')).toHaveProperty('error');
  });
});

describe('el seguimiento de reclamos de punta a punta', () => {
  it('crea el reclamo desde los candidatos (cifras calculadas), lo envía, registra notas y respeta el plazo de 3 meses', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 2000, inicio: '2026-03-01', extemporaneos: 30 });
    const rep = await R.revisionDeDesglose(T, id);
    const ext = rep!.revision.candidatos.filter((c) => c.categoria === 'extemporaneo');
    const masAntiguo = ext.map((c) => c.fecha as string).sort()[0];
    const monto = Math.round(ext.reduce((s, c) => s + c.monto, 0) * 100) / 100;

    const creado = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    if (!creado.ok) throw new Error(creado.motivo);
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({ tenant_id: T, estado: 'preparado', n_cruces: 30, monto_reclamado: monto, fecha_cobro_mas_antiguo: masAntiguo, categoria: 'extemporaneo' });

    // sin enviar no se acepta una nota de crédito
    expect((await R.registrarNotaDeCredito(T, { reclamoId: creado.id, monto: 100, fecha: '2026-04-01' })).ok).toBe(false);
    expect((await R.marcarReclamoEnviado(T, creado.id, '2026-03-20', 'P-77')).ok).toBe(true);
    expect((await R.marcarReclamoEnviado(T, creado.id, '2026-03-21')).ok).toBe(false); // ya no está "preparado"

    // dos notas: parcial y luego completo
    expect((await R.registrarNotaDeCredito(T, { reclamoId: creado.id, monto: 1000, fecha: '2026-04-05', referencia: 'NC-1' })).ok).toBe(true);
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({ estado: 'acreditado_parcial', monto_acreditado: 1000 });
    expect((await R.registrarNotaDeCredito(T, { reclamoId: creado.id, monto: monto - 1000, fecha: '2026-04-20' })).ok).toBe(true);
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({ estado: 'acreditado', monto_acreditado: monto });
    expect(db.tablas.peaje_reclamo_nota).toHaveLength(2);

    // el plazo se evalúa contra el reloj que se le pase
    const { reclamos, resumen } = await R.listarReclamos(T, '2026-07-01');
    expect(reclamos[0].evaluacion.alerta).toBe('cerrado');
    expect(resumen.pendienteAcreditar).toBe(0);
    expect(reclamos[0].evaluacion.fechaLimite).toBe(`2026-${masAntiguo.slice(5, 7) === '03' ? '06' : '05'}-${masAntiguo.slice(8)}`);
  }, 60_000);

  it('A37-S53-03: anular el desglose marca sus reclamos y los saca de las sumas del seguimiento', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 5 });
    await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    const vivo = await R.listarReclamos(T, '2026-03-12');
    expect(vivo.reclamos[0].desgloseAnulado).not.toBe(true);
    expect(vivo.resumen.montoReclamado).toBeGreaterThan(0);
    db.tablas.desglose_peaje[0].anulado_en = '2026-03-12T00:00:00Z';
    const r = await R.listarReclamos(T, '2026-03-12');
    expect(r.reclamos).toHaveLength(1);
    expect(r.reclamos[0].desgloseAnulado).toBe(true);
    expect(r.reclamos[0].notas).toMatch(/DESGLOSE ANULADO/);
    expect(r.resumen.montoReclamado).toBe(0);
  }, 60_000);

  it('un reclamo preparado que nadie envía vence a los 3 meses del cobro más antiguo', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 5 });
    await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    const fecha = db.tablas.peaje_reclamo[0].fecha_cobro_mas_antiguo as string;
    const limite = (await R.listarReclamos(T, '2026-03-12')).reclamos[0].evaluacion.fechaLimite;
    const despues = (await R.listarReclamos(T, '2999-01-01')).reclamos[0].evaluacion;
    expect(despues.alerta).toBe('vencido');
    expect(limite > fecha).toBe(true);
    const enPlazo = await R.listarReclamos(T, fecha);
    expect(enPlazo.reclamos[0].evaluacion.alerta).toBe('ok');
  });

  it('categoría sin candidatos, desglose ajeno y notas inválidas se rechazan', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 300, inicio: '2026-03-01', extemporaneos: 0 });
    expect((await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'tag_dado_de_baja' })).ok).toBe(false);
    expect((await R.crearReclamoDeCategoria(OTRO, { desgloseId: id, categoria: 'extemporaneo' })).ok).toBe(false);
    expect((await R.registrarNotaDeCredito(T, { reclamoId: 'x', monto: -5, fecha: '2026-04-01' })).ok).toBe(false);
    expect((await R.registrarNotaDeCredito(T, { reclamoId: 'x', monto: 5, fecha: 'ayer' })).ok).toBe(false);
    expect((await R.registrarNotaDeCredito(T, { reclamoId: 'no-existe', monto: 5, fecha: '2026-04-01' })).ok).toBe(false);
  });

  it('A37-A2-05: el reclamo por categoría excluye lo descartado/justificado y no reclama categorías internas', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 10 });
    const rep = await R.revisionDeDesglose(T, id);
    const ext = (rep?.revision.candidatos ?? []).filter((c) => c.categoria === 'extemporaneo');
    expect(ext).toHaveLength(10);
    const { registrarDecisionesCandidatos } = await import('./repo');
    await registrarDecisionesCandidatos(T, id, ext.slice(0, 4).map((c) => ({ indice: c.indice, categoria: 'extemporaneo' })), 'descartado', { motivo: 'servicio especial', actor: 'ana' });
    const esperado = Math.round(ext.slice(4).reduce((s, c) => s + c.monto, 0) * 100) / 100;

    const creado = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    if (!creado.ok) throw new Error(creado.motivo);
    expect(db.tablas.peaje_reclamo[0]).toMatchObject({ n_cruces: 6, monto_reclamado: esperado });

    // una caseta que la propia flota prohíbe es un asunto interno: no se convierte en reclamo al proveedor
    expect(await R.guardarReglaCaseta(T, { nombre: 'PLAZA ORIENTE', clasesPermitidas: [], noCruzar: true })).toEqual({ ok: true });
    const interno = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'caseta_no_debe_cruzarse' });
    expect(interno.ok).toBe(false);
    if (!interno.ok) expect(interno.motivo).toMatch(/interno/);
    expect(db.tablas.peaje_reclamo).toHaveLength(1);
  }, 60_000);

  it('un doble envío (dos pestañas, un reintento) choca con el candado de idempotencia y no crea una fila gemela', async () => {
    // HALLAZGO ALTO #1 (auditoría adversarial): el formulario ya deshabilita su botón mientras la
    // acción corre (useActionState), pero esa es defensa de UI. Aquí se prueba la defensa de BASE: el
    // índice único parcial `peaje_reclamo_activo_unico` (migración 0845) choca en el segundo INSERT —
    // simulado aquí como lo hace `cola.test.ts` con `peaje_ingesta_archivo_huella_unica`, porque la base
    // en memoria no aplica índices únicos de verdad (eso lo prueba Postgres real, no esta base falsa).
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 5 });
    db.fallar('peaje_reclamo.insert', 'duplicate key value violates unique constraint "peaje_reclamo_activo_unico"');
    const r = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('no debería crearse');
    expect(r.motivo).toMatch(/ya hay un reclamo abierto/i);
    expect(db.tablas.peaje_reclamo ?? []).toHaveLength(0);
  });

  it('A37-S15-04: «el proveedor lo rechazó» solo da éxito si de verdad cambió una fila', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 5 });
    const c = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    if (!c.ok) throw new Error(c.motivo);
    // preparado (nadie lo envió): no se puede "rechazar" lo que no llegó al proveedor.
    expect(await R.marcarReclamoRechazado(T, c.id)).toBe('sin_cambio');
    expect(db.tablas.peaje_reclamo[0].estado).toBe('preparado');
    expect((await R.marcarReclamoEnviado(T, c.id, '2026-03-20')).ok).toBe(true);
    // id ajeno / de otra flota: 0 filas, no es éxito.
    expect(await R.marcarReclamoRechazado(OTRO, c.id)).toBe('sin_cambio');
    expect(await R.marcarReclamoRechazado(T, 'no-existe')).toBe('sin_cambio');
    expect(await R.marcarReclamoRechazado(T, c.id)).toBe('rechazado');
    expect(db.tablas.peaje_reclamo[0].estado).toBe('rechazado');
    // pestaña vieja: ya está rechazado (o acreditado), la segunda vez no cambia nada.
    expect(await R.marcarReclamoRechazado(T, c.id)).toBe('sin_cambio');
  }, 60_000);

  it('A37-S15-04: un error de la base es «error», no «sin cambio»', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 5 });
    const c = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    if (!c.ok) throw new Error(c.motivo);
    await R.marcarReclamoEnviado(T, c.id, '2026-03-20');
    db.fallar('peaje_reclamo.update', 'base caída');
    expect(await R.marcarReclamoRechazado(T, c.id)).toBe('error');
  }, 60_000);

  it('el reclamo de una flota no lo toca otra', async () => {
    const { id } = await subir('01 A 10 DE MARZO.xlsx', { filas: 500, inicio: '2026-03-01', extemporaneos: 5 });
    const c = await R.crearReclamoDeCategoria(T, { desgloseId: id, categoria: 'extemporaneo' });
    if (!c.ok) throw new Error(c.motivo);
    expect((await R.marcarReclamoEnviado(OTRO, c.id, '2026-03-20')).ok).toBe(false);
    expect((await R.listarReclamos(OTRO, '2026-03-20')).reclamos).toHaveLength(0);
    expect(db.tablas.peaje_reclamo[0].estado).toBe('preparado');
  });
});

describe('revisionDeDesglose: doble cobro entre archivos (T-A2-38)', () => {
  it('lee los desgloses previos de la flota en la ventana y no los de otra flota', async () => {
    const a = await subir('21 A 31 DE AGOSTO.xlsx', { filas: 300, inicio: '2026-08-21', extemporaneos: 0 });
    // mismo archivo subido como otra decena: sus cruces de agosto reaparecen «tarde» en octubre
    const lineasA = db.tablas.desglose_peaje_linea.filter((f) => f.desglose_id === a.id);
    const b = await subir('01 A 10 DE OCTUBRE.xlsx', { filas: 300, inicio: '2026-10-01', extemporaneos: 0 });
    const repetida = lineasA.find((f) => f.fecha && f.hora && f.tag);
    if (!repetida) throw new Error('sin línea para repetir');
    db.tablas.desglose_peaje_linea.push({ ...repetida, id: 'x-rep', desglose_id: b.id, indice: 9999 });
    const antes = db.llamadas.length;
    const rep = await R.revisionDeDesglose(T, b.id);
    const llamadasRevision = db.llamadas.slice(antes);
    const d = rep?.dobleEntreArchivos;
    expect(d?.candidatos.length).toBeGreaterThanOrEqual(1);
    expect(d?.candidatos.some((c) => c.indice === 9999 && c.archivoPrevioId === a.id)).toBe(true);
    // otra flota no ve nada de la primera
    const c2 = await subir('01 A 10 DE OCTUBRE.xlsx', { filas: 50, inicio: '2026-10-01', extemporaneos: 0 }, OTRO);
    db.tablas.desglose_peaje_linea.push({ ...repetida, id: 'x-rep2', desglose_id: c2.id, tenant_id: OTRO, indice: 9999 });
    const rep2 = await R.revisionDeDesglose(OTRO, c2.id);
    expect(rep2?.dobleEntreArchivos?.candidatos).toHaveLength(0);
    // toda consulta a los previos lleva el filtro de la flota
    const previas = llamadasRevision.filter((x) => x.tabla === 'desglose_peaje' || x.tabla === 'desglose_peaje_linea');
    expect(previas.length).toBeGreaterThan(0);
    expect(previas.every((x) => x.filtros.some(([col]) => col === 'tenant_id'))).toBe(true);
  }, 60_000);
});
