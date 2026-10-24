import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TAMANO_LOTE, TOPE_BYTES_IMPORTACION, TOPE_FILAS_IMPORTACION, claveDeRegistro, columnasDePlantilla, enLotes, importarCatalogo, leerCsv, plantillaCsv,
  type PuertoImportacion, type Registro, type TipoPlantilla,
} from './catalogo_import';

// Todo es sintético: clientes inventados, SKUs de juguete, RFC de forma válida pero genérica.

const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const C1 = 'cccccccc-0000-4000-8000-000000000001'; // cliente de la flota 1
const C2 = 'cccccccc-0000-4000-8000-000000000002'; // otro cliente de la flota 1
const CAJENO = 'cccccccc-0000-4000-8000-0000000000ff'; // cliente de la flota 2

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Falso extends PuertoImportacion { almacen: Map<string, Registro>; lotes: number[]; fallarEnLote?: number }

/** Un puerto en memoria: dos flotas, cada una con sus clientes; el almacén guarda lo escrito por clave natural. */
function puertoFalso(): Falso {
  const clientesPorFlota: Record<string, Array<{ id: string; nombre: string }>> = {
    [T1]: [{ id: C1, nombre: 'Cliente Uno' }, { id: C2, nombre: 'Cliente Dos' }],
    [T2]: [{ id: CAJENO, nombre: 'Cliente Ajeno' }],
  };
  const f: Falso = {
    almacen: new Map(), lotes: [],
    async clientes(t) { return clientesPorFlota[t] ?? []; },
    async existentes(_t, tipo, ids) { return [...f.almacen.entries()].filter(([k]) => k.startsWith(`${tipo}#`)).map(([, v]) => v).filter((v) => ids.includes(String(v.cliente_id))); },
    async aplicarLote(_t, tipo, registros) {
      if (f.fallarEnLote !== undefined && f.lotes.length === f.fallarEnLote) throw new Error('boom');
      f.lotes.push(registros.length);
      for (const r of registros) f.almacen.set(`${tipo}#${claveDeRegistro(tipo, r)}`, { ...r });
    },
  };
  return f;
}

const entrada = (csv: string, confirmar: boolean, tipo: TipoPlantilla = 'producto', tenantId = T1) =>
  ({ tenantId, actorId: 'u-1', tipo, bytes: enc(csv), confirmar });

const CAB_PROD = 'cliente,sku,descripcion_patron,bienes_transp,clave_unidad,embalaje,fraccion,tipo_materia,material_peligroso,clave_material_peligroso';
const TRES_SKU = [
  CAB_PROD,
  'Cliente Uno,SKU-A,Pieza A,10000001,H87,,,,no,',
  'Cliente Uno,SKU-B,Pieza B,10000002,H87,,,,no,',
  'Cliente Dos,SKU-A,Pieza A,10000001,KGM,,,,si,',
].join('\r\n');

