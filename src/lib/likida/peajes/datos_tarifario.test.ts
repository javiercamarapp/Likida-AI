import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');

const T = 'tenant-1';
const OTRA = 'tenant-2';
const bytes = (t: string) => new TextEncoder().encode(t);
const base = { caseta: 'Caseta Ejemplo Norte', clase: 5, importe: 300, vigenteDesde: '2026-01-01', vigenteHasta: null };
beforeEach(() => { db = crearDbFalsa({}); });

describe('guardarTarifa / listarTarifas', () => {
  it('guarda sin confirmar (origen declarada por omisión) y la lista devuelve la forma completa', async () => {
    expect(await D.guardarTarifa(T, base)).toEqual({ ok: true, accion: 'creada', confirmada: false });
    const [t] = await D.listarTarifas(T);
    expect(t).toMatchObject({ casetaNorm: 'caseta ejemplo norte', clase: 5, importe: 300, vigenteDesde: '2026-01-01', vigenteHasta: null, origen: 'declarada', confirmada: false, confirmadaPor: null });
  });

  it('la misma llave actualiza la fila en vez de duplicarla', async () => {
    await D.guardarTarifa(T, base);
    expect(await D.guardarTarifa(T, { ...base, importe: 320 })).toEqual({ ok: true, accion: 'actualizada', confirmada: false });
    expect(db.tablas.peaje_tarifa).toHaveLength(1);
    expect(db.tablas.peaje_tarifa[0]).toMatchObject({ importe: 320 });
    expect(await D.guardarTarifa(T, { ...base, importe: 320 })).toEqual({ ok: true, accion: 'sin_cambios', confirmada: false });
  });

  it('una vigencia que se traslapa se rechaza con motivo y no escribe', async () => {
    await D.guardarTarifa(T, { ...base, vigenteHasta: '2026-06-30' });
    const r = await D.guardarTarifa(T, { ...base, vigenteDesde: '2026-06-01', importe: 350 });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.motivo).toMatch(/se traslapa/);
    expect(db.tablas.peaje_tarifa).toHaveLength(1);
  });

  it('A37-S62-06: si la base rechaza el traslape (23P01, captura simultánea) se dice con motivo claro y no como falla genérica', async () => {
    db.fallar('peaje_tarifa.upsert', 'peaje_tarifa: la vigencia se traslapa con otra tarifa de la misma caseta y clase', '23P01');
    const r = await D.guardarTarifa(T, base);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/se traslapa/);
    db.fallar('peaje_tarifa.upsert', 'otra cosa');
    const g = await D.guardarTarifa(T, base);
    expect(!g.ok && g.motivo).toMatch(/No se pudo guardar la tarifa/);
    db.fallar('peaje_tarifa.upsert', 'traslape', '23P01');
    const i = await D.importarTarifasArchivo(T, 'tarifas.csv', bytes('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;300;2026-01-01\n'));
    expect(i.ok).toBe(false);
    expect(!i.ok && i.error).toMatch(/se traslapa/);
  });

  it('un importe negativo se rechaza sin tocar la base', async () => {
    const r = await D.guardarTarifa(T, { ...base, importe: -5 });
    expect(r).toEqual({ ok: false, motivo: 'el importe no puede ser negativo' });
    expect(db.tablas.peaje_tarifa ?? []).toHaveLength(0);
  });

  it('todo va acotado a la flota: otra flota no ve ni choca con estas tarifas', async () => {
    await D.guardarTarifa(T, base);
    expect(await D.listarTarifas(OTRA)).toEqual([]);
    expect(await D.guardarTarifa(OTRA, base)).toMatchObject({ ok: true, accion: 'creada' });
    expect(db.tablas.peaje_tarifa).toHaveLength(2);
    expect(db.llamadas.filter((l) => l.tabla === 'peaje_tarifa').every((l) => l.op === 'upsert' || l.filtros.some(([c, , v]) => c === 'tenant_id' && (v === T || v === OTRA)))).toBe(true);
  });

  it('filtra por caseta (con el nombre tal como lo escribe la persona) y por clase', async () => {
    await D.guardarTarifa(T, base);
    await D.guardarTarifa(T, { ...base, clase: 9, importe: 437 });
    await D.guardarTarifa(T, { ...base, caseta: 'Caseta Ejemplo Sur' });
    expect((await D.listarTarifas(T, { caseta: 'CASETA EJEMPLO NORTE' })).map((t) => t.clase)).toEqual([5, 9]);
    expect((await D.listarTarifas(T, { caseta: 'caseta ejemplo norte', clase: 9 })).map((t) => t.importe)).toEqual([437]);
  });

  it('falla de lectura → motivo llano, sin escribir', async () => {
    db.fallar('peaje_tarifa.select', 'caída');
    const r = await D.guardarTarifa(T, base);
    expect(r).toEqual({ ok: false, motivo: 'No se pudo leer el tarifario actual. Inténtalo de nuevo.' });
  });
});

