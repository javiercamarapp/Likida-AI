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

describe('lo que aporta el Conductor (ronda 03)', () => {
  const en = (min: number) => new Date(AHORA.getTime() + min * 60_000).toISOString();

  it('una CITA se dice como cita y se aclara que no es una medición del GPS', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'eta', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus({ etaIso: en(300), etaFuente: 'cita' }) } }));
    expect(b.texto).toContain('La cita de llegada a destino de F-1042');
    expect(b.texto).toContain('no una medición del GPS');
    expect(b.respaldo).toMatchObject({ eta: en(300), etaFuente: 'cita' });
    expect(b.faltantes).toEqual([]);
  });

  it('una ETA capturada se dice como hora estimada; la cita de carga solo mientras no ha llegado a cargar', () => {
    const e = estatus({ etaIso: en(300), etaFuente: 'eta', citaCarga: { en: en(30), fuente: 'cita' }, etapa: 'en_curso' });
    const b = redactarBorrador(base({ clasificacion: { intencion: 'eta', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: e } }));
    expect(b.texto).toContain('Hora estimada de llegada de F-1042');
    expect(b.texto).toContain('La cita de carga es el');
    const yaCargando = redactarBorrador(base({ clasificacion: { intencion: 'eta', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: { ...e, etapa: 'en_origen' } } }));
    expect(yaCargando.texto).not.toContain('La cita de carga');
  });

  it('ya en destino no hay «hora estimada» que prometer y no falta ningún dato', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'eta', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus({ etapa: 'entregado' }) } }));
    expect(b.texto).toContain('terminó de descargar');
    expect(b.faltantes).toEqual([]);
  });

  it('el último hito de los cinco se nombra bien y dice que lo reportó el operador', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ etapa: 'en_ruta', ultimoHito: { tipo: 'salida_carga', en: AHORA.toISOString() } }) } }));
    expect(b.texto).toContain('Último registro del operador: salida de la carga');
    expect(b.texto).toContain('salió de la carga y va en camino al destino');
  });

  it('en andén: dice en cuál parada y desde cuándo, sin minutos de más', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ enAnden: { lugar: 'descarga', desde: AHORA.toISOString() } }) } }));
    expect(b.texto).toContain('Sigue en la descarga desde las');
  });

  it('con POD recibido ofrece adjuntarlo: riesgo medio (lo aprueba una persona) y sin tarea de entrega manual', () => {
    const e = estatus({ podRecibido: true, facturaEmitida: true, adjuntos: [{ clave: 'pod', nombre: 'Comprobante de entrega (POD)' }] });
    const b = redactarBorrador(base({ clasificacion: { intencion: 'factura_pod', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: e } }));
    expect(b.adjuntos).toEqual(['pod']);
    expect(b.respaldo).toMatchObject({ adjuntos: ['pod'], viajeId: e.viajeId, folio: 'F-1042' });
    expect(b.riesgo).toBe('medio');
    expect(b.tareas).toEqual([]);
    expect(b.texto).toContain('Si necesitas el archivo y no te llega por aquí');
  });

  it('sin archivo que adjuntar, el archivo lo entrega una persona (tarea) y no hay adjuntos', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'factura_pod', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus({ podRecibido: true, facturaEmitida: false }) } }));
    expect(b.adjuntos).toEqual([]);
    expect(b.tareas).toEqual(['entrega_de_archivo']);
    expect(b.respaldo).not.toHaveProperty('adjuntos');
  });

  it('pedir «documentos» no adjunta nada aunque haya POD', () => {
    const e = estatus({ podRecibido: true, adjuntos: [{ clave: 'pod', nombre: 'Comprobante de entrega (POD)' }] });
    const b = redactarBorrador(base({ clasificacion: { intencion: 'documentos', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: e } }));
    expect(b.adjuntos).toEqual([]);
  });
});

