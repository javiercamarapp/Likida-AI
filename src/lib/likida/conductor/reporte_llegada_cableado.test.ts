import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor } = await import('./atender');
const { correrReporteLlegada, mapaReubicaciones, estadoReporteDeEventos } = await import('./reporte_llegada');
const { crearMundo } = await import('./mundo.fixture');
const { viajeBase } = await import('./memoria.fixture');
const { conReporteDeLlegada } = await import('./tablero');
type EventoReporteFila = import('./repo').EventoReporteFila;
type PuertosReporte = import('./reporte_llegada').PuertosReporte;
type FilaTablero = import('./tablero').FilaTablero;

// T-A5-43: el CABLEADO de «¿con quién te reportaste?» y la rampa, de punta a punta con UNA base en memoria compartida:
// el cron pregunta (correrReporteLlegada) → el chofer contesta por la entrada del processor (atenderConductor) → la respuesta
// se PERSISTE en la bitácora → el tablero la LEE y la compone (mapaReubicaciones + conReporteDeLlegada). Teléfonos sintéticos (28999…).
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const T0 = new Date('2026-10-02T18:00:00.000Z'); // 12:00 en México
const hace = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const base = { tenantId: 't1', operadorId: 'o1', telefono: '2899900000001', viajeAbiertoId: V1 };

interface Envio { telefono: string; texto: string; plantilla: string; botones: string[]; contexto: string }

function mundo(opts: { config?: Record<string, unknown>; servicio?: 'importacion' | 'exportacion' | 'nacional'; guardaFalla?: boolean } = {}) {
  const enviados: Envio[] = [];
  const w = crearMundo({
    viajes: [viajeBase({ id: V1, servicio: opts.servicio ?? 'importacion', operadorTelefono: '2899900000001' })],
    configs: { t1: { reporteLlegadaActivo: true, ...opts.config } as never },
    enviar: async (telefono, m, contexto) => {
      enviados.push({ telefono, texto: m.texto, plantilla: m.plantilla.nombre, botones: m.botones.map((b) => b.id), contexto });
      return { ok: true, via: 'botones', id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' };
    },
  });
  w.m.sembrar(V1);
  w.m.registrar(V1, 'llegada_carga', hace(700));
  w.m.registrar(V1, 'salida_carga', hace(600));
  w.m.registrar(V1, 'llegada_descarga', hace(20));

  // La bitácora del reporte: la MISMA para el cron, para la entrada y para el tablero.
  const bitacora: EventoReporteFila[] = [];
  let reloj = T0;
  let n = 0;
  const puertosBitacora = {
    eventosReporte: async (_t: string, ids: string[]) => bitacora.filter((e) => ids.includes(e.viajeId)).map((e) => ({ ...e })),
    guardarEventoReporte: async (h: { id: string; viajeId: string }, detalle: Record<string, string | number | boolean | null>) => {
      if (opts.guardaFalla) return false;
      bitacora.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, detalle: { clase: 'reporte_llegada', ...detalle }, creadoEn: reloj.toISOString() });
      return true;
    },
  };
  w.m.deps.reporte = puertosBitacora;
  const cron: PuertosReporte = { ...w.puertos, ...puertosBitacora };
  const pasada = (min = 0) => { reloj = new Date(T0.getTime() + min * 60_000); return correrReporteLlegada(cron, { ahora: reloj }); };
  const chofer = (texto: string, min = 0) => { reloj = new Date(T0.getTime() + min * 60_000); return atenderConductor({ ...base, texto, ahora: reloj }, w.m.deps); };
  return { w, enviados, bitacora, pasada, chofer };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

describe('T-A5-43 · apagado de origen', () => {
  it('con la perilla apagada (el valor por omisión) el cron no pregunta nada ni reclama nada', async () => {
    const { w, enviados, pasada } = mundo({ config: { reporteLlegadaActivo: false } });
    const r = await pasada();
    expect(enviados).toHaveLength(0);
    expect(r.preguntas).toBe(0);
    expect(w.reclamos.size).toBe(0);
  });

  it('con la perilla apagada un botón viejo de la rampa contesta «ya no está vigente» y NO guarda nada', async () => {
    const { bitacora, chofer } = mundo({ config: { reporteLlegadaActivo: false } });
    expect(textos(await chofer(`rampa_estado_si:${V1}`))).toMatch(/ya no está vigente/);
    expect(bitacora).toHaveLength(0);
  });
});