describe('plantillas y lector de CSV', () => {
  it.each(['producto', 'parte', 'cliente_numero'] as const)('la plantilla %s trae BOM, su encabezado completo y se vuelve a leer', (tipo) => {
    const csv = plantillaCsv(tipo);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const l = leerCsv(enc(csv));
    expect(l.ok && l.filas[0]).toEqual(columnasDePlantilla(tipo));
    expect(l.ok && l.filas).toHaveLength(2);
    // La fila de ejemplo es sintética y no puede colarse: su cliente no existe en ninguna flota.
    expect(l.ok && l.filas[1][0]).toBe('Cliente de ejemplo');
  });

  it('acepta coma y punto y coma, BOM, comillas con coma, comilla escapada y salto de línea dentro de comillas', () => {
    const coma = leerCsv(enc('﻿a,b,c\r\n1,"x, y","dice ""hola"""\n"l1\nl2",,\n'));
    expect(coma).toEqual({ ok: true, filas: [['a', 'b', 'c'], ['1', 'x, y', 'dice "hola"'], ['l1\nl2', '', '']] });
    const punto = leerCsv(enc('a;b;c\n1;2,5;3'));
    expect(punto).toEqual({ ok: true, filas: [['a', 'b', 'c'], ['1', '2,5', '3']] });
  });

  it('ignora las líneas vacías', () => {
    expect(leerCsv(enc('a,b\n\n1,2\n\n'))).toEqual({ ok: true, filas: [['a', 'b'], ['1', '2']] });
  });

  it('rechaza lo que no es UTF-8, lo vacío, las comillas sin cerrar y los topes de tamaño y de filas', () => {
    expect(leerCsv(new Uint8Array([0x61, 0x2c, 0xe9, 0x0a]))).toMatchObject({ ok: false, mensaje: expect.stringContaining('UTF-8') });
    expect(leerCsv(new Uint8Array())).toMatchObject({ ok: false });
    expect(leerCsv(enc('a,b\n"abierta,1'))).toMatchObject({ ok: false, mensaje: expect.stringContaining('comillas') });
    expect(leerCsv(new Uint8Array(TOPE_BYTES_IMPORTACION + 1).fill(0x61))).toMatchObject({ ok: false, mensaje: expect.stringContaining('4 MB') });
    const muchas = `a\n${'x\n'.repeat(TOPE_FILAS_IMPORTACION + 1)}`;
    expect(leerCsv(enc(muchas))).toMatchObject({ ok: false, mensaje: expect.stringContaining('20,000') });
    expect(leerCsv(enc(`a\n${'x\n'.repeat(TOPE_FILAS_IMPORTACION)}`))).toMatchObject({ ok: true });
  });
});

