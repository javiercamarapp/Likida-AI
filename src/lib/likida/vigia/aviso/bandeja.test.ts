import { beforeEach, describe, expect, it, vi } from 'vitest';

// La bandeja de avisos de viaje (T-A4-22), sin base: un cliente GRABADOR de Supabase dice qué se pregunta y con qué filtros
// (aislamiento por tenant en TODA llamada, errores que lanzan, 0797 sin migrar traducida) y las funciones puras fijan lo que
// la pantalla afirma: qué datos tiene, cuáles faltan, qué botón corresponde y que el teléfono completo nunca llega a quien solo mira.

interface Llamada {
  tabla: string; op: string; filtros: Array<[string, string, unknown]>; valores?: unknown; columnas?: string; opciones?: unknown; rango?: [number, number];
}
let llamadas: Llamada[] = [];
let rpcs: Array<{ nombre: string; args: Record<string, unknown> }> = [];
let respuesta: (l: Llamada) => { data: unknown; error: { message: string; code?: string } | null; count?: number } = () => ({ data: [], error: null });
let respuestaRpc: (n: string) => { data: unknown; error: { message: string; code?: string } | null } = () => ({ data: null, error: null });

function constructor(tabla: string) {
  const l: Llamada = { tabla, op: 'select', filtros: [] };
  const b: Record<string, unknown> = {};
  const encadenar = (nombre: string) => (...a: unknown[]) => {
    if (['eq', 'in', 'gte', 'lte', 'neq', 'or'].includes(nombre)) l.filtros.push([nombre, String(a[0]), a[1]]);
    if (nombre === 'range') l.rango = [Number(a[0]), Number(a[1])];
    if (nombre === 'select') { l.columnas = String(a[0]); l.opciones = a[1]; }
    return b;
  };
  for (const m of ['select', 'eq', 'in', 'neq', 'or', 'order', 'range']) b[m] = encadenar(m);
  b.update = (v: unknown) => { l.op = 'update'; l.valores = v; return b; };
  b.upsert = (v: unknown, o: unknown) => { l.op = 'upsert'; l.valores = v; l.opciones = o; return b; };
  b.maybeSingle = () => { llamadas.push(l); const r = respuesta(l); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }); };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { llamadas.push(l); return Promise.resolve(respuesta(l)).then(ok, ko); };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => constructor(t),
    rpc: (nombre: string, args: Record<string, unknown>) => { rpcs.push({ nombre, args }); return Promise.resolve(respuestaRpc(nombre)); },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  crearRepoBandeja, crearDepsCopia, paraEntrega, armarTarjeta, agruparPorDia, validarDatoManual, ocultarTelefonos, errorEnLlano,
  ROTULO_ESTADO,
} = await import('./bandeja');
const { AvisoSinMigrar } = await import('./repo');
const { entregarAviso } = await import('./entrega');
import type { AvisoBandeja } from './bandeja';

const T1 = '11111111-1111-4111-8111-111111111111';
const U1 = '33333333-3333-4333-8333-333333333333';
const FILA = '22222222-2222-4222-8222-222222222222';
const AV = '44444444-4444-4444-8444-444444444444';
const AHORA = '2026-10-20T15:00:00.000Z';

beforeEach(() => { llamadas = []; rpcs = []; respuesta = () => ({ data: [], error: null }); respuestaRpc = () => ({ data: null, error: null }); });

const aviso = (p: Partial<AvisoBandeja> = {}): AvisoBandeja => ({
  id: AV, filaId: FILA, clienteId: 'c1', version: 1, estado: 'pendiente_confirmacion', canal: 'ejecutivo_copia',
  texto: 'Datos de la unidad asignada a tu viaje:\nCaja: CJ-100\nPlacas de la caja: por confirmar\nUnidad: U-7\nOperador: Operador Sintético',
  datos: {
    via: 'proxy', tipo: 'inicial', pendientes: ['placas_caja'],
    valores: { caja: 'CJ-100', unidad: 'U-7', placas_caja: null, placas_unidad: 'ZZZ-123', operador_nombre: 'Operador Sintético' },
    fuentes: { placas_unidad: 'catalogo', operador: 'manual' }, faltantes: [],
  },
  motivo: 'proxy: caja + unidad + CCP', error: null, creadoEn: '2026-10-20T14:00:00.000Z', aprobadoEn: null, enviadoEn: null, ...p,
});

