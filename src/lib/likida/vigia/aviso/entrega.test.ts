import { describe, it, expect, vi, beforeEach } from 'vitest';

// La entrega del aviso con dobles de `Enviador` (el selector real de Meta nunca se toca) y una bandeja en memoria que
// respeta lo que garantiza la 0797: reclamo exclusivo, cierre solo con el token, `fallido` no se reclama solo.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { entregarAviso, ventanaPermite, parametrosDelAviso } = await import('./entrega');
const { PLANTILLA, plantillaDeCatalogo, textoRenderizado } = await import('@/lib/meta/plantillas_catalogo');
const { T1, T2 } = await import('../datos.fixture');
import type { AvisoParaEntrega, ContextoEntrega, DepsEntrega } from './entrega';
import type { Contacto } from '../tipos';

type Op = Parameters<NonNullable<DepsEntrega['enviar']>>[1];

const AHORA = new Date('2026-10-02T15:00:00Z'); // 09:00 en Ciudad de México (UTC-6, sin horario de verano)

const contacto = (c: Partial<Contacto> = {}): Contacto => ({
  id: 'ct-1', tenantId: T1, clienteId: 'cl-1', telefono: '522899900001', nombre: 'Contacto Demo', gerenteUserId: null,
  estado: 'activo', consentimientoEn: '2026-09-01T00:00:00Z', optoutEn: null, avisoPrivacidadEn: '2026-09-01T00:00:00Z', ...c,
});

const aviso = (c: Partial<AvisoParaEntrega> = {}): AvisoParaEntrega => ({
  id: 'av-1', tenantId: T1, filaId: 'fila-1', clienteId: 'cl-1', version: 1, estado: 'aprobado', canal: 'cliente_1a1',
  texto: 'Datos de la unidad asignada a tu viaje:\nCaja: CJ-101',
  datos: {
    valores: { caja: 'CJ-101', placas_caja: '11AA22', unidad: 'U-101', placas_unidad: '33BB44', operador_nombre: 'Operador Demo' },
    cita: '2026-10-02T13:00:00Z',
  },
  ...c,
});

const ctx = (c: Partial<ContextoEntrega> = {}): ContextoEntrega => ({
  agenteHabilitado: true, avisoHabilitado: true, nombreFlota: 'Transportes del Norte', ventanaEnvio: {}, zona: 'America/Mexico_City',
  telefonoEjecutivo: '522899900002', urlBandeja: 'https://app.ejemplo.test/avisos', ...c,
});

