import { describe, expect, it } from 'vitest';
import { aCentavos, validarLiquidacionExterna } from '../../liquidacion_externa/esquema';
import type { Http } from '../tipos';
import { BITACORA_1228, generarDatos, sumaCentavos, SUMAS_1228 } from './falso/datos';
import {
  ETIQUETA_SIN_CATALOGAR, leerLiquidaciones, lectorLiquidaciones, MAPEO_LIQUIDACIONES_SUPUESTO,
  type LiquidacionTms, type ResultadoLiquidaciones,
} from './liquidaciones';
import { SesionTms } from './sesion';

// Todo sintético: la bitácora 1228 y 20 más salen del generador con semilla; operadores, folios y montos inventados.
const BASE = 'https://tms.ejemplo.test';
const LOGIN = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const RELOJ = { ahora: () => 1_000_000, dormir: async () => undefined };
const VENTANA = { desde: '2026-01-01T06:00:00.000Z', hasta: '2026-12-31T06:00:00.000Z' };

type Cruda = Record<string, unknown>;
interface Tablas { nomina: Cruda[]; operadores: Cruda[]; conceptos: Cruda[] }

const dia = (iso: string, hora: string): string => `${iso.slice(0, 10)} ${hora}`;

/** Convierte el conjunto sintético (1228 + 20) en las TRES tablas hipotéticas del origen. */
function tablasSinteticas(): Tablas {
  const datos = generarDatos({ semilla: 7, n: 21 });
  const nomina: Cruda[] = []; const operadores: Cruda[] = []; const catalogo = new Map<string, number>();
  const conceptoId = (nombre: string): number => {
    if (!catalogo.has(nombre)) catalogo.set(nombre, catalogo.size + 1);
    return catalogo.get(nombre) as number;
  };
  let id = 1;
  datos.liquidaciones.forEach((l, i) => {
    const op = 100 + i;
    operadores.push({ ID: op, NumeroEmpleado: `E-${String(op).padStart(4, '0')}` });
    const comunes = { Poliza: `P${l.bitacora}`, Bitacora: l.bitacora, OperadorID: op, FechaInicio: dia(l.de, '00:00:00'), FechaFin: dia(l.a, '23:59:59') };
    for (const r of l.percepciones) nomina.push({ ID: id++, ...comunes, ConceptoID: conceptoId(r.concepto), Cargo: r.valor, Abono: 0 });
    for (const r of l.deducciones) nomina.push({ ID: id++, ...comunes, ConceptoID: conceptoId(r.concepto), Cargo: 0, Abono: r.valor });
  });
  const conceptos = [...catalogo].map(([descripcion, ID]) => ({ ID, Clave: `C${String(ID).padStart(3, '0')}`, Descripcion: descripcion, Oculto: 'no' }));
  return { nomina, operadores, conceptos };
}

function origen(t: Tablas, opciones: { tam?: number } = {}) {
  const peticiones: string[] = [];
  const http: Http = async (pet) => {
    const u = new URL(pet.url);
    if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok-sintetico' }) };
    peticiones.push(u.pathname);
    const tabla = u.pathname === '/api/nomina-bitacora' ? t.nomina : u.pathname === '/api/operadores' ? t.operadores : u.pathname === '/api/conceptos-nomina' ? t.conceptos : null;
    if (!tabla) return { estado: 404, encabezados: {}, cuerpo: '{}' };
    const tam = Number(u.searchParams.get('tam') ?? opciones.tam ?? 100);
    const pagina = Number(u.searchParams.get('pagina') ?? 1);
    return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items: tabla.slice((pagina - 1) * tam, pagina * tam) } }) };
  };
  return { http, peticiones };
}

const sesionDe = (http: Http) => new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: RELOJ });

async function leer(t: Tablas, previas?: ReadonlyMap<string, string>, extra: { maxPaginas?: number; paginacion?: { tipo: 'pagina'; tamano: number } } = {}) {
  const { http } = origen(t);
  return leerLiquidaciones(sesionDe(http), MAPEO_LIQUIDACIONES_SUPUESTO, VENTANA, { previas, ...extra });
}
function ok(r: ResultadoLiquidaciones) {
  if (!r.ok) throw new Error(r.motivo);
  return r;
}
const de1228 = (cuerpos: LiquidacionTms[]): LiquidacionTms => {
  const l = cuerpos.find((c) => c.bitacora === BITACORA_1228);
  if (!l) throw new Error('falta la bitácora 1228');
  return l;
};