const FILA_PROG = { fecha: '2026-10-21', cliente: 'CLIENTE SINT 01', consignatario: null, caja: 'CJ-100', unidad: 'U-7', citaTexto: '08:00', citaEn: null };

describe('AISLAMIENTO: toda llamada del repo lleva el tenant', () => {
  it('cada método filtra o escribe con tenant_id', async () => {
    respuesta = (l) => (l.tabla === 'programa_despacho_fila' ? { data: [{ id: FILA }], error: null } : { data: [{ id: AV }], error: null });
    const r = crearRepoBandeja();
    await r.listar(T1, AHORA, false);
    await r.listar(T1, AHORA, true);
    await r.obtener(T1, AV);
    await r.contarPendientes(T1);
    await r.aprobar(T1, AV, 'pendiente_confirmacion', U1, AHORA);
    await r.reabrir(T1, AV);
    await r.editarTexto(T1, aviso(), 'nuevo', U1, AHORA);
    await r.guardarDatoManual(T1, FILA, U1, { placasCaja: 'ABC-123' });
    expect(llamadas.length).toBeGreaterThanOrEqual(9);
    for (const l of llamadas) {
      const v = l.valores;
      const escribe = l.op === 'upsert' && (v as Record<string, unknown>).tenant_id === T1;
      expect(escribe || l.filtros.some(([o, c, x]) => o === 'eq' && c === 'tenant_id' && x === T1), `${l.tabla}.${l.op}`).toBe(true);
    }
  });
});

describe('la lista', () => {
  it('no trae los reemplazados, acota la página y pide los pendientes sin importar su edad', async () => {
    await crearRepoBandeja().listar(T1, AHORA, false);
    const l = llamadas[0];
    expect(l.filtros).toContainEqual(['neq', 'estado', 'reemplazado']);
    const or = String(l.filtros.find(([o]) => o === 'or')?.[1]);
    expect(or).toContain(`creado_en.gte.${AHORA}`);
    expect(or).toContain('pendiente_confirmacion');
    expect(l.rango).toEqual([0, 299]);
    expect(l.columnas).not.toContain('*');
  });
  it('«solo pendientes» filtra por estado, no por fecha', async () => {
    await crearRepoBandeja().listar(T1, AHORA, true);
    const l = llamadas[0];
    expect(l.filtros.find(([o, c]) => o === 'in' && c === 'estado')?.[2]).toEqual(['pendiente_confirmacion', 'sin_destinatario', 'fallido', 'aprobado']);
    expect(l.filtros.some(([o]) => o === 'or')).toBe(false);
  });
  it('un error de la base LANZA (no se lee como «no hay avisos») y 42P01 es «sin migrar»', async () => {
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(crearRepoBandeja().listar(T1, AHORA, false)).rejects.toThrow(/bandeja\.listar: caída/);
    respuesta = () => ({ data: null, error: { message: 'no existe', code: '42P01' } });
    await expect(crearRepoBandeja().contarPendientes(T1)).rejects.toBeInstanceOf(AvisoSinMigrar);
    respuesta = () => ({ data: null, error: { message: 'no existe', code: 'PGRST205' } });
    await expect(crearRepoBandeja().listar(T1, AHORA, true)).rejects.toBeInstanceOf(AvisoSinMigrar);
  });
  it('convierte la fila: datos que no son objeto quedan en {}', async () => {
    respuesta = () => ({ data: [{ id: AV, fila_id: FILA, cliente_id: null, version: 2, estado: 'fallido', canal: 'cliente_1a1', texto: 'x', datos: [1], motivo: null, error: 'e', creado_en: AHORA, aprobado_en: null, enviado_en: null }], error: null });
    const [a] = await crearRepoBandeja().listar(T1, AHORA, false);
    expect(a).toMatchObject({ id: AV, version: 2, estado: 'fallido', canal: 'cliente_1a1', datos: {}, clienteId: null, error: 'e' });
  });
  it('contar: solo los que esperan a una persona; sin cuenta = 0', async () => {
    respuesta = () => ({ data: null, error: null, count: 4 });
    expect(await crearRepoBandeja().contarPendientes(T1)).toBe(4);
    expect(llamadas[0].filtros.find(([o]) => o === 'in')?.[2]).toEqual(['pendiente_confirmacion', 'sin_destinatario', 'fallido']);
    expect(llamadas[0].opciones).toEqual({ count: 'exact', head: true });
    respuesta = () => ({ data: null, error: null });
    expect(await crearRepoBandeja().contarPendientes(T1)).toBe(0);
  });
});

