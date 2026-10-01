import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { correrConductor, escalarPorProblema, TOPE_RECHAZOS_SEGUIDOS } = await import('./ejecutor');
const { crearPuertos } = await import('./memoria.fixture');
const { hitoVacio, viajeBase } = await import('./memoria.fixture');
const { TIPOS_HITO } = await import('./tipos');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
type Hito = import('./tipos').HitoFila;

const mx = (hhmm: string, dia = '2026-10-02') => new Date(`${dia}T${hhmm}:00-06:00`);

/** Cinco hitos para el viaje `v` (ids `${v}-0..4`). */
function hitosDe(v: string, tenantId = 't1', over: Record<number, Partial<Hito>> = {}): Hito[] {
  return TIPOS_HITO.map((tipo, i) => hitoVacio({ id: `${v}-${i}`, tipo, viajeId: v, tenantId, ...(over[i] ?? {}) }));
}
const viaje = (id: string, extra: Record<string, unknown> = {}) => viajeBase({
  id, folio: `F-${id}`, operadorId: `o-${id}`, operadorTelefono: `52999000${id.replace(/\D/g, '').padStart(4, '0')}`,
  citaOrigenEn: mx('08:00').toISOString(), aceptadoEn: mx('12:00', '2026-10-01').toISOString(), ...extra,
});

describe('pedir: la solicitud sale una sola vez', () => {
  it('en el ancla manda la solicitud con botones y la plantilla del catálogo como respaldo', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r.solicitudes).toBe(1);
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]).toMatchObject({ plantilla: 'conductor_solicitud_llegada_carga_v1', contexto: 'conductor.solicitud', tenantId: 't1' });
    expect(m.enviados[0].texto).toContain('F-v1');
    expect(m.enviados[0].texto).toContain('Planta Zapopan');
    expect(m.enviados[0].botones).toEqual(['hito_llegada_carga:v1', 'hito_retraso_carga:v1', 'pedir_ubicacion:v1']);
    // El hito quedó anotado como solicitado.
    expect(m.hitos.get('v1-0')).toMatchObject({ recordatoriosEnviados: 1 });
    expect(m.hitos.get('v1-0')?.solicitadoEn).not.toBeNull();
  });

  it('una segunda corrida en el mismo minuto NO duplica el WhatsApp', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    await correrConductor(m.puertos, { ahora: mx('07:30') });
    const r2 = await correrConductor(m.puertos, { ahora: mx('07:31') });
    expect(r2.solicitudes + r2.recordatorios).toBe(0);
    expect(m.enviados).toHaveLength(1);
  });

  it('DOS corridas SOLAPADAS (cron at-least-once) mandan UN solo mensaje: el claim decide', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    const [a, b] = await Promise.all([
      correrConductor(m.puertos, { ahora: mx('07:30') }),
      correrConductor(m.puertos, { ahora: mx('07:30') }),
    ]);
    expect(m.enviados).toHaveLength(1);
    expect(a.solicitudes + b.solicitudes).toBe(1);
    expect(a.yaReclamados + b.yaReclamados).toBe(1);
  });

  it('antes del ancla no manda nada', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    const r = await correrConductor(m.puertos, { ahora: mx('07:00') });
    expect(m.enviados).toHaveLength(0);
    expect(r.saltados.no_toca).toBe(1);
  });

  it('reporta cuántos hitos sembró y cuántos viajes miró', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    m.definirSembrados(7);
    const r = await correrConductor(m.puertos, { ahora: mx('07:00') });
    expect(r).toMatchObject({ sembrados: 7, viajes: 1 });
  });
});

