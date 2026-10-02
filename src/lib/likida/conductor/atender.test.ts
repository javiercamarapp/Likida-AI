import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor, atenderAcuseJefe, textoRespuestaSenalVida } = await import('./atender');
const { crearMemoria, viajeBase } = await import('./memoria.fixture');
type Memoria = ReturnType<typeof import('./memoria.fixture').crearMemoria>;

const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const AHORA = new Date('2026-10-02T20:00:00.000Z'); // 14:00 en México
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };
/** La memoria con el viaje de la prueba (id uuid: los botones lo exigen). */
const nueva = (o: Parameters<typeof crearMemoria>[0] = {}) => crearMemoria({ viajes: [viajeBase({ id: V1 })], ...o });

async function dice(m: Memoria, texto: string, extra: Record<string, unknown> = {}) {
  return atenderConductor({ ...base, texto, waMessageId: `wa-${Math.random()}`, ...extra }, m.deps);
}
const textos = (r: Awaited<ReturnType<typeof dice>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');
const estado = (m: Memoria, tipo: string) => m.de(V1).find((h) => h.tipo === tipo)!;

describe('«ya llegué»: el lugar lo decide el estado del viaje', () => {
  it('el primer «ya llegué» es la llegada a CARGAR: el acuse lo dice y NO se sella el legado del destino', async () => {
    const m = nueva();
    const r = await dice(m, 'ya llegué');
    expect(estado(m, 'llegada_carga')).toMatchObject({ estado: 'recibido', fuente: 'texto', interpretacion: 'regla' });
    expect(estado(m, 'llegada_descarga').estado).toBe('esperado');
    expect(m.legado).toEqual([]);
    expect(textos(r)).toMatch(/llegaste a CARGAR \(Planta Zapopan\) a las 14:00/);
    expect(textos(r)).toContain('¿Quién te atiende en el andén?');
    // Ofrece corregir por si en realidad estaba en la descarga.
    expect(r?.mensajes[0].botones).toEqual([{ id: `hito_corrige_llegada:${V1}`, titulo: 'Es en descarga' }]);
  });

  it('tras la salida de carga, «ya llegué» es la llegada a DESCARGAR y sella el legado `llegada`', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    await dice(m, 'ya cargué');
    // La ubicación confirma la llegada (sin ella, `viaje.llegada_en` no se sella: atender_ubicacion.test.ts).
    m.validarResultado.valor = { veredicto: { resultado: 'validado', motivo: null, fuente: 'gps', distanciaM: 20, toleranciaM: 150, radioM: 300, sitioId: 's1', medidaEn: AHORA }, aplicado: 'nuevo', sitioNombre: 'CEDIS Monterrey', pedirUbicacion: false };
    const r = await dice(m, 'ya llegué');
    expect(estado(m, 'llegada_descarga').estado).toBe('recibido');
    expect(m.legado).toEqual([{ viajeId: V1, sellos: ['llegada'] }]);
    expect(textos(r)).toMatch(/llegaste a DESCARGAR \(CEDIS Monterrey\)/);
    expect(r?.mensajes[0].botones).toBeUndefined();
  });

  it('con la llegada a carga registrada y nada más, un segundo «ya llegué» PREGUNTA en vez de adivinar', async () => {
    const m = nueva();
    await dice(m, 'ya llegué');
    const r = await dice(m, 'ya llegué');
    expect(estado(m, 'llegada_descarga').estado).toBe('esperado');
    expect(r?.mensajes[0].botones?.map((b) => b.id)).toEqual([`hito_llegada_descarga:${V1}`, `hito_sigue_cargando:${V1}`]);
    expect(textos(r)).toContain('¿Ya llegaste a DESCARGAR');
  });

  it('«Llegué a descargar» (botón) tras esa pregunta registra la descarga y marca la salida de carga como no reportada', async () => {
    const m = nueva();
    await dice(m, 'ya llegué');
    const r = await dice(m, `hito_llegada_descarga:${V1}`);
    expect(estado(m, 'llegada_descarga').estado).toBe('recibido');
    expect(estado(m, 'salida_carga')).toMatchObject({ estado: 'omitido', omitidoMotivo: 'inferido_por_llegada_descarga' });
    expect(textos(r)).toContain('No tenía anotado tu salida de la carga');
  });
});