describe('las escrituras', () => {
  it('aprobar es condicional al estado leído y deja quién y cuándo; false si ya cambió', async () => {
    respuesta = () => ({ data: [{ id: AV }], error: null });
    expect(await crearRepoBandeja().aprobar(T1, AV, 'fallido', U1, AHORA, 'ejecutivo_copia')).toBe(true);
    const l = llamadas[0];
    expect(l.valores).toMatchObject({ estado: 'aprobado', aprobado_por: U1, aprobado_en: AHORA, canal: 'ejecutivo_copia', error: null });
    expect(l.filtros).toContainEqual(['eq', 'estado', 'fallido']);
    respuesta = () => ({ data: [], error: null });
    expect(await crearRepoBandeja().aprobar(T1, AV, 'pendiente_confirmacion', U1, AHORA)).toBe(false);
  });
  it('sin canal no toca el canal', async () => {
    respuesta = () => ({ data: [{ id: AV }], error: null });
    await crearRepoBandeja().aprobar(T1, AV, 'pendiente_confirmacion', U1, AHORA);
    expect(llamadas[0].valores).not.toHaveProperty('canal');
  });
  it('editar guarda el texto, conserva los datos y deja constancia de que lo tocó una persona; solo si el estado sigue igual', async () => {
    respuesta = () => ({ data: [{ id: AV }], error: null });
    const a = aviso();
    expect(await crearRepoBandeja().editarTexto(T1, a, 'otro texto', U1, AHORA)).toBe(true);
    const v = llamadas[0].valores as { texto: string; datos: Record<string, unknown> };
    expect(v.texto).toBe('otro texto');
    expect(v.datos).toMatchObject({ via: 'proxy', editado_por_persona: true, editado_por: U1, editado_en: AHORA });
    expect(v.datos.valores).toEqual(a.datos.valores);
    expect(llamadas[0].filtros).toContainEqual(['eq', 'estado', 'pendiente_confirmacion']);
  });
  it('la captura manual de una fila AJENA no escribe nada', async () => {
    respuesta = () => ({ data: null, error: null });
    expect(await crearRepoBandeja().guardarDatoManual(T1, FILA, U1, { placasCaja: 'ABC-123' })).toBe('fila_ajena');
    expect(llamadas.some((l) => l.op === 'upsert')).toBe(false);
  });
  it('A37-INN-A4-08: la captura manual NO lee-mezcla-escribe: el upsert lleva solo las columnas tocadas', async () => {
    respuesta = (l) => (l.tabla === 'programa_despacho_fila' ? { data: [{ id: FILA }], error: null } : { data: null, error: null });
    expect(await crearRepoBandeja().guardarDatoManual(T1, FILA, U1, { placasCaja: 'ABC-123' })).toBe('guardado');
    expect(llamadas.some((l) => l.tabla === 'vigia_dato_viaje_manual' && l.op === 'select')).toBe(false);
    const up = llamadas.find((l) => l.op === 'upsert');
    expect(up?.valores).toMatchObject({ tenant_id: T1, fila_id: FILA, placas_caja: 'ABC-123', editado_por: U1 });
    expect(Object.keys(up?.valores as object)).not.toContain('operador_nombre');
    expect(up?.opciones).toEqual({ onConflict: 'tenant_id,fila_id' });
  });
  it('A37-INN-A4-08: borrar es explícito (null) y lo vacío no borra', async () => {
    expect(validarDatoManual({ placasCaja: '', telefono: '' })).toMatchObject({ ok: false });
    const v = validarDatoManual({ placasCaja: 'ABC-123', borrar: ['telefono'] });
    expect(v).toMatchObject({ ok: true, valor: { placasCaja: 'ABC-123', telefono: null } });
    expect(validarDatoManual({ telefono: '5512345678', borrar: ['telefono'] })).toMatchObject({ ok: false });
    expect(validarDatoManual({ borrar: ['tenant_id'] })).toMatchObject({ ok: false });
    respuesta = (l) => (l.tabla === 'programa_despacho_fila' ? { data: [{ id: FILA }], error: null } : { data: null, error: null });
    await crearRepoBandeja().guardarDatoManual(T1, FILA, U1, { telefono: null });
    expect(llamadas.find((l) => l.op === 'upsert')?.valores).toMatchObject({ telefono: null });
  });
});

