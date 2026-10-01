import { describe, it, expect } from 'vitest';
import { redactarBorrador, guardiaDePulido, pulirBorrador, aLineaPlantilla, MAX_RESPUESTA, type EntradaRedaccion, type PuertoPulir } from './redactor';
import { AHORA, estatus, resumen } from './datos.fixture';

const base = (c: Partial<EntradaRedaccion> = {}): EntradaRedaccion => ({
  clasificacion: { intencion: 'ubicacion', secundarias: [], senales: [] },
  nombreContacto: 'María Pérez', nombreFlota: 'Transportes del Norte',
  viaje: { tipo: 'uno', estatus: estatus() },
  ahora: AHORA, primerContacto: false, avisoPrivacidadUrl: null,
  ...c,
});

describe('ubicación con datos reales', () => {
  it('dice la etapa, el folio, la ruta y la posición con su antigüedad', () => {
    const b = redactarBorrador(base());
    expect(b.texto).toContain('Hola María');
    expect(b.texto).toContain('F-1042');
    expect(b.texto).toContain('Guadalajara → Monterrey');
    expect(b.texto).toContain('hace 12 min');
    expect(b.texto).toContain('https://maps.google.com/?q=21.16190,-101.69210');
    expect(b.faltantes).toEqual([]);
    expect(b.riesgo).toBe('bajo');
    expect(b.requiereHumano).toBe(false);
    expect(b.origen).toBe('plantilla');
    expect(b.respaldo).toMatchObject({ viajeId: expect.any(String), folio: 'F-1042' });
  });

  it('la posición vieja se declara vieja y no se presenta como actual', () => {
    const vieja = estatus({ posicion: { lat: 21.1, lng: -101.6, medidaEn: new Date(AHORA.getTime() - 5 * 3_600_000).toISOString() } });
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: vieja } }));
    expect(b.texto).toContain('hace 5 h, no es actual');
    expect(b.texto).not.toMatch(/Última posición del GPS \(/);
  });

  it('SIN GPS: lo dice y lo marca como faltante (no inventa una posición)', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ posicion: null }) } }));
    expect(b.texto).toContain('Todavía no tengo posición GPS');
    expect(b.texto).not.toContain('maps.google');
    expect(b.faltantes).toContain('posicion');
    expect(b.riesgo).toBe('medio');
  });

  it('una posición sin hora de medición no se comparte', () => {
    const raro = estatus({ posicion: { lat: 21, lng: -101, medidaEn: 'no-es-fecha' } });
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: raro } }));
    expect(b.texto).not.toContain('maps.google');
    expect(b.faltantes).toContain('posicion_sin_hora');
  });

  it('el último hito sale con su hora real (hora de México)', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ etapa: 'en_destino', ultimoHito: { tipo: 'llegada', en: '2026-10-01T16:30:00.000Z' } }) } }));
    expect(b.texto).toContain('llegada a destino');
    expect(b.texto).toMatch(/01 oct 2026, 10:30/);
  });
});

describe('ETA: no existe el dato → «lo consulto» y se escala', () => {
  it('sin ETA no inventa una hora', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'eta', secundarias: [], senales: [] } }));
    expect(b.texto).toContain('Todavía no tengo registrada una hora estimada');
    expect(b.texto).toContain('La consulto con tu ejecutivo');
    expect(b.texto).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(b.faltantes).toContain('eta');
    expect(b.riesgo).toBe('medio');
  });
  it('con ETA, la dice', () => {
    const b = redactarBorrador(base({
      clasificacion: { intencion: 'eta', secundarias: [], senales: [] },
      viaje: { tipo: 'uno', estatus: estatus({ etaIso: '2026-10-02T03:00:00.000Z' }) },
    }));
    expect(b.texto).toContain('Hora estimada de llegada de F-1042');
    expect(b.faltantes).not.toContain('eta');
  });
  it('dos preguntas: ubicación y ETA, cada una con su dato o su faltante', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'eta', secundarias: ['ubicacion'], senales: [] } }));
    expect(b.texto).toContain('maps.google');
    expect(b.texto).toContain('hora estimada');
    expect(b.faltantes).toEqual(['eta']);
  });
});

describe('documentos', () => {
  const doc = (e: Partial<ReturnType<typeof estatus>>) => redactarBorrador(base({
    clasificacion: { intencion: 'documentos', secundarias: [], senales: [] },
    viaje: { tipo: 'uno', estatus: estatus(e) },
  }));
  it('lista solo los pendientes', () => {
    const b = doc({});
    expect(b.texto).toContain('Documentos pendientes del viaje: Remisión firmada.');
    expect(b.texto).not.toContain('Carta porte');
    expect(b.riesgo).toBe('bajo');
  });
  it('nada pendiente: lo dice con «con lo que tengo registrado»', () => {
    const b = doc({ documentos: [{ nombre: 'Carta porte', estado: 'entregado' }] });
    expect(b.texto).toContain('no hay documentos pendientes');
  });
  it('no se pudo leer (null) ≠ «no hay faltantes»: se escala', () => {
    const b = doc({ documentos: null });
    expect(b.texto).toContain('No pude verificar');
    expect(b.texto).not.toContain('no hay documentos pendientes');
    expect(b.faltantes).toContain('documentos');
  });
  it('sin documentos registrados tampoco se afirma que no falta nada', () => {
    const b = doc({ documentos: [] });
    expect(b.texto).toContain('No tengo documentos registrados');
    expect(b.faltantes).toContain('documentos');
  });
});

