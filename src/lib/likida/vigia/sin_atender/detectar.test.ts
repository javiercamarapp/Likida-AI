import { describe, it, expect } from 'vitest';
import { leerExportWhatsapp } from '../historial/export_whatsapp';
import { CONFIG_SIN_ATENDER_POR_OMISION as D, normalizarConfigSinAtender } from './config';
import { chatSinEquipoConocido, detectarSinAtender, detectarSinAtenderChat, extracto } from './detectar';
import { chat, cli, enMin, eq, msg, T0_MS, ZONA } from './fixtures';
import type { ConfigSinAtender } from './tipos';

const cfg = (p: Partial<ConfigSinAtender> = {}): ConfigSinAtender => normalizarConfigSinAtender({ ...D, ...p }).config;
const ahora = (min: number) => T0_MS + min * 60_000;

describe('detectarSinAtenderChat · espera sobre el umbral', () => {
  it('cliente sin respuesta pasado el umbral genera alerta', () => {
    const r = detectarSinAtenderChat(chat([eq(0, 'buen día'), cli(1, 'necesito el estatus de mi carga')]), cfg(), ahora(60));
    expect(r.alertas).toHaveLength(1);
    const a = r.alertas[0];
    expect(a.motivos).toEqual(['espera_sobre_umbral']);
    expect(a.nivel).toBe('normal');
    expect(a.antiguedadMin).toBe(59);
    expect(a.umbralAplicadoMin).toBe(30);
    expect(a.excesoMin).toBe(29);
    expect(a.clave).toMatch(/^[0-9a-f]{32}$/);
  });

  it('antes del umbral no hay alerta', () => {
    expect(detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'necesito el estatus')]), cfg(), ahora(20)).alertas).toEqual([]);
  });

  it('si el equipo contestó, no hay alerta', () => {
    expect(detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'dónde va?'), eq(4, 'en camino')]), cfg(), ahora(600)).alertas).toEqual([]);
  });

  it('grupo crítico usa su umbral', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'necesito el estatus')], { critico: true });
    expect(detectarSinAtenderChat(c, cfg(), ahora(15)).alertas[0].umbralAplicadoMin).toBe(10);
  });

  it('la antigüedad se mide contra la foto, no contra el reloj', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'necesito el estatus')], { fotoMs: ahora(11) });
    expect(detectarSinAtenderChat(c, cfg(), ahora(100_000)).alertas).toEqual([]);
    const a = detectarSinAtenderChat({ ...c, fotoMs: ahora(41) }, cfg(), ahora(100_000)).alertas[0];
    expect(a.antiguedadMin).toBe(40);
    expect(a.fotoEn).toBe(enMin(41));
  });

  it('fechas futuras (respecto de la foto) dan antigüedad 0, nunca negativa', () => {
    const a = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(500, 'necesito el estatus')]), cfg({ umbralMin: 1 }), ahora(10)).alertas;
    expect(a).toEqual([]);
  });
});