describe('«Copiar y marcar enviado» de punta a punta con las RPC de la 0797', () => {
  it('reclama y cierra con el token; el aviso queda enviado y la constancia lleva la flota', async () => {
    respuestaRpc = (n) => (n === 'vigia_aviso_reclamar' ? { data: [{ o_id: AV, o_token: 'tok-1' }], error: null } : { data: true, error: null });
    const a = aviso({ estado: 'aprobado' });
    const r = await entregarAviso(paraEntrega(T1, a), crearDepsCopia(T1, true, 'America/Mexico_City'), 'copiar');
    expect(r).toEqual({ estado: 'enviado', via: 'copia_manual' });
    expect(rpcs.map((x) => x.nombre)).toEqual(['vigia_aviso_reclamar', 'vigia_aviso_cerrar']);
    expect(rpcs[0].args).toMatchObject({ p_tenant: T1, p_id: AV });
    expect(rpcs[1].args).toMatchObject({ p_tenant: T1, p_id: AV, p_token: 'tok-1', p_estado: 'enviado' });
  });
  it('si otra llamada ya lo reclamó, no se marca dos veces', async () => {
    respuestaRpc = () => ({ data: [], error: null });
    const r = await entregarAviso(paraEntrega(T1, aviso({ estado: 'aprobado' })), crearDepsCopia(T1, true, 'America/Mexico_City'), 'copiar');
    expect(r).toEqual({ estado: 'perdido' });
    expect(rpcs.map((x) => x.nombre)).toEqual(['vigia_aviso_reclamar']);
  });
  it('con el aviso apagado no se reclama nada', async () => {
    const r = await entregarAviso(paraEntrega(T1, aviso({ estado: 'aprobado' })), crearDepsCopia(T1, false, 'America/Mexico_City'), 'copiar');
    expect(r).toEqual({ estado: 'omitido', motivo: 'aviso_apagado' });
    expect(rpcs).toEqual([]);
  });
  it('un error de la RPC lanza', async () => {
    respuestaRpc = () => ({ data: null, error: { message: 'rpc caída' } });
    await expect(entregarAviso(paraEntrega(T1, aviso({ estado: 'aprobado' })), crearDepsCopia(T1, true, 'America/Mexico_City'), 'copiar')).rejects.toThrow(/rpc caída/);
  });
});