describe('T-A5-43 · el cron pregunta, el chofer contesta, el reporte se guarda y el tablero lo lee', () => {
  it('importación: contacto → rampa → «no aplica» → «¿cómo descargas?», cada paso UNA vez y todo persistido', async () => {
    const { w, enviados, bitacora, pasada, chofer } = mundo();

    // 1) Contacto: se pregunta UNA vez (la segunda pasada no repite), con la plantilla de reserva `conductor_contacto_anden_v1`.
    await pasada();
    expect(enviados.map((e) => e.contexto)).toEqual(['conductor.reporte_llegada']);
    expect(enviados[0].plantilla).toBe('conductor_contacto_anden_v1');
    expect(enviados[0].botones).toEqual([`hito_sin_contacto_anden:${V1}`]);
    await pasada(1);
    expect(enviados).toHaveLength(1);

    // El chofer contesta con el botón de siempre (flujo existente: guarda el hecho de que no hay contacto).
    await chofer(`hito_sin_contacto_anden:${V1}`, 2);
    expect(w.m.de(V1).find((h) => h.tipo === 'llegada_descarga')!.sinContacto).toBe(true);

    // 2) Rampa: página 0 con tres botones; «Más opciones» abre la página 1.
    await pasada(3);
    expect(enviados[1].botones).toEqual([`rampa_estado_si:${V1}`, `rampa_estado_no:${V1}`, `rampa_mas:${V1}`]);
    const mas = await chofer(`rampa_mas:${V1}`, 4);
    expect(mas!.mensajes[0].botones!.map((b) => b.id)).toEqual([`rampa_estado_no_aplica:${V1}`, `rampa_estado_en_espera:${V1}`]);
    const na = await chofer(`rampa_estado_no_aplica:${V1}`, 5);
    expect(textos(na)).toMatch(/no aplica/);

    // 3) «¿Cómo descargas?» (opcional): el cron la manda tras «no aplica»; el chofer contesta con texto libre.
    await pasada(6);
    expect(enviados[2].botones).toEqual([`rampa_como_omitir:${V1}`]);
    const como = await chofer('a pie de calle con montacargas', 7);
    expect(textos(como)).toMatch(/Anotado .* descargas: a pie de calle con montacargas/);

    // Nada más que preguntar: pasadas posteriores no mandan nada (ni se repite ningún paso).
    await pasada(60);
    expect(enviados).toHaveLength(3);

    // PERSISTIDO Y LEÍDO: la bitácora trae las 3 preguntas y las 2 respuestas, y de ella sale la lista de reubicaciones.
    expect(bitacora.map((e) => `${e.detalle.tipo}:${e.detalle.paso ?? e.detalle.estado ?? 'como'}`)).toEqual([
      'pregunta:contacto', 'pregunta:rampa', 'rampa:no_aplica', 'pregunta:como_descarga', 'como:como',
    ]);
    const llegada = w.m.de(V1).find((h) => h.tipo === 'llegada_descarga')!;
    const st = estadoReporteDeEventos(bitacora, llegada.id, llegada.ciclo);
    expect(st.reubicaciones.map((r) => [r.rampaEstado, r.comoDescarga])).toEqual([['no_aplica', null], ['no_aplica', 'a pie de calle con montacargas']]);

    // El tablero lo muestra: la fila de la llegada trae la rampa vigente y su historial.
    const fila = { hitos: [{ id: llegada.id, tipo: 'llegada_descarga', contacto: null }] } as unknown as FilaTablero;
    const [compuesta] = conReporteDeLlegada([fila], mapaReubicaciones(bitacora, w.m.de(V1)));
    expect(compuesta.hitos[0].reporte?.rampa).toBe('Rampa no aplica · descarga: a pie de calle con montacargas');
    expect(compuesta.hitos[0].reporte?.historial).toHaveLength(2);
  });

  it('«Sí» sin número → pide el número (opcional); el número llega por texto; un cambio de rampa agrega un registro con su hora', async () => {
    const { w, enviados, bitacora, pasada, chofer } = mundo();
    await chofer(`hito_sin_contacto_anden:${V1}`);
    await pasada(1);
    const si = await chofer(`rampa_estado_si:${V1}`, 2);
    expect(textos(si)).toMatch(/dime el número de rampa/);
    expect(textos(await chofer('7', 3))).toMatch(/rampa 7/);
    expect(textos(await chofer('rampa 9', 4))).toMatch(/rampa 9/);
    // El mismo dato otra vez no agrega registro (no infla la evidencia contra «no se presentó»).
    const antes = bitacora.length;
    await chofer('rampa 9', 5);
    expect(bitacora).toHaveLength(antes);

    const llegada = w.m.de(V1).find((h) => h.tipo === 'llegada_descarga')!;
    const lista = estadoReporteDeEventos(bitacora, llegada.id, llegada.ciclo).reubicaciones;
    expect(lista.map((r) => r.rampa)).toEqual([null, '7', '9']);
    expect(new Set(lista.map((r) => r.en)).size).toBe(3); // cada cambio con su hora
    // Con la rampa resuelta el cron ya no pregunta nada más.
    await pasada(10);
    expect(enviados.filter((e) => e.botones[0]?.startsWith('rampa_estado'))).toHaveLength(1);
  });

  it('un texto suelto SIN pregunta abierta no se toma por respuesta (sigue al agente)', async () => {
    const { bitacora, chofer } = mundo();
    expect(await chofer('7', 1)).toBeNull();
    expect(await chofer('a pie de calle', 2)).toBeNull();
    expect(bitacora).toHaveLength(0);
  });

  it('«Omitir» el «¿cómo descargas?» lo cierra sin texto y no se vuelve a preguntar', async () => {
    const { enviados, bitacora, pasada, chofer } = mundo();
    await chofer(`hito_sin_contacto_anden:${V1}`);
    await pasada(1);
    await chofer(`rampa_estado_no_aplica:${V1}`, 2);
    await pasada(3);
    expect(textos(await chofer(`rampa_como_omitir:${V1}`, 4))).toMatch(/sin problema/);
    await pasada(90);
    expect(enviados.filter((e) => e.botones[0] === `rampa_como_omitir:${V1}`)).toHaveLength(1);
    expect(bitacora.at(-1)?.detalle).toMatchObject({ tipo: 'como', omitido: true });
  });

  it('sin respuesta al contacto NO bloquea: pasado el plazo se sigue con la rampa y el ciclo del viaje no depende de nada de esto', async () => {
    const { enviados, pasada } = mundo();
    await pasada(0);                 // contacto
    await pasada(5);                 // aún en plazo: espera
    expect(enviados).toHaveLength(1);
    await pasada(11);                // vencido: sigue con la rampa
    expect(enviados[1].botones[0]).toBe(`rampa_estado_si:${V1}`);
    await pasada(60);
    expect(enviados).toHaveLength(2); // y ya no insiste en ninguno
  });
});