describe('detectarSinAtenderChat · prioridad y motivos', () => {
  it('urgencia baja el umbral al urgente y sube a alta', () => {
    const r = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'necesito la unidad ASAP')]), cfg(), ahora(13));
    expect(r.alertas[0].motivos).toContain('urgencia');
    expect(r.alertas[0].nivel).toBe('alta');
    expect(r.alertas[0].umbralAplicadoMin).toBe(10);
  });

  it('palabra clave configurable con acentos y mayúsculas', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'Hay AVERÍA en la unidad 5')]);
    const r = detectarSinAtenderChat(c, cfg({ palabrasClave: ['averia'] }), ahora(20));
    expect(r.alertas[0].motivos).toContain('palabra_clave');
    expect(r.alertas[0].nivel).toBe('alta');
  });

  it('embarque es palabra clave por omisión', () => {
    const r = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'sobre el embarque de mañana')]), cfg(), ahora(20));
    expect(r.alertas[0].motivos).toContain('palabra_clave');
  });

  it('palabras urgentes propias suman, y se cancelan si el cliente dice «sin prisa»', () => {
    const base = cfg({ palabrasUrgentes: ['retraso'] });
    const si = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'hay retraso en la entrega')]), base, ahora(20));
    expect(si.alertas[0].motivos).toContain('urgencia');
    const no = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'hay retraso pero sin prisa')]), base, ahora(20));
    expect(no.alertas).toEqual([]);
  });

  it('urgencia negada por prioridadDe no cuenta', () => {
    const r = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'ASAP no hace falta, avísame cuando puedas')]), cfg(), ahora(20));
    expect(r.alertas).toEqual([]);
  });

  it('pregunta con espera vencida es alta; pregunta sola no crea alerta', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'a qué hora llega?')]);
    expect(detectarSinAtenderChat(c, cfg(), ahora(5)).alertas).toEqual([]);
    const a = detectarSinAtenderChat(c, cfg(), ahora(45)).alertas[0];
    expect(a.motivos).toEqual(['espera_sobre_umbral', 'pregunta']);
    expect(a.nivel).toBe('alta');
    expect(a.preguntasSinAtender).toBe(1);
  });
});

describe('detectarSinAtenderChat · insistencia', () => {
  it('dos preguntas seguidas sin respuesta alertan aunque no haya pasado el umbral', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'dónde está la unidad?'), cli(3, 'me contestan?')]);
    const a = detectarSinAtenderChat(c, cfg(), ahora(5)).alertas[0];
    expect(a.motivos).toContain('insistencia');
    expect(a.mensajesSinAtender).toBe(2);
    expect(a.preguntasSinAtender).toBe(2);
  });

  it('con insistenciaMin = 0 está apagada', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'dónde?'), cli(2, 'y?'), cli(3, 'hola?')]);
    expect(detectarSinAtenderChat(c, cfg({ insistenciaMin: 0 }), ahora(5)).alertas).toEqual([]);
  });

  it('mensajes fuera de la ventana de insistencia no cuentan juntos', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'primera'), cli(300, 'segunda')]);
    expect(detectarSinAtenderChat(c, cfg({ umbralMin: 1440 }), ahora(301)).alertas).toEqual([]);
  });

  it('un mensaje intermedio del equipo corta la insistencia', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'dónde está?'), eq(2, 'reviso'), cli(3, 'gracias, y la factura?')]);
    expect(detectarSinAtenderChat(c, cfg(), ahora(6)).alertas).toEqual([]);
  });
});