describe('importar productos', () => {
  let p: Falso;
  beforeEach(() => { p = puertoFalso(); });

  it('CSV de 3 SKU: la vista previa los cuenta y NO escribe; confirmar da 3 altas', async () => {
    const previa = await importarCatalogo(entrada(TRES_SKU, false), p);
    expect(previa).toMatchObject({ ok: true, aplicado: false, nuevas: 3, cambian: 0, conError: 0 });
    expect(previa.mensaje).toContain('3 nuevas, 0 cambian, 0 filas con error');
    expect(p.almacen.size).toBe(0);

    const r = await importarCatalogo(entrada(TRES_SKU, true), p);
    expect(r).toMatchObject({ ok: true, aplicado: true, nuevas: 3, cambian: 0 });
    expect(p.almacen.size).toBe(3);
    const peligroso = [...p.almacen.values()].find((v) => v.cliente_id === C2);
    expect(peligroso).toMatchObject({ sku: 'SKU-A', material_peligroso: true, clave_unidad: 'KGM', embalaje: null });
  });

  it('reimportar el mismo archivo: 0 nuevas, 0 cambian y no se vuelve a escribir', async () => {
    await importarCatalogo(entrada(TRES_SKU, true), p);
    const lotesAntes = p.lotes.length;
    const otra = await importarCatalogo(entrada(TRES_SKU, true), p);
    expect(otra).toMatchObject({ ok: true, aplicado: false, nuevas: 0, cambian: 0, sinCambio: 3 });
    expect(p.lotes.length).toBe(lotesAntes);
  });

  it('cambiar una celda de un SKU existente cuenta como «cambia» y se actualiza', async () => {
    await importarCatalogo(entrada(TRES_SKU, true), p);
    const editado = TRES_SKU.replace('Pieza B,10000002', 'Pieza B,10000099');
    const previa = await importarCatalogo(entrada(editado, false), p);
    expect(previa).toMatchObject({ nuevas: 0, cambian: 1, sinCambio: 2 });
    await importarCatalogo(entrada(editado, true), p);
    expect([...p.almacen.values()].find((v) => v.sku === 'SKU-B')?.bienes_transp).toBe('10000099');
    expect(p.almacen.size).toBe(3);
  });

  it('el mismo SKU en dos clientes son dos filas distintas; dentro de un cliente se repite = error', async () => {
    const dup = `${TRES_SKU}\r\nCliente Uno,SKU-A,otra,1,H87,,,,no,`;
    const r = await importarCatalogo(entrada(dup, false), p);
    expect(r.conError).toBe(1);
    expect(r.errores[0]).toEqual({ fila: 5, mensaje: 'Repite la clave de la fila 2.' });
  });

  it('el SKU distingue mayúsculas (igual que la clave de la base)', async () => {
    const r = await importarCatalogo(entrada(`${CAB_PROD}\nCliente Uno,sku-a,,1,H87,,,,no,\nCliente Uno,SKU-A,,1,H87,,,,no,`, false), p);
    expect(r).toMatchObject({ nuevas: 2, conError: 0 });
  });

  it('el cliente se puede dar por id; un cliente de OTRA flota, uno inexistente o uno vacío son errores de fila', async () => {
    const csv = [CAB_PROD, `${C1},S1,,1,H87,,,,no,`, `${CAJENO},S2,,1,H87,,,,no,`, 'Cliente Ajeno,S3,,1,H87,,,,no,', 'Nadie,S4,,1,H87,,,,no,', ',S5,,1,H87,,,,no,'].join('\n');
    const r = await importarCatalogo(entrada(csv, false), p);
    expect(r).toMatchObject({ nuevas: 1, conError: 4 });
    expect(r.errores.map((e) => e.fila)).toEqual([3, 4, 5, 6]);
    expect(r.errores[0].mensaje).toBe('Ese cliente no es de tu flota.');
    expect(r.errores[1].mensaje).toContain('No hay un cliente llamado «Cliente Ajeno»');
    expect(r.errores[3].mensaje).toBe('Falta el cliente.');
  });

  it('otra flota no ve a mis clientes: el mismo archivo importado desde la flota 2 solo tiene errores y no escribe', async () => {
    const r = await importarCatalogo(entrada(TRES_SKU, true, 'producto', T2), p);
    expect(r).toMatchObject({ ok: false, aplicado: false, nuevas: 0, conError: 3 });
    expect(p.almacen.size).toBe(0);
  });

  it('confirmar con UNA fila con error no aplica NADA (ni siquiera las buenas)', async () => {
    const mal = `${TRES_SKU}\r\nCliente Uno,SKU-Z,,,H87,,,,no,`;
    const r = await importarCatalogo(entrada(mal, true), p);
    expect(r).toMatchObject({ ok: false, aplicado: false, nuevas: 3, conError: 1 });
    expect(r.errores).toEqual([{ fila: 5, mensaje: 'Falta «bienes_transp».' }]);
    expect(p.almacen.size).toBe(0);
    expect(p.lotes).toEqual([]);
  });

  it('valida largos, booleanos y la coherencia de material peligroso, con el número de fila', async () => {
    const csv = [
      CAB_PROD,
      `Cliente Uno,${'S'.repeat(81)},,1,H87,,,,no,`,
      'Cliente Uno,S2,,1,H87,,,,quizá,',
      'Cliente Uno,S3,,1,H87,,,,no,1203',
      'Cliente Uno,S4,,1,H87,,,,si,1203',
    ].join('\n');
    const r = await importarCatalogo(entrada(csv, false), p);
    expect(r.nuevas).toBe(1);
    expect(r.errores.map((e) => [e.fila, e.mensaje])).toEqual([
      [2, '«sku» pasa de 80 caracteres.'],
      [3, '«material_peligroso» debe ser sí o no (dice «quizá»).'],
      [4, 'Hay una clave de material peligroso, pero el producto no está marcado como peligroso.'],
    ]);
  });

  it('columna desconocida, repetida o faltante: se rechaza el archivo entero con un mensaje claro', async () => {
    expect((await importarCatalogo(entrada('cliente,sku,rfc\nCliente Uno,S1,X', false), p)).mensaje).toContain('Columna no reconocida: «rfc»');
    expect((await importarCatalogo(entrada('cliente,sku,sku\nCliente Uno,S1,S2', false), p)).mensaje).toContain('repetida');
    expect((await importarCatalogo(entrada('cliente,sku\nCliente Uno,S1', false), p)).mensaje).toContain('«bienes_transp»');
    expect((await importarCatalogo(entrada(CAB_PROD, false), p)).mensaje).toContain('solo trae el encabezado');
  });

  it('1,200 filas se escriben en lotes de 500 / 500 / 200', async () => {
    const filas = Array.from({ length: 1200 }, (_, i) => `Cliente Uno,SKU-${i},,1,H87,,,,no,`);
    const r = await importarCatalogo(entrada([CAB_PROD, ...filas].join('\n'), true), p);
    expect(r).toMatchObject({ ok: true, aplicado: true, nuevas: 1200 });
    expect(p.lotes).toEqual([500, 500, 200]);
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(TAMANO_LOTE).toBe(500);
  });

  it('si un lote falla, lo dice con cuántas filas ya quedaron y reimportar termina sin duplicar', async () => {
    const filas = Array.from({ length: 1200 }, (_, i) => `Cliente Uno,SKU-${i},,1,H87,,,,no,`);
    const csv = [CAB_PROD, ...filas].join('\n');
    p.fallarEnLote = 1;
    const r = await importarCatalogo(entrada(csv, true), p);
    expect(r).toMatchObject({ ok: false, aplicado: false });
    expect(r.mensaje).toContain('Se guardaron 500 de 1200');
    expect(p.almacen.size).toBe(500);
    p.fallarEnLote = undefined;
    const fin = await importarCatalogo(entrada(csv, true), p);
    expect(fin).toMatchObject({ ok: true, aplicado: true, nuevas: 700, sinCambio: 500 });
    expect(p.almacen.size).toBe(1200);
  });

  it('muestra a lo sumo 50 errores pero cuenta todos', async () => {
    const filas = Array.from({ length: 80 }, (_, i) => `Nadie,S${i},,1,H87,,,,no,`);
    const r = await importarCatalogo(entrada([CAB_PROD, ...filas].join('\n'), false), p);
    expect(r.conError).toBe(80);
    expect(r.errores).toHaveLength(50);
  });
});

