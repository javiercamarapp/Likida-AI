import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// PANTALLA DE CONFIGURACIÓN DEL AVISO (T-A4-23, E4/E5/E6).
//   · render: apagado por defecto, mapa de colores deshabilitado con su texto, privacidad de solo lectura salvo la dueña;
//   · el servidor valida rangos (horas 0–48, calma 1–120, reenvíos 0–10), horario, catálogos y modo/canal;
//   · el tenant sale de la sesión (jamás del formulario); solo `flota_admin` cambia los datos personales del operador;
//   · guardado idempotente y cada cambio deja bitácora (quién, rol, antes/después, sin datos personales);
//   · INTEGRACIÓN: lo guardado se ve en el siguiente `generarAvisos` (doble de base en memoria, repo real de configuración).
// Datos 100 % sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => sesion) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: (rol: string) => ['superadmin', 'flota_admin', 'encargado', 'contador_ve'].includes(rol) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));
const anotarBitacora = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora }));

// ── doble de base en memoria (lo justo de PostgREST que usa la pantalla y el repo de configuración) ──
type Fila = Record<string, unknown>;
const tablas = vi.hoisted(() => ({ datos: {} as Record<string, Fila[]>, fallan: new Set<string>(), codigoError: 'XX000', escrituras: [] as Array<{ tabla: string; op: string; payload: Fila }> }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(tabla: string) {
      const filtros: Array<(r: Fila) => boolean> = [];
      let op: 'select' | 'update' | 'insert' | 'upsert' = 'select';
      let payload: Fila = {};
      let opts: { onConflict?: string } = {};
      let uno = false;
      const b = {
        select() { return b; },
        eq(k: string, v: unknown) { filtros.push((r) => r[k] === v); return b; },
        is(k: string, v: unknown) { filtros.push((r) => (r[k] ?? null) === v); return b; },
        maybeSingle() { uno = true; return b; },
        update(p: Fila) { op = 'update'; payload = p; return b; },
        insert(p: Fila) { op = 'insert'; payload = p; return b; },
        upsert(p: Fila, o: { onConflict?: string }) { op = 'upsert'; payload = p; opts = o; return b; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(ejecutar()).then(res, rej);
        },
      };
      function ejecutar(): { data: unknown; error: { message: string; code?: string } | null } {
        if (tablas.fallan.has(`${tabla}:${op}`)) return { data: null, error: { message: 'base caída', code: tablas.codigoError } };
        const t = (tablas.datos[tabla] ??= []);
        if (op === 'select') {
          const filas = t.filter((r) => filtros.every((f) => f(r)));
          return { data: uno ? (filas[0] ?? null) : filas, error: null };
        }
        tablas.escrituras.push({ tabla, op, payload });
        if (op === 'update') { for (const r of t.filter((x) => filtros.every((f) => f(x)))) Object.assign(r, payload); return { data: null, error: null }; }
        if (op === 'insert') { t.push({ id: `id-${t.length + 1}`, ...payload }); return { data: null, error: null }; }
        const llave = opts.onConflict ?? 'id';
        const previa = t.find((r) => r[llave] === payload[llave]);
        if (previa) Object.assign(previa, payload);
        else t.push({ autonomo_min_confirmaciones: 5, zona: 'America/Mexico_City', ...payload });
        return { data: null, error: null };
      }
      return b;
    },
  }),
}));

const Pagina = (await import('./page')).default;
const { VistaConfiguracionAviso, TEXTO_COLORES } = await import('./configuracion');
const { generarAvisos } = await import('@/lib/likida/vigia/aviso/generar');
const { crearRepoAviso } = await import('@/lib/likida/vigia/aviso/repo');
import type { RepoAviso, FilaDelPrograma, NuevoAviso, AvisoExistente } from '@/lib/likida/vigia/aviso/repo';
import type { DepsResolver } from '@/lib/likida/vigia/aviso/resolver';
import { normalizarAlias } from '@/lib/likida/vigia/aviso/equivalencias';

type Resultado = null | { ok: true; mensaje: string } | { ok: false; error: string };
type Props = Parameters<typeof VistaConfiguracionAviso>[0];