describe('la tarjeta: qué tiene, qué falta, de dónde salió', () => {
  it('lista los datos con su fuente (programa, catálogo, manual) y dice en llano qué falta', () => {
    const t = armarTarjeta(aviso(), FILA_PROG, false);
    expect(t.tiene.map((d) => `${d.rotulo}=${d.valor}|${d.fuente}`)).toEqual([
      'Caja=CJ-100|del programa', 'Unidad=U-7|del programa', 'Placas de la unidad=ZZZ-123|del catálogo', 'Operador=Operador Sintético|capturado a mano',
    ]);
    expect(t.faltan).toEqual([{ campo: 'placas_caja', texto: 'Falta la placa de la caja' }]);
    expect(t.servicio).toBe('caja CJ-100 · unidad U-7');
    expect(t.cliente).toBe('CLIENTE SINT 01');
    expect(t.cita).toBe('08:00');
    expect(t.estadoRotulo).toBe(ROTULO_ESTADO.pendiente_confirmacion);
  });
  it('nunca pinta licencia, vigencia ni teléfono aunque alguien los hubiera metido en `datos`', () => {
    const a = aviso({ datos: { ...aviso().datos, valores: { caja: 'CJ-1', licencia: 'LIC-SECRETA', vigencia: '2030-01-01', telefono_operador: '5215500000000' } } });
    const t = armarTarjeta(a, FILA_PROG, false);
    expect(JSON.stringify(t.tiene)).not.toMatch(/LIC-SECRETA|2030|5215500000000/);
  });
  it('causas de «sin destinatario»: cliente no identificado, ambiguo o sin contacto; lo de caja/unidad no se repite', () => {
    const a = aviso({ estado: 'sin_destinatario', clienteId: null, datos: { tipo: 'inicial', faltantes: ['sin_cliente', 'sin_caja', 'sin_operador', 'cliente_ambiguo', 'sin_contacto'] } });
    const t = armarTarjeta(a, FILA_PROG, false);
    expect(t.causas).toEqual([
      'No encontré a qué cliente pertenece este servicio.', 'Hay más de un cliente que coincide con ese nombre.', 'El cliente no tiene un contacto autorizado de WhatsApp.',
    ]);
    const sin = armarTarjeta(aviso({ estado: 'sin_destinatario', datos: { tipo: 'inicial', faltantes: [] } }), FILA_PROG, false);
    expect(sin.causas).toEqual(['No hay a quién mandarlo: copia el texto y mándalo por tu grupo.']);
  });
  it('una actualización enseña la versión y qué cambió', () => {
    const a = aviso({ version: 2, texto: 'Actualización: cambió la caja: CJ-1 → CJ-2.\nCaja: CJ-2', datos: { tipo: 'actualizacion', valores: { caja: 'CJ-2' } } });
    const t = armarTarjeta(a, FILA_PROG, false);
    expect(t.version).toBe(2);
    expect(t.cambio).toBe('Actualización: cambió la caja: CJ-1 → CJ-2.');
    expect(armarTarjeta(aviso(), FILA_PROG, false).cambio).toBeNull();
  });
  it('un fallido explica en llano y manda a copiar el texto', () => {
    const t = armarTarjeta(aviso({ estado: 'fallido', canal: 'cliente_1a1', error: 'Ese contacto no tiene constancia de consentimiento: no se le escribe.' }), FILA_PROG, false);
    expect(t.errorLlano).toBe('No pude enviar: este cliente no autorizó mensajes por WhatsApp. Copia el texto y mándalo por tu grupo.');
    expect(armarTarjeta(aviso(), FILA_PROG, false).errorLlano).toBeNull();
  });
  it('errorEnLlano cubre plantilla, contacto, apagado y lo desconocido; nunca repite el cuerpo crudo', () => {
    expect(errorEnLlano('La plantilla del aviso aún no está aprobada en WhatsApp (132001)')).toMatch(/plantilla del aviso todavía no está aprobada/);
    expect(errorEnLlano('El cliente no tiene un contacto de WhatsApp registrado.')).toMatch(/no tiene un contacto de WhatsApp/);
    expect(errorEnLlano('El Vigía está apagado para esta flota.')).toMatch(/Vigía está apagado/);
    const raro = errorEnLlano('{"token":"abc"} boom');
    expect(raro).toMatch(/WhatsApp no lo aceptó/);
    expect(raro).not.toContain('token');
    expect(errorEnLlano(null)).toMatch(/No pude enviar/);
  });
  it('sin fila del programa no truena: cliente sin identificar', () => {
    const t = armarTarjeta(aviso(), null, false);
    expect(t.cliente).toBe('Cliente sin identificar');
    expect(t.servicio).toBe('servicio sin caja ni unidad');
    expect(t.fecha).toBe('');
  });
});