describe('detectarSinAtenderChat · cierres y ruido', () => {
  it('«gracias» y «ok» del cliente cierran la conversación', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'necesito el estatus'), cli(2, 'gracias'), cli(3, 'ok')]);
    expect(detectarSinAtenderChat(c, cfg(), ahora(600)).alertas).toEqual([]);
  });

  it('solo cortesía, monitoreo o vacíos: sin alerta y se cuentan', () => {
    const c = chat([eq(0, 'hola'), cli(1, 'gracias'), cli(2, 'UNIDAD 5 DETENIDA'), cli(3, '   ')]);
    const r = detectarSinAtenderChat(c, cfg(), ahora(600));
    expect(r.alertas).toEqual([]);
    expect(r.ignorados).toBe(3);
  });

  it('chat vacío y solo equipo no lanzan', () => {
    expect(detectarSinAtenderChat(chat([]), cfg(), ahora(1)).alertas).toEqual([]);
    expect(detectarSinAtenderChat(chat([eq(0, 'a'), eq(1, 'b')]), cfg(), ahora(999)).alertas).toEqual([]);
  });

  it('equipo desconocido: sin mensajes del equipo NO alerta (falla cerrado) y se puede saber', () => {
    const c = chat([cli(0, 'hola?'), cli(1, 'alguien?')]);
    expect(detectarSinAtenderChat(c, cfg(), ahora(999)).alertas).toEqual([]);
    expect(chatSinEquipoConocido(c, cfg())).toBe(true);
    expect(chatSinEquipoConocido(chat([cli(0, 'x'), eq(1, 'y')]), cfg())).toBe(false);
  });

  it('equipoHashes rescata un chat mal clasificado', () => {
    const c = chat([msg(0, 'cliente', 'buen día, soy de la flota', 'dddddddddddd'), cli(1, 'necesito el estatus')]);
    expect(detectarSinAtenderChat(c, cfg(), ahora(100)).alertas).toEqual([]);
    expect(detectarSinAtenderChat(c, cfg({ equipoHashes: ['dddddddddddd'] }), ahora(100)).alertas).toHaveLength(1);
  });

  it('ventana de respuesta: una respuesta tardía no cierra', () => {
    const c = chat([cli(0, 'necesito el estatus'), eq(120, 'perdón, ya lo veo')]);
    expect(detectarSinAtenderChat(c, cfg(), ahora(200)).alertas).toEqual([]);
    expect(detectarSinAtenderChat(c, cfg({ ventanaRespuestaMin: 60 }), ahora(200)).alertas).toHaveLength(1);
  });

  it('dedupe: el mismo chat exportado dos veces no duplica mensajes ni inventa insistencia', () => {
    const uno = [eq(0, 'hola'), cli(1, 'necesito el estatus')];
    const r = detectarSinAtenderChat(chat([...uno, ...uno]), cfg({ umbralMin: 1440 }), ahora(5));
    expect(r.alertas).toEqual([]);
    expect(r.descartados).toBe(2);
  });

  it('tope de alertas por chat', () => {
    const msgs = [];
    for (let i = 0; i < 10; i += 1) msgs.push(cli(i * 100 + 1, `solicitud ${i} de la carga`), eq(i * 100 + 60, 'tarde'));
    const r = detectarSinAtenderChat(chat(msgs), cfg({ maxAlertasPorChat: 3, ventanaRespuestaMin: 5 }), ahora(1200));
    expect(r.alertas).toHaveLength(3);
  });
});

describe('detectarSinAtenderChat · turnos y hora de México', () => {
  it('madrugada es noche; mediodía es día', () => {
    // 02:00 locales = 08:00Z
    const noche = chat([{ ...eq(0, 'x'), enviadoEn: '2026-10-14T07:00:00Z' }, { ...cli(0, 'necesito el estatus'), enviadoEn: '2026-10-14T08:00:00Z' }]);
    expect(detectarSinAtenderChat(noche, cfg(), Date.parse('2026-10-14T10:00:00Z')).alertas[0].turno).toBe('noche');
    expect(detectarSinAtenderChat(chat([eq(0, 'x'), cli(60, 'necesito el estatus')]), cfg(), ahora(300)).alertas[0].turno).toBe('dia');
  });

  it('cruce de medianoche: el hilo se etiqueta por su primer mensaje', () => {
    // 23:50 locales del miércoles = 05:50Z del jueves; sigue abierto pasada la medianoche
    const c = chat([{ ...eq(0, 'x'), enviadoEn: '2026-10-15T05:00:00Z' }, { ...cli(0, 'necesito el estatus'), enviadoEn: '2026-10-15T05:50:00Z' }, { ...cli(0, 'sigo esperando'), enviadoEn: '2026-10-15T06:10:00Z' }]);
    const a = detectarSinAtenderChat(c, cfg(), Date.parse('2026-10-15T07:00:00Z')).alertas[0];
    expect(a.turno).toBe('noche');
    expect(a.antiguedadMin).toBe(70);
    expect(a.mensajesSinAtender).toBe(2);
  });

  it('festivo y fin de semana', () => {
    // sáb 17-oct-2026 12:00 local = 18:00Z
    const sab = chat([{ ...eq(0, 'x'), enviadoEn: '2026-10-17T17:00:00Z' }, { ...cli(0, 'necesito el estatus'), enviadoEn: '2026-10-17T18:00:00Z' }]);
    expect(detectarSinAtenderChat(sab, cfg(), Date.parse('2026-10-17T20:00:00Z')).alertas[0].turno).toBe('festivo');
    // miércoles 14 declarado festivo
    const mie = chat([eq(0, 'x'), cli(1, 'necesito el estatus')]);
    expect(detectarSinAtenderChat(mie, cfg({ festivos: ['2026-10-14'], zona: ZONA }), ahora(100)).alertas[0].turno).toBe('festivo');
  });
});