describe('perseguir: la escalera avanza de nivel en nivel', () => {
  it('0 → +15 → +30 → +45 con las plantillas 1, 2 y 3', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    for (const h of ['07:30', '07:45', '08:00', '08:15']) await correrConductor(m.puertos, { ahora: mx(h) });
    expect(m.enviados.map((e) => e.plantilla)).toEqual([
      'conductor_solicitud_llegada_carga_v1', 'conductor_recordatorio_1_v1', 'conductor_recordatorio_2_v1', 'conductor_recordatorio_3_v1',
    ]);
    expect(m.enviados[2].texto).toContain('desde hace 30 minutos');
    expect(m.enviados[3].texto).toContain('último aviso antes de avisar a tu jefe de tráfico');
  });

  it('con el cron caído manda solo el nivel vencido más alto, no los tres de golpe', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1') });
    await correrConductor(m.puertos, { ahora: mx('07:30') });
    const r = await correrConductor(m.puertos, { ahora: mx('08:20') });
    expect(r.recordatorios).toBe(1);
    expect(m.enviados.at(-1)?.plantilla).toBe('conductor_recordatorio_3_v1');
  });

  it('con el hito ya registrado por el chofer deja de perseguirlo y pide el siguiente', async () => {
    const hs = hitosDe('v1', 't1', { 0: { estado: 'recibido', fuente: 'texto', mensajeEn: mx('07:40').toISOString(), recibidoEn: mx('07:40').toISOString() } });
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hs });
    await correrConductor(m.puertos, { ahora: mx('09:40') });
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0].plantilla).toBe('conductor_salida_carga_v1');
  });

  it('nunca de madrugada: fuera de la ventana no manda ni reclama', async () => {
    const v = viaje('v1', { citaOrigenEn: mx('02:00').toISOString() });
    const m = crearPuertos({ viajes: [v], hitos: hitosDe('v1') });
    const r = await correrConductor(m.puertos, { ahora: mx('03:00') });
    expect(m.enviados).toHaveLength(0);
    expect(m.reclamos.size).toBe(0);
    expect(r.saltados.fuera_de_ventana).toBe(1);
  });

  it('el tope diario por chofer cuenta lo ya mandado hoy', async () => {
    const previos = Array.from({ length: 12 }, (_, i) => ({ hitoId: 'otro', clase: 'recordatorio' as const, nivel: i, ciclo: 1, operadorId: 'o-v1', creado: mx('06:30') }));
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: previos });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(m.enviados).toHaveLength(0);
    expect(r.saltados.tope_diario).toBe(1);
  });

  it('el tope diario también se respeta DENTRO de la corrida (varios viajes del mismo chofer)', async () => {
    const cfgTope = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [0, 15, 30, 45], topeDiarioChofer: 1 };
    const v1 = viaje('v1', { operadorId: 'mismo' });
    const v2 = viaje('v2', { operadorId: 'mismo', operadorTelefono: '529990009999' });
    const m = crearPuertos({ viajes: [v1, v2], hitos: [...hitosDe('v1'), ...hitosDe('v2')], configs: { t1: cfgTope } });
    await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(m.enviados).toHaveLength(1);
  });
});

describe('fallos de envío', () => {
  it('un rechazo REINTENTABLE (429) libera el claim: la corrida siguiente lo reintenta', async () => {
    let falla = true;
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), envio: () => (falla ? { ok: false, reintentable: true, mensaje: '429' } : { ok: true, via: 'texto' }) });
    const r1 = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r1.rechazosReintentables).toBe(1);
    expect(m.reclamos.size).toBe(0);
    falla = false;
    const r2 = await correrConductor(m.puertos, { ahora: mx('07:35') });
    expect(r2.solicitudes).toBe(1);
  });

  it('un rechazo NO reintentable (plantilla sin aprobar) deja el claim con el motivo y avanza: no se repite cada 5 minutos', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), envio: () => ({ ok: false, reintentable: false, mensaje: 'plantilla no aprobada' }) });
    const r1 = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r1.fallos[0]).toContain('plantilla no aprobada');
    expect([...m.reclamos.values()][0]).toMatchObject({ ok: false, motivo: 'plantilla no aprobada' });
    const r2 = await correrConductor(m.puertos, { ahora: mx('07:35') });
    expect(r2.solicitudes + r2.recordatorios).toBe(0);
  });

  it(`${TOPE_RECHAZOS_SEGUIDOS} rechazos reintentables seguidos paran la corrida (es Meta diciendo «hoy no»)`, async () => {
    const vs = Array.from({ length: 8 }, (_, i) => viaje(`v${i + 1}`));
    const m = crearPuertos({ viajes: vs, hitos: vs.flatMap((v) => hitosDe(v.id)), envio: () => ({ ok: false, reintentable: true, mensaje: 'bloqueo temporal' }) });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r.cortadaPorRechazoMasivo).toBe(true);
    expect(r.rechazosReintentables).toBe(TOPE_RECHAZOS_SEGUIDOS);
    expect(r.cortadosPorReloj).toBe(8 - TOPE_RECHAZOS_SEGUIDOS);
    expect(m.reclamos.size).toBe(0); // todo quedó sin reclamar para la siguiente
  });

  it('un viaje que revienta no tumba el lote', async () => {
    const vs = [viaje('v1'), viaje('v2')];
    const m = crearPuertos({ viajes: vs, hitos: vs.flatMap((v) => hitosDe(v.id)), envio: (e) => { if (e.texto.includes('F-v1')) throw new Error('boom'); return { ok: true, via: 'texto' }; } });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r.fallos.some((f) => f.includes('boom'))).toBe(true);
    expect(m.enviados.map((e) => e.texto).join()).toContain('F-v2');
  });
});

