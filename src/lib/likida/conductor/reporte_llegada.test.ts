import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const {
  interpretarRampa, interpretarRampaTexto, leerBotonRampa, limpiarComoDescarga, ESTADOS_RAMPA,
} = await import('./interprete');
const { agregarReubicacion, decidirReporteLlegada, estadoReporte, MAX_REUBICACIONES } = await import('./maquina');
const { preguntaRampa, textoRampa, acuseRampa, mensajePreguntaContacto } = await import('./mensajes');
const { armarPreguntaContacto, armarPreguntaReporte } = await import('./alertas_llegada');
const { conReporteDeLlegada, reporteLlegadaVista } = await import('./tablero');
const { hitoVacio, viajeBase } = await import('./memoria.fixture');
type HitoFila = import('./tipos').HitoFila;
type TipoHito = import('./tipos').TipoHito;
type Reubicacion = import('./maquina').Reubicacion;
type FilaTablero = import('./tablero').FilaTablero;

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const VIAJE = '11111111-1111-4111-8111-111111111111';
const OK = { permitido: true, razon: 'detenida' as const };
const NO = { permitido: false, razon: 'en_movimiento' as const };

function hitos(llegada: TipoHito | null, extra: Partial<HitoFila> = {}): HitoFila[] {
  return (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => hitoVacio({
    id: `h-${tipo}`, tipo, viajeId: 'v1', tenantId: 't1',
    ...(tipo === llegada ? { estado: 'recibido', fuente: 'boton', mensajeEn: hace(20), recibidoEn: hace(20), ...extra } : {}),
  }));
}

const base = {
  activo: true, servicio: 'importacion' as const, reubicaciones: [] as Reubicacion[], sinContacto: false,
  preguntados: {}, compuerta: OK, ahora: AHORA,
};

describe('interprete: rampa (T-A5-43)', () => {
  it('botones: estado del vocabulario, uuid validado y anclado', () => {
    for (const e of ESTADOS_RAMPA) expect(leerBotonRampa(`rampa_estado_${e}:${VIAJE}`)).toEqual({ accion: 'estado', estado: e, viajeId: VIAJE });
    expect(leerBotonRampa(`rampa_como_omitir:${VIAJE}`)).toEqual({ accion: 'omitir_como', viajeId: VIAJE });
    expect(leerBotonRampa('rampa_estado_si:no-es-uuid')).toBeNull();
    expect(leerBotonRampa(`rampa_estado_quizas:${VIAJE}`)).toBeNull();
    expect(leerBotonRampa(`rampa_estado_si:${VIAJE}:x`)).toBeNull();
    expect(leerBotonRampa(undefined)).toBeNull();
  });

  it('texto: cada rama de rampa', () => {
    expect(interpretarRampaTexto('rampa 7')).toMatchObject({ estado: 'si', numero: '7' });
    expect(interpretarRampaTexto('Me dieron la rampa B2')).toMatchObject({ estado: 'si', numero: 'B2' });
    expect(interpretarRampaTexto('12')).toMatchObject({ estado: 'si', numero: '12' });
    expect(interpretarRampaTexto('sí')).toMatchObject({ estado: 'si', numero: null });
    expect(interpretarRampaTexto('no')).toMatchObject({ estado: 'no', numero: null });
    expect(interpretarRampaTexto('No aplica')).toMatchObject({ estado: 'no_aplica' });
    expect(interpretarRampaTexto('a pie de calle')).toMatchObject({ estado: 'no_aplica' });
    expect(interpretarRampaTexto('en espera')).toMatchObject({ estado: 'en_espera' });
    expect(interpretarRampaTexto('todavía no me asignan')).toMatchObject({ estado: 'en_espera' });
  });

  it('texto que no es de rampa o es demasiado largo no se interpreta', () => {
    expect(interpretarRampaTexto('cargué diésel en la gasolinera')).toBeNull();
    expect(interpretarRampaTexto('x'.repeat(200))).toBeNull();
    expect(interpretarRampaTexto('')).toBeNull();
    expect(interpretarRampaTexto(undefined)).toBeNull();
  });

  it('botón primero, texto después', () => {
    expect(interpretarRampa(`rampa_estado_en_espera:${VIAJE}`)).toMatchObject({ estado: 'en_espera', via: 'boton', viajeId: VIAJE });
    expect(interpretarRampa('rampa 3')).toMatchObject({ estado: 'si', numero: '3', via: 'regla' });
  });

  it('«¿cómo descargas?»: una línea, sin enlaces ni teléfonos; vacío = nada', () => {
    expect(limpiarComoDescarga('  a pie   de calle ')).toBe('a pie de calle');
    expect(limpiarComoDescarga('mira http://x.mx')).toBeNull();
    expect(limpiarComoDescarga('llama al 3312345678')).toBeNull(); // grep-limpio:ok
    expect(limpiarComoDescarga('   ')).toBeNull();
    expect(limpiarComoDescarga('a'.repeat(300))).toHaveLength(120);
  });
});