describe('bloqueo de fórmulas', () => {
  const p = puertoFalso();
  it.each(['=CMD|\' /C calc\'!A0', '+SUMA(1;1)', '-2+3', '@SUMA(A1)', '\t=1+1', ' =1+1'])('rechaza la celda %j', async (celda) => {
    const csv = `${CAB_PROD}\nCliente Uno,S1,"${celda.replace(/"/g, '""')}",1,H87,,,,no,`;
    const r = await importarCatalogo(entrada(csv, true), p);
    expect(r).toMatchObject({ ok: false, aplicado: false, conError: 1 });
    expect(r.errores[0].fila).toBe(2);
    expect(r.errores[0].mensaje).toContain('fórmula');
  });

  it('también en el cliente y en la clave; un texto normal con guion en medio sí pasa', async () => {
    expect((await importarCatalogo(entrada(`${CAB_PROD}\n=Cliente Uno,S1,,1,H87,,,,no,`, false), p)).conError).toBe(1);
    expect((await importarCatalogo(entrada(`${CAB_PROD}\nCliente Uno,=S1,,1,H87,,,,no,`, false), p)).conError).toBe(1);
    expect((await importarCatalogo(entrada(`${CAB_PROD}\nCliente Uno,S-1,Pieza 10-20,1,H87,,,,no,`, false), p)).conError).toBe(0);
  });

  it('un teléfono con prefijo internacional es lo único con «+» que se acepta', async () => {
    const cab = 'cliente,rol,alias,telefono';
    const ok = await importarCatalogo(entrada(`${cab}\nCliente Uno,remitente,Planta,+52 55 0000 0000`, false, 'parte'), p); // grep-limpio:ok
    expect(ok.conError).toBe(0);
    const mal = await importarCatalogo(entrada(`${cab}\nCliente Uno,remitente,Planta,+52+SUMA(1)`, false, 'parte'), p);
    expect(mal.conError).toBe(1);
  });
});

