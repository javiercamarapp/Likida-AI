import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaConfiguracionPeajes, type BuzonVista, type AccionesConfiguracion } from './vista';

const nada = async () => {};
const acciones: AccionesConfiguracion = {
  activarBuzon: nada, desactivarBuzon: nada, rotarLlave: nada, reintentarArchivo: nada, altaTag: nada, bajaTag: nada, importarTags: nada,
  importarCasetas: nada, estadoCaseta: nada, guardarGeocerca: nada, estadoGeocerca: nada, guardarMapeo: nada, borrarMapeo: nada,
};
const LLAVE = 'a'.repeat(64);
const buzonActivo: BuzonVista = { estado: 'activo', rotacion: 2, secretoConfigurado: true, puedeAdministrar: true, llave: LLAVE, url: 'https://app.likida.ai/api/peajes/ingesta', flotaId: 'f-1' };

function pintar(o: Partial<Parameters<typeof VistaConfiguracionPeajes>[0]> = {}) {
  return renderToStaticMarkup(
    <VistaConfiguracionPeajes
      sufijo="" aviso={null} error={null} agenteApagado={null}
      tags={[]} unidades={[{ id: 'u1', numeroEconomico: 'C2-08', placas: 'ABC-123' }]} casetas={[]} geocercas={[]} mapeos={[]} archivos={[]}
      tiposGeocerca={['origen', 'punto_interes']} buzon={buzonActivo} acciones={acciones}
      {...o}
    />,
  );
}

describe('la llave del buzón es un secreto', () => {
  it('quien administra la ve, con la URL y la flota', () => {
    const html = pintar();
    expect(html).toContain(LLAVE);
    expect(html).toContain('https://app.likida.ai/api/peajes/ingesta');
    expect(html).toContain('x-likida-firma');
  });
  it('quien NO administra no la ve (aunque llegue en props, no se pinta)', () => {
    const html = pintar({ buzon: { ...buzonActivo, puedeAdministrar: false } });
    expect(html).not.toContain(LLAVE);
    expect(html).toContain('solo la ve quien administra');
    expect(html).not.toContain('Rotar llave');
  });
  it('sin llave calculada (buzón inactivo) no hay campo de llave', () => {
    const html = pintar({ buzon: { ...buzonActivo, estado: 'inactivo', llave: null } });
    expect(html).not.toContain('Llave de firma');
    expect(html).toContain('Activar buzón');
  });
  it('sin PEAJES_INGESTA_SECRETO lo dice con todas sus letras', () => {
    expect(pintar({ buzon: { ...buzonActivo, secretoConfigurado: false, llave: null } })).toContain('Falta PEAJES_INGESTA_SECRETO');
  });
  it('estado ilegible: «no se pudo leer», no «desactivado»', () => {
    const html = pintar({ buzon: { ...buzonActivo, estado: 'ilegible', llave: null } });
    expect(html).toContain('No se pudo leer el estado del buzón');
    expect(html).not.toContain('Buzón desactivado');
  });
});

describe('honestidad de los catálogos', () => {
  it('catálogo de casetas vacío: dice que no valida nada y que nunca acusa', () => {
    const html = pintar();
    expect(html).toContain('Nace vacío a propósito');
    expect(html).toContain('nunca una acusación');
  });
  it('lecturas fallidas (null) dicen «no se pudo leer», no «aún no hay»', () => {
    const html = pintar({ tags: null, casetas: null, geocercas: null, mapeos: null, archivos: null });
    for (const que of ['los TAGs', 'las casetas', 'las geocercas', 'los mapeos', 'los archivos recibidos']) expect(html).toContain(`No se pudo leer ${que}`);
    expect(html).not.toContain('Aún no hay TAGs');
  });
  it('el aviso del archivo REAL de PASE sin calibrar está a la vista', () => {
    expect(pintar()).toContain('archivo REAL de PASE todavía no se ha calibrado');
  });
});

describe('archivos recibidos', () => {
  const base = { id: 'a1', nombre: 'corte.xlsx', proveedor: 'PASE', intentos: 1, bytes: 20_480, recibidaEn: '2026-10-01T12:00:00Z', procesadaEn: null, desgloseId: null, ultimoError: null };
  it('un fallido muestra su motivo y el botón de reintentar; un procesado enlaza al desglose', () => {
    const html = pintar({
      archivos: [
        { ...base, estado: 'fallida', reintentable: true, ultimoError: 'No encontré la columna de importe en el archivo.' },
        { ...base, id: 'a2', nombre: 'ok.xlsx', estado: 'procesada', reintentable: false, desgloseId: 'd7' },
      ],
    });
    expect(html).toContain('No encontré la columna de importe');
    expect(html).toContain('Reintentar');
    expect(html).toContain('desglose=d7');
    expect(html).toContain('falló');
  });
  it('el texto del error del proveedor se escapa (no es HTML)', () => {
    const html = pintar({ archivos: [{ ...base, estado: 'fallida', reintentable: true, ultimoError: '<img src=x onerror=alert(1)>' }] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('mensajes', () => {
  it('aviso y error se pintan con su rol accesible, escapados', () => {
    const html = pintar({ aviso: 'Listo <b>x</b>', error: 'Falló' });
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Listo &lt;b&gt;x&lt;/b&gt;');
  });
  it('el agente apagado se avisa', () => {
    expect(pintar({ agenteApagado: 'El agente de Peajes está apagado' })).toContain('apagado');
  });
  it('tags y mapeos existentes se listan con su botón de borrar accesible', () => {
    const html = pintar({
      tags: [{ id: 't1', tag: 'IMDM10000001', tagOriginal: 'IMDM 10000001', unidadId: 'u1', unidadEconomico: 'C2-08', proveedor: 'PASE', activo: true }],
      mapeos: [{ id: 'm1', proveedor: 'PASE', activo: true, columnas: { fecha: 'Fecha de cobro', caseta: 'Plaza', monto: 'Importe', hora: 'Hora' } }],
    });
    expect(html).toContain('IMDM 10000001');
    expect(html).toContain('→ C2-08');
    expect(html).toContain('Eliminar el TAG IMDM10000001');
    expect(html).toContain('Eliminar el mapeo de PASE');
    expect(html).toContain('hora=«Hora»');
  });
});