describe('escalar: patio responsable → jefe general', () => {
  const escalera = (hitoId: string) => ['solicitud', 'recordatorio', 'recordatorio', 'recordatorio'].map((clase, i) => ({ hitoId, clase: clase as 'solicitud' | 'recordatorio', nivel: i, ciclo: 1 }));

  it('a los +90 escala al nivel 1 con botón «Ya lo atiendo» y la plantilla del jefe; marca el hito escalado', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: escalera('v1-0') });
    const r = await correrConductor(m.puertos, { ahora: mx('09:00') });
    expect(r.escalaciones).toBe(1);
    const e = m.enviados[0];
    expect(e).toMatchObject({ plantilla: 'aviso_jefe_trafico_v1', telefono: '5219990000099', contexto: 'conductor.escalacion_n1' });
    expect(e.botones).toEqual(['jefe_atiendo:v1']);
    expect(e.texto).toContain('Juan Pérez');
    expect(e.texto).toContain('su llegada a carga');
    expect(e.texto).toContain('sin respuesta a 4 avisos');
    expect(m.hitos.get('v1-0')).toMatchObject({ estado: 'escalado', escalacionNivel: 1 });
    expect(m.eventos.some((x) => x.evento === 'escalado')).toBe(true);
  });

  it('el nivel 2 sube 30 min después y NO se repite el nivel 1', async () => {
    const destinos = (_t: string, _term: string | null, nivel: 1 | 2) => [{ nombre: nivel === 1 ? 'Patio' : 'Jefe', telefono: nivel === 1 ? '5219990000099' : '5219990000088' }];
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: escalera('v1-0'), destinatarios: destinos });
    await correrConductor(m.puertos, { ahora: mx('09:00') });
    await correrConductor(m.puertos, { ahora: mx('09:10') });
    expect(m.enviados).toHaveLength(1);
    await correrConductor(m.puertos, { ahora: mx('09:30') });
    expect(m.enviados.map((e) => [e.contexto, e.telefono])).toEqual([
      ['conductor.escalacion_n1', '5219990000099'], ['conductor.escalacion_n2', '5219990000088'],
    ]);
    await correrConductor(m.puertos, { ahora: mx('12:00') });
    expect(m.enviados).toHaveLength(2);
    expect(m.hitos.get('v1-0')?.escalacionNivel).toBe(2);
  });

  it('dos corridas solapadas escalan UNA vez', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: escalera('v1-0') });
    await Promise.all([correrConductor(m.puertos, { ahora: mx('09:00') }), correrConductor(m.puertos, { ahora: mx('09:00') })]);
    expect(m.enviados).toHaveLength(1);
  });

  it('sin a quién escalar: se marca igual, se grita y NO se reintenta cada 5 min', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: escalera('v1-0'), destinatarios: () => [] });
    const r = await correrConductor(m.puertos, { ahora: mx('09:00') });
    expect(r.sinDestinatario).toBe(1);
    expect(m.hitos.get('v1-0')?.estado).toBe('escalado');
    expect([...m.reclamos.entries()].find(([k]) => k.includes('escalacion'))?.[1]).toMatchObject({ ok: false, motivo: 'sin_destinatario' });
    const r2 = await correrConductor(m.puertos, { ahora: mx('09:05') });
    expect(r2.sinDestinatario).toBe(0);
  });

  it('un rechazo reintentable a TODOS los destinos libera el claim', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: escalera('v1-0'), envio: () => ({ ok: false, reintentable: true, mensaje: '429' }) });
    const r = await correrConductor(m.puertos, { ahora: mx('09:00') });
    expect(r.rechazosReintentables).toBe(1);
    expect(m.hitos.get('v1-0')?.estado).toBe('esperado');
    expect([...m.reclamos.keys()].some((k) => k.includes('escalacion'))).toBe(false);
  });

  it('se avisa a todos los destinos del nivel (máx. 3) y basta uno entregado', async () => {
    const m = crearPuertos({
      viajes: [viaje('v1')], hitos: hitosDe('v1'), avisos: escalera('v1-0'),
      destinatarios: () => [{ nombre: 'A', telefono: '5211' }, { nombre: 'B', telefono: '5212' }],
      envio: (e) => (e.telefono === '5211' ? { ok: false, reintentable: false, mensaje: 'inválido' } : { ok: true, via: 'texto' }),
    });
    const r = await correrConductor(m.puertos, { ahora: mx('09:00') });
    expect(r.escalaciones).toBe(1);
    expect(m.enviados.map((e) => e.telefono)).toEqual(['5212']);
  });

  it('«Tengo un problema»: escala YA al nivel 1 con el motivo, y un doble toque no avisa dos veces', async () => {
    const v = viaje('v1');
    const m = crearPuertos({ viajes: [v], hitos: hitosDe('v1') });
    const hs = [...m.hitos.values()];
    const a = await escalarPorProblema(m.puertos, v, hs[0], hs, mx('07:40'));
    const b = await escalarPorProblema(m.puertos, v, hs[0], hs, mx('07:40'));
    expect([a, b]).toEqual(['ok', 'perdido']);
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0].texto).toContain('el chofer reportó un problema');
  });
});