describe('qué botón corresponde a cada estado y canal', () => {
  const p = (a: Partial<AvisoBandeja>, lectura = false) => armarTarjeta(aviso(a), FILA_PROG, lectura).puede;

  it('pendiente por WhatsApp directo: Confirmar y enviar, editar y descartar; sin «copiar»', () => {
    expect(p({ canal: 'cliente_1a1' })).toEqual({ confirmar: true, copiar: false, editar: true, descartar: true, capturar: true });
  });
  it('pendiente en copia: Copiar y marcar enviado, no confirmar', () => {
    expect(p({ canal: 'ejecutivo_copia' })).toMatchObject({ confirmar: false, copiar: true, editar: true, descartar: true });
  });
  it('aprobado: ya no se edita ni se captura; se puede descartar; copiar solo en canal de copia', () => {
    expect(p({ estado: 'aprobado', canal: 'ejecutivo_copia' })).toEqual({ confirmar: false, copiar: true, editar: false, descartar: true, capturar: false });
    expect(p({ estado: 'aprobado', canal: 'cliente_1a1' })).toEqual({ confirmar: false, copiar: false, editar: false, descartar: true, capturar: false });
  });
  it('fallido y sin destinatario: copiar a mano como salida, también en canal 1:1', () => {
    expect(p({ estado: 'fallido', canal: 'cliente_1a1' })).toMatchObject({ confirmar: false, copiar: true, editar: true, descartar: true });
    expect(p({ estado: 'sin_destinatario', canal: 'cliente_1a1' })).toMatchObject({ confirmar: false, copiar: true });
  });
  it('enviado, descartado y reemplazado son historia: ningún botón', () => {
    for (const estado of ['enviado', 'descartado', 'reemplazado'] as const) {
      expect(p({ estado })).toEqual({ confirmar: false, copiar: false, editar: false, descartar: false, capturar: false });
    }
  });
  it('quien solo mira no tiene ningún botón en ningún estado', () => {
    for (const estado of ['pendiente_confirmacion', 'aprobado', 'fallido', 'sin_destinatario', 'enviado'] as const) {
      expect(Object.values(p({ estado, canal: 'cliente_1a1' }, true)).some(Boolean)).toBe(false);
    }
  });
  it('una alerta interna solo se descarta: no se confirma, no se copia, no se edita', () => {
    expect(p({ estado: 'sin_destinatario', datos: { tipo: 'alerta_cambia_demasiado', interno: true } })).toEqual({ confirmar: false, copiar: false, editar: false, descartar: true, capturar: false });
  });
  it('capturar solo si falta algo que se captura a mano', () => {
    expect(p({ datos: { ...aviso().datos, pendientes: [] } }).capturar).toBe(false);
    expect(p({ datos: { ...aviso().datos, pendientes: ['caja'] } }).capturar).toBe(false);
    expect(p({ datos: { ...aviso().datos, pendientes: ['placas_unidad', 'operador_nombre'] } }).capturar).toBe(true);
    expect(p({ datos: { tipo: 'cancelacion', pendientes: ['operador_nombre'] } }).capturar).toBe(false);
  });
});

describe('sin teléfonos completos para quien solo mira', () => {
  it('ocultarTelefonos deja solo los últimos cuatro dígitos, con o sin 52, espacios y guiones', () => {
    expect(ocultarTelefonos('Llama al 5212899900001 hoy')).toBe('Llama al •••• 0001 hoy');
    expect(ocultarTelefonos('Teléfono del operador: +52 28 9990 0001')).toBe('Teléfono del operador: •••• 0001');
    expect(ocultarTelefonos('tel 28-9990-0001.')).toBe('tel •••• 0001.');
  });
  it('no toca cajas, placas ni fechas', () => {
    const t = 'Caja: CJ-100 Placas: ABC-1234 Vigencia 2026-10-21 Unidad 7';
    expect(ocultarTelefonos(t)).toBe(t);
  });
  it('la tarjeta de solo lectura enmascara el texto y los valores; la del que decide, no', () => {
    const a = aviso({ texto: 'Operador: X\nTeléfono del operador: 5212899900001', datos: { ...aviso().datos, valores: { operador_nombre: 'X 5212899900001' } } });
    const lee = armarTarjeta(a, FILA_PROG, true);
    expect(lee.texto).not.toContain('5212899900001');
    expect(lee.texto).toContain('•••• 0001');
    expect(JSON.stringify(lee.tiene)).not.toContain('5212899900001');
    expect(armarTarjeta(a, FILA_PROG, false).texto).toContain('5212899900001');
  });
});