describe('factura / POD', () => {
  it('dice lo que hay y deja la entrega del archivo a una persona', () => {
    const b = redactarBorrador(base({
      clasificacion: { intencion: 'factura_pod', secundarias: [], senales: [] },
      viaje: { tipo: 'uno', estatus: estatus({ podRecibido: true, facturaEmitida: false }) },
    }));
    expect(b.texto).toContain('(POD) ya está recibido');
    expect(b.texto).toContain('factura de este viaje todavía no está emitida');
    expect(b.tareas).toEqual(['entrega_de_archivo']);
    expect(b.riesgo).toBe('medio'); // nunca se autoenvía: hay una tarea humana
  });
  it('null en POD o factura: no lo afirma', () => {
    const b = redactarBorrador(base({
      clasificacion: { intencion: 'factura_pod', secundarias: [], senales: [] },
      viaje: { tipo: 'uno', estatus: estatus({ podRecibido: null, facturaEmitida: null }) },
    }));
    expect(b.faltantes).toEqual(expect.arrayContaining(['pod', 'factura']));
    expect(b.texto).not.toMatch(/ya está (recibido|emitida)/);
  });
});

describe('casos sin viaje o delicados', () => {
  it('varios viajes: pregunta cuál, listando folios', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'ambiguo', viajes: [resumen('F-1042'), resumen('F-2000')] } }));
    expect(b.texto).toContain('F-1042, F-2000');
    expect(b.texto).toContain('¿De cuál quieres saber?');
    expect(b.riesgo).toBe('medio');
  });
  it('ningún viaje en curso: lo dice y pide humano', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'ninguno' } }));
    expect(b.texto).toContain('no encuentro un viaje en curso a tu nombre');
    expect(b.requiereHumano).toBe(true);
    expect(b.faltantes).toContain('viaje');
  });
  it('AISLAMIENTO: folio ajeno — ni confirma ni niega que exista, y exige humano', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'folio_no_encontrado' } }));
    expect(b.texto).toContain('no encuentro ese folio entre tus viajes en curso');
    expect(b.texto).not.toMatch(/otro cliente|de otra empresa|no es tuyo|pertenece/i);
    expect(b.requiereHumano).toBe(true);
  });
  it('queja y pide_humano: acuse sin promesas de tiempo, riesgo alto', () => {
    for (const intencion of ['queja', 'pide_humano'] as const) {
      const b = redactarBorrador(base({ clasificacion: { intencion, secundarias: [], senales: [] } }));
      expect(b.riesgo).toBe('alto');
      expect(b.requiereHumano).toBe(true);
      expect(b.texto).not.toMatch(/\b\d+\s*(min|minutos|horas|h)\b/i);
      expect(b.texto).not.toMatch(/en breve|enseguida|de inmediato/i);
    }
  });
  it('«otro»: no entendí → humano', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'otro', secundarias: [], senales: [] } }));
    expect(b.requiereHumano).toBe(true);
    expect(b.faltantes).toContain('intencion');
  });
  it('saludo: riesgo bajo, sin datos del viaje', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'saludo', secundarias: [], senales: [] }, viaje: { tipo: 'ninguno' } }));
    expect(b.riesgo).toBe('bajo');
    expect(b.texto).not.toContain('F-1042');
  });
  it('una señal de inyección sube el riesgo a alto aunque el dato sea perfecto', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'ubicacion', secundarias: [], senales: ['inyeccion'] } }));
    expect(b.riesgo).toBe('alto');
  });
});

describe('primer contacto: aviso de privacidad y baja', () => {
  it('lo lleva la primera vez, con la liga si hay', () => {
    const b = redactarBorrador(base({ primerContacto: true, avisoPrivacidadUrl: 'https://app.likida.ai/privacidad' }));
    expect(b.texto).toContain('asistente automatizado de Transportes del Norte');
    expect(b.texto).toContain('https://app.likida.ai/privacidad');
    expect(b.texto).toContain('escribe BAJA');
  });
  it('sin liga, el aviso sigue diciendo cómo darse de baja', () => {
    const b = redactarBorrador(base({ primerContacto: true }));
    expect(b.texto).toContain('escribe BAJA');
    expect(b.texto).not.toContain('Aviso de privacidad:');
  });
  it('las veces siguientes no se repite', () => {
    expect(redactarBorrador(base()).texto).not.toContain('BAJA');
  });
});