/** Bandeja en memoria con las garantías de la 0797. */
function montar(opts: { ctx?: Partial<ContextoEntrega>; contacto?: Contacto | null; respuesta?: unknown } = {}) {
  const estado = { reclamado: false, token: null as string | null, cerrado: null as null | { estado: string; error?: string } };
  const enviadas: Array<{ telefono: string; op: Op }> = [];
  const respuesta = opts.respuesta ?? { ok: true, via: 'texto', id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' };
  const deps: DepsEntrega = {
    tenantId: T1,
    ahora: () => AHORA,
    contexto: async () => ctx(opts.ctx),
    reclamar: vi.fn(async () => {
      if (estado.reclamado || estado.cerrado) return null;
      estado.reclamado = true; estado.token = 'tok-1';
      return { token: 'tok-1' };
    }),
    cerrar: vi.fn(async (_id: string, token: string, e: 'enviado' | 'fallido', error?: string) => {
      if (token !== estado.token || estado.cerrado) return false;
      estado.cerrado = { estado: e, error };
      return true;
    }),
    contactoDeCliente: vi.fn(async () => (opts.contacto === undefined ? contacto() : opts.contacto)),
    enviar: vi.fn(async (telefono: string, op: Op) => { enviadas.push({ telefono, op }); return respuesta as never; }),
  };
  return { deps, estado, enviadas };
}

beforeEach(() => vi.clearAllMocks());

describe('canal cliente_1a1: las puertas de enviarAlCliente se conservan', () => {
  it('contacto SIN consentimiento → fallido con motivo llano y nada sale', async () => {
    const m = montar({ contacto: contacto({ consentimientoEn: null }) });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toMatchObject({ estado: 'fallido', motivo: 'sin_consentimiento' });
    expect(m.enviadas).toHaveLength(0);
    expect(m.estado.cerrado?.estado).toBe('fallido');
    expect(m.estado.cerrado?.error).toMatch(/consentimiento/);
  });

  it.each([
    ['baja por estado', { estado: 'baja' as const }],
    ['baja por opt-out', { optoutEn: '2026-09-30T00:00:00Z' }],
  ])('contacto con %s → no envía', async (_n, cambio) => {
    const m = montar({ contacto: contacto(cambio) });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toMatchObject({ estado: 'fallido', motivo: 'con_baja' });
    expect(m.enviadas).toHaveLength(0);
  });

  it('contacto de OTRA flota → no envía', async () => {
    const m = montar({ contacto: contacto({ tenantId: T2 }) });
    expect(await entregarAviso(aviso(), m.deps)).toMatchObject({ estado: 'fallido', motivo: 'contacto_no_activo' });
    expect(m.enviadas).toHaveLength(0);
  });

  it('cliente sin contacto o aviso sin cliente → fallido sin_destinatario', async () => {
    const a = montar({ contacto: null });
    expect(await entregarAviso(aviso(), a.deps)).toMatchObject({ estado: 'fallido', motivo: 'sin_destinatario' });
    const b = montar();
    expect(await entregarAviso(aviso({ clienteId: null }), b.deps)).toMatchObject({ estado: 'fallido', motivo: 'sin_destinatario' });
    expect(a.enviadas.length + b.enviadas.length).toBe(0);
  });

  it('dentro de la ventana el texto del aviso sale tal cual; la plantilla de respaldo es la del aviso de viaje', async () => {
    const m = montar();
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toEqual({ estado: 'enviado', via: 'texto' });
    expect(m.enviadas).toHaveLength(1);
    const { telefono, op } = m.enviadas[0];
    expect(telefono).toBe('522899900001');
    expect(op.texto).toContain('Caja: CJ-101');
    expect(op.plantilla.nombre).toBe(PLANTILLA.vigiaAvisoViaje);
    expect(op.tenantId).toBe(T1);
    expect(m.estado.cerrado).toEqual({ estado: 'enviado', error: undefined });
  });

  it('fuera de 24 h sale la plantilla con las 5 variables (flota, caja, unidad, operador, cita)', async () => {
    const m = montar({ respuesta: { ok: true, via: 'plantilla', id: 'wamid.P', motivo: 'ventana_cerrada', ventana: 'cerrada' } });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toEqual({ estado: 'enviado', via: 'plantilla' });
    const parametros = (m.enviadas[0].op.plantilla as { parametros?: string[] }).parametros;
    expect(parametros).toEqual([
      'Transportes del Norte', 'caja CJ-101, placas 11AA22', 'unidad U-101, placas 33BB44', 'Operador Demo', '02/10/2026 07:00',
    ]);
    expect(textoRenderizado(PLANTILLA.vigiaAvisoViaje, parametros ?? [])).toContain('para tu cita del 02/10/2026 07:00');
  });

  it('un reenvío (versión 2) usa la plantilla de CAMBIO', async () => {
    const m = montar();
    await entregarAviso(aviso({ version: 2 }), m.deps);
    expect(m.enviadas[0].op.plantilla.nombre).toBe(PLANTILLA.vigiaAvisoCambio);
    expect(plantillaDeCatalogo(PLANTILLA.vigiaAvisoCambio)).toBeDefined();
  });

  it('fuera de 24 h SIN plantilla aprobada (132001) → fallido fail-closed, registrado, sin texto de respaldo desde aquí', async () => {
    const m = montar({ respuesta: {
      ok: false, motivo: 'plantilla_rechazada', mensaje: 'rechazo', codigo: 132001, fueraDeVentana: true, reintentable: false, ventana: 'cerrada',
    } });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toMatchObject({ estado: 'fallido', motivo: 'plantilla_no_aprobada' });
    expect(m.enviadas).toHaveLength(1); // un intento al selector, nunca un segundo envío libre
    expect(m.estado.cerrado?.estado).toBe('fallido');
    expect(m.estado.cerrado?.error).toMatch(/132001/);
  });

  it('otro rechazo de Meta → fallido con su motivo y SIN reintento: fallido no se reclama solo', async () => {
    const m = montar({ respuesta: {
      ok: false, motivo: 'rechazo_no_ventana', mensaje: 'WhatsApp rechazó el número', codigo: 131026, fueraDeVentana: false, reintentable: true, ventana: 'abierta',
    } });
    expect(await entregarAviso(aviso(), m.deps)).toMatchObject({ estado: 'fallido', motivo: 'rechazado_por_meta' });
    // la segunda pasada del cron ya no puede reclamarlo
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'perdido' });
    expect(m.enviadas).toHaveLength(1);
  });

  it('el error guardado nunca pasa de 200 caracteres', async () => {
    const m = montar({ respuesta: {
      ok: false, motivo: 'rechazo_no_ventana', mensaje: 'x'.repeat(900), fueraDeVentana: false, reintentable: false, ventana: 'abierta',
    } });
    await entregarAviso(aviso(), m.deps);
    expect((m.estado.cerrado?.error ?? '').length).toBeLessThanOrEqual(200);
  });

  it('si el envío lanza una excepción el aviso se cierra fallido (no queda trabado)', async () => {
    const m = montar();
    m.deps.enviar = vi.fn(async () => { throw new Error('boom con datos internos'); });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toMatchObject({ estado: 'fallido', motivo: 'error_inesperado' });
    expect(m.estado.cerrado?.error).not.toMatch(/boom/);
  });

  it('A37-S62-03: si el cierre lanza DESPUÉS de enviar, se reintenta y nunca se marca fallido', async () => {
    const m = montar();
    m.deps.esperaCierreMs = 0;
    const real = m.deps.cerrar;
    let n = 0;
    m.deps.cerrar = vi.fn(async (...a: Parameters<typeof real>) => { if (++n < 3) throw new Error('blip'); return real(...a); });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toMatchObject({ estado: 'enviado' });
    expect(m.enviadas).toHaveLength(1);
    expect(m.estado.cerrado?.estado).toBe('enviado');
  });

  it('A37-S62-03: si el cierre sigue fallando, no se cierra como «fallido» ni se reenvía en la misma pasada', async () => {
    const m = montar();
    m.deps.esperaCierreMs = 0;
    m.deps.cerrar = vi.fn(async () => { throw new Error('blip'); });
    const r = await entregarAviso(aviso(), m.deps);
    expect(r).toMatchObject({ estado: 'arriendo_perdido' });
    expect(m.enviadas).toHaveLength(1);
    expect(m.deps.cerrar).toHaveBeenCalledTimes(3);
    expect(m.deps.cerrar).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'fallido', expect.anything());
  });

  it('un aviso de OTRA flota lanza (nunca se entrega)', async () => {
    const m = montar();
    await expect(entregarAviso(aviso({ tenantId: T2 }), m.deps)).rejects.toThrow(/otra flota/);
    expect(m.enviadas).toHaveLength(0);
  });
});

