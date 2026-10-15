import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Salida, VistaProgramaVigia, type ResultadoPrograma, type ResumenPrograma } from './vista';

const accion = async () => null;
const base = (p: Partial<Parameters<typeof VistaProgramaVigia>[0]> = {}): Parameters<typeof VistaProgramaVigia>[0] => ({
  sufijo: '', puedeEscribir: true, vigiaEncendido: true, accion, ...p,
});
const pintar = (p?: Partial<Parameters<typeof VistaProgramaVigia>[0]>) => renderToStaticMarkup(<VistaProgramaVigia {...base(p)} />);

const resumen = (p: Partial<ResumenPrograma> = {}): ResumenPrograma => ({
  terminal: 'GDL', leidas: 1087, validas: 1075, dias: 26,
  porDia: [{ fecha: '2026-10-05', filas: 40, conAviso: 2, sinCaja: 3 }, { fecha: '2026-10-06', filas: 1, conAviso: 0, sinCaja: 0 }],
  totalDescartadas: 12, descartadas: [{ lineaCsv: 14, motivo: 'sin_caja_unidad_ni_cliente' }],
  totalConAviso: 2, filasConAviso: [{ lineaCsv: 30, fecha: '2026-10-05', avisos: ['La cita «XX» no se reconoció.'] }],
  avisosArchivo: [], sinFecha: 0,
  guardado: { yaCargado: false, nuevas: 1000, cambiadas: 5, sinCambio: 70, desaparecidas: 0 },
  ...p,
});

describe('pantalla de carga del programa (vista)', () => {
  it('estado vacío: dice que aún no hay programa e invita a subir el de hoy; el formulario pide terminal y archivo', () => {
    const html = pintar();
    expect(html).toContain('Aún no has cargado un programa');
    expect(html).toContain('Sube el archivo de hoy');
    expect(html).toContain('name="terminal"');
    expect(html).toContain('name="archivo"');
    expect(html).toContain('hasta 12 MB');
    expect(html).not.toContain('Qué entendí');
  });

  it('quien no puede escribir ve el aviso y ningún formulario', () => {
    const html = pintar({ puedeEscribir: false });
    expect(html).not.toContain('name="archivo"');
    expect(html).toContain('Solo el dueño o el encargado');
    expect(html).toContain('Aún no has cargado un programa');
  });

  it('Vigía apagado: lo dice; encendido, no; sin saberlo, lo admite', () => {
    expect(pintar({ vigiaEncendido: false })).toContain('El Vigía está apagado');
    expect(pintar({ vigiaEncendido: true })).not.toContain('El Vigía está apagado');
    const nulo = pintar({ vigiaEncendido: null });
    expect(nulo).toContain('No pude confirmar');
    expect(nulo).not.toContain('El Vigía está apagado');
  });

  it('el enlace de regreso conserva el sufijo de tenant', () => {
    expect(pintar({ sufijo: '?tenant=abc' })).toContain('href="/dashboard/agentes/vigia?tenant=abc"');
  });

  it('el formulario avisa que el xlsx todavía no se lee', () => {
    expect(pintar()).toContain('.xlsx');
  });
});

describe('lo que se muestra tras subir (Salida)', () => {
  const pintarSalida = (estado: ResultadoPrograma) => renderToStaticMarkup(<Salida estado={estado} />);

  it('con resultado: «qué entendí» en lenguaje llano con miles, días y no leídas', () => {
    const html = pintarSalida({ ok: true, resumen: resumen() });
    expect(html).toContain('Qué entendí');
    expect(html).toContain('Leí 1 087 filas de 26 días en la terminal GDL.');
    expect(html).toContain('12 no se pudieron leer.');
    expect(html).toContain('Guardé 1 000 filas nuevas, 5 con cambios y 70 sin cambios.');
    expect(html).not.toContain('Aún no has cargado');
  });

  it('lo descartado dice la línea y el porqué en llano, y el «y N más» cuando se recortó', () => {
    const html = pintarSalida({ ok: true, resumen: resumen() });
    expect(html).toContain('Lo que descarté');
    expect(html).toContain('Línea 14 del archivo: no traía caja, unidad ni cliente.');
    expect(html).toContain('Y 11 más.');
  });

  it('tabla por día con fecha dd/mm/aaaa y conteos', () => {
    const html = pintarSalida({ ok: true, resumen: resumen() });
    expect(html).toContain('05/10/2026');
    expect(html).toContain('06/10/2026');
    expect(html).toMatch(/05\/10\/2026<\/td><td[^>]*>40<\/td><td[^>]*>3<\/td><td[^>]*>2<\/td>/);
  });

  it('con avisos: lista las filas a revisar con su línea y fecha', () => {
    const html = pintarSalida({ ok: true, resumen: resumen() });
    expect(html).toContain('Filas que conviene revisar');
    expect(html).toContain('Línea 30 (05/10/2026):');
    expect(html).toContain('no se reconoció');
  });

  it('todo limpio: no inventa secciones de descartes ni de avisos', () => {
    const html = pintarSalida({ ok: true, resumen: resumen({ totalDescartadas: 0, descartadas: [], totalConAviso: 0, filasConAviso: [] }) });
    expect(html).toContain('Todas se pudieron leer.');
    expect(html).not.toContain('Lo que descarté');
    expect(html).not.toContain('Filas que conviene revisar');
  });

  it('el mismo archivo otra vez: dice que ya estaba y que no cambió nada', () => {
    const html = pintarSalida({ ok: true, resumen: resumen({ guardado: { yaCargado: true, nuevas: 0, cambiadas: 0, sinCambio: 0, desaparecidas: 0 } }) });
    expect(html).toContain('ya estaba cargado: no cambié nada');
  });

  it('filas que ya no vienen: «ocultas, no borradas»; filas sin fecha: se dice que no se guardaron', () => {
    const html = pintarSalida({ ok: true, resumen: resumen({ sinFecha: 3, guardado: { yaCargado: false, nuevas: 0, cambiadas: 0, sinCambio: 1, desaparecidas: 2 } }) });
    expect(html).toContain('las dejé ocultas, no las borré');
    expect(html).toContain('3 filas no tenían fecha de sección y no se guardaron');
  });

  it('con error: lo enseña tal cual, con role=alert, sin la sección de resultado', () => {
    const html = pintarSalida({ ok: false, error: 'El archivo no parece un programa de despacho: no encontré la fila de encabezados.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('no encontré la fila de encabezados');
    expect(html).not.toContain('Qué entendí');
  });

  it('sin resultado: el estado vacío', () => {
    expect(pintarSalida(null)).toContain('Aún no has cargado un programa');
  });
});
