import { describe, it, expect } from 'vitest';
import { mulberry32 } from './rng';
import {
  ATAQUES_FUZZING, PAYLOADS_INYECCION, CARACTERES_HOSTILES, CARACTERES_IMPRIMIBLES,
  bytesBasura, dataUrlBasura, textoConControl, generarEscenarioFuzzing, semillaFuzzing,
} from './fuzzing.escenarios';

// ═══════════════════════════════════════════════════════════════════════════
// EL GENERADOR DE FUZZING SE PRUEBA OFFLINE, Y TIENE QUE PROBARSE.
//
// El orquestador (`npm run qa:nocturno`) exige `.env.local` con la service-role
// de Supabase y la llave de OpenRouter, y gasta dinero de verdad: no corre en
// CI y no debe. Pero el generador SÍ es puro —igual que `operador.escenarios.ts`—
// así que su contrato se puede vigilar en la suite normal, gratis y sin red.
//
// Es la mitad que importa: un generador que dejara de generar (payload vacío,
// bytes que sí decodifican, caracteres hostiles que no lo son) convertiría la
// corrida nocturna en un ✅ sin contenido, y nadie lo notaría hasta que el bug
// que debía cazar llegara a producción.
// ═══════════════════════════════════════════════════════════════════════════

const FECHA = '2026-08-28';

/**
 * La clase de caracteres hostiles se CONSTRUYE desde la lista del generador, no
 * se escribe a mano. Dos razones: un literal con NUL dentro no lo parsea ni el
 * transpilador (medido: `Unterminated regular expression`), y si alguien agrega
 * un carácter a la lista, estas pruebas lo cubren solas en vez de quedarse a
 * medias en silencio.
 */
const HOSTILES_RE = new RegExp(`[${CARACTERES_HOSTILES.map((c) => c.car).join('')}]`, 'g');

