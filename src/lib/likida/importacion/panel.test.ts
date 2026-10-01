// ═══════════════════════════════════════════════════════════════════════════
// LA CARGA MASIVA DEL PANEL — revisar y recién entonces confirmar (W2).
// Contra una base en memoria que aplica filtros y UNIQUE.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

let base: BaseEnMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => base.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => true }));
const enviar = vi.fn(async (_t: string, _o: unknown): Promise<unknown> => ({ ok: true, via: 'plantilla', id: 'w', motivo: 'ventana_cerrada', ventana: 'cerrada' }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback: (t: string, o: unknown) => enviar(t, o) }));

const { cargarOperadoresDesdeArchivo, cargarUnidadesDesdeArchivo, huellaDe } = await import('./panel');

const T = '11111111-1111-4111-8111-111111111111';
const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const flota = { tipo: 'flota' } as const;

beforeEach(() => {
  base = crearBaseEnMemoria({
    tenant: [{ id: T, nombre: 'Transportes del Norte' }],
    terminal: [{ id: NORTE, tenant_id: T, nombre: 'Patio Norte', ciudad: null }, { id: SUR, tenant_id: T, nombre: 'Patio Sur', ciudad: null }],
    operador: [], unidad: [],
  }, [{ tabla: 'operador', nombre: 'uq_operador_tenant_telefono_norm', columnas: ['tenant_id', 'telefono'] }],
  { operador: { activo: true }, unidad: { activo: true } });
  enviar.mockClear();
});

function csv(filas: string[][], nombre = 'archivo.csv'): File {
  return new File(['﻿' + filas.map((f) => f.join(',')).join('\n')], nombre, { type: 'text/csv' });
}
function datos(archivo: File | null, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  if (archivo) fd.set('archivo', archivo);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
const entrada = (fd: FormData, alcance: { tipo: 'flota' } | { tipo: 'patio'; terminalId: string } = flota) =>
  ({ tenantId: T, alcance, actor: { id: 'u-1' }, datos: fd });
const escrituras = () => base.bitacora.filter((b) => b.op === 'insert' || b.op === 'update').length;

const OPS = [
  ['nombre', 'telefono', 'patio'],
  ['Ana Ruiz', '5500000001', 'Patio Norte'],
  ['Beto Cruz', '5500000002', 'patio sur'],
  ['Carla Díaz', '123', ''],
  ['Dani Soto', '5500000004', 'Patio Fantasma'],
];

describe('operadores — la vista previa NO escribe', () => {
  it('cuenta nuevas, ya estaban y con problema; muestra y motivos por fila', async () => {
    base.tabla('operador').push({ id: 'o-1', tenant_id: T, nombre: 'Ya Estaba', telefono: '525500000002', activo: true });
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(csv(OPS))));
    expect(r.error).toBeUndefined();
    expect(r.paso).toBe('previsualizar');
    expect(r).toMatchObject({ nuevas: 1, yaEstaban: 1, conProblema: 2 });
    expect(r.muestra).toEqual([{ fila: 2, titulo: 'Ana Ruiz', detalle: expect.stringContaining('patio Patio Norte') }]);
    expect(r.problemas.map((p) => p.fila)).toEqual([4, 5]);
    expect(r.problemas[1].motivo).toMatch(/Patio Fantasma/);
    expect(r.patiosDesconocidos).toEqual(['Patio Fantasma']);
    expect(escrituras()).toBe(0);
    expect(r.huella).toBe(huellaDe(await csv(OPS).arrayBuffer()));
  });

  it('un archivo vacío, sin columnas o de otro tipo se rechaza con motivo y sin tocar la base', async () => {
    expect((await cargarOperadoresDesdeArchivo(entrada(datos(null)))).error).toMatch(/Elige el archivo/);
    expect((await cargarOperadoresDesdeArchivo(entrada(datos(new File([''], 'x.csv'))))).error).toMatch(/Elige el archivo/);
    expect((await cargarOperadoresDesdeArchivo(entrada(datos(csv([['a', 'b'], ['1', '2']]))))).error).toMatch(/No encontré la columna/);
    expect((await cargarOperadoresDesdeArchivo(entrada(datos(new File(['x'], 'virus.exe'))))).error).toMatch(/\.csv, \.xlsx o \.xls/);
    expect(base.bitacora).toHaveLength(0);
  });

  it('un archivo de más de 4 MB se rechaza antes de leerlo', async () => {
    const grande = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'g.csv');
    expect((await cargarOperadoresDesdeArchivo(entrada(datos(grande)))).error).toMatch(/Máximo 4 MB/);
  });

  it('más del tope de filas: lo dice, lee las primeras y NO deja confirmar', async () => {
    const filas: string[][] = [['nombre', 'telefono']];
    for (let i = 1; i <= 2_050; i++) filas.push([`Chofer Número ${i}`, `55${String(i).padStart(8, '0')}`]);
    const prev = await cargarOperadoresDesdeArchivo(entrada(datos(csv(filas))));
    expect(prev.excedeTope).toBe(true);
    expect(prev.avisos.join(' ')).toMatch(/tope es 2,000/);
    const conf = await cargarOperadoresDesdeArchivo(entrada(datos(csv(filas), { paso: 'confirmar', huella: prev.huella })));
    expect(conf.error).toMatch(/rebasa el tope/);
    expect(base.tabla('operador')).toHaveLength(0);
  });
});