describe('la secuencia completa por texto y por botón', () => {
  it('cinco mensajes, cinco hitos, cada uno con su hora del MENSAJE', async () => {
    const m = nueva({ config: { validarUbicacion: false } }); // sin validar ubicación, los sellos de la 0090 son inmediatos
    await dice(m, 'ya llegué a cargar', { mensajeEn: min(-300) });
    await dice(m, 'ya cargué', { mensajeEn: min(-240) });
    await dice(m, 'ya llegué a descargar', { mensajeEn: min(-60) });
    await dice(m, 'ya descargué', { mensajeEn: min(-30) });
    await dice(m, 'voy de regreso', { mensajeEn: min(-10) });
    expect(m.de(V1).map((h) => h.estado)).toEqual(['recibido', 'recibido', 'recibido', 'recibido', 'recibido']);
    expect(estado(m, 'llegada_carga').mensajeEn).toBe(min(-300).toISOString());
    expect(estado(m, 'regreso').mensajeEn).toBe(min(-10).toISOString());
    expect(m.legado.flatMap((l) => l.sellos).sort()).toEqual(['llegada', 'regreso']);
  });

  it('un botón registra el hito de SU payload', async () => {
    const m = nueva();
    const r = await dice(m, `hito_llegada_carga:${V1}`);
    expect(estado(m, 'llegada_carga')).toMatchObject({ estado: 'recibido', fuente: 'boton', interpretacion: 'boton' });
    expect(estado(m, 'llegada_carga').mensajeEn).not.toBeNull();
    expect(textos(r)).toContain('llegaste a CARGAR');
  });
});

describe('fuera de orden, duplicados y correcciones', () => {
  it('«ya salí» sin haber avisado la llegada registra la salida y deja la llegada sin hora', async () => {
    const m = nueva();
    const r = await dice(m, 'ya cargué');
    expect(estado(m, 'salida_carga').estado).toBe('recibido');
    expect(estado(m, 'llegada_carga')).toMatchObject({ estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' });
    expect(textos(r)).toContain('No tenía anotado tu llegada a cargar; lo dejé sin hora.');
  });

  it('el duplicado NO mueve la hora ni vuelve a escribir', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar', { mensajeEn: min(-20) });
    const r = await dice(m, 'ya llegué a cargar', { mensajeEn: min(-1) });
    expect(estado(m, 'llegada_carga').mensajeEn).toBe(min(-20).toISOString());
    expect(textos(r)).toBe('Ya lo tenía anotado. 👍');
  });

  it('el MISMO mensaje de WhatsApp reentregado no registra dos veces', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar', { waMessageId: 'wamid.1' });
    await dice(m, 'ya cargué', { waMessageId: 'wamid.1' });
    expect(estado(m, 'salida_carga').estado).toBe('esperado');
  });

  it('«me equivoqué» retira el último hito y regresa a esperado a los omitidos por su causa', async () => {
    const m = nueva();
    await dice(m, 'ya cargué');
    expect(estado(m, 'llegada_carga').estado).toBe('omitido');
    const r = await dice(m, 'me equivoqué', { ahora: min(10) });
    expect(estado(m, 'salida_carga')).toMatchObject({ estado: 'esperado', fuente: null, recibidoEn: null, correcciones: 1, ciclo: 2 });
    expect(estado(m, 'llegada_carga')).toMatchObject({ estado: 'esperado', ciclo: 2 });
    expect(textos(r)).toContain('retiré tu salida de la carga');
    expect(m.eventos.some((e) => e.evento === 'corregido')).toBe(true);
  });

  it('tras retirar, el chofer vuelve a registrar bien y queda UNA sola verdad', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    await dice(m, 'todavía no llego');
    expect(estado(m, 'llegada_carga').estado).toBe('esperado');
    await dice(m, 'ya llegué a cargar', { mensajeEn: min(30), ahora: min(30) });
    expect(estado(m, 'llegada_carga')).toMatchObject({ estado: 'recibido', mensajeEn: min(30).toISOString() });
  });

  it('«Es en descarga» corrige una llegada anotada en la carga: retira y registra la descarga', async () => {
    const m = nueva();
    await dice(m, 'ya llegué');
    const r = await dice(m, `hito_corrige_llegada:${V1}`);
    expect(estado(m, 'llegada_carga').estado).toBe('omitido');
    expect(estado(m, 'llegada_descarga').estado).toBe('recibido');
    expect(textos(r)).toContain('retiré tu llegada a cargar');
    expect(textos(r)).toContain('llegaste a DESCARGAR');
  });

  it('un hito validado por la oficina NO se retira desde WhatsApp', async () => {
    const m = nueva();
    m.registrar(V1, 'llegada_carga', AHORA.toISOString(), { estado: 'validado', validadoEn: AHORA.toISOString(), validadoPor: 'oficina' });
    const r = await dice(m, 'me equivoqué');
    expect(estado(m, 'llegada_carga').estado).toBe('validado');
    expect(textos(r)).toContain('ya lo validó tu oficina');
  });

  it('fuera de la ventana de corrección ya no se retira', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    const r = await dice(m, 'me equivoqué', { ahora: min(200) });
    expect(estado(m, 'llegada_carga').estado).toBe('recibido');
    expect(textos(r)).toContain('Ya pasó mucho tiempo');
  });

  it('el aplazamiento («voy con retraso») reinicia la escalera y tras dos veces avisa que ya no calla', async () => {
    const m = nueva();
    const r1 = await dice(m, 'voy con retraso, llego en 20 minutos');
    expect(estado(m, 'llegada_carga')).toMatchObject({ pospuestoVeces: 1, ciclo: 2 });
    expect(estado(m, 'llegada_carga').pospuestoHasta).toBe(min(20).toISOString());
    expect(textos(r1)).toContain('te vuelvo a preguntar en 20 min');
    await dice(m, 'voy tarde');
    const r3 = await dice(m, 'voy tarde otra vez');
    expect(estado(m, 'llegada_carga').pospuestoVeces).toBe(2);
    expect(textos(r3)).toContain('ya van varias veces');
  });
});