describe('vista previa', () => {
  it('por omisión es null', () => {
    expect(detectarSinAtenderChat(chat([eq(0, 'x'), cli(1, 'necesito el estatus')]), cfg(), ahora(100)).alertas[0].vistaPrevia).toBeNull();
  });

  it('tope duro de 80 caracteres aunque se pida más, y nunca el mensaje completo', () => {
    const largo = 'necesito el estatus de la carga '.repeat(20);
    const a = detectarSinAtenderChat(chat([eq(0, 'x'), cli(1, largo)]), { ...cfg(), vistaPreviaMax: 5000 }, ahora(100)).alertas[0];
    expect(a.vistaPrevia!.length).toBeLessThanOrEqual(80);
    expect(a.vistaPrevia!.length).toBeLessThan(largo.trim().length);
  });

  it('tapa teléfonos y correos', () => {
    const e = extracto('llámame al 55 1234 5678 o escribe a persona@ejemplo.com', 80)!;
    expect(e).not.toMatch(/\d{4}/);
    expect(e).not.toContain('@');
    expect(e).toContain('[tel]');
    expect(e).toContain('[correo]');
  });

  it('max 0 o texto vacío dan null', () => {
    expect(extracto('hola', 0)).toBeNull();
    expect(extracto('   ', 50)).toBeNull();
  });
});

describe('detectarSinAtender · varios chats y resumen', () => {
  it('agrega, ordena y resume', () => {
    const r = detectarSinAtender([
      chat([eq(0, 'x'), cli(1, 'necesito el estatus')], { chatId: 'g1', nombre: 'Grupo B' }),
      chat([eq(0, 'x'), cli(1, 'urgente, dónde está?')], { chatId: 'g2', nombre: 'Grupo A', critico: true }),
      chat([eq(0, 'x'), cli(1, 'gracias')], { chatId: 'g3', nombre: 'Grupo C' }),
    ], cfg(), ahora(100));
    expect(r.resumen).toMatchObject({ chatsRevisados: 3, chatsConAlerta: 2, alertas: 2, altas: 1, normales: 1, ignorados: 1, masAntiguaMin: 99 });
    expect(r.alertas.map((a) => a.chatId)).toEqual(['g2', 'g1']);
    expect(r.resumen.porTurno).toEqual({ dia: 2, noche: 0, festivo: 0 });
    expect(r.ahoraEn).toBe(enMin(100));
  });

  it('sin chats: resumen en cero y masAntigua null', () => {
    const r = detectarSinAtender([], cfg(), ahora(0));
    expect(r.alertas).toEqual([]);
    expect(r.resumen.masAntiguaMin).toBeNull();
  });

  it('reloj no finito no lanza', () => {
    expect(() => detectarSinAtender([chat([eq(0, 'x'), cli(1, 'hola?')])], cfg(), Number.NaN)).not.toThrow();
  });

  it('ninguna salida contiene el texto del mensaje con la vista previa apagada', () => {
    const secreto = 'texto-secreto-del-cliente-12345';
    const r = detectarSinAtender([chat([eq(0, 'x'), cli(1, `${secreto}?`)])], cfg(), ahora(100));
    expect(JSON.stringify(r)).not.toContain('secreto');
  });
});