describe('forma del texto', () => {
  it('nunca pasa el tope (más el pie)', () => {
    const largo = estatus({ folio: 'F'.repeat(900) });
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: largo } }));
    expect(b.texto.length).toBeLessThanOrEqual(MAX_RESPUESTA + 1);
  });
  it('aLineaPlantilla: sin saltos ni tabuladores (Meta los rechaza en parámetros)', () => {
    const l = aLineaPlantilla('uno\n\ndos\ttres   cuatro');
    expect(l).not.toMatch(/[\n\t]/);
    expect(l).not.toMatch(/ {2,}/);
    expect(aLineaPlantilla('x'.repeat(1000), 50)).toHaveLength(50);
  });
});

describe('guardia anti-invención del texto pulido', () => {
  const borrador = redactarBorrador(base());
  const ok = (t: string) => guardiaDePulido(t, borrador, '¿dónde va mi viaje F-1042?', 'F-1042');

  it('acepta una reescritura que solo usa cifras del borrador', () => {
    expect(ok(`Hola María, tu viaje F-1042 va en curso. Última posición hace 12 min: ${borrador.texto.match(/https:\/\/\S+/)![0]}`).ok).toBe(true);
  });
  it('rechaza una cifra inventada (un ETA que no existe)', () => {
    const g = ok('Hola María, tu viaje F-1042 llega a las 17:45 y va a 80 km/h. https://maps.google.com/?q=21.16190,-101.69210');
    expect(g).toEqual({ ok: false, motivo: 'cifra_sin_respaldo' });
  });
  it('rechaza una liga nueva (phishing o exfiltración)', () => {
    expect(ok('Tu viaje F-1042 va bien, revísalo en https://evil.example/x').motivo).toBe('liga_nueva');
  });
  it('rechaza un correo nuevo', () => {
    expect(ok('Tu viaje F-1042 va bien, escribe a gerente@evil.example').motivo).toBe('correo_nuevo');
  });
  it('rechaza si pierde el folio', () => {
    expect(ok('Tu viaje va bien, hace 12 min.').motivo).toBe('folio_perdido');
  });
  it('rechaza vacío y excesivo', () => {
    expect(ok('   ').motivo).toBe('vacio');
    expect(ok(`F-1042 ${'a'.repeat(2000)}`).motivo).toBe('muy_largo');
  });
  it('una cifra que el CLIENTE mencionó sí es respaldo (la repite, no la inventa)', () => {
    const g = guardiaDePulido('Entiendo que llevas 45 minutos esperando. F-1042 va hace 12 min.', borrador, 'llevo 45 minutos esperando F-1042', 'F-1042');
    expect(g.ok).toBe(true);
  });

  describe('pulirBorrador', () => {
    const modelo = (r: string | null | Error): PuertoPulir => ({
      pulir: async () => { if (r instanceof Error) throw r; return r; },
    });
    it('sin modelo: el borrador intacto', async () => {
      const r = await pulirBorrador(borrador, 'x', 'F-1042', null, 't1');
      expect(r.borrador).toBe(borrador);
    });
    it('un pulido que pasa la guardia se usa y se marca origen modelo', async () => {
      const liga = borrador.texto.match(/https:\/\/\S+/)![0];
      const r = await pulirBorrador(borrador, 'x', 'F-1042', modelo(`Hola María 👋 tu viaje F-1042 sigue en camino. Posición hace 12 min: ${liga}`), 't1');
      expect(r.borrador.origen).toBe('modelo');
      expect(r.motivoDescartado).toBeNull();
    });
    it('un pulido con cifra inventada se TIRA: sale el determinista', async () => {
      const r = await pulirBorrador(borrador, 'x', 'F-1042', modelo('Tu viaje F-1042 llega mañana a las 7:30 con 3 horas de retraso'), 't1');
      expect(r.borrador).toBe(borrador);
      expect(r.motivoDescartado).toBe('cifra_sin_respaldo');
    });
    it('el modelo caído o mudo no rompe nada', async () => {
      expect((await pulirBorrador(borrador, 'x', 'F-1042', modelo(new Error('timeout')), 't1')).motivoDescartado).toBe('modelo_caido');
      expect((await pulirBorrador(borrador, 'x', 'F-1042', modelo(null), 't1')).motivoDescartado).toBe('modelo_sin_respuesta');
    });
    it('un borrador que pide humano o es de riesgo alto no se embellece', async () => {
      const queja = redactarBorrador(base({ clasificacion: { intencion: 'queja', secundarias: [], senales: [] } }));
      let llamado = false;
      const r = await pulirBorrador(queja, 'x', null, { pulir: async () => { llamado = true; return 'otro'; } }, 't1');
      expect(llamado).toBe(false);
      expect(r.borrador).toBe(queja);
    });
  });
});