describe('contacto en andén', () => {
  it('llegada + contacto en un mensaje', async () => {
    const m = nueva();
    const r = await dice(m, 'ya estoy en andén, me atiende Juan de recibo');
    // «recibo» sugiere la descarga y el viaje no ha salido de la carga: el lugar explícito manda.
    expect(estado(m, 'llegada_descarga')).toMatchObject({ estado: 'recibido', contactoNombre: 'Juan', contactoArea: 'recibo' });
    expect(textos(r)).toContain('Te atiende Juan (recibo)');
  });

  it('el contacto llega DESPUÉS de la llegada', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    const r = await dice(m, 'me atiende Pedro López de embarques');
    expect(estado(m, 'llegada_carga')).toMatchObject({ contactoNombre: 'Pedro López', contactoArea: 'embarques' });
    expect(textos(r)).toBe('Anotado: te atiende Pedro López (embarques). 👍');
  });

  it('«sin contacto» lo deja explícito', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    await dice(m, 'sin contacto');
    expect(estado(m, 'llegada_carga')).toMatchObject({ sinContacto: true, contactoNombre: null });
    await dice(m, 'me atiende Luis de embarques');
    expect(estado(m, 'llegada_carga')).toMatchObject({ sinContacto: false, contactoNombre: 'Luis' });
  });
});

describe('lo que NO es del módulo sigue su camino (y sin tocar la base)', () => {
  it.each(['listo', 'ya quedó', 'gracias', 'llegué a cargar diésel en Querétaro', '¿ya llegué?', 'sí', 'hola buenas', 'jefe_atiendo:4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001'])(
    '«%s» → null', async (t) => {
      const m = nueva();
      const viajeDelOperador = vi.spyOn(m.deps, 'viajeDelOperador');
      expect(await dice(m, t)).toBeNull();
      expect(viajeDelOperador).not.toHaveBeenCalled();
    });

  it('sin viaje abierto, el texto libre no es de este módulo', async () => {
    const m = nueva();
    expect(await dice(m, 'ya llegué', { viajeAbiertoId: null })).toBeNull();
  });
});

