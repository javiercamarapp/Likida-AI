import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor, atenderPinConductor, hitoParaEvidenciaDelChofer, registrarEvidenciaDelChofer, registrarHitoDesdeFoto, TEXTO_PEDIR_UBICACION } = await import('./atender');
const { crearMemoria, viajeBase } = await import('./memoria.fixture');
type Memoria = ReturnType<typeof import('./memoria.fixture').crearMemoria>;

const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const AHORA = new Date('2026-10-02T20:00:00.000Z');
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };
const nueva = (o: Parameters<typeof crearMemoria>[0] = {}) => crearMemoria({ viajes: [viajeBase({ id: V1, unidadId: 'u1' })], ...o });
const dice = (m: Memoria, texto: string, extra: Record<string, unknown> = {}) => atenderConductor({ ...base, texto, waMessageId: `wa-${Math.random()}`, ...extra }, m.deps);
const textos = (r: Awaited<ReturnType<typeof dice>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

function salidaValidar(resultado: 'validado' | 'sin_coincidencia' | 'sin_dato', extra: Record<string, unknown> = {}) {
  return {
    veredicto: { resultado, motivo: resultado === 'sin_dato' ? 'sin_ubicacion' : null, fuente: resultado === 'sin_dato' ? null : 'pin', distanciaM: resultado === 'sin_dato' ? null : 480, toleranciaM: 150, radioM: 300, sitioId: 's1', medidaEn: AHORA },
    aplicado: 'nuevo', sitioNombre: 'Planta Zapopan', pedirUbicacion: false, ...extra,
  } as never;
}

describe('la llegada se valida contra el sitio al registrarse', () => {
  it('«ya llegué» (llegada a carga) dispara la validación con el hito YA recibido y la hora del mensaje', async () => {
    const m = nueva();
    await dice(m, 'ya llegué', { mensajeEn: min(-3) });
    expect(m.validaciones).toEqual([{ hito: expect.any(String), tipo: 'llegada_carga', pin: false }]);
  });

  it('sin ubicación y con sitio: el resultado trae la solicitud de ubicación para mandarla DESPUÉS del acuse', async () => {
    const m = nueva();
    m.validarResultado.valor = salidaValidar('sin_dato', { pedirUbicacion: true });
    const r = await dice(m, 'ya llegué');
    expect(r?.solicitarUbicacion).toBe(TEXTO_PEDIR_UBICACION);
    expect(textos(r)).toMatch(/llegaste a CARGAR/);
    // El texto dice para qué se usa la ubicación (transparencia: es un dato personal).
    expect(TEXTO_PEDIR_UBICACION).toMatch(/Solo se usa para comprobar que estás en el sitio/);
  });

  it('con GPS que ya validó, no se le pide nada al chofer', async () => {
    const m = nueva();
    m.validarResultado.valor = salidaValidar('validado');
    const r = await dice(m, 'ya llegué');
    expect(r?.solicitarUbicacion).toBeUndefined();
  });

  it('la validación NUNCA retrasa ni rompe el acuse: si devuelve null, el hito igual queda registrado', async () => {
    const m = nueva();
    m.validarResultado.valor = null;
    const r = await dice(m, 'ya llegué');
    expect(textos(r)).toMatch(/Anotado/);
    expect(m.de(V1).find((h) => h.tipo === 'llegada_carga')?.estado).toBe('recibido');
  });

  it('un duplicado («ya llegué» otra vez) no vuelve a validar ni a pedir', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    const antes = m.validaciones.length;
    await dice(m, 'ya llegué a cargar');
    expect(m.validaciones.length).toBe(antes);
  });

  it('con la confirmación al chofer apagada, la solicitud de ubicación sigue yendo', async () => {
    const m = nueva({ config: { confirmarAlChofer: false } });
    m.validarResultado.valor = salidaValidar('sin_dato', { pedirUbicacion: true });
    const r = await dice(m, 'ya llegué');
    expect(r?.mensajes).toEqual([]);
    expect(r?.solicitarUbicacion).toBe(TEXTO_PEDIR_UBICACION);
  });

  it('una salida de carga NO pide ubicación aunque el validador (hipotéticamente) lo dijera', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    m.validarResultado.valor = null;
    const r = await dice(m, 'ya cargué');
    expect(r?.solicitarUbicacion).toBeUndefined();
  });
});