describe('el generador es DETERMINISTA: misma semilla, mismo escenario', () => {
  it.each(ATAQUES_FUZZING)('%s se repite byte a byte', (ataque) => {
    const a = generarEscenarioFuzzing(FECHA, ataque, 0);
    const b = generarEscenarioFuzzing(FECHA, ataque, 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('la fecha cambia el escenario (el "cuándo" está sembrado, no leído del reloj)', () => {
    const a = generarEscenarioFuzzing('2026-08-28', 'foto_inyeccion_ocr', 0);
    const b = generarEscenarioFuzzing('2026-08-29', 'foto_inyeccion_ocr', 0);
    expect(a.seed).not.toBe(b.seed);
    // Y la fecha del viaje se ancla a la de la corrida, no a hoy.
    expect(a.fechaInicioViaje).toBe('2026-08-27');
    expect(b.fechaInicioViaje).toBe('2026-08-28');
  });

  it('el índice separa escenarios de la misma fecha y ataque', () => {
    expect(semillaFuzzing(FECHA, 'texto_control', 0).seed)
      .not.toBe(semillaFuzzing(FECHA, 'texto_control', 1).seed);
  });

  it('la semilla es auditable: el texto que se hasheó viene con el escenario', () => {
    const e = generarEscenarioFuzzing(FECHA, 'texto_control', 3);
    expect(e.semillaTexto).toBe(`${FECHA}|nivel3|fuzzing|texto_control|3`);
    expect(e.seed).toBe(semillaFuzzing(FECHA, 'texto_control', 3).seed);
  });

  it('el espacio de nombres de la semilla NO choca con el del Operador', () => {
    // Si `fuzzing` y `operador` compartieran texto de semilla, dos escenarios
    // distintos generarían los mismos datos y el reporte los confundiría.
    expect(generarEscenarioFuzzing(FECHA, 'texto_control', 0).semillaTexto).toContain('|fuzzing|');
  });
});

describe('todo escenario trae lo que el reporte del orquestador lee sin guard', () => {
  it.each(ATAQUES_FUZZING)('%s', (ataque) => {
    const e = generarEscenarioFuzzing(FECHA, ataque, 0);
    expect(e.anticipo).toBeGreaterThan(0);
    expect(e.folioViaje).toMatch(/^ZZZQA-V-\d{6}$/);   // el prefijo QA es lo que hace alcanzable la limpieza
    expect(e.invariantes.length).toBeGreaterThan(0);
    expect(e.prohibido.length).toBeGreaterThan(0);
    expect(e.topeDiesel).toBe(4000);                   // la política sembrada, no el ataque
    expect(Array.isArray(e.fotos)).toBe(true);
    expect(Array.isArray(e.textos)).toBe(true);
    // Un escenario sin nada que mandar no ataca nada.
    expect(e.fotos.length + e.textos.length).toBeGreaterThan(0);
  });
});

describe('los bytes basura son basura de verdad', () => {
  it('no son una imagen: ninguna firma de PNG/JPEG/GIF/WEBP', () => {
    // Si por azar el PRNG produjera una cabecera válida, el ataque dejaría de
    // ser «esto no es una imagen» y pasaría a ser «imagen truncada», que es
    // otro camino de código.
    for (let s = 0; s < 50; s++) {
      const b = bytesBasura(mulberry32(s), 2048);
      expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
      expect(b[0] === 0xff && b[1] === 0xd8).toBe(false);       // JPEG SOI
      expect(b.subarray(0, 3).toString('latin1')).not.toBe('GIF');
      expect(b.subarray(0, 4).toString('latin1')).not.toBe('RIFF');
    }
  });

  it('son reproducibles y del largo pedido', () => {
    expect(bytesBasura(mulberry32(7), 1500)).toEqual(bytesBasura(mulberry32(7), 1500));
    expect(bytesBasura(mulberry32(7), 1500)).toHaveLength(1500);
    expect(bytesBasura(mulberry32(7), 1500).equals(bytesBasura(mulberry32(8), 1500))).toBe(false);
  });

  it('el data-URL MIENTE con el MIME, que es justo el ataque', () => {
    const url = dataUrlBasura(mulberry32(3), 900);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    // Y lo que va detrás no es un JPEG.
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    expect(bytes[0] === 0xff && bytes[1] === 0xd8).toBe(false);
  });

  it('el escenario pide un tamaño creíble para una foto de WhatsApp', () => {
    const e = generarEscenarioFuzzing(FECHA, 'foto_bytes_basura', 0);
    const foto = e.fotos[0];
    expect(foto.clase).toBe('bytes_basura');
    if (foto.clase !== 'bytes_basura') return;
    expect(foto.bytes).toBeGreaterThanOrEqual(900);
    expect(foto.bytes).toBeLessThanOrEqual(6000);
  });
});

describe('el ruido válido es VÁLIDO: la imagen decodifica y no dice nada', () => {
  it('trae bloques dentro del lienzo y ninguno es texto', () => {
    const e = generarEscenarioFuzzing(FECHA, 'foto_sin_contenido', 0);
    const foto = e.fotos[0];
    expect(foto.clase).toBe('ruido_valido');
    if (foto.clase !== 'ruido_valido') return;
    expect(foto.bloques.length).toBeGreaterThanOrEqual(12);
    for (const b of foto.bloques) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThan(foto.ancho);
      expect(b.y).toBeLessThan(foto.alto);
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });

  it('lo prohibido nombra la alucinación, que es el modo de falla real aquí', () => {
    const e = generarEscenarioFuzzing(FECHA, 'foto_sin_contenido', 0);
    expect(e.prohibido.join(' ')).toMatch(/INVENTAR/);
  });
});

describe('los payloads de inyección', () => {
  it('los tres caben en el ticket renderizado (4 renglones × 62 caracteres)', () => {
    // El renderizador corta en seco a los 248 caracteres. Un payload más largo
    // se imprimiría a medias y el ataque probaría otra cosa sin avisar.
    for (const p of PAYLOADS_INYECCION) {
      const t = p.texto(9850);
      expect(t.length, `"${p.nombre}" se cortaría: ${t.length} > ${CARACTERES_IMPRIMIBLES}`)
        .toBeLessThanOrEqual(CARACTERES_IMPRIMIBLES);
    }
  });

  it('cada uno lleva el monto inyectado dentro, o no inyecta nada', () => {
    for (const p of PAYLOADS_INYECCION) {
      expect(p.texto(9850)).toContain('9850');
    }
  });

  it('el monto inyectado está MUY lejos del real: si se cuela, se ve solo', () => {
    for (let i = 0; i < 30; i++) {
      const e = generarEscenarioFuzzing(FECHA, 'foto_inyeccion_ocr', i);
      const foto = e.fotos[0];
      if (foto.clase !== 'ticket_envenenado') throw new Error('clase inesperada');
      expect(e.montoInyectado).toBe(foto.montoInyectado);
      // Un decimal de diferencia sería indistinguible de un error de OCR; un
      // orden de magnitud no.
      expect(foto.montoInyectado).toBeGreaterThan(foto.ticket.monto * 4);
      // Y por encima del tope de política, para que además dispare `sobre_politica`.
      expect(foto.montoInyectado).toBeGreaterThan(e.topeDiesel);
    }
  });

  it('el ticket base es CREÍBLE y limpio: el ataque es el payload, no el monto', () => {
    const e = generarEscenarioFuzzing(FECHA, 'foto_inyeccion_ocr', 0);
    const foto = e.fotos[0];
    if (foto.clase !== 'ticket_envenenado') throw new Error('clase inesperada');
    expect(foto.ticket.monto).toBeLessThan(e.topeDiesel);
    expect(foto.ticket.folio).toMatch(/^ZZZQA-\d{6}$/);
    expect(foto.ticket.litros).toBeGreaterThan(0);
  });

  it('el ataque por TEXTO usa los mismos vectores: es el camino más barato', () => {
    const e = generarEscenarioFuzzing(FECHA, 'texto_inyeccion', 0);
    expect(e.textos).toHaveLength(1);
    expect(e.textos[0]).toContain(String(e.montoInyectado));
  });

  it('con índices distintos se recorren los tres vectores, no siempre el mismo', () => {
    const vistos = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const f = generarEscenarioFuzzing(FECHA, 'foto_inyeccion_ocr', i).fotos[0];
        return f.clase === 'ticket_envenenado' ? f.payloadNombre : '';
      }),
    );
    expect(vistos.size).toBe(PAYLOADS_INYECCION.length);
  });
});