describe('decidirReporteLlegada (T-A5-43)', () => {
  it('flujo feliz en importación: contacto → rampa → (no aplica) cómo descargas → completo', () => {
    const hs = hitos('llegada_descarga');
    expect(decidirReporteLlegada({ ...base, hitos: hs })).toEqual({ accion: 'preguntar', paso: 'contacto' });

    const conContacto = agregarReubicacion([], { contacto: 'Contacto Prueba' }, AHORA);
    expect(decidirReporteLlegada({ ...base, hitos: hs, reubicaciones: conContacto, preguntados: { contacto: hace(15) } }))
      .toEqual({ accion: 'preguntar', paso: 'rampa' });

    const sinRampa = agregarReubicacion(conContacto, { rampaEstado: 'no_aplica' }, AHORA);
    expect(decidirReporteLlegada({ ...base, hitos: hs, reubicaciones: sinRampa, preguntados: { contacto: hace(30), rampa: hace(20) } }))
      .toEqual({ accion: 'preguntar', paso: 'como_descarga' });

    const completo = agregarReubicacion(sinRampa, { comoDescarga: 'a pie de calle' }, AHORA);
    expect(decidirReporteLlegada({ ...base, hitos: hs, reubicaciones: completo }))
      .toEqual({ accion: 'nada', razon: 'completo' });
  });

  it('cada rama de rampa deja el viaje completo sin más preguntas (sí, no, en espera)', () => {
    const hs = hitos('llegada_descarga');
    for (const cambio of [{ rampaEstado: 'si' as const, rampa: '7' }, { rampaEstado: 'no' as const }, { rampaEstado: 'en_espera' as const }]) {
      const l = agregarReubicacion([], { contacto: 'Contacto Prueba', ...cambio }, AHORA);
      expect(decidirReporteLlegada({ ...base, hitos: hs, reubicaciones: l })).toEqual({ accion: 'nada', razon: 'completo' });
    }
  });

  it('la rampa SOLO existe en importación: exportación y nacional solo preguntan el contacto', () => {
    for (const servicio of ['exportacion', 'nacional'] as const) {
      const hs = hitos('llegada_carga');
      expect(decidirReporteLlegada({ ...base, servicio, hitos: hs })).toEqual({ accion: 'preguntar', paso: 'contacto' });
      const l = agregarReubicacion([], { contacto: 'Contacto Prueba' }, AHORA);
      expect(decidirReporteLlegada({ ...base, servicio, hitos: hs, reubicaciones: l })).toEqual({ accion: 'nada', razon: 'completo' });
    }
  });

  it('unidad en movimiento (o compuerta sin evaluar) → no pregunta', () => {
    const hs = hitos('llegada_descarga');
    expect(decidirReporteLlegada({ ...base, hitos: hs, compuerta: NO })).toEqual({ accion: 'nada', razon: 'en_movimiento' });
    expect(decidirReporteLlegada({ ...base, hitos: hs, compuerta: null })).toEqual({ accion: 'nada', razon: 'en_movimiento' });
  });

  it('apagado hasta la fase 2 y sin llegada registrada: no pregunta', () => {
    expect(decidirReporteLlegada({ ...base, activo: false, hitos: hitos('llegada_descarga') })).toEqual({ accion: 'nada', razon: 'apagado' });
    expect(decidirReporteLlegada({ ...base, hitos: hitos(null) })).toEqual({ accion: 'nada', razon: 'sin_llegada' });
    // importación cuelga de la llegada a DESCARGA: una llegada a carga no cuenta
    expect(decidirReporteLlegada({ ...base, hitos: hitos('llegada_carga') })).toEqual({ accion: 'nada', razon: 'sin_llegada' });
  });

  it('una sola pregunta por paso y sin insistir: lo ya preguntado no se repite', () => {
    const hs = hitos('llegada_descarga');
    // contacto preguntado hace 30 min y sin respuesta: no se repite; se sigue con la rampa
    expect(decidirReporteLlegada({ ...base, hitos: hs, preguntados: { contacto: hace(30) } })).toEqual({ accion: 'preguntar', paso: 'rampa' });
    // los dos preguntados y vencidos: nada más
    expect(decidirReporteLlegada({ ...base, hitos: hs, preguntados: { contacto: hace(60), rampa: hace(30) } }))
      .toEqual({ accion: 'nada', razon: 'completo' });
  });

  it('sin respuesta no bloquea: dentro del plazo espera y no encima dos preguntas; vencido, avanza', () => {
    const hs = hitos('llegada_descarga');
    expect(decidirReporteLlegada({ ...base, hitos: hs, preguntados: { contacto: hace(2) } })).toEqual({ accion: 'nada', razon: 'esperando_respuesta' });
    expect(decidirReporteLlegada({ ...base, hitos: hs, preguntados: { contacto: hace(11) } })).toEqual({ accion: 'preguntar', paso: 'rampa' });
    expect(decidirReporteLlegada({ ...base, hitos: hs, preguntados: { contacto: hace(2) }, esperaMin: 1 })).toEqual({ accion: 'preguntar', paso: 'rampa' });
  });

  it('«aún no tengo contacto» (en el hito o en la entrada) es una respuesta, no un hueco', () => {
    const hs = hitos('llegada_descarga', { sinContacto: true });
    expect(decidirReporteLlegada({ ...base, hitos: hs })).toEqual({ accion: 'preguntar', paso: 'rampa' });
    expect(decidirReporteLlegada({ ...base, hitos: hitos('llegada_descarga'), sinContacto: true })).toEqual({ accion: 'preguntar', paso: 'rampa' });
  });

  it('un contacto que ya trae el hito no se vuelve a preguntar', () => {
    const hs = hitos('llegada_descarga', { contactoNombre: 'Contacto Prueba' });
    expect(decidirReporteLlegada({ ...base, hitos: hs })).toEqual({ accion: 'preguntar', paso: 'rampa' });
  });
});