describe('la invitación opcional a mandar la foto', () => {
  it('apagada por defecto: el acuse de la salida no la menciona', async () => {
    const m = nueva();
    await dice(m, 'ya llegué a cargar');
    expect(textos(await dice(m, 'ya cargué'))).not.toMatch(/foto del sello/);
  });

  it('encendida: la salida de carga invita al «sello», la llegada al «andén» y la salida de descarga al «recibido»', async () => {
    const m = nueva({ config: { pedirFotoEvidencia: true } });
    expect(textos(await dice(m, 'ya llegué a cargar'))).toMatch(/«andén»/);
    expect(textos(await dice(m, 'ya cargué'))).toMatch(/foto del sello y escribe «sello»/);
    await dice(m, 'ya llegué a descargar');
    expect(textos(await dice(m, 'ya descargué'))).toMatch(/«recibido»/);
  });

  it('no invita cuando el hito no se registró (duplicado)', async () => {
    const m = nueva({ config: { pedirFotoEvidencia: true } });
    await dice(m, 'ya llegué a cargar');
    expect(textos(await dice(m, 'ya llegué a cargar'))).not.toMatch(/foto/);
  });
});

describe('atenderPinConductor: el pin se adjunta a la llegada y se compara', () => {
  const pin = { tenantId: 't1', operadorId: 'o1', viajeId: V1, lat: 20.72, lng: -103.39, ahora: AHORA };

  async function conLlegada(m: Memoria) {
    m.registrar(V1, 'llegada_carga', min(-5).toISOString());
  }

  it('validado: se adjunta, se valida con el pin y se le confirma al chofer', async () => {
    const m = nueva();
    await conLlegada(m);
    m.validarResultado.valor = salidaValidar('validado');
    const linea = await atenderPinConductor(pin, m.deps);
    expect(linea).toMatch(/quedó confirmada tu llegada a cargar en «Planta Zapopan»/);
    expect(m.validaciones.at(-1)).toMatchObject({ tipo: 'llegada_carga', pin: true });
    expect(m.de(V1).find((h) => h.tipo === 'llegada_carga')).toMatchObject({ lat: 20.72, lng: -103.39 });
  });

  it('sin coincidencia: se le dice SIN acusarlo — su aviso ya quedó anotado', async () => {
    const m = nueva();
    await conLlegada(m);
    m.validarResultado.valor = salidaValidar('sin_coincidencia');
    const linea = await atenderPinConductor(pin, m.deps);
    expect(linea).toMatch(/ya quedó anotado/);
    expect(linea).toMatch(/a 480 m/);
    expect(linea).toMatch(/otra entrada/);
    expect(linea).not.toMatch(/mintió|falso|incorrecto/i);
  });

  it('sin dato (no hay sitio): no se le dice nada', async () => {
    const m = nueva();
    await conLlegada(m);
    m.validarResultado.valor = salidaValidar('sin_dato');
    expect(await atenderPinConductor(pin, m.deps)).toBeNull();
  });

  it('sin una llegada reciente (un pin en ruta) no se compara ni se adjunta a nada', async () => {
    const m = nueva();
    expect(await atenderPinConductor(pin, m.deps)).toBeNull();
    expect(m.validaciones).toEqual([]);
  });

  it('una llegada de hace más de 30 minutos no es la que el pin responde', async () => {
    const m = nueva();
    m.deps.hitoLlegadaReciente = async () => null;
    m.registrar(V1, 'llegada_carga', min(-120).toISOString());
    expect(await atenderPinConductor(pin, m.deps)).toBeNull();
  });

  it('con la validación apagada por la flota no hace nada', async () => {
    const m = nueva({ config: { validarUbicacion: false } });
    await conLlegada(m);
    expect(await atenderPinConductor(pin, m.deps)).toBeNull();
    expect(m.validaciones).toEqual([]);
  });

  it('el viaje de OTRO chofer no se toca (el viaje tiene que ser de ese operador y flota)', async () => {
    const m = nueva();
    await conLlegada(m);
    expect(await atenderPinConductor({ ...pin, operadorId: 'o-otro' }, m.deps)).toBeNull();
    expect(await atenderPinConductor({ ...pin, tenantId: 't-otro' }, m.deps)).toBeNull();
    expect(m.validaciones).toEqual([]);
  });

  it('un viaje liquidado no se valida', async () => {
    const m = nueva({ viajes: [viajeBase({ id: V1, estatus: 'liquidado' })] });
    await conLlegada(m);
    expect(await atenderPinConductor(pin, m.deps)).toBeNull();
  });

  it('nunca lanza: una base caída devuelve null y el pin sigue su camino', async () => {
    const m = nueva();
    m.fallos.config = true;
    await expect(atenderPinConductor(pin, m.deps)).resolves.toBeNull();
  });

  it('usa la hora del pin según Meta cuando viene', async () => {
    const m = nueva();
    await conLlegada(m);
    const espia = vi.fn(m.deps.validarHito);
    m.deps.validarHito = espia;
    const enviadoEn = min(-1);
    await atenderPinConductor({ ...pin, enviadoEn }, m.deps);
    expect(espia.mock.calls[0][0].pin?.medidaEn).toEqual(enviadoEn);
  });
});

