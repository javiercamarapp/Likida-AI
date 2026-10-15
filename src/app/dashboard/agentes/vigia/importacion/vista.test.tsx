import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Salida, VistaImportacionVigia, type ResultadoImportacion, type ResumenImportacion } from './vista';

const accion = async () => null;
const pintar = (sufijo = '') => renderToStaticMarkup(<VistaImportacionVigia sufijo={sufijo} accion={accion} />);

const resumen = (p: Partial<ResumenImportacion> = {}): ResumenImportacion => ({
  terminal: 'GDL', totalCajas: 1250, filasImportacion: 1300, filasOtrasSecciones: 40, sinFecha: 0,
  dias: [
    { fecha: '2026-10-05', cajas: 1200, sinCaja: 2, porEstado: { patio: 700, pend_cruce: 300, en_ruta: 150, desconocido: 50 }, porDocs: { listo: 900, pend_requisito: 250, desconocido: 50 } },
    { fecha: '2026-10-06', cajas: 50, sinCaja: 0, porEstado: { patio: 10, pend_cruce: 5, en_ruta: 30, desconocido: 5 }, porDocs: { listo: 40, pend_requisito: 5, desconocido: 5 } },
  ],
  totalIncoherencias: 0, incoherencias: [], comparacion: null, csv: 'Fecha,Caja\n',
  ...p,
});
const salida = (estado: ResultadoImportacion) => renderToStaticMarkup(<Salida estado={estado} />);

describe('tablero de estatus de importación (vista)', () => {
  it('muestra siempre el rótulo «derivado del programa, no verificado contra Track & Trace»', () => {
    expect(pintar()).toContain('Derivado del programa, no verificado contra Track &amp; Trace.');
  });

  it('estado vacío: invita a cargar el programa del día; el formulario pide terminal y archivo; sin tablero ni CSV', () => {
    const html = pintar();
    expect(html).toContain('Carga el programa del día para ver el estatus.');
    expect(html).toContain('name="terminal"');
    expect(html).toContain('name="archivo"');
    expect(html).toContain('hasta 12 MB');
    expect(html).not.toContain('Descargar CSV');
    expect(html).not.toContain('Estatus por día');
  });

  it('el enlace de regreso conserva el sufijo de tenant', () => {
    expect(pintar('?tenant=abc')).toContain('href="/dashboard/agentes/vigia?tenant=abc"');
  });

  it('con resultado: cajas por día y por estado, con miles, y el botón «Descargar CSV»', () => {
    const html = salida({ ok: true, resumen: resumen() });
    expect(html).toContain('1 250 cajas de importación en 2 días, terminal GDL.');
    expect(html).toContain('40 filas de otras secciones no cuentan aquí.');
    expect(html).toMatch(/data-dia="2026-10-05"[^>]*>.*05\/10\/2026.*?>1 200<.*?>700<.*?>300<.*?>150<.*?>900<.*?>250<.*?>50</s);
    expect(html).toContain('Descargar CSV');
    expect(html).not.toContain('data-testid="vacio"');
  });

  it('sin incoherencias lo dice; con incoherencias lista línea, día, caja y motivo, y avisa de las que faltan', () => {
    expect(salida({ ok: true, resumen: resumen() })).toContain('Ninguna fila se contradice');
    const html = salida({
      ok: true,
      resumen: resumen({
        totalIncoherencias: 25,
        incoherencias: [{ lineaCsv: 1042, fecha: '2026-10-05', caja: 'CAJA-9', unidad: null, codigo: 'listo_sin_transito', mensaje: 'Los documentos están en «LISTO» pero la columna TRANSITO está vacía: no se sabe dónde está la caja.' }],
      }),
    });
    expect(html).toContain('Línea 1 042 (05/10/2026), caja CAJA-9:');
    expect(html).toContain('TRANSITO está vacía');
    expect(html).toContain('Y 24 más en el CSV.');
    expect(html).not.toContain('Ninguna fila se contradice');
  });

  it('sin Track & Trace dice que no hay con qué comparar; con él, cuenta coincidencias y nombra las que difieren', () => {
    expect(salida({ ok: true, resumen: resumen() })).toContain('todavía no está conectado');
    const html = salida({ ok: true, resumen: resumen({ comparacion: { comparadas: 10, coinciden: 8, difieren: ['C2', 'C7'], sinDatoTT: 3 } }) });
    expect(html).toContain('10 cajas comparadas: 8 coinciden y 2 no.');
    expect(html).toContain('No coinciden: C2, C7.');
    expect(html).not.toContain('todavía no está conectado');
  });

  it('un programa sin cajas de importación lo dice y no ofrece el CSV', () => {
    const html = salida({ ok: true, resumen: resumen({ totalCajas: 0, dias: [], filasImportacion: 0 }) });
    expect(html).toContain('No encontré cajas de importación en la terminal GDL.');
    expect(html).not.toContain('Descargar CSV');
  });

  it('un error se muestra en llano y no pinta tablero', () => {
    const html = salida({ ok: false, error: 'Elige el archivo del programa (CSV).' });
    expect(html).toContain('Elige el archivo del programa (CSV).');
    expect(html).not.toContain('Estatus por día');
  });

  it('el texto del programa que venga en una caja se escapa (no se inyecta HTML)', () => {
    const html = salida({
      ok: true,
      resumen: resumen({ totalIncoherencias: 1, incoherencias: [{ lineaCsv: 3, fecha: '2026-10-05', caja: '<img src=x onerror=alert(1)>', unidad: null, codigo: 'listo_sin_transito', mensaje: 'm' }] }),
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