describe('lista de reubicaciones (T-A5-43)', () => {
  it('cada cambio de rampa o contacto agrega un registro con hora; hereda lo vigente', () => {
    const t0 = new Date('2026-10-02T17:00:00.000Z');
    const t1 = new Date('2026-10-02T17:30:00.000Z');
    const t2 = new Date('2026-10-02T18:00:00.000Z');
    let l = agregarReubicacion([], { contacto: 'Contacto Uno', rampaEstado: 'si', rampa: '3' }, t0, 'cliente');
    l = agregarReubicacion(l, { rampa: '9' }, t1, 'cliente');
    l = agregarReubicacion(l, { contacto: 'Contacto Dos' }, t2, 'chofer');
    expect(l.map((r) => [r.en, r.contacto, r.rampa, r.ordenadoPor])).toEqual([
      [t0.toISOString(), 'Contacto Uno', '3', 'cliente'],
      [t1.toISOString(), 'Contacto Uno', '9', 'cliente'],
      [t2.toISOString(), 'Contacto Dos', '9', 'chofer'],
    ]);
    expect(estadoReporte(l)?.contacto).toBe('Contacto Dos');
  });

  it('repetir lo vigente no agrega registro ni mueve la hora; no muta la lista de entrada', () => {
    const l0 = agregarReubicacion([], { contacto: 'Contacto Uno', rampaEstado: 'si', rampa: '3' }, AHORA);
    const l1 = agregarReubicacion(l0, { contacto: 'contacto uno', rampa: '3' }, new Date(AHORA.getTime() + 60_000));
    expect(l1).toEqual(l0);
    expect(l0).toHaveLength(1);
  });

  it('el número de rampa solo vive con «sí» y «cómo descargas» solo con «no aplica»', () => {
    let l = agregarReubicacion([], { rampaEstado: 'si', rampa: '4' }, AHORA);
    l = agregarReubicacion(l, { rampaEstado: 'no_aplica', comoDescarga: 'a granel' }, AHORA);
    expect(estadoReporte(l)).toMatchObject({ rampaEstado: 'no_aplica', rampa: null, comoDescarga: 'a granel' });
    l = agregarReubicacion(l, { rampaEstado: 'en_espera' }, AHORA);
    expect(estadoReporte(l)).toMatchObject({ rampaEstado: 'en_espera', rampa: null, comoDescarga: null });
  });

  it('tiene tope (frena un bucle de mensajes) y conserva los más recientes', () => {
    let l: Reubicacion[] = [];
    for (let i = 0; i < MAX_REUBICACIONES + 5; i++) l = agregarReubicacion(l, { rampaEstado: 'si', rampa: String(i + 1) }, new Date(AHORA.getTime() + i * 1000));
    expect(l).toHaveLength(MAX_REUBICACIONES);
    expect(estadoReporte(l)?.rampa).toBe(String(MAX_REUBICACIONES + 5));
  });
});