describe('doble toque y reejecución', () => {
  it('dos entregas simultáneas del mismo aviso → un solo envío', async () => {
    const m = montar();
    const [a, b] = await Promise.all([entregarAviso(aviso(), m.deps), entregarAviso(aviso(), m.deps)]);
    expect([a.estado, b.estado].sort()).toEqual(['enviado', 'perdido']);
    expect(m.enviadas).toHaveLength(1);
  });

  it('ejecutarlo otra vez cuando ya salió no duplica', async () => {
    const m = montar();
    await entregarAviso(aviso(), m.deps);
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'perdido' });
    expect(m.enviadas).toHaveLength(1);
  });

  it('un aviso que no está aprobado ni se reclama', async () => {
    const m = montar();
    for (const estado of ['pendiente_confirmacion', 'enviado', 'fallido', 'descartado'] as const) {
      expect(await entregarAviso(aviso({ estado }), m.deps)).toEqual({ estado: 'omitido', motivo: 'aviso_no_aprobado' });
    }
    expect(m.deps.reclamar).not.toHaveBeenCalled();
    expect(m.enviadas).toHaveLength(0);
  });

  it('si el arriendo se perdió al cerrar, lo dice y no finge éxito', async () => {
    const m = montar();
    m.deps.cerrar = vi.fn(async () => false);
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'arriendo_perdido' });
  });
});