describe('leerLiquidaciones: cuadre y aceptación', () => {
  it('la bitácora 1228 cuadra al centavo: 11 407.46 / 5 114.23 / 6 293.23, sin recalcular nada', async () => {
    const r = ok(await leer(tablasSinteticas()));
    const l = de1228(r.cuerpos);
    const conceptos = l.cuerpo.conceptos as Array<{ tipo: string; monto: number }>;
    const sum = (tipo: string) => conceptos.filter((c) => c.tipo === tipo).reduce((a, c) => a + aCentavos(c.monto), 0);
    expect(sum('percepcion')).toBe(SUMAS_1228.percepciones);
    expect(sum('deduccion')).toBe(SUMAS_1228.deducciones);
    expect(sum('percepcion') / 100).toBe(11407.46);
    expect(sum('deduccion') / 100).toBe(5114.23);
    expect(l.cuerpo.total).toBe(6293.23);
    // Contra el sintético de origen: las sumas son las del dato, no un cálculo nuestro.
    const orig = generarDatos({ semilla: 7, n: 21 }).liquidaciones[0];
    expect(sumaCentavos(orig.percepciones)).toBe(SUMAS_1228.percepciones);
  });

  it('las 21 bitácoras (1228 + 20 con semilla) producen un cuerpo que validarLiquidacionExterna ACEPTA', async () => {
    const r = ok(await leer(tablasSinteticas()));
    expect(r.completa).toBe(true);
    expect(r.cuerpos).toHaveLength(21);
    expect(r.rechazadas).toEqual([]);
    for (const c of r.cuerpos) {
      const n = validarLiquidacionExterna(c.cuerpo);
      expect(n.claveExterna).toBe(c.clave);
      expect(n.sistemaOrigen).toBe('tms');
      expect(n.viajes).toEqual([c.bitacora]);
    }
  });

  it('percepciones primero, deducciones después; cargo → percepción, abono → deducción; el periodo es el día local', async () => {
    const l = de1228(ok(await leer(tablasSinteticas())).cuerpos);
    const tipos = (l.cuerpo.conceptos as Array<{ tipo: string }>).map((c) => c.tipo);
    expect(tipos).toEqual(['percepcion', 'percepcion', 'percepcion', 'deduccion', 'deduccion', 'deduccion']);
    expect(l.cuerpo.periodo).toEqual({ desde: '2026-01-05', hasta: '2026-01-14' });
    expect(l.cuerpo.claveExterna).toBe('1228-P1228');
  });

  it('el cuerpo no lleva nombres de operador: solo número de empleado (y teléfono si hay)', async () => {
    const r = ok(await leer(tablasSinteticas()));
    for (const c of r.cuerpos) expect(Object.keys(c.cuerpo.operador as object)).toEqual(['numeroEmpleado']);
    expect(JSON.stringify(r.cuerpos.map((c) => c.cuerpo))).not.toMatch(/Operador Sint/);
  });
});

