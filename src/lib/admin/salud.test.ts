import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// RES-7: un cron muerto era invisible. La puerta loguea el 401 con código
// estable, el secreto ausente alerta, el latido nunca lanza, y `juzgarLatido`
// llama vencido a lo que lleva cadencia + 20 min sin latir.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])) }));
const upsert = vi.fn(async () => ({ error: null as null | { message: string } }));
const insertLatencia = vi.fn(async (..._a: unknown[]) => ({ error: null as null | { message: string } }));
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: null as unknown, error: null as null | { message: string } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => (tabla === 'latencia_muestra'
      ? { insert: (...a: unknown[]) => insertLatencia(...a) }
      : { upsert: (...a: unknown[]) => upsert(...(a as [])) }),
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

const { puertaCron, registrarLatido, registrarLatencia, registrarEstado, leerEstado30Dias, purgarObservabilidad, juzgarLatido, motivoDeSalto, esHuecoDeConfiguracion, CRONS, CADENCIA_MS, TOLERANCIA_LATIDO_MS } = await import('./salud');
const { estadoDescargaSat } = await import('@/lib/likida/sat_descarga');

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's3cr3t'; });

describe('puertaCron', () => {
  it('sin CRON_SECRET: 500 y ALERTA al operador (antes solo un log)', async () => {
    delete process.env.CRON_SECRET;
    const r = await puertaCron('escalar', new Request('http://x'), 'La escalación no corre sin él.');
    expect(r?.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalledWith('cron.escalar', expect.objectContaining({ codigo: 'cron_sin_secreto' }));
  });

  it('secreto equivocado: 401 sin cuerpo, pero CON log y código cron_401', async () => {
    const r = await puertaCron('purgar', new Request('http://x', { headers: { authorization: 'Bearer otro' } }), '');
    expect(r?.status).toBe(401);
    expect(await r?.text()).toBe('');
    expect(logger.error).toHaveBeenCalledWith('cron.purgar.no_autorizado', { codigo: 'cron_401' });
  });

  it('secreto correcto: null, sin ruido', async () => {
    const r = await puertaCron('purgar', new Request('http://x', { headers: { authorization: 'Bearer s3cr3t' } }), '');
    expect(r).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('registrarLatido', () => {
  it('escribe el upsert por id y no lanza ni con la base caída', async () => {
    await registrarLatido('wa-pendientes', 'ok', { procesados: 3 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'wa-pendientes', estado: 'ok' }), { onConflict: 'id' });
    upsert.mockRejectedValueOnce(new Error('caída'));
    await expect(registrarLatido('escalar', 'fallo')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('cron.latido_sin_escribir', expect.objectContaining({ cron: 'escalar' }));
  });
});

describe('juzgarLatido', () => {
  const ahora = Date.parse('2026-08-22T12:00:00Z');
  it('sin fila: sin_latido (recién desplegado no es muerto)', () => {
    expect(juzgarLatido('escalar', null, null, ahora).estado).toBe('sin_latido');
  });
  it('vencido = su cadencia + 20 min de tolerancia, sea cual sea la cadencia', () => {
    // Relativo a CADENCIA_MS a propósito: si mañana wa-pendientes corre cada
    // minuto en vez de cada cinco, esta prueba sigue midiendo la regla.
    const tope = CADENCIA_MS['wa-pendientes'] + TOLERANCIA_LATIDO_MS;
    expect(juzgarLatido('wa-pendientes', new Date(ahora - (tope - 60_000)).toISOString(), 'ok', ahora).estado).toBe('ok');
    expect(juzgarLatido('wa-pendientes', new Date(ahora - (tope + 60_000)).toISOString(), 'ok', ahora).estado).toBe('vencido');
  });
  it('el cron horario tolera 80 min', () => {
    const r = juzgarLatido('escalar', new Date(ahora - 70 * 60_000).toISOString(), 'parcial', ahora);
    expect(r).toMatchObject({ estado: 'ok', haceMin: 70, ultimoEstado: 'parcial' });
    expect(juzgarLatido('escalar', new Date(ahora - 90 * 60_000).toISOString(), 'ok', ahora).estado).toBe('vencido');
  });
});

describe('CADENCIA_MS espeja vercel.json', () => {
  it('cada cron de vercel.json tiene su cadencia aquí y coincide', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    const esperada: Record<string, number> = {
      '* * * * *': 60_000, '*/5 * * * *': 300_000, '*/15 * * * *': 900_000,
      '0 * * * *': 3_600_000, '7 * * * *': 3_600_000, '30 * * * *': 3_600_000,
      '0 */4 * * *': 4 * 3_600_000, '15 4 * * *': 86_400_000,
      // 0231: el minuto 25 está desfasado a propósito de la estampida de los
      // minutos 0/5/7/15 — un cron más en el minuto 0 se lleva la cuota de la
      // plataforma y el pool de conexiones a la misma hora que los otros.
      '25 */6 * * *': 6 * 3_600_000,
      // 0248: el vigilante de portales, SEMANAL — lunes 06:40 UTC. El minuto 40
      // y el lunes temprano están elegidos igual que el 25 de arriba: fuera de
      // la estampida, y el lunes para que si un portal murió el fin de semana
      // se sepa antes de la primera tanda de facturación de la semana.
      '40 6 * * 1': 7 * 86_400_000,
    };
    for (const c of cfg.crons) {
      const id = c.path.replace('/api/cron/', '') as keyof typeof CADENCIA_MS;
      // Si esto truena por `undefined`, no falta la cadencia en CADENCIA_MS:
      // falta la CADENA de cron en esta tabla. Añádela aquí antes de tocar
      // salud.ts, o el latido juzgará con la cadencia equivocada.
      expect(esperada[c.schedule], `cadencia "${c.schedule}" (${id}) no está en esta tabla`).toBeTypeOf('number');
      expect(CADENCIA_MS[id], `${id} falta en CADENCIA_MS`).toBe(esperada[c.schedule]);
    }
    expect(TOLERANCIA_LATIDO_MS).toBe(20 * 60_000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // EL GUARDIA QUE FALTABA. La prueba de arriba cruza CRONS contra
  // vercel.json, así que un cron nuevo sin cadencia se cazaba. Nadie cruzaba
  // CRONS contra el CHECK de `cron_latido`, y por ahí se coló el drift que
  // arregla la 0242: `asistencia` y `descarga-sat` llevaban semanas
  // llamando a `registrarLatido` con un id que la base rechazaba, y como el
  // latido es best-effort (traga el error con un warn), los dos crons corrían
  // y el panel los daba por muertos.
  //
  // Se lee el ÚLTIMO `add constraint cron_latido_id_dominio` de todo
  // `supabase/migrations/` —no un archivo fijo— porque el dominio se ha
  // reescrito tres veces (0155 → 0176 → 0180 → 0242) y la prueba tiene que
  // seguir midiendo el vigente, no el que estaba cuando se escribió.
  // ═════════════════════════════════════════════════════════════════════════
  it('el CHECK de cron_latido admite exactamente los CRONS que el código declara', () => {
    const dir = 'supabase/migrations';
    const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    let dominio: string[] | null = null;
    let deQuien = '';
    for (const archivo of archivos) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- recorre las migraciones del propio repo en tiempo de prueba; la ruta sale de readdirSync sobre una constante, no de ninguna entrada de usuario.
      const sql = readFileSync(`${dir}/${archivo}`, 'utf8');
      // Sin comentarios: la 0242 CITA el dominio viejo en su encabezado para
      // explicar el bug, y sin este filtro la prueba leería esa cita como si
      // fuera el CHECK vigente.
      const vivo = sql.replace(/^\s*--.*$/gm, '');
      const re = /add\s+constraint\s+cron_latido_id_dominio\s+check\s*\(\s*id\s+in\s*\(([^)]*)\)/gis;
      for (const m of vivo.matchAll(re)) {
        dominio = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        deQuien = archivo;
      }
    }

    expect(dominio, 'ninguna migración declara cron_latido_id_dominio').not.toBeNull();
    // Ordenados: al dominio le da igual el orden, y comparar listas ordenadas
    // hace que el mensaje de fallo diga QUÉ id sobra o falta.
    expect([...(dominio ?? [])].sort(), `el CHECK vigente lo pone ${deQuien}`)
      .toEqual([...CRONS].sort());
  });
});

describe('motivoDeSalto', () => {
  it('traduce la palanca que apagó el cron', () => {
    expect(motivoDeSalto({ interruptor: 'global' })).toBe('apagado por la palanca «global»');
  });
  it('un salto sin palanca no inventa un motivo', () => {
    // `null` es «no fue un salto declarado», y la vista lo pinta distinto de
    // un salto explicado. Un string de relleno aquí haría que un cron caído
    // se leyera como un cron apagado a propósito.
    expect(motivoDeSalto({})).toBeNull();
    expect(motivoDeSalto({ interruptor: '' })).toBeNull();
    expect(motivoDeSalto({ interruptor: '   ' })).toBeNull();
    expect(motivoDeSalto({ interruptor: 7 })).toBeNull();
    expect(motivoDeSalto({ otra: 'cosa' })).toBeNull();
  });
  it('lee el motivo en prosa que dejó el cron (facturar sin adaptadores)', () => {
    // Tableros al día (28-ago-2026): un salto puede tener motivo propio sin
    // palanca — `facturar` con cero adaptadores de portal escribe la frase y
    // aquí solo se lee, nunca se inventa.
    expect(motivoDeSalto({ motivo: 'no hay ningún adaptador de portal escrito' }))
      .toBe('no hay ningún adaptador de portal escrito');
    expect(motivoDeSalto({ motivo: '   ' })).toBeNull();
    expect(motivoDeSalto({ motivo: 42 })).toBeNull();
    // La palanca gana si vienen las dos: apagar a mano es la señal más fuerte.
    expect(motivoDeSalto({ interruptor: 'global', motivo: 'otra cosa' }))
      .toBe('apagado por la palanca «global»');
  });
});

// Auditoría prod 29-ago-2026: `descarga-sat` sin LIKIDA_SAT_PROVEEDOR mandó
// ocho correos "Urgente" en doce horas porque `/api/health` no distinguía un
// hueco de configuración YA DECLARADO de una regresión real. Esta función es
// la bisagra de esa distinción — lee la MISMA convención de prosa que ya usa
// todo el repo ("no está configurado" / "no configurado"), no una lista de
// crons a mano.
describe('esHuecoDeConfiguracion', () => {
  it('reconoce el motivo real de descarga-sat en producción (falta LIKIDA_SAT_PROVEEDOR)', () => {
    expect(esHuecoDeConfiguracion(
      'La descarga masiva no está configurada: falta LIKIDA_SAT_PROVEEDOR en el servidor. Lo destraba Javier (contrato con el PAC y variables de entorno).',
    )).toBe(true);
  });
  it('reconoce la variante "no configurado" sin el "está" (otros canales del repo)', () => {
    expect(esHuecoDeConfiguracion('El canal de correo no está configurado (RESEND_API_KEY/RESEND_EMAIL_DOMAIN).')).toBe(true);
    expect(esHuecoDeConfiguracion('canal de WhatsApp no configurado')).toBe(true);
    expect(esHuecoDeConfiguracion('El cofre no está configurado (falta LIKIDA_COFRE_LLAVE).')).toBe(true);
  });
  it('una regresión real NO trae la convención de "no configurado" y no se confunde con un hueco', () => {
    expect(esHuecoDeConfiguracion('timeout al llamar al proveedor de SW')).toBe(false);
    expect(esHuecoDeConfiguracion('el proveedor devolvió 500')).toBe(false);
    expect(esHuecoDeConfiguracion('interruptor_ilegible')).toBe(false);
  });
  it('sin motivo, o con un tipo que no es texto, no es un hueco declarado', () => {
    expect(esHuecoDeConfiguracion(null)).toBe(false);
    expect(esHuecoDeConfiguracion(undefined)).toBe(false);
    expect(esHuecoDeConfiguracion(42)).toBe(false);
    expect(esHuecoDeConfiguracion('')).toBe(false);
  });

  // AUDITORÍA 21 (29-ago-2026): el regex de arriba solo reconocía UNA de las
  // cuatro ramas de `estadoDescargaSat()` (verificado contra el código real,
  // no hipotético). La señal ESTRUCTURADA `configAusente` es la que de verdad
  // cierra el hueco: gana sobre `motivo` sea cual sea su redacción.
  it('la señal estructurada `configAusente` decide, no la prosa de `motivo`', () => {
    // Un motivo que NO trae la convención de texto, pero SÍ trae la señal
    // estructurada en true: es un hueco de configuración de todos modos.
    expect(esHuecoDeConfiguracion({ configAusente: true, motivo: 'cualquier redacción futura' })).toBe(true);
    // Al revés: `configAusente: false` gana aunque el texto libre "suene" a
    // hueco de configuración — la señal estructurada nunca la contradice el
    // regex.
    expect(esHuecoDeConfiguracion({ configAusente: false, motivo: 'esto no está configurado, pero ya se resolvió' })).toBe(false);
  });

  it('sin `configAusente`, cae al regex de prosa sobre `detalle.motivo` (crons que no mandan la señal estructurada)', () => {
    expect(esHuecoDeConfiguracion({ motivo: 'El cofre no está configurado (falta LIKIDA_COFRE_LLAVE).' })).toBe(true);
    expect(esHuecoDeConfiguracion({ motivo: 'timeout al llamar al proveedor de SW' })).toBe(false);
    expect(esHuecoDeConfiguracion({})).toBe(false);
  });

  // Las CUATRO variantes reales de `estadoDescargaSat()`
  // (`sat_descarga/index.ts:64-91`), probadas contra el flujo real: el mismo
  // objeto que `cron/descarga-sat/route.ts` manda a `registrarLatido`
  // (`{ motivo, configAusente: !configurado }`). Antes de este arreglo, solo
  // la primera de las cuatro clasificaba como hueco — las otras tres caían en
  // "regresión real" y disparaban el correo "Urgente" cada hora para siempre.
  describe('las cuatro variantes de motivo de estadoDescargaSat(), vía el latido real', () => {
    const detalleDelLatido = () => {
      const estado = estadoDescargaSat();
      return { motivo: estado.motivo, configAusente: !estado.configurado };
    };

    afterEach(() => { vi.unstubAllEnvs(); });

    it('1) LIKIDA_SAT_PROVEEDOR ausente', () => {
      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', '');
      const detalle = detalleDelLatido();
      expect(detalle.motivo).toMatch(/no está configurada/i);
      expect(esHuecoDeConfiguracion(detalle)).toBe(true);
    });

    it('2) LIKIDA_SAT_PROVEEDOR=sat_directo (declarado, no construido)', () => {
      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sat_directo');
      const detalle = detalleDelLatido();
      expect(detalle.motivo).toMatch(/no construido/i);
      expect(esHuecoDeConfiguracion(detalle)).toBe(true);
    });

    it('3) LIKIDA_SAT_PROVEEDOR con un valor desconocido (typo, p. ej. mayúscula)', () => {
      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'SW');
      const detalle = detalleDelLatido();
      expect(detalle.motivo).toMatch(/no es un proveedor conocido/i);
      expect(esHuecoDeConfiguracion(detalle)).toBe(true);
    });

    it('4) proveedor válido pero credenciales incompletas (falta LIKIDA_SAT_URL)', () => {
      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sw');
      vi.stubEnv('LIKIDA_SAT_URL', '');
      vi.stubEnv('LIKIDA_SAT_USUARIO', '');
      vi.stubEnv('LIKIDA_SAT_PASSWORD', '');
      vi.stubEnv('LIKIDA_PAC_USUARIO', '');
      vi.stubEnv('LIKIDA_PAC_PASSWORD', '');
      const detalle = detalleDelLatido();
      expect(detalle.motivo).toMatch(/^Falta LIKIDA_SAT_URL/);
      expect(esHuecoDeConfiguracion(detalle)).toBe(true);
    });

    // Y el regex de respaldo (para latidos viejos sin `configAusente`, o
    // crons que aún no manden la señal) también reconoce las tres variantes
    // que antes se le escapaban.
    it('el regex de respaldo también reconoce las tres variantes que antes se le escapaban', () => {
      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sat_directo');
      expect(esHuecoDeConfiguracion(estadoDescargaSat().motivo)).toBe(true);
      vi.unstubAllEnvs();

      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'SW');
      expect(esHuecoDeConfiguracion(estadoDescargaSat().motivo)).toBe(true);
      vi.unstubAllEnvs();

      vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sw');
      vi.stubEnv('LIKIDA_SAT_URL', '');
      vi.stubEnv('LIKIDA_SAT_USUARIO', '');
      vi.stubEnv('LIKIDA_SAT_PASSWORD', '');
      vi.stubEnv('LIKIDA_PAC_USUARIO', '');
      vi.stubEnv('LIKIDA_PAC_PASSWORD', '');
      expect(esHuecoDeConfiguracion(estadoDescargaSat().motivo)).toBe(true);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// E1-A (0700): la duración de cada corrida de cron se mide de la puerta al
// latido — sin tocar una sola ruta — y se escribe UNA fila por corrida.
// ═══════════════════════════════════════════════════════════════════════════
describe('la latencia de los crons (puerta → latido)', () => {
  const autorizada = () => new Request('http://x', { headers: { authorization: 'Bearer s3cr3t' } });

  it('una corrida autorizada deja una muestra de tipo cron con su duración y ok = (estado ok)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
      await puertaCron('gps', autorizada(), '');
      vi.setSystemTime(new Date('2026-10-03T12:00:02.500Z'));
      await registrarLatido('gps', 'ok');
      expect(insertLatencia).toHaveBeenCalledTimes(1);
      expect(insertLatencia).toHaveBeenCalledWith({ tipo: 'cron', nombre: 'gps', ms: 2500, ok: true });
      await puertaCron('gps', autorizada(), '');
      vi.setSystemTime(new Date('2026-10-03T12:00:03Z'));
      await registrarLatido('gps', 'fallo');
      expect(insertLatencia).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
    } finally { vi.useRealTimers(); }
  });

  it('un `saltado` (apagado por palanca) NO cuenta: respondería en ms sin trabajar y hundiría el p50', async () => {
    await puertaCron('jornada', autorizada(), '');
    await registrarLatido('jornada', 'saltado', { interruptor: 'global' });
    expect(insertLatencia).not.toHaveBeenCalled();
  });

  it('un latido sin puerta previa (o un segundo latido de la misma corrida) no escribe muestra', async () => {
    await registrarLatido('peajes', 'ok');
    expect(insertLatencia).not.toHaveBeenCalled();
    await puertaCron('peajes', autorizada(), '');
    await registrarLatido('peajes', 'ok');
    await registrarLatido('peajes', 'fallo');
    expect(insertLatencia).toHaveBeenCalledTimes(1);
  });

  it('una puerta rechazada (401) NO arranca el cronómetro', async () => {
    await puertaCron('asistencia', new Request('http://x', { headers: { authorization: 'Bearer mal' } }), '');
    await registrarLatido('asistencia', 'ok');
    expect(insertLatencia).not.toHaveBeenCalled();
  });

  it('medir NUNCA tumba el latido: con la tabla de latencias caída, el latido igual se escribe', async () => {
    insertLatencia.mockRejectedValueOnce(new Error('caída'));
    await puertaCron('escalar', autorizada(), '');
    await expect(registrarLatido('escalar', 'ok')).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'escalar' }), { onConflict: 'id' });
  });
});

describe('registrarLatencia', () => {
  it('escribe tipo, nombre, ms entero y ok; recorta el nombre y el tope de una hora', async () => {
    await registrarLatencia('ruta', 'x'.repeat(200), 12.6, false);
    expect(insertLatencia).toHaveBeenCalledWith({ tipo: 'ruta', nombre: 'x'.repeat(120), ms: 13, ok: false });
    await registrarLatencia('ruta', 'y', 99_999_999, true);
    expect(insertLatencia).toHaveBeenLastCalledWith(expect.objectContaining({ ms: 3_600_000 }));
  });
  it('una duración inválida (NaN, negativa) NO se escribe', async () => {
    await registrarLatencia('ruta', 'y', Number.NaN, true);
    await registrarLatencia('ruta', 'y', -5, true);
    expect(insertLatencia).not.toHaveBeenCalled();
  });
  it('nunca lanza: error de la base o excepción', async () => {
    insertLatencia.mockResolvedValueOnce({ error: { message: 'rls' } });
    await expect(registrarLatencia('ruta', 'y', 5, true)).resolves.toBeUndefined();
    insertLatencia.mockRejectedValueOnce(new Error('caída'));
    await expect(registrarLatencia('ruta', 'y', 5, true)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('latencia.sin_escribir', expect.objectContaining({ nombre: 'y' }));
  });
});

describe('estado público (0701)', () => {
  it('registrarEstado llama la RPC y devuelve si escribió; nunca lanza', async () => {
    expect(await registrarEstado('base', 'ok')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('registrar_estado', { p_componente: 'base', p_estado: 'ok' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await registrarEstado('base', 'caido')).toBe(false);
    rpc.mockRejectedValueOnce(new Error('caída'));
    expect(await registrarEstado('base', 'caido')).toBe(false);
  });
  it('leerEstado30Dias normaliza filas y descarta componentes fuera del catálogo; LANZA si la base falla', async () => {
    rpc.mockResolvedValueOnce({ data: [
      { componente: 'app', dia: '2026-10-03', muestras: 10, ok: 9, degradadas: 1, caidas: 0 },
      { componente: 'intruso', dia: '2026-10-03', muestras: 1, ok: 1, degradadas: 0, caidas: 0 },
    ], error: null });
    expect(await leerEstado30Dias()).toEqual([{ componente: 'app', dia: '2026-10-03', muestras: 10, ok: 9, degradadas: 1, caidas: 0 }]);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(leerEstado30Dias()).rejects.toThrow(/boom/);
  });
  it('purgarObservabilidad repite la tanda mientras quede vencido (con tope) y borra el estado viejo', async () => {
    rpc.mockResolvedValueOnce({ data: { borradas: 20000, parcial: true }, error: null });
    rpc.mockResolvedValueOnce({ data: { borradas: 5, parcial: false }, error: null });
    rpc.mockResolvedValueOnce({ data: 3, error: null });
    expect(await purgarObservabilidad()).toEqual({ latencias: 20005, estados: 3, parcial: false });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['purgar_latencia', 'purgar_latencia', 'purgar_estado_dia']);
  });
  it('purgarObservabilidad LANZA si la base falla (la guardia lo registra)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'lock' } });
    await expect(purgarObservabilidad()).rejects.toThrow(/lock/);
  });
});