describe('entradas hostiles al leer el archivo', () => {
  it('un archivo con MILLONES de filas (bomba de descompresión) se lee acotado y se rechaza diciendo que rebasa el tope', async () => {
    // Un CSV chico no es una bomba real, pero ejerce el mismo camino: más filas que el
    // máximo de lectura. El parser se detiene en FILAS_MAX_LECTURA y el conteo es un piso.
    const filas: string[][] = [['nombre', 'telefono']];
    for (let i = 1; i <= 10_500; i++) filas.push([`Chofer Número ${i}`, `55${String(i).padStart(8, '0')}`]);
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(csv(filas))));
    expect(r.excedeTope).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/10,000 o más filas y el tope es 2,000/);
    expect(r.leidas).toBeLessThanOrEqual(2_000);
    expect(escrituras()).toBe(0);
  });

  it('un .xlsx corrupto o un archivo que no es una hoja se rechaza con motivo, sin lanzar', async () => {
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'roto.xlsx'))));
    expect(r.error).toBeTruthy();
    expect(escrituras()).toBe(0);
  });
});

describe('operadores — confirmar', () => {
  it('escribe lo revisado, con su patio, y reporta lo que NO entró', async () => {
    const prev = await cargarOperadoresDesdeArchivo(entrada(datos(csv(OPS))));
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(csv(OPS), { paso: 'confirmar', huella: prev.huella })));
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ confirmado: true, nuevas: 2, conProblema: 2, invitacion: null });
    expect(base.tabla('operador')).toHaveLength(2);
    expect(base.tabla('operador')[0]).toMatchObject({ nombre: 'Ana Ruiz', terminal_id: NORTE });
    expect(base.tabla('operador')[1]).toMatchObject({ nombre: 'Beto Cruz', terminal_id: SUR });
    expect(enviar).not.toHaveBeenCalled(); // un import NO manda WhatsApp por sí solo
  });

  it('el archivo que cambió después de la vista previa NO se escribe', async () => {
    const prev = await cargarOperadoresDesdeArchivo(entrada(datos(csv(OPS))));
    const otro = csv([['nombre', 'telefono'], ['Intruso Pérez', '5599999999']]);
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(otro, { paso: 'confirmar', huella: prev.huella })));
    expect(r.error).toMatch(/cambió desde la vista previa/);
    expect(base.tabla('operador')).toHaveLength(0);
  });

  it('confirmar dos veces el mismo archivo: la segunda no duplica y dice que no hay nada nuevo', async () => {
    const fd = () => datos(csv(OPS), { paso: 'confirmar' });
    await cargarOperadoresDesdeArchivo(entrada(fd()));
    const b = await cargarOperadoresDesdeArchivo(entrada(fd()));
    expect(b.error).toBe('No hay nada nuevo que importar.');
    expect(base.tabla('operador')).toHaveLength(2);
  });

  it('con «invitar» manda UNA plantilla por operador nuevo y reporta los fallos por nombre', async () => {
    const archivo = csv([['nombre', 'telefono'], ['Ana Ruiz', '5500000001'], ['Beto Cruz', '5500000002']]);
    enviar.mockImplementation(async (tel: string) => tel.endsWith('2')
      ? { ok: false, motivo: 'plantilla_rechazada', mensaje: 'Sin WhatsApp.', reintentable: false, fueraDeVentana: true, ventana: 'cerrada' }
      : { ok: true, via: 'plantilla', id: 'w', motivo: 'ventana_cerrada', ventana: 'cerrada' });
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(archivo, { paso: 'confirmar', invitar: 'on' })));
    expect(r.nuevas).toBe(2);
    expect(r.invitacion).toMatchObject({ enviadas: 1, fallidas: [{ nombre: 'Beto Cruz', motivo: 'Sin WhatsApp.' }] });
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('un jefe CON patio: lo sin patio cae en el suyo y lo de otro patio queda como problema', async () => {
    const archivo = csv([['nombre', 'telefono', 'patio'], ['Ana Ruiz', '5500000001', ''], ['Beto Cruz', '5500000002', 'Patio Sur']]);
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(archivo, { paso: 'confirmar' }), { tipo: 'patio', terminalId: NORTE }));
    expect(r).toMatchObject({ nuevas: 1, conProblema: 1 });
    expect(base.tabla('operador')[0].terminal_id).toBe(NORTE);
    expect(r.problemas[0].motivo).toMatch(/no es el tuyo/);
  });

  it('la base caída al leer patios: error claro y nada escrito', async () => {
    base.fallarProxima('terminal', 'select', { message: 'se cayó' });
    const r = await cargarOperadoresDesdeArchivo(entrada(datos(csv(OPS), { paso: 'confirmar' })));
    expect(r.error).toMatch(/No pude leer los patios/);
    expect(escrituras()).toBe(0);
  });
});