describe('leerLiquidaciones: póliza, conceptos y neto', () => {
  it('una bitácora SIN póliza no se convierte en cuerpo: va a pendientes_poliza (y las demás siguen)', async () => {
    const t = tablasSinteticas();
    t.nomina.filter((f) => f.Bitacora === '2003').forEach((f) => { delete f.Poliza; });
    const r = ok(await leer(t));
    expect(r.pendientes_poliza).toEqual([{ bitacora: '2003', operador_id: '103', renglones: 3 }]);
    expect(r.cuerpos.some((c) => c.bitacora === '2003')).toBe(false);
    expect(r.cuerpos).toHaveLength(20);
  });

  it('A37-TRANSVERSAL-04: un mapeo de nómina cuyo «cargo» no se convierte a número NO entrega una liquidación sin esos renglones: la lectura falla', async () => {
    const t = tablasSinteticas();
    t.nomina.forEach((f) => { if (Number(f.Cargo) > 999) f.Cargo = String(f.Cargo).replace(/(\d)(\d{3})$/, '$1,$2') + '.50'; });
    const sinNumero = { ...MAPEO_LIQUIDACIONES_SUPUESTO, nomina: { ...MAPEO_LIQUIDACIONES_SUPUESTO.nomina, campos: { ...MAPEO_LIQUIDACIONES_SUPUESTO.nomina.campos, cargo: 'Cargo' } } };
    const { http } = origen(t);
    const r = await leerLiquidaciones(sesionDe(http), sinNumero, VENTANA, {});
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.motivo).toMatch(/importe debe llevar transformar/); expect(r.parcial.cuerpos).toHaveLength(0); }
  });

  it('neto negativo: se entrega tal cual y se ADVIERTE (no se oculta ni se corrige)', async () => {
    const t = tablasSinteticas();
    t.nomina.filter((f) => f.Bitacora === '2001' && Number(f.Abono) > 0).forEach((f) => { f.Abono = 99_000; });
    const l = ok(await leer(t)).cuerpos.find((c) => c.bitacora === '2001') as LiquidacionTms;
    expect(l.cuerpo.total as number).toBeLessThan(0);
    expect(l.advertencias.join(' ')).toContain('neto es negativo');
    expect(validarLiquidacionExterna(l.cuerpo).total).toBe(l.cuerpo.total);
  });

  it('un concepto que no está en el catálogo pasa con «(sin catalogar)» y se lista; nunca se pierde', async () => {
    const t = tablasSinteticas();
    t.conceptos = t.conceptos.filter((c) => c.ID !== 3); // «Viáticos» deja de estar catalogado
    const r = ok(await leer(t));
    const l = de1228(r.cuerpos);
    const sin = (l.cuerpo.conceptos as Array<{ clave: string; descripcion: string; monto: number }>).filter((c) => c.descripcion.endsWith(ETIQUETA_SIN_CATALOGAR));
    expect(sin).toHaveLength(1);
    expect(sin[0].clave).toBe('3');
    expect(sin[0].monto).toBe(907.46);
    expect(l.sin_catalogar).toEqual(['3']);
    expect(l.cuerpo.total).toBe(6293.23); // el total no cambia por no tener catálogo
  });

  it('un concepto oculto SE CONSERVA en el cuerpo y se marca; el desglose de RH manda sobre la descripción', async () => {
    const t = tablasSinteticas();
    t.conceptos.find((c) => c.ID === 4)!.Oculto = 'sí'; // «Anticipo»
    t.nomina.filter((f) => f.Bitacora === '1228' && f.ConceptoID === 4).forEach((f) => { f.Desglose = 'Otros'; });
    const l = de1228(ok(await leer(t)).cuerpos);
    const conceptos = l.cuerpo.conceptos as Array<{ clave: string; descripcion: string }>;
    expect(l.ocultos).toEqual(['C004']);
    expect(conceptos.find((c) => c.clave === 'C004')?.descripcion).toBe('Otros');
    expect(conceptos).toHaveLength(6);
  });

  it('una póliza con importes que no cuadran con 2 decimales la rechaza el validador, con su motivo', async () => {
    const t = tablasSinteticas();
    t.nomina.find((f) => f.Bitacora === '2002' && Number(f.Cargo) > 0)!.Cargo = 100.005;
    const r = ok(await leer(t));
    const x = r.rechazadas.find((q) => q.ref.includes('2002'));
    expect(x?.tabla).toBe('liquidacion');
    expect(x?.motivo).toMatch(/decimal/i);
    expect(r.cuerpos.some((c) => c.bitacora === '2002')).toBe(false);
  });

  it('un importe negativo se rechaza con motivo en vez de invertirlo en silencio', async () => {
    const t = tablasSinteticas();
    t.nomina.find((f) => f.Bitacora === '2004' && Number(f.Cargo) > 0)!.Cargo = -50;
    const r = ok(await leer(t));
    expect(r.rechazadas.find((q) => q.ref.includes('2004'))?.motivo).toContain('negativo');
  });

  it('operador ausente del catálogo, o póliza con dos operadores: rechazada con motivo', async () => {
    const t = tablasSinteticas();
    t.operadores = t.operadores.filter((o) => o.ID !== 105);
    const f = t.nomina.find((x) => x.Bitacora === '2006')!;
    const g = t.nomina.filter((x) => x.Bitacora === '2007');
    g[0].OperadorID = 101;
    const r = ok(await leer(t));
    expect(f).toBeDefined();
    expect(r.rechazadas.find((q) => q.ref.includes('2005'))?.motivo).toContain('no está en la tabla de operadores');
    expect(r.rechazadas.find((q) => q.ref.includes('2007'))?.motivo).toContain('más de un operador');
  });
});