describe('datos de la unidad (T-A4-24)', () => {
  const datos = { caja: 'CJ-100', placasCaja: 'ABC123', estadoCaja: 'cargada', unidad: 'C2-08', placasUnidad: 'XYZ789', operador: 'Operador Uno' };
  const pide = (e: Partial<ReturnType<typeof estatus>>, extra: Partial<EntradaRedaccion> = {}) =>
    redactarBorrador(base({ clasificacion: { intencion: 'datos_unidad', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus(e) }, ...extra }));

  it('CON caja: dice caja, placas, estado, unidad y operador del dato, sin faltantes', () => {
    const b = pide(datos);
    expect(b.texto).toContain('Caja: CJ-100.');
    expect(b.texto).toContain('Placas de la caja: ABC123.');
    expect(b.texto).toContain('Estado de la caja: cargada.');
    expect(b.texto).toContain('Unidad: C2-08.');
    expect(b.texto).toContain('Placas de la unidad: XYZ789.');
    expect(b.texto).toContain('Operador: Operador Uno.');
    expect(b.faltantes).toEqual([]);
    expect(b.requiereHumano).toBe(false);
  });

  it('siempre a aprobación de una persona: riesgo medio aunque el dato esté completo', () => {
    expect(pide(datos).riesgo).toBe('medio');
  });

  it('SIN caja: no la inventa, dice «lo consulto», marca el faltante (escala) y conserva lo que sí hay', () => {
    const b = pide({ ...datos, caja: null, placasCaja: null, estadoCaja: null });
    expect(b.texto).not.toContain('Caja:');
    expect(b.texto).toContain('Aún no tengo registro de caja');
    expect(b.texto).toContain('lo consulto con tu ejecutivo');
    expect(b.texto).toContain('Unidad: C2-08.');
    expect(b.faltantes).toEqual(['caja']);
  });

  it('sin caja, unidad ni operador (o sin que se hayan pedido): todo es «lo consulto» y los tres son faltantes', () => {
    const b = pide({});
    expect(b.texto).toContain('todavía no tengo asignada la caja, la unidad ni el operador');
    expect(b.faltantes).toEqual(['caja', 'unidad', 'operador']);
    expect(b.texto).not.toMatch(/Caja:|Unidad:|Operador:/);
  });

  it('sin operador ni unidad: lista los dos con «ni» y escala', () => {
    const b = pide({ ...datos, unidad: null, placasUnidad: null, operador: null });
    expect(b.texto).toContain('Aún no tengo registro de unidad ni operador');
    expect(b.faltantes).toEqual(['unidad', 'operador']);
  });

  it('placas o estado sin registrar se dicen, pero por sí solos NO escalan', () => {
    const b = pide({ ...datos, placasCaja: null, placasUnidad: null, estadoCaja: 'desconocido' });
    expect(b.texto).toContain('Placas de la caja: sin registrar.');
    expect(b.texto).toContain('Placas de la unidad: sin registrar.');
    expect(b.texto).not.toContain('Estado de la caja');
    expect(b.faltantes).toEqual([]);
  });

  it('nunca imprime licencia, vigencia ni teléfono, aunque el objeto del estatus los traiga por error', () => {
    const sucio = { ...datos, licencia: 'LIC-999', vigencia: '2030-01-01', telefonoOperador: '5215500000000' } as unknown as Partial<ReturnType<typeof estatus>>;
    const b = pide(sucio);
    expect(b.texto).not.toMatch(/LIC-999|2030|5215500000000/);
  });

  it('lo que se guarda para la auditoría omite el nombre del operador y las placas', () => {
    const b = pide(datos);
    expect(JSON.stringify(b.respaldo)).not.toMatch(/Operador Uno|ABC123|XYZ789/);
    expect(b.respaldo).toMatchObject({ datosUnidad: { caja: 'CJ-100', unidad: 'C2-08', conOperador: true } });
  });

  it('como pregunta secundaria: se suma a la ubicación en el mismo mensaje', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'ubicacion', secundarias: ['datos_unidad'], senales: [] }, viaje: { tipo: 'uno', estatus: estatus(datos) } }));
    expect(b.texto).toContain('Última posición del GPS');
    expect(b.texto).toContain('Caja: CJ-100.');
  });

  it('con varios viajes sin decir cuál, o folio ajeno: no suelta ningún dato de unidad', () => {
    const amb = redactarBorrador(base({ clasificacion: { intencion: 'datos_unidad', secundarias: [], senales: [] }, viaje: { tipo: 'ambiguo', viajes: [resumen('F-1'), resumen('F-2')] } }));
    expect(amb.texto).toContain('¿De cuál quieres saber?');
    const ajeno = redactarBorrador(base({ clasificacion: { intencion: 'datos_unidad', secundarias: [], senales: [] }, viaje: { tipo: 'folio_no_encontrado' } }));
    expect(ajeno.requiereHumano).toBe(true);
    expect(ajeno.texto).not.toMatch(/Caja:|Unidad:|Operador:/);
  });

  it('un modelo NO pule este borrador (placas y nombres salen exactos del dato)', async () => {
    const b = pide(datos);
    let llamado = false;
    const modelo: PuertoPulir = { pulir: async () => { llamado = true; return 'otro texto'; } };
    const r = await pulirBorrador(b, 'placas?', 'F-1042', modelo, 't1');
    expect(llamado).toBe(false);
    expect(r.borrador.texto).toBe(b.texto);
  });
});