describe('importar partes (remitente / destinatario)', () => {
  const CAB = 'cliente,rol,alias,razon_social,rfc,id_fiscal_extranjero,cp,correo';
  it('RFC con forma inválida → error con el número de fila; los genéricos y las minúsculas pasan', async () => {
    const p = puertoFalso();
    const csv = [CAB,
      'Cliente Uno,Remitente,Planta Norte,Empresa Uno SA,xaxx010101000,,64000,a@ejemplo.test',
      'Cliente Uno,destinatario,Bodega Sur,Empresa Dos SA,RFC-MALO,,,',
      'Cliente Uno,destinatario,Puerto,Extranjera LLC,XEXX010101000,TAX-123,,', // grep-limpio:ok
      'Cliente Uno,otro,X,,,,,',
      'Cliente Uno,destinatario,Sin correo valido,,,,,no-es-correo',
    ].join('\n');
    const r = await importarCatalogo(entrada(csv, false, 'parte'), p);
    expect(r).toMatchObject({ nuevas: 2, conError: 3 });
    expect(r.errores[0]).toEqual({ fila: 3, mensaje: expect.stringContaining('El RFC «RFC-MALO» no tiene forma válida') });
    expect(r.errores[1]).toEqual({ fila: 5, mensaje: expect.stringContaining('remitente o destinatario') });
    expect(r.errores[2]).toEqual({ fila: 6, mensaje: 'El correo «no-es-correo» no es válido.' });
    await importarCatalogo(entrada(csv.split('\n').filter((_, i) => i < 2 || i === 3).join('\n'), true, 'parte'), p);
    const guardado = [...p.almacen.values()].find((v) => v.alias === 'Planta Norte');
    expect(guardado).toMatchObject({ rol: 'remitente', rfc: 'XAXX010101000', cp: '64000' }); // grep-limpio:ok
  });

  it('el alias se repite por rol: remitente «Planta» y destinatario «Planta» no chocan', async () => {
    const csv = `${CAB}\nCliente Uno,remitente,Planta,,,,,\nCliente Uno,destinatario,Planta,,,,,`;
    expect(await importarCatalogo(entrada(csv, false, 'parte'), puertoFalso())).toMatchObject({ nuevas: 2, conError: 0 });
  });
});

describe('importar la tabla cliente → número', () => {
  it('un número por cliente; activo vacío = sí; reimportar no cambia nada', async () => {
    const p = puertoFalso();
    const csv = 'cliente,numero_interno,numero_pagador,activo\nCliente Uno,10001,,\nCliente Dos,10002,20002,no';
    const r = await importarCatalogo(entrada(csv, true, 'cliente_numero'), p);
    expect(r).toMatchObject({ ok: true, aplicado: true, nuevas: 2 });
    const a = [...p.almacen.values()];
    expect(a.find((v) => v.cliente_id === C1)).toMatchObject({ numero_interno: '10001', numero_pagador: null, activo: true });
    expect(a.find((v) => v.cliente_id === C2)).toMatchObject({ numero_interno: '10002', numero_pagador: '20002', activo: false });
    expect(await importarCatalogo(entrada(csv, true, 'cliente_numero'), p)).toMatchObject({ nuevas: 0, cambian: 0, sinCambio: 2 });
    const dup = `${csv}\nCliente Uno,10003,,`;
    expect((await importarCatalogo(entrada(dup, false, 'cliente_numero'), p)).errores).toEqual([{ fila: 4, mensaje: 'Repite la clave de la fila 2.' }]);
  });
});

// ── La acción de servidor ───────────────────────────────────────────────────

