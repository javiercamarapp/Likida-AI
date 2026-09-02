import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CIERRE DE UNA CORRIDA GLOBAL — la mitad que se olvida.
//
// Lo natural al cablear esto es llamar al aviso dentro del `catch`. Queda
// roto de una forma que ninguna prueba de "manda correo cuando falla" atrapa:
// la racha de una flota que se rompió una vez y luego sanó no se limpia
// nunca, así que meses después su siguiente incidente arranca ya pasado de
// las marcas de insistencia y NO manda el primer correo — el único que
// importa. Estas pruebas son las que fijan que el éxito también se registre.
// ═══════════════════════════════════════════════════════════════════════════

/** Las tablas que toca el motor, con lo que cada llamada hizo. */
const cierres: Array<Record<string, unknown>> = [];
const upserts: Array<Record<string, unknown>> = [];

function tablaFalsa(nombre: string) {
  const filtros: Record<string, string> = {};
  let payload: Record<string, unknown> | null = null;
  const encadenable = {
    // El cierre del incidente (B7) es un UPDATE que pone la magnitud en cero;
    // la fila —y con ella la huella `avisado_en`— se queda. Se captura el
    // payload para poder afirmar QUÉ columnas tocó y cuáles no.
    update: (fila: Record<string, unknown>) => { payload = fila; return encadenable; },
    select: () => encadenable,
    upsert: (fila: Record<string, unknown>) => {
      upserts.push({ tabla: nombre, ...fila });
      return Promise.resolve({ error: null });
    },
    eq: (col: string, val: string) => { filtros[col] = val; return encadenable; },
    // `usuariosAvisables` (FE-34, auditoría 24) agregó `.order('id')` antes
    // del `.limit()` — sin este método, esa lectura tronaba con "order is
    // not a function" (se atrapa y se loguea, no tumba la corrida, pero
    // ensuciaba el log de una prueba que no está probando ESO).
    order: () => encadenable,
    limit: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    // El `update()...eq()...eq()` de `cerrarIncidente` se resuelve al await.
    then: (res: (v: { error: null }) => unknown) => {
      if (nombre === 'agente_notificacion_estado' && payload !== null) {
        cierres.push({ ...filtros, ...payload });
      }
      return Promise.resolve({ error: null }).then(res);
    },
  };
  return encadenable;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => tablaFalsa(t) }),
}));
// Sin canal no sale ningún correo, que es justo lo que se quiere probar: el
// registro del cierre NO depende del canal.
vi.mock('@/lib/correo/enviar', () => ({
  correoConfigurado: () => false,
  enviarCorreo: vi.fn(async () => ({ ok: false as const, motivo: 'canal apagado' })),
}));

const { avisarCorridasPorFlota, avisarCorridaFallida, avisar } = await import('./notificaciones');

beforeEach(() => {
  cierres.length = 0;
  upserts.length = 0;
});

describe('el éxito de una corrida REARMA el filo', () => {
  it('una flota que corrió bien pone su racha en cero — sin borrar la huella', async () => {
    // `cerrarIncidente` es ese UPDATE. Sin él, el contador de esa flota se
    // queda arriba para siempre. Y NO es un DELETE (B7): borrar la fila
    // borraba también `avisado_en`, y un agente que parpadea encontraba el
    // piso de una hora desarmado en cada lote.
    await avisarCorridasPorFlota('cobranza', new Map([['flota-a', null]]));
    expect(cierres).toHaveLength(1);
    expect(cierres[0]).toMatchObject({
      tenant_id: 'flota-a', agente: 'cobranza', evento: 'corrida_fallida', magnitud: 0,
    });
    // El cierre NO toca las columnas de la huella: `avisado_en` y
    // `magnitud_avisada` se quedan como estaban — son la memoria del piso.
    expect('avisado_en' in cierres[0]).toBe(false);
    expect('magnitud_avisada' in cierres[0]).toBe(false);
  });

  it('el cierre ocurre aunque el correo esté apagado', async () => {
    // El canal está mockeado en `false`. Si el cierre dependiera del canal, un
    // entorno sin Resend acumularía rachas fantasma que se descargarían todas
    // el día que alguien lo encienda.
    const r = await avisarCorridaFallida('flota-a', 'cobranza', null);
    expect(r.avisado).toBe(false);
    expect(cierres).toHaveLength(1);
  });

  it('`undefined` cuenta como éxito, no como fallo', async () => {
    // Un runner que no devuelve nada al salir bien es lo normal. Tratar ese
    // `undefined` como fallo mandaría el correo de "el agente no pudo
    // trabajar" cada vez que el agente trabaja.
    await avisarCorridaFallida('flota-a', 'cobranza', undefined);
    expect(cierres).toHaveLength(1);
    expect(upserts).toHaveLength(0);
  });
});

describe('el fallo SÍ sube la racha', () => {
  it('una flota que tronó guarda magnitud, no la cierra', async () => {
    await avisarCorridasPorFlota('cobranza', new Map([['flota-b', new Error('PostgREST 503')]]));
    expect(cierres).toHaveLength(0);
    expect(upserts.some((u) => u.tabla === 'agente_notificacion_estado' && u.tenant_id === 'flota-b')).toBe(true);
  });

  it('éxitos y fallos en la misma corrida no se contagian', async () => {
    await avisarCorridasPorFlota('cobranza', new Map<string, unknown>([
      ['flota-a', null],
      ['flota-b', new Error('se cayó')],
      ['flota-c', null],
    ]));
    expect(cierres.map((b) => b.tenant_id).sort()).toEqual(['flota-a', 'flota-c']);
    expect(upserts.filter((u) => u.tabla === 'agente_notificacion_estado')).toHaveLength(1);
  });
});

describe('las que no corrieron no entran', () => {
  it('un mapa vacío no toca la base', async () => {
    // Es el caso del corte por reloj con cero flotas alcanzadas: ni éxito
    // (cerraría una racha real sin haber arreglado nada) ni fallo.
    await avisarCorridasPorFlota('cobranza', new Map());
    expect(cierres).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });
});

describe('el aviso NUNCA tumba la corrida', () => {
  it('un agente que no existe no revienta', async () => {
    await expect(
      avisarCorridasPorFlota('inventado' as never, new Map([['flota-a', null]])),
    ).resolves.toBeUndefined();
  });

  it('un evento no declarado por ese agente se rechaza sin lanzar', async () => {
    // `escalado` hoy SOLO lo declara el Agente de Conductores. Pedirle a otro
    // que lo avise es un bug de quien llama, y fallar cerrado aquí es devolver
    // "no avisado" —nunca una excepción que suba al cron y convierta una
    // corrida que sí trabajó en un 500—. Se llama `avisar` directo y no
    // `avisarCorridaFallida` porque ésta cablea `corrida_fallida`, que los seis
    // sí declaran: por ahí esta rama no se toca.
    const r = await avisar(
      'flota-a', 'liquidacion', 'escalado',
      { hayProblema: true, magnitud: 1 },
      () => ({ asunto: 'x', titulo: 'x', parrafos: [], avance: 'x', tono: 'neutral', porQueLoRecibes: 'x' }),
    );
    expect(r.avisado).toBe(false);
    expect(r.porque).toContain('no declara ese evento');
    // Y no dejó rastro: ni cerró la racha ni la subió.
    expect(cierres).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });
});