describe('la foto de evidencia', () => {
  const entrada = { tenantId: 't1', operadorId: 'o1', viajeId: V1, ahora: AHORA };

  it('el caption «sello» resuelve la salida de carga como destino', async () => {
    const m = nueva();
    m.registrar(V1, 'llegada_carga', min(-60).toISOString());
    m.registrar(V1, 'salida_carga', min(-5).toISOString());
    const r = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'sello' }, m.deps);
    expect(r?.tipo).toBe('sello');
    expect(r?.hito?.tipo).toBe('salida_carga');
  });

  it('un caption cualquiera NO es de este módulo (null: sigue como comprobante)', async () => {
    const m = nueva();
    expect(await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'diésel 800' }, m.deps)).toBeNull();
    expect(await hitoParaEvidenciaDelChofer({ ...entrada, caption: undefined }, m.deps)).toBeNull();
  });

  it('con el caption pero sin hito al cual colgarla y la foto-como-aviso APAGADA: devuelve el tipo y hito null (el processor lo dice y no descarga)', async () => {
    const m = nueva({ config: { fotoRegistraHito: false } });
    const r = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'sello' }, m.deps);
    expect(r).toEqual({ tipo: 'sello', hito: null });
  });

  describe('0483 · la foto ES el aviso', () => {
    const foto = (m: Memoria, tipo: 'anden' | 'sello' | 'recibido', extra: Record<string, unknown> = {}) => registrarHitoDesdeFoto({
      tenantId: 't1', operadorId: 'o1', telefono: base.telefono, viajeId: V1, tipo, ruta: `t1/${V1}/ev_x.jpg`, sha256: 'e'.repeat(64), waMessageId: 'wamid.foto', mensajeEn: min(-4), ahora: AHORA, ...extra,
    }, m.deps);

    it('un «andén» sin nada registrado registra la LLEGADA A CARGAR con fuente foto, la hora del mensaje y la foto de evidencia', async () => {
      const m = nueva();
      const previa = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'andén' }, m.deps);
      expect(previa).toEqual({ tipo: 'anden', hito: null, comoHito: 'llegada_carga' });
      const r = await foto(m, 'anden');
      const h = m.de(V1).find((x) => x.tipo === 'llegada_carga')!;
      expect(h).toMatchObject({ estado: 'recibido', fuente: 'foto', interpretacion: 'foto', mensajeEn: min(-4).toISOString() });
      expect(m.evidencias).toEqual([expect.objectContaining({ hitoId: h.id, tipo: 'anden', waMessageId: 'wamid.foto' })]);
      expect(textos(r)).toMatch(/llegaste a CARGAR/);
      expect(textos(r)).toMatch(/Lo anoté con tu foto de el andén/);
      expect(m.validaciones).toEqual([{ hito: h.id, tipo: 'llegada_carga', pin: false }]);   // como cualquier llegada: se compara con el sitio
    });

    it('un «andén» ya salido de la carga registra la LLEGADA A DESCARGAR (no cuelga la foto de la carga)', async () => {
      const m = nueva();
      m.registrar(V1, 'llegada_carga', min(-300).toISOString());
      m.registrar(V1, 'salida_carga', min(-240).toISOString());
      const previa = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'andén' }, m.deps);
      expect(previa).toMatchObject({ hito: null, comoHito: 'llegada_descarga' });
      await foto(m, 'anden');
      expect(m.de(V1).find((x) => x.tipo === 'llegada_descarga')).toMatchObject({ estado: 'recibido', fuente: 'foto' });
    });

    it('un «andén» AMBIGUO (llegó a cargar y no ha salido) no adivina: se cuelga de la parada donde está, como siempre', async () => {
      const m = nueva();
      m.registrar(V1, 'llegada_carga', min(-30).toISOString());
      const previa = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'andén' }, m.deps);
      expect(previa?.comoHito).toBeUndefined();
      expect(previa?.hito?.tipo).toBe('llegada_carga');
    });

    it('un «sello» registra la SALIDA DE LA CARGA aunque la llegada ya esté (el sello es la carga terminada)', async () => {
      const m = nueva();
      m.registrar(V1, 'llegada_carga', min(-90).toISOString());
      const previa = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'sello' }, m.deps);
      expect(previa).toEqual({ tipo: 'sello', hito: null, comoHito: 'salida_carga' });
      const r = await foto(m, 'sello');
      expect(m.de(V1).find((x) => x.tipo === 'salida_carga')).toMatchObject({ estado: 'recibido', fuente: 'foto', interpretacion: 'foto' });
      expect(m.de(V1).find((x) => x.tipo === 'llegada_carga')?.estado).toBe('recibido');       // la llegada NO se toca
      expect(textos(r)).toMatch(/Lo anoté con tu foto de el sello/);
    });

    it('un «sello» sin la llegada registrada: la salida entra y la llegada pendiente se marca omitida (fuera de orden, como un texto)', async () => {
      const m = nueva();
      await foto(m, 'sello');
      expect(m.de(V1).find((x) => x.tipo === 'salida_carga')?.estado).toBe('recibido');
      expect(m.de(V1).find((x) => x.tipo === 'llegada_carga')).toMatchObject({ estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' });
    });

    it('un «recibido» registra la SALIDA DE LA DESCARGA', async () => {
      const m = nueva();
      m.registrar(V1, 'llegada_carga', min(-400).toISOString());
      m.registrar(V1, 'salida_carga', min(-300).toISOString());
      m.registrar(V1, 'llegada_descarga', min(-100).toISOString());
      const previa = await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'recibido' }, m.deps);
      expect(previa).toEqual({ tipo: 'recibido', hito: null, comoHito: 'salida_descarga' });
      await foto(m, 'recibido');
      expect(m.de(V1).find((x) => x.tipo === 'salida_descarga')).toMatchObject({ estado: 'recibido', fuente: 'foto' });
    });

    it('con la perilla APAGADA la foto no registra nada: queda como evidencia de lo ya registrado (o «primero dime»)', async () => {
      const m = nueva({ config: { fotoRegistraHito: false } });
      expect(await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'andén' }, m.deps)).toEqual({ tipo: 'anden', hito: null });
      const r = await foto(m, 'anden');
      expect(textos(r)).toMatch(/Primero dime/);
      expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
      expect(m.evidencias).toHaveLength(0);
    });

    it('«otra» (o un caption que no es de evidencia) jamás es un aviso', async () => {
      const m = nueva();
      expect(await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'diésel 800' }, m.deps)).toBeNull();
      const r = await registrarHitoDesdeFoto({ tenantId: 't1', operadorId: 'o1', telefono: base.telefono, viajeId: V1, tipo: 'otra', ruta: 'x', sha256: 'f'.repeat(64), ahora: AHORA }, m.deps);
      expect(textos(r)).toMatch(/Primero dime/);
      expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
    });

    it('la hora es la del MENSAJE y nunca del futuro; el reintento del webhook (mismo mensaje) no duplica ni el hito ni la foto', async () => {
      const m = nueva();
      await foto(m, 'anden', { mensajeEn: min(30) });                                  // un timestamp del futuro se recorta al reloj
      expect(new Date(m.de(V1).find((x) => x.tipo === 'llegada_carga')!.mensajeEn!).getTime()).toBeLessThanOrEqual(AHORA.getTime());
      const antes = m.evidencias.length;
      const otra = await foto(m, 'anden');                                              // reentrega: ya hay hito, es evidencia duplicada
      expect(textos(otra)).toMatch(/ya la tenía/);
      expect(m.evidencias.length).toBe(antes);
      expect(m.de(V1).filter((h) => h.estado === 'recibido')).toHaveLength(1);
    });

    it('el aviso de la foto respeta «confirmar al chofer» apagado (silencio) y la solicitud de ubicación sigue yendo', async () => {
      const m = nueva({ config: { confirmarAlChofer: false } });
      m.validarResultado.valor = salidaValidar('sin_dato', { pedirUbicacion: true });
      const r = await foto(m, 'anden');
      expect(r.mensajes).toEqual([]);
      expect(r.solicitarUbicacion).toBe(TEXTO_PEDIR_UBICACION);
    });

    it('el viaje de OTRO chofer o de otra flota: la foto no registra nada', async () => {
      const m = nueva();
      expect(textos(await foto(m, 'anden', { operadorId: 'o-otro' }))).toMatch(/Primero dime/);
      expect(textos(await foto(m, 'anden', { tenantId: 't-otro' }))).toMatch(/Primero dime/);
      expect(m.de(V1).every((h) => h.estado === 'esperado')).toBe(true);
    });

    it('un viaje liquidado no recibe avisos de una foto', async () => {
      const m = nueva({ viajes: [viajeBase({ id: V1, unidadId: 'u1', estatus: 'liquidado' })] });
      expect(await hitoParaEvidenciaDelChofer({ ...entrada, caption: 'andén' }, m.deps)).toEqual({ tipo: 'anden', hito: null });
    });
  });

  it('el viaje de otro chofer o de otra flota nunca aporta hito', async () => {
    const m = nueva();
    m.registrar(V1, 'salida_carga', min(-5).toISOString());
    expect((await hitoParaEvidenciaDelChofer({ ...entrada, operadorId: 'o-otro', caption: 'sello' }, m.deps))?.hito).toBeNull();
    expect((await hitoParaEvidenciaDelChofer({ ...entrada, tenantId: 't-otro', caption: 'sello' }, m.deps))?.hito).toBeNull();
  });

  it('registrar: guarda, deja el evento y confirma; la misma foto otra vez es «ya la tenía»', async () => {
    const m = nueva();
    m.registrar(V1, 'salida_carga', min(-5).toISOString());
    const hito = m.de(V1).find((h) => h.tipo === 'salida_carga')!;
    const a = { tenantId: 't1', hito, tipo: 'sello' as const, ruta: `t1/${V1}/ev_x.jpg`, sha256: 'a'.repeat(64), waMessageId: 'wamid.1', ahora: AHORA };
    expect(await registrarEvidenciaDelChofer(a, m.deps)).toMatch(/Recibí la foto de el sello/);
    expect(m.eventos.some((e) => e.evento === 'evidencia')).toBe(true);
    expect(await registrarEvidenciaDelChofer(a, m.deps)).toMatch(/ya la tenía/);
    // El reintento del webhook con otro hash pero el mismo mensaje también es duplicado.
    expect(await registrarEvidenciaDelChofer({ ...a, sha256: 'b'.repeat(64) }, m.deps)).toMatch(/ya la tenía/);
    expect(m.evidencias).toHaveLength(1);
  });

  it('si el hito se retiró mientras se subía la foto, se dice que falta el aviso (no se cuelga de otra cosa)', async () => {
    const m = nueva();
    m.registrar(V1, 'salida_carga', min(-5).toISOString());
    const hito = { ...m.de(V1).find((h) => h.tipo === 'salida_carga')! };
    m.hitos.set(hito.id, { ...m.hitos.get(hito.id)!, estado: 'esperado' });
    const msg = await registrarEvidenciaDelChofer({ tenantId: 't1', hito, tipo: 'sello', ruta: 'x', sha256: 'c'.repeat(64), ahora: AHORA }, m.deps);
    expect(msg).toMatch(/Primero dime/);
  });

  it('un fallo al guardar se dice (no se finge la foto guardada)', async () => {
    const m = nueva();
    m.registrar(V1, 'salida_carga', min(-5).toISOString());
    m.deps.guardarEvidencia = async () => { throw new Error('storage caído'); };
    const hito = m.de(V1).find((h) => h.tipo === 'salida_carga')!;
    expect(await registrarEvidenciaDelChofer({ tenantId: 't1', hito, tipo: 'sello', ruta: 'x', sha256: 'd'.repeat(64), ahora: AHORA }, m.deps)).toMatch(/No pude guardar/);
  });
});