describe('rendimiento y entrada hostil', () => {
  it('5,000 mensajes en tiempo razonable', () => {
    const msgs = [];
    for (let i = 0; i < 2500; i += 1) msgs.push(cli(i * 3, `consulta ${i}?`), eq(i * 3 + 1, 'ok te ayudo'));
    const t = performance.now();
    const r = detectarSinAtender([chat(msgs)], cfg(), ahora(10_000));
    expect(performance.now() - t).toBeLessThan(3000);
    expect(r.resumen.mensajesAnalizados).toBe(5000);
  });

  it('50,000 mensajes sin respuesta se procesan en tiempo lineal', () => {
    const msgs = [];
    for (let i = 0; i < 50_000; i += 1) msgs.push(cli(i, `mensaje ${i} de la carga`));
    msgs.push(eq(-1, 'hola'));
    const t = performance.now();
    const r = detectarSinAtender([chat(msgs)], cfg(), ahora(60_000));
    expect(performance.now() - t).toBeLessThan(15_000);
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].mensajesSinAtender).toBe(50_000);
  });

  it('cadenas enormes y caracteres de control no rompen nada ni se filtran', () => {
    const hostil = `${'\u0000‮'.repeat(1000)}${'a'.repeat(200_000)}?`;
    const r = detectarSinAtender([chat([eq(0, 'x'), cli(1, hostil)])], { ...cfg(), vistaPreviaMax: 80 }, ahora(100));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].vistaPrevia!.length).toBeLessThanOrEqual(80);
    expect(r.alertas[0].vistaPrevia).not.toMatch(/[\u0000‮]/);
  });
});

describe('integración con el lector de exportaciones', () => {
  const opciones = { equipo: ['Operador 1', 'Operador Ñandú'], sal: 'flota-prueba' };

  it('iOS 24 horas con mensaje multilínea', () => {
    const txt = [
      '[14/10/26, 10:00:00] Operador 1: Buen día',
      '[14/10/26, 10:05:10] Cliente A: Necesito saber',
      'dónde está la unidad 4',
      'por favor?',
      '[14/10/26, 10:06:00] Cliente A: Cliente A cambió el asunto',
    ].join('\n');
    const lectura = leerExportWhatsapp(txt, opciones);
    expect(lectura.formato).toBe('ios');
    const a = detectarSinAtenderChat(chat(lectura.mensajes), cfg(), ahora(120)).alertas;
    expect(a).toHaveLength(1);
    expect(a[0].mensajesSinAtender).toBe(2);
    expect(a[0].desde).toBe(enMin(5) .replace(':00.000Z', ':10.000Z'));
  });

  it('Android 12 horas p. m. con nombre acentuado del equipo', () => {
    const txt = [
      '14/10/2026 10:00 p. m. - Operador Ñandú: Turno de noche',
      '14/10/2026 10:30 p. m. - Cliente B: el embarque sale hoy?',
    ].join('\n');
    const lectura = leerExportWhatsapp(txt, opciones);
    expect(lectura.formato).toBe('android');
    const r = detectarSinAtender([chat(lectura.mensajes)], cfg(), Date.parse('2026-10-15T05:30:00Z'));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].turno).toBe('noche');
    expect(r.alertas[0].nivel).toBe('alta');
    expect(r.alertas[0].motivos).toEqual(expect.arrayContaining(['pregunta', 'palabra_clave']));
  });

  it('adjuntos omitidos y mensajes de sistema no abren hilos', () => {
    const txt = [
      '[14/10/26, 10:00:00] Operador 1: Hola',
      '[14/10/26, 10:01:00] Cliente A: <Multimedia omitido>',
      '[14/10/26, 10:02:00] Cliente A: Los mensajes y las llamadas están cifrados de extremo a extremo.',
    ].join('\n');
    const lectura = leerExportWhatsapp(txt, opciones);
    const r = detectarSinAtenderChat(chat(lectura.mensajes), cfg(), ahora(500));
    expect(r.alertas.every((a) => a.mensajesSinAtender <= 1)).toBe(true);
  });

  it('sin lista de equipo todo sale como cliente y el motor no alerta', () => {
    const txt = ['[14/10/26, 10:00:00] Operador 1: Hola', '[14/10/26, 10:05:00] Cliente A: dónde está?'].join('\n');
    const lectura = leerExportWhatsapp(txt, { equipo: [], sal: 'x' });
    expect(detectarSinAtenderChat(chat(lectura.mensajes), cfg(), ahora(500)).alertas).toEqual([]);
  });
});