describe('kill switch y ventana de envío: no consumen el aviso', () => {
  it('agente apagado → omitido, sin reclamar ni enviar', async () => {
    const m = montar({ ctx: { agenteHabilitado: false } });
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'omitido', motivo: 'agente_apagado' });
    expect(m.deps.reclamar).not.toHaveBeenCalled();
    expect(m.enviadas).toHaveLength(0);
  });

  it('aviso apagado para la flota → omitido', async () => {
    const m = montar({ ctx: { avisoHabilitado: false } });
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'omitido', motivo: 'aviso_apagado' });
    expect(m.deps.reclamar).not.toHaveBeenCalled();
  });

  it('de madrugada (fuera de la ventana) → diferido, el aviso sigue aprobado', async () => {
    const m = montar({ ctx: { ventanaEnvio: { desde: '10:00', hasta: '20:00' } } }); // son las 09:00 locales
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'diferido', motivo: 'fuera_de_ventana' });
    expect(m.deps.reclamar).not.toHaveBeenCalled();
    expect(m.enviadas).toHaveLength(0);
  });

  it('una ventana ilegible falla cerrado', async () => {
    const m = montar({ ctx: { ventanaEnvio: { desde: 'temprano' } } });
    expect(await entregarAviso(aviso(), m.deps)).toEqual({ estado: 'diferido', motivo: 'ventana_ilegible' });
  });

  it('dentro de la ventana sí sale', async () => {
    const m = montar({ ctx: { ventanaEnvio: { desde: '08:00', hasta: '20:00' } } });
    expect(await entregarAviso(aviso(), m.deps)).toMatchObject({ estado: 'enviado' });
  });
});

describe('ventanaPermite (pura)', () => {
  const v = (x: unknown, h = AHORA) => ventanaPermite(x, h, 'America/Mexico_City');
  it('{} = sin restricción', () => expect(v({})).toBe('si'));
  it('rango normal', () => {
    expect(v({ desde: '08:00', hasta: '20:00' })).toBe('si');
    expect(v({ desde: '09:01', hasta: '20:00' })).toBe('no');
    expect(v({ desde: '07:00', hasta: '09:00' })).toBe('no'); // hasta es exclusivo
  });
  it('rango que cruza la medianoche', () => {
    expect(v({ desde: '22:00', hasta: '10:00' })).toBe('si');
    expect(v({ desde: '22:00', hasta: '06:00' })).toBe('no');
  });
  it('formas ilegibles', () => {
    for (const x of [null, [], 'si', { desde: '08:00' }, { desde: '08:00', hasta: '08:00' }, { desde: '25:00', hasta: '26:00' }, { desde: '08:00', hasta: '20:00', otro: 1 }]) {
      expect(v(x)).toBe('ilegible');
    }
  });
  it('usa la zona de la flota, no la del servidor', () => {
    expect(ventanaPermite({ desde: '15:00', hasta: '16:00' }, AHORA, 'UTC')).toBe('si');
    expect(ventanaPermite({ desde: '15:00', hasta: '16:00' }, AHORA, 'America/Mexico_City')).toBe('no');
  });
});