describe('T-A5-43 · guardias', () => {
  it('unidad en movimiento (compuerta T-A5-36 sin GPS que la libere) → no pregunta y no reclama; se reevalúa en la pasada siguiente', async () => {
    const { w, enviados, pasada } = mundo({ config: { compuertaMovimientoActiva: true } });
    const r = await pasada();
    expect(enviados).toHaveLength(0);
    expect(r.compuertaMovimiento).toBe(1);
    expect(w.reclamos.size).toBe(0);
  });

  it('exportación o nacional: se pregunta el contacto pero NUNCA la rampa (solo importación)', async () => {
    for (const servicio of ['exportacion', 'nacional'] as const) {
      const { enviados, pasada, chofer } = mundo({ servicio });
      await pasada();
      expect(enviados[0].plantilla).toBe('conductor_contacto_anden_v1');
      await chofer(`hito_sin_contacto_anden:${V1}`, 1);
      await pasada(30);
      expect(enviados.filter((e) => e.botones[0]?.startsWith('rampa_'))).toHaveLength(0);
      expect(textos(await chofer(`rampa_estado_si:${V1}`, 31))).toMatch(/ya no está vigente/);
    }
  });

  it('un botón de OTRO chofer o de otro viaje no toca nada', async () => {
    const { bitacora, chofer } = mundo();
    const ajeno = await atenderConductor({ ...base, operadorId: 'o-ajeno', texto: `rampa_estado_si:${V1}`, ahora: T0 }, (await import('./memoria.fixture')).crearMemoria({ viajes: [viajeBase({ id: V1 })] }).deps);
    expect(textos(ajeno)).toMatch(/otro viaje o ya no está vigente/);
    expect(textos(await chofer(`rampa_estado_si:11111111-1111-4111-8111-111111111111`, 1))).toMatch(/otro viaje o ya no está vigente/);
    expect(bitacora).toHaveLength(0);
  });

  it('si la bitácora no puede guardar, el chofer NO recibe un «anotado» falso y el cron no manda la pregunta', async () => {
    const { enviados, pasada, chofer, bitacora } = mundo({ guardaFalla: true });
    const r = await pasada();
    expect(enviados).toHaveLength(0);
    expect(r.fallos.join(' ')).toMatch(/no se pudo anotar la pregunta/);
    const resp = await chofer(`rampa_estado_si:${V1}`, 1);
    expect(textos(resp)).toMatch(/No pude anotarlo/);
    expect(textos(resp)).not.toMatch(/Anotado/);
    expect(bitacora).toHaveLength(0);
  });

  it('el reporte no guarda datos personales: el «cómo descargas» con teléfono, correo o enlace se descarta', async () => {
    const { enviados, bitacora, pasada, chofer } = mundo();
    await chofer(`hito_sin_contacto_anden:${V1}`);
    await pasada(1);
    await chofer(`rampa_estado_no_aplica:${V1}`, 2);
    await pasada(3);
    expect(enviados).toHaveLength(2);
    expect(await chofer('llamen al 2899900000009', 4)).toBeNull();
    expect(await chofer('escríbeme a alguien@ejemplo.test', 5)).toBeNull();
    expect(JSON.stringify(bitacora)).not.toMatch(/2899900000009|ejemplo\.test/);
  });
});