async function props(sp: Record<string, string> = { config: '1' }): Promise<Props> {
  const el = (await Pagina({ searchParams: Promise.resolve(sp) })) as ReactElement<Props>;
  return el.props;
}
const guardar = async (campos: Array<[string, string]>): Promise<Resultado> => {
  const p = await props();
  const fd = new FormData();
  for (const [k, v] of campos) fd.append(k, v);
  return p.accion(null, fd);
};
/** Un formulario completo y válido; `cambios` reemplaza o agrega (una clave repetida con valor `null` la quita). */
function forma(cambios: Record<string, string | string[] | null> = {}): Array<[string, string]> {
  const base: Record<string, string | string[]> = {
    habilitado: '1', modo: 'confirmar', canal: 'ejecutivo_copia', ccp: ['listo', 'despachado'], seccion: ['IMPORTACION', 'EXPORTACION'],
    horas_antes: '', ventana_desde: '', ventana_hasta: '', debounce_min: '10', max_reenvios: '3',
  };
  const out: Record<string, string | string[]> = { ...base };
  for (const [k, v] of Object.entries(cambios)) { if (v === null) delete out[k]; else out[k] = v; }
  return Object.entries(out).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x): [string, string] => [k, x]) : [[k, v] as [string, string]]));
}
const sesionComo = (rol: string) => { sesion = { ...sesion, rol }; };
const filaConfig = (t = 't-sesion') => tablas.datos.vigia_aviso_config?.find((r) => r.tenant_id === t);

beforeEach(() => {
  sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
  vi.clearAllMocks();
  tablas.datos = { vigia_aviso_config: [], vigia_politica_datos: [] };
  tablas.fallan.clear();
  tablas.codigoError = 'XX000';
  tablas.escrituras = [];
});

