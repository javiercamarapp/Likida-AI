import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ImportadorMasivo, csvDeProblemas } = await import('./importador-masivo');

const BASE: ResultadoImportacionUI = {
  paso: 'previsualizar', huella: 'abc123', archivo: 'flota.csv', leidas: 5, nuevas: 3, yaEstaban: 1, conProblema: 2,
  muestra: [{ fila: 2, titulo: 'Ana Ruiz', detalle: '5255 · patio Norte' }],
  problemas: [{ fila: 4, motivo: 'el patio «Patio Nowhere» no existe en tu flota' }, { fila: 5, motivo: 'teléfono inválido' }],
  patiosDesconocidos: ['Patio Nowhere'], avisos: [], excedeTope: false,
};

function pintar(estado: ResultadoImportacionUI | null, extra: Partial<React.ComponentProps<typeof ImportadorMasivo>> = {}) {
  return renderToStaticMarkup(
    <ImportadorMasivo
      entidad="operadores" accion={async () => null} plantillaCsv={'﻿nombre,telefono\r\n'} archivoPlantilla="plantilla-operadores.csv"
      columnas="Obligatorias: nombre y teléfono." hrefPatios="/dashboard/patios" tope={2000} estadoInicial={estado} {...extra}
    />,
  );
}

describe('ImportadorMasivo — los tres tiempos', () => {
  it('sin archivo: plantilla descargable (data URI con BOM, nombre de archivo), input accesible y límites DICHOS', () => {
    const html = pintar(null);
    expect(html).toContain('download="plantilla-operadores.csv"');
    expect(decodeURIComponent(/href="data:text\/csv;charset=utf-8,([^"]+)"/.exec(html)![1])).toBe('﻿nombre,telefono\r\n');
    expect(html).toMatch(/<label[^>]*for="archivo-operadores"[^>]*class="sr-only"/);
    expect(html).toContain('accept=".csv,.xlsx,.xls"');
    expect(html).toContain('Máximo 4 MB y 2,000 filas por archivo');
    expect(html).toContain('Revisar archivo');
    expect(html).not.toContain('Importar ');
  });

  it('la vista previa dice nuevas / ya estaban / con problema, enseña la muestra y los problemas fila por fila', () => {
    const html = pintar(BASE);
    expect(html).toContain('Se darían de alta');
    expect(html).toMatch(/Se darían de alta<\/p><p[^>]*>3</);
    expect(html).toContain('Ya estaban');
    expect(html).toContain('Ana Ruiz');
    expect(html).toContain('2 filas no entran');
    expect(html).toContain('teléfono inválido');
    expect(html).toContain('Descargar errores (.csv)');
    expect(html).toContain('download="errores-operadores.csv"');
  });

  it('los patios desconocidos se listan UNA vez con enlace a Patios', () => {
    const html = pintar(BASE);
    expect(html).toContain('Patio Nowhere');
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/patios"[^>]*>Créalos en Patios<\/a>/);
  });

  it('NO ofrece confirmar hasta que el archivo elegido sea el revisado (sin archivo en el navegador no hay botón de importar)', () => {
    expect(pintar(BASE)).not.toMatch(/>Importar 3 operadores</);
  });

  it('un error de todo el archivo se dice con role="alert" y sin tarjetas', () => {
    const html = pintar({ ...BASE, error: 'No pude leer el archivo.', huella: '', leidas: 0 });
    expect(html).toContain('role="alert"');
    expect(html).toContain('No pude leer el archivo.');
    expect(html).not.toContain('Se darían de alta');
  });

  it('un archivo con más del tope lo dice y no deja confirmar', () => {
    const html = pintar({ ...BASE, excedeTope: true });
    expect(html).toContain('Pártelo en archivos más chicos');
  });

  it('tras CONFIRMAR: dice «CARGA CONFIRMADA», lo que se dio de alta y el resultado de las invitaciones por nombre', () => {
    const html = pintar({
      ...BASE, paso: 'confirmar', confirmado: true,
      invitacion: { enviadas: 2, fallidas: [{ nombre: 'Beto Cruz', motivo: 'Sin WhatsApp.' }], pendientesRestantes: 40 },
    });
    expect(html).toContain('CARGA CONFIRMADA');
    expect(html).toContain('Se dieron de alta');
    expect(html).toContain('Invitaciones por WhatsApp: 2 enviadas');
    expect(html).toContain('Beto Cruz: Sin WhatsApp.');
    expect(html).toContain('Quedan 40 por invitar');
  });

  it('un jefe con patio lo lee: su carga cae en su patio (no se le manda a «crear patios»)', () => {
    const html = pintar(null, { patioDelJefe: 'Patio Norte' });
    expect(html).toContain('Tu carga cae en tu patio');
    expect(html).toContain('Patio Norte');
    expect(html).not.toContain('Patios</a>');
  });

  it('los textos del archivo se escapan (un nombre hostil no inyecta HTML)', () => {
    const html = pintar({ ...BASE, muestra: [{ fila: 2, titulo: '<img src=x onerror=alert(1)>', detalle: '' }] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('csvDeProblemas', () => {
  it('lleva BOM (Excel abre con acentos), comillas RFC 4180 y una fila por problema', () => {
    const csv = csvDeProblemas([{ fila: 4, motivo: 'el patio «A, B» no existe' }, { fila: 5, motivo: 'dice "hola"' }]);
    expect(csv.startsWith('﻿fila,motivo\r\n')).toBe(true);
    expect(csv).toContain('4,"el patio «A, B» no existe"');
    expect(csv).toContain('5,"dice ""hola"""');
  });
});