describe('canal ejecutivo_copia', () => {
  const av = () => aviso({ canal: 'ejecutivo_copia' });

  it('«Copiar y marcar enviado» deja el aviso enviado SIN tocar a Meta', async () => {
    const m = montar();
    const r = await entregarAviso(av(), m.deps, 'copiar');
    expect(r).toEqual({ estado: 'enviado', via: 'copia_manual' });
    expect(m.estado.cerrado?.estado).toBe('enviado');
    expect(m.enviadas).toHaveLength(0);
    expect(m.deps.contactoDeCliente).not.toHaveBeenCalled();
  });

  it('copiar dos veces (doble clic) → un solo cierre', async () => {
    const m = montar();
    const [a, b] = await Promise.all([entregarAviso(av(), m.deps, 'copiar'), entregarAviso(av(), m.deps, 'copiar')]);
    expect([a.estado, b.estado].sort()).toEqual(['enviado', 'perdido']);
    expect(m.deps.cerrar).toHaveBeenCalledTimes(1);
  });

  it('copiar no depende del kill switch ni de la ventana (no sale nada del sistema)', async () => {
    const m = montar({ ctx: { agenteHabilitado: false, ventanaEnvio: { desde: '10:00', hasta: '11:00' } } });
    expect(await entregarAviso(av(), m.deps, 'copiar')).toEqual({ estado: 'enviado', via: 'copia_manual' });
  });

  it('«copiar» sobre un aviso de canal 1:1 es un error de uso, no un cierre', async () => {
    const m = montar();
    await expect(entregarAviso(aviso(), m.deps, 'copiar')).rejects.toThrow(/ejecutivo_copia/);
    expect(m.deps.reclamar).not.toHaveBeenCalled();
  });

  it('el automático NO toca al cliente: sin aviso al ejecutivo configurado no manda nada y deja el aviso aprobado', async () => {
    const m = montar();
    expect(await entregarAviso(av(), m.deps)).toEqual({ estado: 'omitido', motivo: 'sin_telefono_ejecutivo' });
    expect(m.enviadas).toHaveLength(0);
    expect(m.deps.contactoDeCliente).not.toHaveBeenCalled();
    expect(m.deps.reclamar).not.toHaveBeenCalled();
  });

  it('con teléfono del ejecutivo manda el texto a ÉL (aviso_operacion_v1), no al cliente, y no cambia el estado', async () => {
    const m = montar();
    const vistos = new Set<string>();
    m.deps.reservarAvisoAlEjecutivo = vi.fn(async (id: string, v: number) => { const k = `${id}:${v}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
    const r = await entregarAviso(av(), m.deps);
    expect(r).toEqual({ estado: 'avisado_ejecutivo', via: 'texto' });
    expect(m.enviadas).toHaveLength(1);
    expect(m.enviadas[0].telefono).toBe('522899900002');
    expect(m.enviadas[0].op.plantilla.nombre).toBe(PLANTILLA.avisoOperacion);
    expect(m.enviadas[0].op.texto).toContain('Caja: CJ-101');
    expect(m.deps.contactoDeCliente).not.toHaveBeenCalled();
    expect(m.deps.reclamar).not.toHaveBeenCalled();
    expect(m.estado.cerrado).toBeNull();
    // segunda pasada del cron: no repite el aviso a la oficina
    expect(await entregarAviso(av(), m.deps)).toEqual({ estado: 'omitido', motivo: 'ya_avisado' });
    expect(m.enviadas).toHaveLength(1);
  });

  it('el aviso al ejecutivo respeta el kill switch y la ventana', async () => {
    const a = montar({ ctx: { agenteHabilitado: false } });
    a.deps.reservarAvisoAlEjecutivo = vi.fn(async () => true);
    expect(await entregarAviso(av(), a.deps)).toEqual({ estado: 'omitido', motivo: 'agente_apagado' });
    const b = montar({ ctx: { ventanaEnvio: { desde: '10:00', hasta: '11:00' } } });
    b.deps.reservarAvisoAlEjecutivo = vi.fn(async () => true);
    expect(await entregarAviso(av(), b.deps)).toEqual({ estado: 'diferido', motivo: 'fuera_de_ventana' });
    expect(a.enviadas.length + b.enviadas.length).toBe(0);
    expect(a.deps.reservarAvisoAlEjecutivo).not.toHaveBeenCalled();
  });

  it('un teléfono de ejecutivo mal formado no se usa', async () => {
    const m = montar({ ctx: { telefonoEjecutivo: '55-1234' } });
    m.deps.reservarAvisoAlEjecutivo = vi.fn(async () => true);
    expect(await entregarAviso(av(), m.deps)).toEqual({ estado: 'omitido', motivo: 'sin_telefono_ejecutivo' });
    expect(m.enviadas).toHaveLength(0);
  });
});

describe('privacidad en la plantilla', () => {
  it('licencia, vigencia y teléfono del operador NO viajan aunque estén en datos por error', () => {
    const p = parametrosDelAviso({
      datos: { valores: { caja: 'CJ-101', operador_nombre: 'Operador Demo', licencia: 'LIC-SECRETA', vigencia: '2030-01-01', telefono_operador: '522899900009' }, cita: null },
    }, 'Flota Demo', 'America/Mexico_City');
    const todo = p.join(' | ');
    expect(todo).not.toMatch(/LIC-SECRETA|2030|522899900009/);
    expect(p).toHaveLength(5);
  });

  it('lo que falta se marca «por confirmar»; no se inventa ni se toma de otra parte', () => {
    expect(parametrosDelAviso({ datos: {} }, 'Flota Demo', 'America/Mexico_City'))
      .toEqual(['Flota Demo', 'por confirmar', 'por confirmar', 'por confirmar', 'por confirmar']);
  });

  it('un operador oculto por política (sin operador_nombre) sale «por confirmar», no vacío', () => {
    const p = parametrosDelAviso({ datos: { valores: { caja: 'CJ-1', unidad: 'U-1' } } }, 'F', 'America/Mexico_City');
    expect(p[3]).toBe('por confirmar');
    expect(p[1]).toBe('caja CJ-1');
  });

  it('las variables caben en la plantilla del catálogo (5 variables)', () => {
    const p = parametrosDelAviso(aviso(), 'Transportes del Norte', 'America/Mexico_City');
    expect(p).toHaveLength(5);
    expect(() => textoRenderizado(PLANTILLA.vigiaAvisoViaje, p)).not.toThrow();
  });
});