describe('leerLiquidaciones: idempotencia y corrección', () => {
  it('leer la misma bitácora dos veces es idempotente por huella: todo «omitida», nada por entregar', async () => {
    const t = tablasSinteticas();
    const primera = ok(await leer(t));
    expect(primera.cuerpos.every((c) => c.estado === 'nueva')).toBe(true);
    expect(primera.porEntregar).toHaveLength(21);
    const previas = new Map(primera.cuerpos.map((c) => [c.clave, c.huella]));
    const segunda = ok(await leer(t, previas));
    expect(segunda.cuerpos.every((c) => c.estado === 'omitida')).toBe(true);
    expect(segunda.porEntregar).toEqual([]);
    expect(segunda.cuerpos.map((c) => c.huella)).toEqual(primera.cuerpos.map((c) => c.huella));
  });

  it('una bitácora corregida en el origen sale «actualizada» con otra huella; las demás siguen «omitida»', async () => {
    const t = tablasSinteticas();
    const previas = new Map(ok(await leer(t)).cuerpos.map((c) => [c.clave, c.huella]));
    t.nomina.find((f) => f.Bitacora === '1228' && f.ConceptoID === 1)!.Cargo = 8100;
    const r = ok(await leer(t, previas));
    const l = de1228(r.cuerpos);
    expect(l.estado).toBe('actualizada');
    expect(l.cuerpo.total).toBe(6393.23);
    expect(r.porEntregar.map((c) => c.bitacora)).toEqual([BITACORA_1228]);
    expect(r.cuerpos.filter((c) => c.estado === 'omitida')).toHaveLength(20);
  });

  it('un renglón de nómina repetido (mismo ID) no duplica el concepto: se rechaza y la póliza sigue cuadrando', async () => {
    const t = tablasSinteticas();
    t.nomina.push({ ...t.nomina[0] });
    const r = ok(await leer(t));
    expect(r.cuerpos).toHaveLength(21);
    expect(de1228(r.cuerpos).cuerpo.total).toBe(6293.23);
  });
});

describe('leerLiquidaciones: fallas del origen', () => {
  it('con la nómina partida en páginas y presupuesto de 3 páginas: sin cuerpos (no hay totales parciales) y con punto de reanudación', async () => {
    const r = ok(await leer(tablasSinteticas(), undefined, { maxPaginas: 3, paginacion: { tipo: 'pagina', tamano: 30 } }));
    expect(r.completa).toBe(false);
    expect(r.backlog).toBe(true);
    expect(r.reanudar).toBeDefined();
    expect(r.cuerpos).toEqual([]);
    expect(r.avisos.join(' ')).toContain('incompleta');
  });

  it('si la tabla de operadores no responde, falla con motivo claro y no arma nada', async () => {
    const t = tablasSinteticas();
    const { http } = origen(t);
    const roto: Http = async (p) => (new URL(p.url).pathname === '/api/operadores'
      ? { estado: 500, encabezados: {}, cuerpo: '{}' } : http(p));
    const r = await leerLiquidaciones(sesionDe(roto), MAPEO_LIQUIDACIONES_SUPUESTO, VENTANA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('operadores');
      expect(r.parcial.cuerpos).toEqual([]);
    }
  });

  it('solo LEE: todas las peticiones son GET a las tres tablas', async () => {
    const t = tablasSinteticas();
    const { http, peticiones } = origen(t);
    const metodos: string[] = [];
    const espia: Http = async (p) => { if (!p.url.endsWith('/api/login')) metodos.push(p.metodo); return http(p); };
    ok(await leerLiquidaciones(sesionDe(espia), MAPEO_LIQUIDACIONES_SUPUESTO, VENTANA));
    expect(new Set(metodos)).toEqual(new Set(['GET']));
    expect(new Set(peticiones)).toEqual(new Set(['/api/nomina-bitacora', '/api/operadores', '/api/conceptos-nomina']));
  });
});

describe('lectorLiquidaciones (contrato LectorTms)', () => {
  it('devuelve los cuerpos como filas y lanza cuando la lectura falla', async () => {
    const t = tablasSinteticas();
    const { http } = origen(t);
    const lector = lectorLiquidaciones(sesionDe(http));
    expect(lector.recurso).toBe('liquidaciones');
    const lectura = await lector.leer(VENTANA.desde, VENTANA.hasta);
    expect(lectura.filas).toHaveLength(21);
    const caido: Http = async () => ({ estado: 500, encabezados: {}, cuerpo: '{}' });
    await expect(lectorLiquidaciones(sesionDe(caido)).leer(VENTANA.desde, VENTANA.hasta)).rejects.toThrow();
  });
});