describe('confirmarTarifa: la acción humana', () => {
  it('confirma y deja quién; una tarifa inferida jamás queda confirmada por sí sola', async () => {
    await D.guardarTarifa(T, base, 'inferida');
    const [t] = await D.listarTarifas(T);
    expect(t).toMatchObject({ confirmada: false, origen: 'inferida' });
    expect(await D.confirmarTarifa(T, t.id, '  Finanzas  ')).toEqual({ ok: true, yaConfirmada: false });
    expect((await D.listarTarifas(T))[0]).toMatchObject({ confirmada: true, confirmadaPor: 'Finanzas', origen: 'inferida' });
    expect(await D.confirmarTarifa(T, t.id, 'Otra persona')).toEqual({ ok: true, yaConfirmada: true });
    expect((await D.listarTarifas(T))[0].confirmadaPor).toBe('Finanzas');
  });

  it('exige quién confirma, y no confirma tarifas de otra flota ni inexistentes', async () => {
    await D.guardarTarifa(T, base);
    const [t] = await D.listarTarifas(T);
    expect(await D.confirmarTarifa(T, t.id, '   ')).toMatchObject({ ok: false });
    expect(await D.confirmarTarifa(OTRA, t.id, 'X')).toEqual({ ok: false, motivo: 'No encontré esa tarifa.' });
    expect(await D.confirmarTarifa(T, 'no-existe', 'X')).toEqual({ ok: false, motivo: 'No encontré esa tarifa.' });
    expect((await D.listarTarifas(T))[0].confirmada).toBe(false);
  });

  it('cambiar después el importe de una tarifa confirmada la deja sin confirmar', async () => {
    await D.guardarTarifa(T, base);
    await D.confirmarTarifa(T, (await D.listarTarifas(T))[0].id, 'Finanzas');
    await D.guardarTarifa(T, { ...base, importe: 310 });
    expect((await D.listarTarifas(T))[0]).toMatchObject({ importe: 310, confirmada: false, confirmadaPor: null });
  });
});