describe('botones: nadie toca un viaje que no es suyo', () => {
  it('un payload con el viaje de OTRO chofer de la misma flota no registra nada', async () => {
    const m = crearMemoria({ viajes: [viajeBase({ id: V1 }), viajeBase({ id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d009', operadorId: 'o9' })] });
    const r = await dice(m, 'hito_llegada_carga:4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d009');
    expect(r?.mensajes[0].texto).toContain('otro viaje');
    expect(m.hitos.size).toBe(0);
  });

  it('un viaje de otra FLOTA tampoco', async () => {
    const m = crearMemoria({ viajes: [viajeBase({ id: V1, tenantId: 't2' })] });
    const r = await dice(m, `hito_llegada_carga:${V1}`, { viajeAbiertoId: null });
    expect(r?.mensajes[0].texto).toContain('otro viaje');
    expect(m.hitos.size).toBe(0);
  });

  it('el botón de un viaje ya liquidado se dice y no escribe', async () => {
    const id = V1;
    const m = crearMemoria({ viajes: [viajeBase({ id, estatus: 'liquidado' })] });
    const r = await dice(m, `hito_regreso:${id}`, { viajeAbiertoId: null });
    expect(textos(r)).toContain('ya está cerrado');
    expect(m.hitos.size).toBe(0);
  });

  it('«Tengo un problema» escala YA con el hito activo', async () => {
    const m = nueva();
    const escalar = vi.spyOn(m.deps, 'escalarPorProblema');
    const r = await dice(m, `recordatorio_problema:${V1}`);
    expect(escalar).toHaveBeenCalledTimes(1);
    expect(escalar.mock.calls[0][1]).toMatchObject({ tipo: 'llegada_carga' });
    expect(textos(r)).toContain('Ya le avisé a tu jefe de tráfico');
  });

  it('si no se pudo avisar al jefe, se dice y se da la salida', async () => {
    const m = nueva();
    m.deps.escalarPorProblema = async () => 'sin_envio';
    expect(textos(await dice(m, `recordatorio_problema:${V1}`))).toContain('No pude avisarle a tu jefe');
  });

  it('«Compartir ubicación» abre la solicitud de ubicación y no registra ningún hito', async () => {
    const m = nueva();
    const solicitar = vi.spyOn(m.deps, 'solicitarUbicacion');
    const r = await dice(m, `pedir_ubicacion:${V1}`);
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ mensajes: [] });
    expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
  });

  it('«Registrar ahora» registra el hito que se estaba pidiendo', async () => {
    const m = nueva();
    m.registrar(V1, 'llegada_carga', AHORA.toISOString());
    await dice(m, `recordatorio_registrar:${V1}:salida_carga`);
    expect(estado(m, 'salida_carga').estado).toBe('recibido');
    expect(estado(m, 'salida_carga').fuente).toBe('boton');
  });

  it('un recordatorio VIEJO tocado tarde no registra el hito que hoy toca', async () => {
    const m = nueva();
    m.registrar(V1, 'llegada_carga', AHORA.toISOString());
    const r = await dice(m, `recordatorio_registrar:${V1}:llegada_carga`);
    expect(estado(m, 'salida_carga').estado).toBe('esperado');
    expect(textos(r)).toBe('Ya lo tenía anotado. 👍');
  });
});

describe('el respaldo con modelo', () => {
  it('lo que las reglas no entienden pero parece un hito lo decide el modelo, con su fuente `llm`', async () => {
    const m = nueva();
    m.deps.llm = vi.fn(async () => ({ intencion: { clase: 'llegada' as const, lugar: 'carga' as const }, contacto: null, via: 'llm' as const, confianza: 0.93 }));
    const r = await dice(m, 'ya estoy formado en la fila de la puerta 4 esperando turno');
    expect(m.deps.llm).toHaveBeenCalledTimes(1);
    expect(estado(m, 'llegada_carga')).toMatchObject({ estado: 'recibido', interpretacion: 'llm' });
    expect(textos(r)).toContain('llegaste a CARGAR');
  });

  it('si el modelo no entiende (null) el mensaje sigue al agente: no se registra nada', async () => {
    const m = nueva();
    m.deps.llm = vi.fn(async () => null);
    expect(await dice(m, 'ya estoy formado en la fila de la puerta 4 esperando turno')).toBeNull();
    expect(m.hitos.size).toBe(5); // se sembraron, ninguno se tocó
    expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
  });

  it('la flota puede apagar el modelo', async () => {
    const m = nueva({ config: { usarLlm: false } });
    m.deps.llm = vi.fn(async () => null);
    expect(await dice(m, 'ya estoy formado en la fila de la puerta 4 esperando turno')).toBeNull();
    expect(m.deps.llm).not.toHaveBeenCalled();
  });

  it('un texto que las reglas SÍ entienden nunca paga una llamada', async () => {
    const m = nueva();
    m.deps.llm = vi.fn(async () => null);
    await dice(m, 'ya llegué');
    expect(m.deps.llm).not.toHaveBeenCalled();
  });
});

describe('falla cerrado y lo dice', () => {
  it('si no se puede escribir, el chofer lo sabe (no se finge la anotación)', async () => {
    const m = nueva();
    m.fallos.registrar = true;
    const r = await dice(m, 'ya llegué');
    expect(textos(r)).toContain('No pude anotarlo');
    expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
    expect(m.eventos).toHaveLength(0);
  });

  it('si la base no contesta (config) tampoco se afirma nada', async () => {
    const m = nueva();
    m.fallos.config = true;
    const r = await dice(m, 'ya llegué');
    expect(textos(r)).toContain('No pude anotarlo');
    expect(m.hitos.size).toBe(0);
  });

  it('con la confirmación apagada el hito se registra en silencio', async () => {
    const m = nueva({ config: { confirmarAlChofer: false } });
    const r = await dice(m, 'ya llegué');
    expect(r).toEqual({ mensajes: [] });
    expect(estado(m, 'llegada_carga').estado).toBe('recibido');
  });
});

describe('avisos a la oficina (configurables)', () => {
  it('apagados por defecto', async () => {
    const m = nueva();
    await dice(m, 'ya llegué');
    expect(m.oficina).toHaveLength(0);
  });

  it('llegada encendida avisa de llegadas, no de salidas', async () => {
    const m = nueva({ config: { avisarOficinaLlegada: true } });
    await dice(m, 'ya llegué a cargar, me atiende Pedro de embarques');
    await dice(m, 'ya cargué');
    expect(m.oficina).toHaveLength(1);
    expect(m.oficina[0].contacto).toEqual({ nombre: 'Pedro', area: 'embarques' });
  });

  it('salida encendida avisa de salidas y del regreso', async () => {
    const m = nueva({ config: { avisarOficinaSalida: true } });
    await dice(m, 'ya llegué a cargar');
    await dice(m, 'ya cargué');
    await dice(m, 'voy de regreso');
    expect(m.oficina).toHaveLength(2);
  });

  it('un duplicado no vuelve a avisar', async () => {
    const m = nueva({ config: { avisarOficinaLlegada: true } });
    await dice(m, 'ya llegué a cargar');
    await dice(m, 'ya llegué a cargar');
    expect(m.oficina).toHaveLength(1);
  });
});

describe('«ya lo atiendo» del jefe o del patio', () => {
  const V = V1;
  const mk = (puede: boolean, existe = true) => {
    const marcar = vi.fn(async () => [{ id: 'h', tenantId: 't1', viajeId: V, tipo: 'llegada_carga' as const }] as never[]);
    return {
      marcar,
      deps: {
        viajePorId: async () => (existe ? { tenantId: 't1' } : null),
        puedeAcusar: async () => puede,
        marcar,
        evento: vi.fn(async () => {}),
      },
    };
  };

  it('un contacto autorizado detiene la escalación', async () => {
    const x = mk(true);
    expect(await atenderAcuseJefe('5219990000099', `jefe_atiendo:${V}`, AHORA, x.deps)).toContain('lo marqué como atendido');
    expect(x.marcar).toHaveBeenCalledWith('t1', V, AHORA);
  });

  it('un número ajeno NO puede acusar, y recibe la misma respuesta que si el viaje no existiera', async () => {
    const x = mk(false);
    const ajeno = await atenderAcuseJefe('5210000000000', `jefe_atiendo:${V}`, AHORA, x.deps);
    const noExiste = await atenderAcuseJefe('5210000000000', `jefe_atiendo:${V}`, AHORA, mk(true, false).deps);
    expect(ajeno).toBe(noExiste);
    expect(x.marcar).not.toHaveBeenCalled();
  });

  it('lo que no es el botón del jefe devuelve null', async () => {
    const x = mk(true);
    expect(await atenderAcuseJefe('5219990000099', 'hola', AHORA, x.deps)).toBeNull();
    expect(await atenderAcuseJefe('5219990000099', `hito_llegada_carga:${V}`, AHORA, x.deps)).toBeNull();
  });

  it('si ya estaba atendido lo dice sin error', async () => {
    const x = mk(true);
    x.marcar.mockResolvedValueOnce([]);
    expect(await atenderAcuseJefe('5219990000099', `jefe_atiendo:${V}`, AHORA, x.deps)).toContain('Ya estaba atendido');
  });
});

describe('P2: los botones del «¿sigues bien?» (sin señal de vida)', () => {
  const llamadas: Array<[string, string, string]> = [];
  const conRespuesta = (m: Memoria, resultado: 'cerrado' | 'sin_episodio' | 'fallo') => {
    llamadas.length = 0;
    m.deps.responderSenalVida = async (t, v, r) => { llamadas.push([t, v, r]); return resultado; };
    return m;
  };

  it.each([['senal_vida_estoy', 'estoy'], ['senal_vida_cargar', 'voy_a_cargar'], ['senal_vida_bien', 'estoy_bien']])('«%s» cierra el episodio de ESE viaje y de ESA flota con la respuesta «%s» y contesta sin tocar los hitos', async (boton, respuesta) => {
    const m = conRespuesta(nueva(), 'cerrado');
    const r = await dice(m, `${boton}:${V1}`);
    expect(llamadas).toEqual([['t1', V1, respuesta]]);
    expect(textos(r)).toMatch(/anotado|Anotado/);
    expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
    expect(m.legado).toEqual([]);
  });

  it('un botón viejo (ya no hay episodio abierto) dice que ya no está vigente; un fallo de la base dice que no pudo anotarlo', async () => {
    expect(textos(await dice(conRespuesta(nueva(), 'sin_episodio'), `senal_vida_estoy:${V1}`))).toContain('ya no está vigente');
    expect(textos(await dice(conRespuesta(nueva(), 'fallo'), `senal_vida_estoy:${V1}`))).toContain('No pude anotarlo');
  });

  it('el botón de OTRO viaje (o tecleado a mano) no toca nada: la respuesta nunca llega a cerrar episodios ajenos', async () => {
    const m = conRespuesta(nueva(), 'cerrado');
    const r = await dice(m, `senal_vida_estoy:4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d999`);
    expect(llamadas).toEqual([]);
    expect(textos(r)).toContain('otro viaje');
  });

  it('un viaje liquidado no responde la señal de vida', async () => {
    const m = conRespuesta(crearMemoria({ viajes: [viajeBase({ id: V1, estatus: 'liquidado' })] }), 'cerrado');
    expect(textos(await dice(m, `senal_vida_estoy:${V1}`))).toContain('ya está cerrado');
    expect(llamadas).toEqual([]);
  });

  it('los textos de respuesta: «voy a cargar» promete volver a preguntar en una hora; «estoy bien» manda al jefe si hay problema', () => {
    expect(textoRespuestaSenalVida('voy_a_cargar', 'cerrado', 'F-1')).toContain('una hora');
    expect(textoRespuestaSenalVida('estoy_bien', 'cerrado', null)).toContain('jefe de tráfico');
    expect(textoRespuestaSenalVida('estoy', 'cerrado', 'F-1')).toContain('del viaje F-1');
  });

  it('el «Ya lo atiendo» del jefe también cierra el episodio de señal de vida, aunque no haya hito escalado', async () => {
    const cerrados: string[] = [];
    const deps = {
      viajePorId: async () => ({ tenantId: 't1' }), puedeAcusar: async () => true, marcar: async () => [], evento: async () => {},
      cerrarSenalVida: async (_t: string, v: string) => { cerrados.push(v); return 1; },
    };
    expect(await atenderAcuseJefe('5219990000099', `jefe_atiendo:${V1}`, AHORA, deps)).toContain('lo marqué como atendido');
    expect(cerrados).toEqual([V1]);
  });
});