describe('la pantalla renderizada', () => {
  const html = (p: Partial<Props> = {}) => renderToStaticMarkup(<VistaConfiguracionAviso {...({} as Props)} {...p} />);
  async function base(): Promise<Props> { return props(); }
  /** Las etiquetas <input> con ese nombre (React reordena los atributos: se prueba atributo por atributo, no el orden). */
  const entradas = (h: string, nombre: string) => [...h.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((e) => e.includes(`name="${nombre}"`));

  it('sin configuración guardada: apagado, confirmar cada aviso y los datos personales del operador sin marcar', async () => {
    const p = await base();
    expect(p.config).toMatchObject({ habilitado: false, modo: 'confirmar', canalDefault: 'ejecutivo_copia', operador: { licencia: false, vigencia: false, telefono: false } });
    const h = html(p);
    expect(h).toContain('Aviso de viaje encendido');
    expect(entradas(h, 'habilitado')[0]).not.toContain('checked');
    expect(h).toContain('Confirmar cada aviso (recomendado)');
  });
  it('el mapa de colores está deshabilitado y dice «Esperando el archivo con colores»', async () => {
    const h = html(await base());
    expect(TEXTO_COLORES).toBe('Esperando el archivo con colores');
    expect(h).toContain('data-testid="colores"');
    expect(h).toContain('aria-disabled="true"');
    expect(h).toContain('Esperando el archivo con colores');
    expect(h).not.toMatch(/name="colores?/);
  });
  it('muestra la regla provisional del «listo» y los estatus de CCP editables', async () => {
    const h = html(await base());
    expect(h).toContain('Regla provisional');
    const valores = entradas(h, 'ccp').map((e) => /value="([^"]+)"/.exec(e)?.[1]);
    expect(valores).toEqual(['listo', 'despachado', 'pend_reque', 'pend_ccp', 'falta_complemento']);
    expect(entradas(h, 'ccp').filter((e) => e.includes('checked=""')).length).toBe(2);
    expect(h).not.toContain('CANCELACIONES');
  });
  it('los límites viajan a los campos numéricos', async () => {
    const h = html(await base());
    const [horas] = entradas(h, 'horas_antes');
    expect(horas).toContain('min="0"'); expect(horas).toContain('max="48"');
    const [calma] = entradas(h, 'debounce_min');
    expect(calma).toContain('min="1"'); expect(calma).toContain('max="120"');
    const [reenvios] = entradas(h, 'max_reenvios');
    expect(reenvios).toContain('min="0"'); expect(reenvios).toContain('max="10"');
  });
  it('la dueña ve la privacidad editable; el encargado la ve deshabilitada con su explicación', async () => {
    sesionComo('flota_admin');
    const dueña = html(await base());
    expect(entradas(dueña, 'op_presente')).toHaveLength(1);
    expect(entradas(dueña, 'op_licencia')[0]).not.toContain('disabled');
    sesionComo('encargado');
    const encargado = html(await base());
    expect(entradas(encargado, 'op_presente')).toHaveLength(0);
    expect(entradas(encargado, 'op_licencia')[0]).toContain('disabled');
    expect(encargado).toContain('data-testid="solo-duena"');
    expect(encargado).toContain('Guardar configuración');
  });
  it('quien solo mira ve la configuración sin controles ni botón de guardar', async () => {
    sesionComo('contador_ve');
    const p = await base();
    expect(p.puedeEditar).toBe(false);
    const h = html(p);
    expect(h).not.toContain('Guardar configuración');
    expect(entradas(h, 'habilitado')[0]).toContain('disabled');
    expect(h).toContain('Solo el dueño o el encargado');
  });
  it('la privacidad dice qué sale siempre y qué solo con permiso de la dueña', async () => {
    const h = html(await base());
    expect(h).toContain('data-testid="privacidad"');
    expect(h).toContain('licencia');
    expect(h).toContain('dueña de la flota');
  });
  it('los alias sin ligar tienen su lugar con una explicación honesta', async () => {
    expect(html(await base())).toContain('data-testid="alias"');
  });
  it('error de lectura, migración pendiente y horario ilegible se dicen en llano', async () => {
    const p = await base();
    expect(html({ ...p, config: null, errorLectura: 'No pude leer la configuración. Intenta de nuevo en un momento.' })).toContain('No pude leer la configuración');
    expect(html({ ...p, config: null, sinMigrar: true })).toContain('todavía no está lista');
    expect(html({ ...p, ventanaIlegible: true })).toContain('no se puede leer');
  });
});

describe('la página', () => {
  it('lee la configuración DE LA FLOTA de la sesión y no la de otra', async () => {
    tablas.datos.vigia_aviso_config = [
      { tenant_id: 't-sesion', habilitado: true, modo: 'autonomo', canal_default: 'cliente_1a1', ccp_listos: ['listo'], exigir_transito: true, secciones: ['EXPORTACION'], horas_antes_cita: 6, ventana_envio: { desde: '08:00', hasta: '20:00' }, max_reenvios: 4, debounce_min: 15 },
      { tenant_id: 't-otra', habilitado: false, modo: 'confirmar', canal_default: 'ejecutivo_copia', ccp_listos: [], exigir_transito: false, secciones: [], horas_antes_cita: null, ventana_envio: {}, max_reenvios: 9, debounce_min: 99 },
    ];
    tablas.datos.vigia_politica_datos = [
      { tenant_id: 't-sesion', cliente_id: null, campo: 'telefono', visible: true },
      { tenant_id: 't-otra', cliente_id: null, campo: 'licencia', visible: true },
      { tenant_id: 't-sesion', cliente_id: 'c1', campo: 'vigencia', visible: true },
    ];
    const p = await props();
    expect(p.config).toEqual({
      habilitado: true, modo: 'autonomo', canalDefault: 'cliente_1a1', ccpListos: ['listo'], exigirTransito: true, secciones: ['EXPORTACION'],
      horasAntesCita: 6, ventana: { desde: '08:00', hasta: '20:00' }, maxReenvios: 4, debounceMin: 15,
      operador: { licencia: false, vigencia: false, telefono: true },
    });
    expect(p.ventanaIlegible).toBe(false);
  });
  it('un horario guardado con otra forma se marca ilegible', async () => {
    tablas.datos.vigia_aviso_config = [{ tenant_id: 't-sesion', habilitado: true, ventana_envio: { desde: '8am', hasta: '20:00' }, ccp_listos: [], secciones: [] }];
    expect((await props()).ventanaIlegible).toBe(true);
  });
  it('un error de la base se dice en llano; la migración pendiente también', async () => {
    tablas.fallan.add('vigia_aviso_config:select');
    const p = await props();
    expect(p.config).toBeNull();
    expect(p.errorLectura).toContain('No pude leer');
    expect(logger.error).toHaveBeenCalled();
    tablas.codigoError = '42P01';
    expect((await props()).sinMigrar).toBe(true);
  });
  it('sin ?config=1 sigue siendo la bandeja (no la pantalla de configuración)', async () => {
    tablas.datos.vigia_aviso_config = [];
    const el = (await Pagina({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect((el.type as { name?: string }).name).not.toBe('VistaConfiguracionAviso');
  });
});

describe('validación en el servidor', () => {
  const casosMal: Array<[string, Record<string, string | string[] | null>, RegExp]> = [
    ['horas antes 49', { horas_antes: '49' }, /0 a 48/],
    ['horas antes negativas', { horas_antes: '-1' }, /0 a 48/],
    ['horas antes decimales', { horas_antes: '2.5' }, /0 a 48/],
    ['horas antes en notación científica', { horas_antes: '1e1' }, /0 a 48/],
    ['calma 0', { debounce_min: '0' }, /1 a 120/],
    ['calma 121', { debounce_min: '121' }, /1 a 120/],
    ['calma vacía', { debounce_min: '' }, /1 a 120/],
    ['calma ausente', { debounce_min: null }, /1 a 120/],
    ['reenvíos 11', { max_reenvios: '11' }, /0 a 10/],
    ['reenvíos negativos', { max_reenvios: '-1' }, /0 a 10/],
    ['reenvíos vacíos', { max_reenvios: '' }, /0 a 10/],
    ['horario con solo inicio', { ventana_desde: '08:00' }, /inicio y de fin/],
    ['horario con hora inválida', { ventana_desde: '25:00', ventana_hasta: '08:00' }, /inicio y de fin/],
    ['horario con inicio igual al fin', { ventana_desde: '08:00', ventana_hasta: '08:00' }, /no pueden ser la misma/],
    ['sin ningún CCP', { ccp: [] }, /al menos un estatus/],
    ['CCP desconocido', { ccp: ['listo', 'inventado'] }, /al menos un estatus/],
    ['sin secciones', { seccion: [] }, /al menos una sección/],
    ['sección CANCELACIONES', { seccion: ['IMPORTACION', 'CANCELACIONES'] }, /al menos una sección/],
    ['modo desconocido', { modo: 'automatico' }, /modo/],
    ['canal desconocido', { canal: 'sms' }, /canal/],
  ];
  it.each(casosMal)('rechaza %s y no escribe nada', async (_n, cambios, mensaje) => {
    const r = await guardar(forma(cambios));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(mensaje);
    expect(tablas.escrituras).toEqual([]);
    expect(anotarBitacora).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  const casosBien: Array<[string, Record<string, string | string[] | null>]> = [
    ['horas antes 0', { horas_antes: '0' }], ['horas antes 48', { horas_antes: '48' }], ['calma 1', { debounce_min: '1' }], ['calma 120', { debounce_min: '120' }],
    ['reenvíos 0', { max_reenvios: '0' }], ['reenvíos 10', { max_reenvios: '10' }],
    ['horario que cruza la medianoche', { ventana_desde: '22:00', ventana_hasta: '06:00' }],
  ];
  it.each(casosBien)('acepta %s en el borde', async (_n, cambios) => {
    const r = await guardar(forma({ habilitado: null, ...cambios }));
    expect(r).toMatchObject({ ok: true });
  });
});

describe('guardado, permisos y bitácora', () => {
  it('guarda en la flota de la SESIÓN y no lee un tenant_id del formulario', async () => {
    const r = await guardar([...forma({ horas_antes: '12', ventana_desde: '07:30', ventana_hasta: '21:00', max_reenvios: '5' }), ['tenant_id', 't-otra'], ['tenantId', 't-otra']]);
    expect(r).toMatchObject({ ok: true });
    expect(tablas.datos.vigia_aviso_config).toHaveLength(1);
    expect(filaConfig()).toMatchObject({
      tenant_id: 't-sesion', habilitado: true, modo: 'confirmar', canal_default: 'ejecutivo_copia', ccp_listos: ['despachado', 'listo'],
      secciones: ['EXPORTACION', 'IMPORTACION'], horas_antes_cita: 12, ventana_envio: { desde: '07:30', hasta: '21:00' }, max_reenvios: 5, debounce_min: 10,
      actualizado_por: 'u-sesion',
    });
    expect(filaConfig('t-otra')).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/agentes/vigia/avisos');
  });
  it('un horario vacío se guarda como «sin restricción» y las horas vacías como null', async () => {
    await guardar(forma({ horas_antes: '9' }));
    await guardar(forma({ horas_antes: '' }));
    expect(filaConfig()).toMatchObject({ horas_antes_cita: null, ventana_envio: {} });
  });
  it('es idempotente: la segunda vez no escribe ni anota nada', async () => {
    const campos = forma({ debounce_min: '20' });
    expect(await guardar(campos)).toMatchObject({ ok: true, mensaje: expect.stringContaining('Configuración guardada') });
    const n = tablas.escrituras.length;
    const veces = anotarBitacora.mock.calls.length;
    const otra = await guardar(campos);
    expect(otra).toMatchObject({ ok: true, mensaje: expect.stringContaining('No hay cambios') });
    expect(tablas.escrituras).toHaveLength(n);
    expect(anotarBitacora).toHaveBeenCalledTimes(veces);
    expect(tablas.datos.vigia_aviso_config).toHaveLength(1);
  });
  it('guardar los valores por defecto sin encender nada no crea una fila', async () => {
    const r = await guardar(forma({ habilitado: null }));
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('No hay cambios') });
    expect(tablas.escrituras).toEqual([]);
  });
  it('cada cambio deja bitácora con quién, rol y antes/después; sin datos personales', async () => {
    await guardar(forma({ modo: 'autonomo', max_reenvios: '5' }));
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
    const [entrada, opciones] = anotarBitacora.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(entrada).toMatchObject({
      tenantId: 't-sesion', actor: { id: 'u-sesion' }, accion: 'vigia_aviso_config.cambiar', entidad: 'vigia_aviso_config', entidadId: 't-sesion',
    });
    const detalle = entrada.detalle as { rol: string; cambios: Array<{ campo: string; antes: string; despues: string }> };
    expect(detalle.rol).toBe('encargado');
    expect(detalle.cambios).toEqual(expect.arrayContaining([
      { campo: 'habilitado', antes: 'no', despues: 'sí' }, { campo: 'modo', antes: 'confirmar', despues: 'autonomo' }, { campo: 'max_reenvios', antes: '3', despues: '5' },
    ]));
    expect(detalle.cambios.find((c) => c.campo === 'debounce_min')).toBeUndefined();
    expect(opciones).toMatchObject({ evento: expect.any(String) });
  });
  it('un segundo cambio anota el antes que dejó el primero', async () => {
    await guardar(forma({ max_reenvios: '5' }));
    await guardar(forma({ max_reenvios: '2' }));
    const detalle = (anotarBitacora.mock.calls[1] as unknown as [{ detalle: { cambios: Array<Record<string, string>> } }])[0].detalle;
    expect(detalle.cambios).toEqual([{ campo: 'max_reenvios', antes: '5', despues: '2' }]);
  });
  it('quien solo mira (o no tiene rol de decisión) no puede guardar', async () => {
    sesionComo('contador_ve');
    const r = await guardar(forma());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('dueño o el encargado') });
    expect(tablas.escrituras).toEqual([]);
    sesionComo('superadmin');
    expect(await guardar(forma())).toMatchObject({ ok: false });
    expect(tablas.escrituras).toEqual([]);
  });
  it('un fallo de la base se dice en llano y no deja bitácora de lo que no se guardó', async () => {
    tablas.fallan.add('vigia_aviso_config:upsert');
    const r = await guardar(forma());
    expect(r).toEqual({ ok: false, error: 'No se pudo guardar la configuración' });
    expect(anotarBitacora).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('vigia.aviso_config_fallo', expect.objectContaining({ tenant: 't-sesion' }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('si la migración no está aplicada lo dice sin culpar al usuario', async () => {
    tablas.codigoError = '42P01';
    tablas.fallan.add('vigia_aviso_config:select');
    const r = await guardar(forma());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('todavía no está lista') });
  });
});

describe('datos personales del operador (E6): solo la dueña', () => {
  it('el encargado que manda los controles de privacidad (petición armada a mano) es rechazado y no se guarda NADA', async () => {
    const r = await guardar([...forma(), ['op_licencia', '1']]);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Solo la dueña') });
    expect(tablas.escrituras).toEqual([]);
    expect(tablas.datos.vigia_politica_datos).toEqual([]);
    expect(anotarBitacora).not.toHaveBeenCalled();
    const r2 = await guardar([...forma(), ['op_presente', '1']]);
    expect(r2).toMatchObject({ ok: false });
  });
  it('el encargado guarda lo demás sin tocar la política del operador', async () => {
    tablas.datos.vigia_politica_datos = [{ id: 'p1', tenant_id: 't-sesion', cliente_id: null, campo: 'telefono', visible: true }];
    const r = await guardar(forma({ max_reenvios: '6' }));
    expect(r).toMatchObject({ ok: true });
    expect(tablas.datos.vigia_politica_datos).toEqual([{ id: 'p1', tenant_id: 't-sesion', cliente_id: null, campo: 'telefono', visible: true }]);
  });
  it('la dueña habilita el teléfono con constancia (quién y cuándo, en bitácora) y luego lo revoca sin duplicar filas', async () => {
    sesionComo('flota_admin');
    expect(await guardar([...forma({ habilitado: null }), ['op_presente', '1'], ['op_telefono', '1']])).toMatchObject({ ok: true });
    expect(tablas.datos.vigia_politica_datos).toEqual([
      expect.objectContaining({ tenant_id: 't-sesion', cliente_id: null, campo: 'telefono', visible: true, updated_by: 'u-sesion' }),
    ]);
    expect(tablas.datos.vigia_aviso_config).toEqual([]);
    const [entrada] = anotarBitacora.mock.calls[0] as unknown as [{ actor: { id: string }; detalle: { rol: string; cambios: unknown[] } }];
    expect(entrada.actor.id).toBe('u-sesion');
    expect(entrada.detalle.rol).toBe('flota_admin');
    expect(entrada.detalle.cambios).toEqual([{ campo: 'operador_telefono', antes: 'no', despues: 'sí' }]);

    expect(await guardar([...forma({ habilitado: null }), ['op_presente', '1']])).toMatchObject({ ok: true });
    expect(tablas.datos.vigia_politica_datos).toHaveLength(1);
    expect(tablas.datos.vigia_politica_datos[0]).toMatchObject({ campo: 'telefono', visible: false });
    expect(anotarBitacora).toHaveBeenCalledTimes(2);
  });
  it('si la dueña guarda sin la sección de privacidad (sin op_presente), la política no cambia', async () => {
    sesionComo('flota_admin');
    tablas.datos.vigia_politica_datos = [{ id: 'p1', tenant_id: 't-sesion', cliente_id: null, campo: 'licencia', visible: true }];
    await guardar(forma({ max_reenvios: '7' }));
    expect(tablas.datos.vigia_politica_datos[0]).toMatchObject({ campo: 'licencia', visible: true });
  });
  it('si la configuración falla después de guardar la política, lo hecho queda en la bitácora y se avisa el error', async () => {
    sesionComo('flota_admin');
    tablas.fallan.add('vigia_aviso_config:upsert');
    const r = await guardar([...forma(), ['op_presente', '1'], ['op_vigencia', '1']]);
    expect(r).toMatchObject({ ok: false });
    expect(tablas.datos.vigia_politica_datos).toHaveLength(1);
    const [entrada] = anotarBitacora.mock.calls[0] as unknown as [{ detalle: { cambios: Array<{ campo: string }> } }];
    expect(entrada.detalle.cambios.map((c) => c.campo)).toEqual(['operador_vigencia']);
  });
  it('ningún valor de licencia, vigencia o teléfono viaja a la bitácora ni al log', async () => {
    sesionComo('flota_admin');
    await guardar([...forma(), ['op_presente', '1'], ['op_licencia', '1'], ['op_vigencia', '1'], ['op_telefono', '1']]);
    const todo = JSON.stringify([anotarBitacora.mock.calls, logger.info.mock.calls, logger.error.mock.calls]);
    expect(todo).not.toMatch(/\d{10}/);
  });
});

// ── INTEGRACIÓN: lo guardado se ve en el siguiente `generarAvisos` ─────────────────────────────────────────────────
describe('el valor nuevo rige en el siguiente generarAvisos', () => {
  const T = 't-sesion';
  const AHORA = new Date('2026-10-05T14:00:00Z'); // 08:00 en Ciudad de México
  const fila = (o: Partial<FilaDelPrograma> = {}): FilaDelPrograma => ({
    id: '20000000-0000-4000-8000-000000000001', fecha: '2026-10-05', tipo: 'EXPORTACION', cliente: 'Cliente Uno', consignatario: null,
    caja: 'CJ-1', unidad: 'U-101', citaEn: '2026-10-05T20:00:00Z', citaTexto: null, transito: 'patio_nld', ccp: 'despachado', ...o,
  });
  function resolver(): DepsResolver {
    return {
      tenantId: T,
      aliasDe: async () => [{ tenantId: T, textoNormalizado: normalizarAlias('Cliente Uno'), clienteId: 'c1', campo: 'cliente' as const }],
      contactosDeCliente: async () => [{ id: 'ct-1', tenantId: T, clienteId: 'c1', telefono: '5252899900001', nombre: 'Contacto Uno', gerenteUserId: null, estado: 'activo', consentimientoEn: '2026-09-01T00:00:00Z', optoutEn: null, avisoPrivacidadEn: null }],
      unidadesPorNumero: async (n: string) => [{ tenantId: T, id: 'u-1', numero: n, placas: 'AAA-111' }],
      cajaPorNumero: async (n: string) => ({ tenantId: T, numero: n, placas: 'BBB-222', estado: 'cargada' }),
      operadorDeUnidad: async () => null,
      datoManual: async () => null,
    } as unknown as DepsResolver;
  }
  /** La configuración la lee el repo REAL (contra el doble de base); lo demás es memoria. */
  function repoConConfigReal(filas: FilaDelPrograma[]) {
    const real = crearRepoAviso();
    const creados: NuevoAviso[] = [];
    const repo: RepoAviso = {
      leerConfig: real.leerConfig,
      async filasVisibles() { return filas; },
      async avisosDeFilas(): Promise<AvisoExistente[]> { return []; },
      async insertarAviso(_t, a) { creados.push(a); return 'creado'; },
    };
    return { repo, creados };
  }

  it('al agregar «despachado» a los CCP que cuentan como listo, la fila despachada deja de ser «no lista»', async () => {
    sesionComo('flota_admin');
    await guardar(forma({ ccp: ['listo'] }));
    const antes = repoConConfigReal([fila()]);
    const r1 = await generarAvisos(T, AHORA, { repo: antes.repo, resolver: resolver() });
    expect(r1).toMatchObject({ estado: 'ok', noListas: 1, creados: 0 });

    expect(await guardar(forma({ ccp: ['listo', 'despachado'] }))).toMatchObject({ ok: true });
    const despues = repoConConfigReal([fila()]);
    const r2 = await generarAvisos(T, AHORA, { repo: despues.repo, resolver: resolver() });
    expect(r2).toMatchObject({ estado: 'ok', noListas: 0, creados: 1, pendientesConfirmacion: 1 });
    expect(despues.creados[0].estado).toBe('pendiente_confirmacion');
  });
  it('apagar el aviso lo apaga en la siguiente pasada; encenderlo lo vuelve a armar', async () => {
    await guardar(forma());
    const encendido = repoConConfigReal([fila()]);
    expect((await generarAvisos(T, AHORA, { repo: encendido.repo, resolver: resolver() })).creados).toBe(1);
    await guardar(forma({ habilitado: null }));
    const apagado = repoConConfigReal([fila()]);
    expect(await generarAvisos(T, AHORA, { repo: apagado.repo, resolver: resolver() })).toMatchObject({ estado: 'apagado', creados: 0 });
  });
  it('las horas antes de la cita cambian cuándo se arma el aviso', async () => {
    await guardar(forma({ horas_antes: '2' }));
    const temprano = repoConConfigReal([fila()]); // la cita es en 6 h
    expect(await generarAvisos(T, AHORA, { repo: temprano.repo, resolver: resolver() })).toMatchObject({ muyTemprano: 1, creados: 0 });
    await guardar(forma({ horas_antes: '8' }));
    const a_tiempo = repoConConfigReal([fila()]);
    expect(await generarAvisos(T, AHORA, { repo: a_tiempo.repo, resolver: resolver() })).toMatchObject({ muyTemprano: 0, creados: 1 });
  });
  it('el modo y el canal guardados llegan al aviso: con «confirmar» nada queda aprobado solo', async () => {
    await guardar(forma({ canal: 'cliente_1a1', modo: 'confirmar' }));
    const { repo, creados } = repoConConfigReal([fila()]);
    await generarAvisos(T, AHORA, { repo, resolver: resolver() });
    expect(creados[0]).toMatchObject({ canal: 'cliente_1a1', estado: 'pendiente_confirmacion' });
  });
});