describe('importarTarifasArchivo', () => {
  const archivo = 'caseta;clase;importe;desde;hasta\nCaseta Ejemplo Norte;5;300,00;2026-01-01;2026-06-30\nCaseta Ejemplo Norte;5;320,00;2026-07-01;\nCaseta Ejemplo Norte;9;437,00;2026-01-01;\nCaseta Ejemplo Sur;5;-1;2026-01-01;\nCaseta Ejemplo Sur;3;189;2026-01-01;\n';

  it('guarda las válidas sin confirmar, rechaza las malas con fila y motivo', async () => {
    const r = await D.importarTarifasArchivo(T, 'tarifas.csv', bytes(archivo));
    expect(r).toMatchObject({ ok: true, guardadas: 4, actualizadas: 0 });
    expect(r.rechazadas).toEqual([{ fila: 5, motivo: 'el importe no puede ser negativo' }]);
    const filas = await D.listarTarifas(T);
    expect(filas).toHaveLength(4);
    expect(filas.every((t) => !t.confirmada && t.origen === 'declarada')).toBe(true);
  });

  it('repetir el archivo es seguro: no duplica ni cambia nada', async () => {
    await D.importarTarifasArchivo(T, 'tarifas.csv', bytes(archivo));
    const r = await D.importarTarifasArchivo(T, 'tarifas.csv', bytes(archivo));
    expect(r).toMatchObject({ ok: true, guardadas: 4, actualizadas: 0 });
    expect(await D.listarTarifas(T)).toHaveLength(4);
  });

  it('misma llave con otro importe actualiza y cuenta como actualizada', async () => {
    await D.importarTarifasArchivo(T, 'a.csv', bytes('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;300;2026-01-01\n'));
    const r = await D.importarTarifasArchivo(T, 'b.csv', bytes('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;315;2026-01-01\n'));
    expect(r).toMatchObject({ ok: true, guardadas: 1, actualizadas: 1 });
    expect((await D.listarTarifas(T))).toHaveLength(1);
    expect((await D.listarTarifas(T))[0].importe).toBe(315);
  });

  it('una vigencia que choca con una YA guardada se rechaza con su fila', async () => {
    await D.guardarTarifa(T, base);
    const r = await D.importarTarifasArchivo(T, 'c.csv', bytes('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;350;2026-03-01\n'));
    expect(r.guardadas).toBe(0);
    expect(r.rechazadas[0]).toMatchObject({ fila: 2 });
    expect(r.rechazadas[0].motivo).toMatch(/se traslapa/);
  });

  it('solo una carga declarada «proveedor» deja las tarifas confirmadas', async () => {
    await D.importarTarifasArchivo(T, 'p.csv', bytes('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;300;2026-01-01\n'), 'proveedor');
    expect((await D.listarTarifas(T))[0]).toMatchObject({ confirmada: true, origen: 'proveedor', confirmadaPor: null });
    await D.importarTarifasArchivo(OTRA, 'i.csv', bytes('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;300;2026-01-01\n'), 'inferida');
    expect((await D.listarTarifas(OTRA))[0]).toMatchObject({ confirmada: false, origen: 'inferida' });
  });

  it('sin columna «desde» usa el día de hoy de México como inicio', async () => {
    const r = await D.importarTarifasArchivo(T, 'd.csv', bytes('caseta;clase;importe\nCaseta Ejemplo Norte;5;300\n'));
    expect(r).toMatchObject({ ok: true, guardadas: 1 });
    expect((await D.listarTarifas(T))[0].vigenteDesde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('error de archivo o de base → ok false con motivo', async () => {
    expect(await D.importarTarifasArchivo(T, 'x.csv', new Uint8Array())).toMatchObject({ ok: false, error: 'El archivo está vacío.' });
    expect(await D.importarTarifasArchivo(T, 'x.csv', bytes('hola\n1\n'))).toMatchObject({ ok: false });
    db.fallar('peaje_tarifa.upsert', 'caída');
    const r = await D.importarTarifasArchivo(T, 'e.csv', bytes(archivo));
    expect(r).toMatchObject({ ok: false, guardadas: 0 });
    expect(r.error).toMatch(/es seguro repetirlo/);
  });

  it('el catálogo no se precarga: un tenant sin cargas tiene el tarifario vacío', async () => {
    expect(await D.listarTarifas(T)).toEqual([]);
  });
});

describe('contrato SQL de la migración 0811', () => {
  const sql = readFileSync('supabase/migrations/0811_peaje_tarifario.sql', 'utf8');
  const ejecutable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('crea peaje_tarifa con if not exists y las columnas de la ficha', () => {
    expect(ejecutable).toMatch(/create table if not exists public\.peaje_tarifa/);
    for (const c of ['tenant_id uuid not null references public\\.tenant\\(id\\) on delete cascade', 'caseta_norm text not null', 'clase smallint not null', 'importe numeric\\(12,2\\) not null', 'vigente_desde date not null', 'vigente_hasta date', 'origen text not null', 'confirmada boolean not null default false', 'confirmada_por text', 'created_at timestamptz not null default now\\(\\)']) {
      expect(ejecutable.replace(/[ \t]+/g, ' ')).toMatch(new RegExp(c));
    }
  });
  it('llave única por (flota, caseta, clase, inicio de vigencia)', () => {
    expect(ejecutable).toMatch(/unique \(tenant_id, caseta_norm, clase, vigente_desde\)/);
  });
  it('importe >= 0, vigencia coherente y origen acotado', () => {
    expect(ejecutable).toMatch(/importe >= 0/);
    expect(ejecutable).toMatch(/vigente_hasta is null or vigente_hasta >= vigente_desde/);
    expect(ejecutable).toMatch(/origen in \('declarada', 'inferida', 'proveedor'\)/);
  });
  it('nada queda confirmado sin responsable ni proveedor', () => {
    expect(ejecutable).toMatch(/not confirmada or origen = 'proveedor' or confirmada_por is not null/);
  });
  it('RLS deny-all: prendida y sin políticas', () => {
    expect(ejecutable).toMatch(/alter table public\.peaje_tarifa enable row level security/);
    expect(ejecutable).not.toMatch(/create policy/i);
  });
  it('no siembra ni destruye', () => {
    expect(ejecutable).not.toMatch(/\binsert\s+into\b|\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|column|constraint)\b/i);
    expect(sql).toMatch(/NO SE SIEMBRA NINGUNA TARIFA/);
  });
});