const sesion = vi.hoisted(() => ({ actual: { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' } as { tenantId: string; userId: string; rol: string } }));
const consultas = vi.hoisted(() => ({ tenants: [] as string[], tablas: [] as string[], upserts: 0, clientes: [] as Array<{ id: string; nombre: string }> }));
const resolver = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: resolver }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      consultas.tablas.push(tabla);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'in', 'limit', 'range']) b[m] = () => b;
      b.eq = (col: string, v: string) => { if (col === 'tenant_id') consultas.tenants.push(v); return b; };
      b.upsert = () => { consultas.upserts++; return b; };
      b.then = (ok: (r: unknown) => unknown) => ok({ data: tabla === 'cliente' ? consultas.clientes : [], error: null });
      return b;
    },
  }),
}));

function formulario(csv: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('tipo', 'producto');
  fd.set('archivo', new File([csv], 'catalogo.csv', { type: 'text/csv' }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe('importarCatalogoCsv (acción de servidor)', () => {
  beforeEach(() => {
    consultas.tenants.length = 0; consultas.tablas.length = 0; consultas.upserts = 0;
    consultas.clientes = [{ id: C1, nombre: 'Cliente Uno' }, { id: C2, nombre: 'Cliente Dos' }];
    sesion.actual = { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' };
    resolver.mockReset();
    resolver.mockImplementation(async () => sesion.actual);
  });

  it('un rol sin acceso a la operación (contador) es rechazado sin tocar la base', async () => {
    sesion.actual.rol = 'contador';
    const { importarCatalogoCsv } = await import('@/app/dashboard/agentes/carta-porte/catalogo/actions');
    const r = await importarCatalogoCsv(null, formulario(TRES_SKU, { intencion: 'confirmar' }));
    expect(r).toEqual({ ok: false, error: 'Tu rol no puede administrar el catálogo de Carta Porte.' });
    expect(consultas.tablas).toEqual([]);
  });

  it('usa SIEMPRE la flota de la sesión: un tenant en el formulario no cambia nada, y las lecturas van filtradas', async () => {
    const { importarCatalogoCsv } = await import('@/app/dashboard/agentes/carta-porte/catalogo/actions');
    const r = await importarCatalogoCsv(null, formulario(TRES_SKU, { tenant: 'otra-flota', intencion: 'previsualizar' }));
    expect(r).toMatchObject({ ok: true, aplicado: false, nuevas: 3, tipo: 'producto' });
    expect(consultas.tenants.length).toBeGreaterThan(0);
    expect(new Set(consultas.tenants)).toEqual(new Set(['t-sesion']));
    expect(consultas.upserts).toBe(0);
    // La puerta recibe el «ver como» firmado del formulario; es ella la que decide si vale.
    expect(resolver).toHaveBeenCalledWith('/dashboard/agentes/carta-porte', expect.objectContaining({ tenant: 'otra-flota' }));
  });

  it('confirmar escribe con upsert; un archivo vacío, un tipo desconocido y un cliente ajeno se rechazan con mensaje', async () => {
    const { importarCatalogoCsv } = await import('@/app/dashboard/agentes/carta-porte/catalogo/actions');
    const ok = await importarCatalogoCsv(null, formulario(TRES_SKU, { intencion: 'confirmar' }));
    expect(ok).toMatchObject({ ok: true, aplicado: true, nuevas: 3 });
    expect(consultas.upserts).toBe(1);

    const vacio = await importarCatalogoCsv(null, formulario('', { intencion: 'confirmar' }));
    expect(vacio).toEqual({ ok: false, error: 'Elige un archivo CSV.' });
    const tipoMalo = await importarCatalogoCsv(null, formulario(TRES_SKU, { tipo: 'otro' }));
    expect(tipoMalo).toMatchObject({ ok: false });

    consultas.upserts = 0;
    consultas.clientes = [{ id: CAJENO, nombre: 'Cliente Ajeno' }]; // la flota de la sesión no tiene a C1/C2
    const ajeno = await importarCatalogoCsv(null, formulario(TRES_SKU, { intencion: 'confirmar' }));
    expect(ajeno).toMatchObject({ ok: false, aplicado: false, conError: 3 });
    expect(consultas.upserts).toBe(0);
  });
});