describe('unidades', () => {
  const UNI = [
    ['numero economico', 'placas', 'marca', 'patio'],
    ['T-001', 'AB-0001', 'Kenworth', 'Patio Norte'],
    ['T-002', 'AB-0002', 'Freightliner', 'Patio Sur'],
    ['T-003', '', 'Volvo', ''],
    ['T-004', 'AB-0004', 'Volvo', 'Patio Nowhere'],
  ];

  it('previsualiza sin escribir y dice las filas con problema', async () => {
    const r = await cargarUnidadesDesdeArchivo(entrada(datos(csv(UNI))));
    expect(r).toMatchObject({ nuevas: 2, conProblema: 2, yaEstaban: 0 });
    expect(r.problemas.map((p) => p.fila)).toEqual([4, 5]);
    expect(escrituras()).toBe(0);
  });

  it('confirma con su patio y el mismo archivo otra vez no duplica', async () => {
    await cargarUnidadesDesdeArchivo(entrada(datos(csv(UNI), { paso: 'confirmar' })));
    expect(base.tabla('unidad')).toHaveLength(2);
    expect(base.tabla('unidad').map((u) => u.terminal_id).sort()).toEqual([NORTE, SUR].sort());
    const otra = await cargarUnidadesDesdeArchivo(entrada(datos(csv(UNI), { paso: 'confirmar' })));
    expect(otra.error).toBe('No hay nada nuevo que importar.');
    expect(base.tabla('unidad')).toHaveLength(2);
  });

  it('sin columna de número económico usa la placa y lo AVISA', async () => {
    const r = await cargarUnidadesDesdeArchivo(entrada(datos(csv([['placas', 'marca'], ['AB-0001', 'Kenworth']]))));
    expect(r.nuevas).toBe(1);
    expect(r.avisos.join(' ')).toMatch(/se usó la placa como número económico/);
  });

  it('dos submits simultáneos del mismo archivo no duplican camiones', async () => {
    const fd = () => datos(csv(UNI), { paso: 'confirmar' });
    await Promise.all([cargarUnidadesDesdeArchivo(entrada(fd())), cargarUnidadesDesdeArchivo(entrada(fd()))]);
    expect(base.tabla('unidad')).toHaveLength(2);
  });
});