describe('estatus de ubicación «va por…, le faltan…» (T-A4-39)', () => {
  const con = (extra: Parameters<typeof estatus>[0]) => redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus(extra) } }));
  const hace = (min: number) => ({ lat: 21.1, lng: -101.6, medidaEn: new Date(AHORA.getTime() - min * 60_000).toISOString() });

  it('con posición reciente y avance dice «va por <lugar>, le faltan ~km / ~h» y aclara que no es hora de llegada', () => {
    const b = con({ avance: { cercaDe: 'Saltillo', kmRestantes: 84.4, minRestantes: 95 } });
    expect(b.texto).toContain('Va por Saltillo, le faltan ~84 km / ~2 h a Monterrey');
    expect(b.texto).toContain('no es hora de llegada');
    expect(b.texto).toContain('maps.google.com');
    expect(b.respaldo.avance).toEqual({ cercaDe: 'Saltillo', kmRestantes: 84, minRestantes: 95 });
    expect(b.faltantes).toEqual([]);
  });

  it('menos de una hora se dice en minutos', () => {
    expect(con({ avance: { cercaDe: null, kmRestantes: 30, minRestantes: 40 } }).texto).toContain('Va en camino, le faltan ~30 km / ~40 min a Monterrey');
  });

  it('con posición vieja NO dice «va por» (queda como hoy: antigüedad y liga)', () => {
    const b = con({ posicion: hace(45), avance: { cercaDe: 'Saltillo', kmRestantes: 80, minRestantes: 90 } });
    expect(b.texto).not.toContain('Va por');
    expect(b.texto).not.toContain('le faltan');
    expect(b.texto).toContain('hace 45 min');
    expect(b.respaldo.avance).toBeUndefined();
  });

  it('sin destino no inventa distancia', () => {
    const b = con({ destino: null, avance: { cercaDe: 'Saltillo', kmRestantes: 80, minRestantes: 90 } });
    expect(b.texto).not.toContain('le faltan');
    expect(b.texto).not.toContain('Va por');
  });

  it('sin avance, o con cifras inválidas, el texto es el de siempre', () => {
    const sin = con({});
    for (const avance of [null, { cercaDe: null, kmRestantes: null, minRestantes: null }, { cercaDe: null, kmRestantes: -5, minRestantes: Number.NaN }]) {
      expect(con({ avance }).texto).toBe(sin.texto);
    }
    expect(sin.texto).not.toContain('le faltan');
  });

  it('sin posición no hay avance aunque el adaptador lo mande («lo consulto» sigue igual)', () => {
    const b = con({ posicion: null, avance: { cercaDe: 'Saltillo', kmRestantes: 80, minRestantes: 90 } });
    expect(b.texto).toContain('Todavía no tengo posición GPS');
    expect(b.texto).not.toContain('Va por');
    expect(b.faltantes).toContain('posicion');
  });

  it('el lugar se limpia (sin saltos de línea ni largo desmedido)', () => {
    const b = con({ avance: { cercaDe: `Tramo\n  largo ${'x'.repeat(200)}`, kmRestantes: 10, minRestantes: null } });
    expect(b.texto).toContain('Va por Tramo largo xxx');
    expect(b.texto).not.toContain('x'.repeat(61));
    expect(b.texto).not.toMatch(/Tramo\n/);
  });
});

// A37-S59-06: el tope de 700 caracteres no puede cortar la liga de Maps: una URL truncada sigue siendo válida pero apunta a otro lugar.
describe('A37-S59-06 el recorte no parte la liga de ubicación', () => {
  const LIGA_COMPLETA = 'maps.google.com/?q=21.16190,-101.69210';
  it('con cualquier largo de ruta, toda liga que sale está completa', () => {
    for (let n = 0; n <= 700; n += 3) {
      const e = estatus({ origen: 'O'.repeat(n), destino: 'Monterrey' });
      const b = redactarBorrador(base({
        clasificacion: { intencion: 'ubicacion', secundarias: ['eta', 'documentos', 'factura_pod'], senales: [] },
        viaje: { tipo: 'uno', estatus: e },
      }));
      const ligas = b.texto.match(/maps\.google\.com\/\?q=\S*/g) ?? [];
      for (const l of ligas) expect(l, `n=${n}`).toBe(LIGA_COMPLETA);
    }
  });
  it('si hubo recorte, el borrador deja de ser de riesgo bajo (no sale sin aprobación)', () => {
    const e = estatus({ origen: 'O'.repeat(900) });
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: e } }));
    expect(b.riesgo).not.toBe('bajo');
  });
});

// A37-S59-07: tras la descarga la unidad ya puede ir con carga de OTRO cliente; su posición en vivo no es del cliente que pregunta.
describe('A37-S59-07 no se comparte la posición de un viaje ya descargado', () => {
  for (const etapa of ['descargando', 'entregado', 'regresando', 'cerrado'] as const) {
    it(`etapa ${etapa}: no sale liga de GPS ni posición`, () => {
      const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ etapa }) } }));
      expect(b.texto).not.toContain('maps.google');
      expect(b.texto).not.toMatch(/posición del GPS/);
      expect(b.texto).toContain('no comparto la ubicación de la unidad');
      expect(b.respaldo.posicion).toBeUndefined();
    });
  }
  it('en camino o ya en destino la posición se sigue compartiendo', () => {
    for (const etapa of ['en_curso', 'en_destino'] as const) {
      expect(redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ etapa }) } })).texto).toContain('maps.google');
    }
  });
});