describe('los caracteres hostiles lo son de verdad', () => {
  it('el NUL está en la lista: es el que Postgres rechaza (22021)', () => {
    expect(CARACTERES_HOSTILES.some((c) => c.car === '\u0000')).toBe(true);
  });

  it('ninguno es imprimible ASCII: si lo fuera, no atacaría nada', () => {
    for (const c of CARACTERES_HOSTILES) {
      const cp = c.car.codePointAt(0)!;
      expect(cp < 0x20 || cp > 0x7e, `${c.nombre} (U+${cp.toString(16)}) es un carácter normal`).toBe(true);
    }
  });

  it('el texto sucio CONSERVA el mensaje legible debajo', () => {
    // Si el ataque destruyera el mensaje, el sistema podría rechazarlo por
    // vacío y el escenario no probaría el camino que quiere probar.
    const { texto, usados } = textoConControl(mulberry32(11), 'ya subí todo', 3);
    expect(usados).toHaveLength(3);
    expect(texto.replace(HOSTILES_RE, '')).toBe('ya subí todo');
    expect(texto).not.toBe('ya subí todo');
  });

  it('el escenario de texto_control mete entre 2 y 5, y dice cuáles', () => {
    for (let i = 0; i < 20; i++) {
      const e = generarEscenarioFuzzing(FECHA, 'texto_control', i);
      const cuantos = (e.textos[0].match(HOSTILES_RE) ?? []).length;
      expect(cuantos).toBeGreaterThanOrEqual(2);
      expect(cuantos).toBeLessThanOrEqual(5);
      expect(e.prohibido.join(' ')).toMatch(/22021/);
    }
  });
});
