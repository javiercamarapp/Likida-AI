import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor } = await import('./atender');
const { correrAlertasEstadia } = await import('./alertas_estadia');
const { crearMemoria, crearPuertos, viajeBase } = await import('./memoria.fixture');
const { leerBotonConductor } = await import('./tipos');
const { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor } = await import('./config');

// T-A5-45: el CABLEADO del «¿ya inició la descarga?». El cron manda la pregunta con los botones; el botón que el chofer toca llega a
// `atenderConductor` (la entrada del processor) y de ahí a `responderEstadiaDescarga`, que avisa al supervisor o cierra el claim.
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const AHORA = new Date('2026-10-02T18:00:00.000Z'); // 12:00 en México
const hace = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };
const CONFIG = { estadiaAlertaDescargaMin: 120, estadiaDescargaInteractiva: true, estadiaDescargaSinRespuestaMin: 30 };

function mundo(config: Record<string, unknown> = CONFIG) {
  const m = crearMemoria({ viajes: [viajeBase({ id: V1 })], config: config as never });
  m.sembrar(V1);
  m.registrar(V1, 'llegada_carga', hace(700));
  m.registrar(V1, 'salida_carga', hace(600));
  m.registrar(V1, 'llegada_descarga', hace(130), { contactoNombre: 'Contacto Prueba' });
  const cron = crearPuertos({ viajes: [viajeBase({ id: V1 })], hitos: m.de(V1), configs: { t1: { ...CONFIG_CONDUCTOR_DEFAULT, ...(config as object) } as never } });
  m.deps.estadia = cron.puertos;
  return { m, cron };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

describe('T-A5-45 · del botón del chofer al aviso (cableado de punta a punta)', () => {
  it('el cron pregunta, el chofer toca «No», y el supervisor recibe el aviso con contacto y minutos (una sola vez)', async () => {
    const { m, cron } = mundo();
    await correrAlertasEstadia(cron.puertos, { ahora: AHORA });
    const pregunta = cron.enviados[0];
    expect(pregunta.botones).toEqual([`estadia_descarga:${V1}:si`, `estadia_descarga:${V1}:no`]);

    const r = await atenderConductor({ ...base, texto: pregunta.botones[1] }, m.deps);
    expect(textos(r)).toMatch(/Ya le avisé a tu supervisor/);
    const aviso = cron.enviados.filter((e) => e.contexto === 'conductor.alerta_estadia');
    expect(aviso).toHaveLength(1);
    expect(aviso[0].texto).toMatch(/2 horas y 10 minutos/);
    expect(aviso[0].texto).toMatch(/Contacto Prueba/);

    await atenderConductor({ ...base, texto: pregunta.botones[1] }, m.deps);
    await correrAlertasEstadia(cron.puertos, { ahora: new Date(AHORA.getTime() + 3_600_000) });
    expect(cron.enviados.filter((e) => e.contexto === 'conductor.alerta_estadia')).toHaveLength(1);
  });

  it('el chofer toca «Sí»: nadie recibe aviso, ni ahora ni cuando el cron vuelve a pasar', async () => {
    const { m, cron } = mundo();
    await correrAlertasEstadia(cron.puertos, { ahora: AHORA });
    const r = await atenderConductor({ ...base, texto: `estadia_descarga:${V1}:si` }, m.deps);
    expect(textos(r)).toMatch(/Avísame cuando termines la descarga/);
    await correrAlertasEstadia(cron.puertos, { ahora: new Date(AHORA.getTime() + 4 * 3_600_000) });
    expect(cron.enviados.map((e) => e.contexto)).toEqual(['conductor.pregunta_estadia']);
  });

  it('un botón de OTRO viaje o de un chofer ajeno no toca nada', async () => {
    const { m, cron } = mundo();
    const r = await atenderConductor({ ...base, operadorId: 'o-ajeno', texto: `estadia_descarga:${V1}:no` }, m.deps);
    expect(textos(r)).toMatch(/otro viaje o ya no está vigente/);
    expect(cron.enviados).toHaveLength(0);
  });

  it('apagada la perilla el botón viejo contesta que ya no está vigente y no avisa', async () => {
    const { m, cron } = mundo({ ...CONFIG, estadiaDescargaInteractiva: false });
    const r = await atenderConductor({ ...base, texto: `estadia_descarga:${V1}:no` }, m.deps);
    expect(textos(r)).toMatch(/ya no está vigente/);
    expect(cron.enviados).toHaveLength(0);
  });
});

describe('T-A5-45 · el payload del botón y la configuración', () => {
  it('leerBotonConductor solo acepta si/no, con uuid de viaje', () => {
    expect(leerBotonConductor(`estadia_descarga:${V1}:si`)).toMatchObject({ prefijo: 'estadia_descarga', opcion: 'si' });
    expect(leerBotonConductor(`estadia_descarga:${V1}:NO`)).toMatchObject({ opcion: 'no' });
    expect(leerBotonConductor(`estadia_descarga:${V1}:quizas`)).toBeNull();
    expect(leerBotonConductor(`estadia_descarga:no-es-uuid:si`)).toBeNull();
  });

  it('validarConfigConductor: por omisión apagada y 30 min; rechaza umbrales fuera de rango o con claves que no son un cliente', () => {
    const ok = validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT });
    expect(ok).toMatchObject({ ok: { estadiaDescargaInteractiva: false, estadiaDescargaSinRespuestaMin: 30, estadiaDescargaMinPorCliente: {} } });
    const cliente = '11111111-1111-4111-8111-111111111111';
    expect(validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT, estadiaDescargaInteractiva: true, estadiaDescargaMinPorCliente: { [cliente.toUpperCase()]: 240 } }))
      .toMatchObject({ ok: { estadiaDescargaInteractiva: true, estadiaDescargaMinPorCliente: { [cliente]: 240 } } });
    expect(validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT, estadiaDescargaMinPorCliente: { [cliente]: 5 } })).toHaveProperty('error');
    expect(validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT, estadiaDescargaMinPorCliente: { 'cliente-uno': 240 } })).toHaveProperty('error');
    expect(validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT, estadiaDescargaSinRespuestaMin: 1 })).toHaveProperty('error');
  });
});