describe('mensajes y plantilla (T-A5-43)', () => {
  it('la rampa se pregunta en dos páginas de ≤ 3 botones (Meta) que cubren los cuatro estados, con el viaje en el id y títulos de ≤ 20 caracteres', () => {
    const p0 = preguntaRampa(VIAJE, 0);
    const p1 = preguntaRampa(VIAJE, 1);
    expect(p0.botones).toHaveLength(3);
    expect(p1.botones!.length).toBeLessThanOrEqual(3);
    const ids = [...p0.botones!, ...p1.botones!].map((o) => o.id);
    for (const e of ESTADOS_RAMPA) expect(ids).toContain(`rampa_estado_${e}:${VIAJE}`);
    for (const o of [...p0.botones!, ...p1.botones!]) expect(o.titulo.length).toBeLessThanOrEqual(20);
    for (const id of ids) expect(leerBotonRampa(id)?.viajeId).toBe(VIAJE);
    expect(leerBotonRampa(`rampa_mas:${VIAJE}`)).toEqual({ accion: 'mas', viajeId: VIAJE });
    expect(leerBotonRampa(`rampa_mas:no-es-uuid`)).toBeNull();
  });

  it('el texto de la rampa por estado, y el acuse nunca vuelve a preguntar', () => {
    expect(textoRampa({ rampaEstado: 'si', rampa: '7', comoDescarga: null })).toBe('Rampa 7');
    expect(textoRampa({ rampaEstado: 'no_aplica', rampa: null, comoDescarga: 'a granel' })).toContain('a granel');
    expect(textoRampa({ rampaEstado: 'en_espera', rampa: null, comoDescarga: null })).toBe('En espera de rampa');
    expect(textoRampa(null)).toBeNull();
    for (const e of ESTADOS_RAMPA) expect(acuseRampa(e, '7')).not.toContain('?');
  });

  it('el contacto: botón «Aún sin contacto» (≤ 20 caracteres) y plantilla de reserva conductor_contacto_anden_v1 (tres variables, botón con el viaje)', () => {
    const v = viajeBase({ id: VIAJE, folio: 'F-1042', destino: 'Cliente Sintetico', operadorNombre: 'Chofer Prueba' });
    const h = hitos('llegada_descarga').find((x) => x.tipo === 'llegada_descarga')!;
    const m = armarPreguntaContacto(v, h);
    expect(m.botones).toEqual([{ id: `hito_sin_contacto_anden:${VIAJE}`, titulo: 'Aún sin contacto' }]);
    expect(m.plantilla.nombre).toBe('conductor_contacto_anden_v1');
    expect(m.plantilla.parametros).toEqual(['Chofer', 'Cliente Sintetico', 'F-1042']);
    expect(mensajePreguntaContacto({ viajeId: VIAJE, folio: null, origen: null, destino: null }).texto).toContain('¿Con quién te reportaste?');
  });

  it('armarPreguntaReporte arma el mensaje de cada paso (texto, botones y plantilla de reserva)', () => {
    const v = viajeBase({ id: VIAJE });
    const h = hitos('llegada_descarga').find((x) => x.tipo === 'llegada_descarga')!;
    expect(armarPreguntaReporte('contacto', v, h).plantilla.nombre).toBe('conductor_contacto_anden_v1');
    const r = armarPreguntaReporte('rampa', v, h);
    expect(r.botones.map((b) => b.id)).toEqual([`rampa_estado_si:${VIAJE}`, `rampa_estado_no:${VIAJE}`, `rampa_mas:${VIAJE}`]);
    expect(armarPreguntaReporte('rampa', v, h, 1).botones.map((b) => b.id)).toEqual([`rampa_estado_no_aplica:${VIAJE}`, `rampa_estado_en_espera:${VIAJE}`]);
    expect(armarPreguntaReporte('como_descarga', v, h).botones[0].id).toBe(`rampa_como_omitir:${VIAJE}`);
  });
});

