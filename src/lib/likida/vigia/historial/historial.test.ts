import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { leerExportWhatsapp, taparDatosPersonales } from './export_whatsapp';
import { textoDeZip, esZip } from './zip_lector';
import { analizarHistorial, esPregunta, semanaDe, temaDe } from './analisis';

const OPC = { equipo: ['Ana Servicio', 'Luis Tráfico'], sal: 'flota-1' };

describe('leerExportWhatsapp', () => {
  it('lee el formato iOS con a. m./p. m., multilínea y descarta sistema y multimedia', () => {
    const txt = [
      '‎[12/09/2026, 10:23:45 a. m.] Cliente Uno: Buenos días, ¿dónde va mi viaje?',
      '[12/09/2026, 10:25:00 a. m.] Ana Servicio: Va por Querétaro,',
      'llega a las 4 pm.',
      '[12/09/2026, 10:26:00 a. m.] Cliente Uno: ‎<Multimedia omitido>',
      '[12/09/2026, 10:27:00 a. m.] Los mensajes y las llamadas están cifrados de extremo a extremo.',
      '[12/09/2026, 3:05:00 p. m.] Cliente Uno: gracias',
    ].join('\n');
    const r = leerExportWhatsapp(txt, OPC);
    expect(r.formato).toBe('ios');
    expect(r.mensajes.map((m) => [m.rol, m.texto])).toEqual([
      ['cliente', 'Buenos días, ¿dónde va mi viaje?'],
      ['equipo', 'Va por Querétaro,\nllega a las 4 pm.'],
      ['cliente', 'gracias'],
    ]);
    expect(r.descartados).toBe(2);
    expect(r.autores).toBe(2);
    // 10:23:45 hora de México (UTC-6) = 16:23:45 UTC; 3:05 p. m. = 21:05 UTC.
    expect(r.mensajes[0].enviadoEn).toBe('2026-09-12T16:23:45.000Z');
    expect(r.mensajes[2].enviadoEn).toBe('2026-09-12T21:05:00.000Z');
  });

  it('lee el formato Android, decide día/mes por los datos y no guarda nombres ni teléfonos', () => {
    const txt = [
      '25/9/26, 10:23 - Cliente Dos: llámame al 33 1234 5678 o a x@y.com',
      '26/9/26, 08:00 - Luis Tráfico: listo',
    ].join('\n');
    const r = leerExportWhatsapp(txt, OPC);
    expect(r.formato).toBe('android');
    expect(r.mensajes[0].texto).toBe('llámame al [tel] o a [correo]');
    expect(r.mensajes[0].enviadoEn.startsWith('2026-09-25')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('Cliente Dos');
    expect(r.mensajes[0].autorHash).toHaveLength(12);
    expect(r.mensajes[1].rol).toBe('equipo');
  });

  it('el mismo nombre en otra flota da otro hash; las fechas imposibles se cuentan', () => {
    const a = leerExportWhatsapp('12/09/2026 10:00 - X: hola', { equipo: [], sal: 'a' }).mensajes[0].autorHash;
    const b = leerExportWhatsapp('12/09/2026 10:00 - X: hola', { equipo: [], sal: 'b' }).mensajes[0].autorHash;
    expect(a).not.toBe(b);
    expect(leerExportWhatsapp('31/02/2026 10:00 - X: hola', OPC).fechasInvalidas).toBe(1);
  });

  it('un texto sin ningún encabezado devuelve cero mensajes y formato desconocido', () => {
    const r = leerExportWhatsapp('esto no es un chat', OPC);
    expect(r.mensajes).toHaveLength(0);
    expect(r.formato).toBe('desconocido');
  });

  it('descarta las marcas de multimedia y de llamada en español e inglés, y no toma una fecha por teléfono', () => {
    const txt = [
      '12/09/2026 10:00 - A: <Multimedia omitido>', '12/09/2026 10:01 - A: imagen omitida', '12/09/2026 10:02 - A: Llamada perdida',
      '12/09/2026 10:03 - A: <Media omitted>', '12/09/2026 10:04 - A: entrega 2026-09-12 folio 55-1234-5678',
    ].join('\n');
    const r = leerExportWhatsapp(txt, { equipo: [], sal: 's' });
    expect(r.mensajes.map((m) => m.texto)).toEqual(['entrega 2026-09-12 folio [tel]']);
    expect(r.descartados).toBe(4);
  });

  it('un renglón de 1 MB sin separadores se procesa rápido (acotado antes de tapar)', () => {
    const t0 = Date.now();
    const r = leerExportWhatsapp(`12/09/2026 10:00 - A: ${'1234567890'.repeat(100_000)}`, { equipo: [], sal: 's' });
    expect(r.mensajes[0].texto.length).toBeLessThanOrEqual(1_500);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('tapa teléfonos largos pero no números cortos como un folio de 5 dígitos', () => {
    expect(taparDatosPersonales('folio 12345 y 55-1234-5678')).toBe('folio 12345 y [tel]');
  });
});

function zipDe(nombre: string, contenido: string, metodo: 0 | 8 = 8): Buffer {
  const datos = Buffer.from(contenido, 'utf8');
  const comp = metodo === 8 ? deflateRawSync(datos) : datos;
  const n = Buffer.from(nombre);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(metodo, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(metodo, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const cuerpo = Buffer.concat([loc, n, comp]);
  const dirc = Buffer.concat([cen, n]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(dirc.length, 12); eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, dirc, eocd]);
}

describe('textoDeZip', () => {
  it('saca el .txt (deflate y almacenado)', () => {
    for (const m of [8, 0] as const) {
      const z = zipDe('Chat de WhatsApp con Cliente.txt', 'hola ñ', m);
      expect(esZip(z)).toBe(true);
      expect(textoDeZip(z)).toEqual({ ok: true, texto: 'hola ñ', nombre: 'Chat de WhatsApp con Cliente.txt' });
    }
  });
  it('rechaza un zip sin .txt, uno dañado y uno que no es zip', () => {
    expect(textoDeZip(zipDe('foto.jpg', 'x'))).toMatchObject({ ok: false });
    expect(textoDeZip(Buffer.from('PK\x03\x04basura'))).toMatchObject({ ok: false });
    expect(esZip(Buffer.from('texto plano'))).toBe(false);
  });
  it('corta una bomba de descompresión sin reventar', () => {
    const bomba = zipDe('chat.txt', 'a'.repeat(21 * 1024 * 1024));
    expect(textoDeZip(bomba)).toMatchObject({ ok: false });
  });
});

describe('temas y análisis', () => {
  it('clasifica con las reglas del Vigía y las dos propias del grupo', () => {
    expect(temaDe('¿A qué hora llega mi camión?')).toBe('eta');
    expect(temaDe('¿Dónde va mi viaje?')).toBe('ubicacion');
    expect(temaDe('necesitamos reprogramar la cita de mañana')).toBe('cita_anden');
    expect(temaDe('¿me pasan la cotización?')).toBe('tarifa');
    expect(temaDe('esto es inaceptable')).toBe('queja');
    expect(temaDe('buenos días')).toBe('otro');
    expect(esPregunta('dónde está')).toBe(true);
    expect(esPregunta('gracias')).toBe(false);
  });

  const m = (iso: string, rol: 'cliente' | 'equipo', texto: string) => ({ enviadoEn: iso, rol, texto });
  const base = [
    m('2026-09-01T15:00:00Z', 'cliente', '¿Dónde va mi viaje?'),
    m('2026-09-01T15:04:00Z', 'equipo', 'Va por Querétaro, llega a las 4.'),
    m('2026-09-02T15:00:00Z', 'cliente', 'donde va mi viaje por favor'),
    m('2026-09-02T15:30:00Z', 'equipo', 'Va por Querétaro, llega a las 4.'),
    m('2026-09-03T15:00:00Z', 'cliente', '¿Dónde va mi viaje hoy?'),
    m('2026-09-04T15:00:00Z', 'cliente', 'Es inaceptable, nadie me contesta'),
    m('2026-09-04T17:00:00Z', 'cliente', 'gracias'),
  ];

  it('agrupa FAQs parecidas, trae la respuesta típica del equipo y mide esperas contra el umbral', () => {
    const r = analizarHistorial(base);
    expect(r.mensajesCliente).toBe(5);
    expect(r.faqs).toHaveLength(1);
    expect(r.faqs[0]).toMatchObject({ tema: 'ubicacion', veces: 3, dias: 3, respuestaTipica: 'Va por Querétaro, llega a las 4.', respuestasEncontradas: 2 });
    // esperas: 4 min, 30 min; sin respuesta: la 3.ª pregunta y la queja (el «gracias» no espera respuesta).
    expect(r.tiempos).toMatchObject({ conRespuesta: 2, sinRespuesta: 2, umbralMin: 10, sobreUmbral: 3 });
    expect(r.porTema.find((t) => t.tema === 'queja')?.mensajes).toBe(1);
  });

  it('las tendencias solo comparan si el histórico cubre 8 semanas; sin base, delta es null', () => {
    expect(analizarHistorial(base).tendencias.every((t) => t.delta === null)).toBe(true);
    const largo = [m('2026-07-01T15:00:00Z', 'cliente', '¿Dónde va mi viaje?'), m('2026-07-02T15:00:00Z', 'cliente', '¿Dónde va mi viaje?'), ...base];
    const t = analizarHistorial(largo).tendencias.find((x) => x.tema === 'ubicacion')!;
    expect(t).toMatchObject({ ultimas4Semanas: 3, previas4Semanas: 0, delta: 3 });
  });

  it('un histórico vacío no inventa nada', () => {
    const r = analizarHistorial([]);
    expect(r).toMatchObject({ mensajes: 0, faqs: [], tendencias: [], desde: null });
    expect(r.tiempos.medianaMin).toBeNull();
  });

  it('semanaDe devuelve el lunes', () => {
    expect(semanaDe('2026-09-03T12:00:00Z')).toBe('2026-08-31');
  });
});