describe('aislamiento entre flotas y fallos de configuración', () => {
  it('la config ilegible de una flota salta SUS viajes y las demás siguen', async () => {
    const vA = viaje('v1');
    const vB = viaje('v2', { tenantId: 't2' });
    const m = crearPuertos({ viajes: [vA, vB], hitos: [...hitosDe('v1'), ...hitosDe('v2', 't2')], configs: { t1: 'ilegible' } });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r.configIlegible).toBe(1);
    expect(m.enviados.map((e) => e.tenantId)).toEqual(['t2']);
  });

  it('cada flota usa SU escalera y SU ventana', async () => {
    const vA = viaje('v1');
    const vB = viaje('v2', { tenantId: 't2' });
    const m = crearPuertos({
      viajes: [vA, vB], hitos: [...hitosDe('v1'), ...hitosDe('v2', 't2')],
      configs: { t2: { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [20], horaInicio: 9, horaFin: 18 } },
    });
    await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(m.enviados.map((e) => e.tenantId)).toEqual(['t1']); // t2 todavía está fuera de SU ventana
  });

  it('el reloj de la corrida corta ANTES del claim', async () => {
    const vs = [viaje('v1'), viaje('v2')];
    const m = crearPuertos({ viajes: vs, hitos: vs.flatMap((v) => hitosDe(v.id)) });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30'), venceEn: Date.now() - 1 });
    expect(r.cortadosPorReloj).toBe(2);
    expect(m.reclamos.size).toBe(0);
    expect(m.enviados).toHaveLength(0);
  });

  it('una flota con el agente apagado no recibe mensajes proactivos', async () => {
    const m = crearPuertos({ viajes: [viaje('v1')], hitos: hitosDe('v1'), configs: { t1: { ...CONFIG_CONDUCTOR_DEFAULT, activo: false } } });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(m.enviados).toHaveLength(0);
    expect(r.saltados.flota_apagada).toBe(1);
  });

  it('sin viajes activos no hace nada más', async () => {
    const m = crearPuertos({ viajes: [], hitos: [] });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r.viajes).toBe(0);
    expect(m.enviados).toHaveLength(0);
  });
});