describe('tablero: contacto y rampa (T-A5-43)', () => {
  const vista = (id: string, contacto: string | null) => ({ id, tipo: 'llegada_descarga', contacto } as unknown as FilaTablero['hitos'][number]);
  const fila = (hs: FilaTablero['hitos']) => ({ hitos: hs } as unknown as FilaTablero);

  it('muestra contacto vigente, rampa, número de reubicaciones e historial', () => {
    let l = agregarReubicacion([], { contacto: 'Contacto Uno', rampaEstado: 'si', rampa: '3' }, new Date('2026-10-02T17:00:00.000Z'));
    l = agregarReubicacion(l, { rampa: '9', contacto: 'Contacto Dos' }, new Date('2026-10-02T17:30:00.000Z'));
    const r = reporteLlegadaVista(null, l)!;
    expect(r).toMatchObject({ contacto: 'Contacto Dos', rampa: 'Rampa 9', reubicaciones: 1 });
    expect(r.historial.map((x) => x.rampa)).toEqual(['Rampa 3', 'Rampa 9']);
  });

  it('sin lista ni contacto no inventa nada; con contacto del hito y sin lista usa el del hito', () => {
    expect(reporteLlegadaVista(null, [])).toBeNull();
    expect(reporteLlegadaVista('Contacto Hito', [])).toMatchObject({ contacto: 'Contacto Hito', rampa: null, reubicaciones: 0 });
  });

  it('conReporteDeLlegada solo toca el hito que tiene lista y no muta las filas', () => {
    const l = agregarReubicacion([], { rampaEstado: 'en_espera' }, AHORA);
    const f = fila([vista('a', 'Contacto A'), vista('b', null)]);
    const [out] = conReporteDeLlegada([f], new Map([['a', l]]));
    expect(out.hitos[0].reporte).toMatchObject({ contacto: 'Contacto A', rampa: 'En espera de rampa' });
    expect(out.hitos[1].reporte).toBeUndefined();
    expect(f.hitos[0].reporte).toBeUndefined();
    expect(conReporteDeLlegada([f], new Map())[0].hitos[0].reporte).toBeUndefined();
  });
});