describe('la captura manual valida como la tabla (0796)', () => {
  it('normaliza placas a mayúsculas sin espacios, el teléfono a 52 + 10 dígitos, y acepta el estado de la lista', () => {
    const v = validarDatoManual({ placasCaja: ' abc 123 ', placasUnidad: 'zz-99a', telefono: '(28) 9990-0001', estadoCaja: 'en_patio', operadorNombre: '  Operador   Sintético ', licenciaVence: '2027-02-28' });
    expect(v).toEqual({ ok: true, valor: { placasCaja: 'ABC123', placasUnidad: 'ZZ-99A', telefono: '522899900001', estadoCaja: 'en_patio', operadorNombre: 'Operador Sintético', licenciaVence: '2027-02-28' } });
  });
  it('rechaza lo que la base rechazaría, con un mensaje que dice qué corregir', () => {
    const err = (e: Record<string, unknown>) => { const r = validarDatoManual(e); return r.ok ? null : r.error; };
    expect(err({ placasCaja: 'A' })).toMatch(/Placas de la caja/);
    expect(err({ placasUnidad: 'AB CD!!' })).toMatch(/Placas de la unidad/);
    expect(err({ telefono: '12345' })).toMatch(/10 dígitos/);
    expect(err({ telefono: '5612345678901' })).toMatch(/10 dígitos/);
    expect(err({ estadoCaja: 'rota' })).toMatch(/estado de la caja/);
    expect(err({ licenciaVence: '2027-02-30' })).toMatch(/fecha real/);
    expect(err({ licenciaVence: '30/02/2027' })).toMatch(/fecha real/);
    expect(err({ operadorNombre: 'x'.repeat(121) })).toMatch(/demasiado largo/);
    expect(err({ licencia: 'x'.repeat(41) })).toMatch(/demasiado larga/);
  });
  it('todo vacío es un error; lo que no es texto se ignora', () => {
    expect(validarDatoManual({})).toEqual({ ok: false, error: 'Escribe al menos un dato para guardar.' });
    expect(validarDatoManual({ placasCaja: '   ', operadorNombre: 5, telefono: null })).toEqual({ ok: false, error: 'Escribe al menos un dato para guardar.' });
  });
  it('acepta el teléfono ya con 52', () => {
    expect(validarDatoManual({ telefono: '522899900001' })).toEqual({ ok: true, valor: { telefono: '522899900001' } });
  });
});

describe('agrupar por día y cliente', () => {
  const t = (id: string, fecha: string, cliente: string, version = 1, filaId = id) => ({ ...armarTarjeta(aviso({ id, filaId }), { ...FILA_PROG, fecha, cliente }, false), version });
  it('el día más próximo primero, sin fecha al final; clientes en orden; versiones de menor a mayor', () => {
    const g = agruparPorDia([t('a', '2026-10-22', 'Beta'), t('b', '', 'Sin'), t('c', '2026-10-21', 'Beta'), t('d', '2026-10-21', 'Alfa', 2, 'f1'), t('e', '2026-10-21', 'Alfa', 1, 'f1')]);
    expect(g.map((x) => x.fecha)).toEqual(['2026-10-21', '2026-10-22', '']);
    expect(g[0].clientes.map((c) => c.cliente)).toEqual(['Alfa', 'Beta']);
    expect(g[0].clientes[0].tarjetas.map((x) => x.id)).toEqual(['e', 'd']);
  });
  it('lista vacía → sin grupos', () => { expect(agruparPorDia([])).toEqual([]); });
});
