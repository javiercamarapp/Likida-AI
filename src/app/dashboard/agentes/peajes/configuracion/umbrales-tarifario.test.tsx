import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionUmbralesAvisos } from './umbrales-avisos';
import { SeccionTarifario } from './tarifario';
import { VistaConfiguracionPeajes, type BuzonVista, type AccionesConfiguracion } from './vista';
import type { EntradasVista } from './entradas';
import { CONFIG_AVISOS_DEFAULT } from '@/lib/likida/peajes/config_avisos';
import { CONFIG_ATIPICOS_DEFAULT } from '@/lib/likida/peajes/atipicos';
import type { TarifaVista } from '@/lib/likida/peajes/datos';

const nada = async () => {};
const config = { atipicosActivo: false, umbrales: CONFIG_ATIPICOS_DEFAULT, avisos: CONFIG_AVISOS_DEFAULT, telefono: null };
const accionesU = { guardarUmbrales: nada, guardarAvisos: nada, guardarDestinatario: nada };
const accionesT = { importarTarifas: nada, confirmarTarifa: nada, sugerirPasada: nada };

const tarifa = (o: Partial<TarifaVista> = {}): TarifaVista => ({
  id: 't1', casetaNorm: 'caseta ejemplo norte', clase: 5, importe: 300, vigenteDesde: '2026-01-01', vigenteHasta: null,
  origen: 'inferida', confirmada: false, confirmadaPor: null, creadaEn: null, ...o,
});

describe('umbrales y avisos', () => {
  it('una flota nueva ve todo APAGADO y sin destinatario', () => {
    const html = renderToStaticMarkup(<SeccionUmbralesAvisos datos={{ config, puedeAdministrar: true, acciones: accionesU }} />);
    expect(html).not.toMatch(/name="activo"[^>]*checked/);
    expect(html).not.toMatch(/name="aviso_plazo"[^>]*checked/);
    expect(html).not.toMatch(/name="recordatorio_archivo"[^>]*checked/);
    expect(html).toContain('Sin destinatario: nada se manda por WhatsApp');
    expect(html).toContain('Vacío = solo en pantalla');
    expect(html).toContain('aún no está confirmado por escrito');
  });

  it('A37-A2-03: dice a la vista que los avisos de plazo y el recordatorio NO están conectados y no deja encenderlos', () => {
    const html = renderToStaticMarkup(<SeccionUmbralesAvisos datos={{ config, puedeAdministrar: true, acciones: accionesU }} />);
    expect(html).toContain('aún NO están conectados');
    expect(html).toMatch(/<input[^>]*disabled[^>]*name="aviso_plazo"/);
    expect(html).toMatch(/<input[^>]*disabled[^>]*name="recordatorio_archivo"/);
    expect(html).not.toContain('Necesita un destinatario');
  });

  it('muestra los valores por omisión: plazo de 3 meses, avisos 30 y 7, N=4, H=6, 130 km/h', () => {
    const html = renderToStaticMarkup(<SeccionUmbralesAvisos datos={{ config, puedeAdministrar: true, acciones: accionesU }} />);
    expect(html).toMatch(/name="plazo_meses"[^>]*value="3"/);
    expect(html).toMatch(/name="aviso_dias"[^>]*value="30, 7"/);
    expect(html).toMatch(/name="repeticion_min"[^>]*value="4"/);
    expect(html).toMatch(/name="repeticion_horas"[^>]*value="6"/);
    expect(html).toMatch(/name="velocidad_max"[^>]*value="130"/);
  });

  it('lo guardado se pinta: interruptores encendidos y el destinatario', () => {
    const html = renderToStaticMarkup(<SeccionUmbralesAvisos datos={{
      config: { ...config, atipicosActivo: true, telefono: '525500000000', avisos: { ...CONFIG_AVISOS_DEFAULT, interruptores: { aviso_plazo: true, recordatorio_archivo: false } } }, // grep-limpio:ok
      puedeAdministrar: true, acciones: accionesU,
    }} />);
    expect(html).toMatch(/name="activo"[^>]*checked/);
    expect(html).toMatch(/name="aviso_plazo"[^>]*checked/);
    expect(html).not.toMatch(/name="recordatorio_archivo"[^>]*checked/);
    expect(html).toContain('525500000000'); // grep-limpio:ok
    expect(html).toContain('llegan a este número');
  });

  it('quien no administra no ve formularios; si no se pudo leer lo dice', () => {
    const sin = renderToStaticMarkup(<SeccionUmbralesAvisos datos={{ config, puedeAdministrar: false, acciones: accionesU }} />);
    expect(sin).toContain('Solo quien administra la flota');
    expect(sin).not.toContain('<form');
    const ciego = renderToStaticMarkup(<SeccionUmbralesAvisos datos={{ config: null, puedeAdministrar: true, acciones: accionesU }} />);
    expect(ciego).toContain('No se pudo leer la configuración');
    expect(ciego).not.toContain('<form');
  });
});

describe('tarifario', () => {
  it('una flota nueva ve el tarifario vacío y lo dice (nada precargado)', () => {
    const html = renderToStaticMarkup(<SeccionTarifario datos={{ tarifas: [], acciones: accionesT }} />);
    expect(html).toContain('Nace vacío a propósito');
    expect(html).toContain('Aún no hay tarifas');
    expect(html).not.toContain('Confirmar');
  });

  it('una tarifa inferida se rotula «por confirmar» y ofrece confirmarla con un clic', () => {
    const html = renderToStaticMarkup(<SeccionTarifario datos={{ tarifas: [tarifa()], acciones: accionesT }} />);
    expect(html).toContain('inferida de los archivos');
    expect(html).toContain('Por confirmar');
    expect(html).toContain('name="tarifa" value="t1"');
    expect(html).toContain('0 confirmadas · 1 por confirmar');
  });

  it('una tarifa confirmada muestra quién la confirmó y no ofrece botón', () => {
    const html = renderToStaticMarkup(<SeccionTarifario datos={{ tarifas: [tarifa({ confirmada: true, confirmadaPor: 'Ana Prueba', origen: 'proveedor' })], acciones: accionesT }} />);
    expect(html).toContain('Confirmada por Ana Prueba');
    expect(html).not.toContain('name="tarifa"');
  });

  it('el formulario de carga no ofrece «inferida» como origen y no deja confirmar sin querer', () => {
    const html = renderToStaticMarkup(<SeccionTarifario datos={{ tarifas: [], acciones: accionesT }} />);
    expect(html).toContain('value="declarada"');
    expect(html).toContain('value="proveedor"');
    expect(html).not.toContain('value="inferida"');
    expect(html).toMatch(/<option value="declarada"|<option value="declarada" selected/);
  });

  it('si no se pudo leer, dice «no se pudo leer» y no «vacío»', () => {
    const html = renderToStaticMarkup(<SeccionTarifario datos={{ tarifas: null, acciones: accionesT }} />);
    expect(html).toContain('No se pudo leer el tarifario');
    expect(html).not.toContain('Aún no hay tarifas');
  });

  it('un tarifario grande no se pinta completo', () => {
    const muchas = Array.from({ length: 450 }, (_, i) => tarifa({ id: `t${i}`, clase: (i % 9) + 1 }));
    const html = renderToStaticMarkup(<SeccionTarifario datos={{ tarifas: muchas, acciones: accionesT }} />);
    expect(html).toContain('Se muestran 300 de 450');
  });
});

describe('integradas en la pantalla de configuración', () => {
  const acciones = { activarBuzon: nada, desactivarBuzon: nada, rotarLlave: nada, reintentarArchivo: nada, altaTag: nada, bajaTag: nada, importarTags: nada,
    importarCasetas: nada, estadoCaseta: nada, guardarGeocerca: nada, estadoGeocerca: nada, importarCursos: nada, importarCursosDeTabla: nada, estadoCurso: nada, guardarMapeo: nada, borrarMapeo: nada,
    activarCorreo: nada, desactivarCorreo: nada, rotarCorreo: nada, guardarRemitentes: nada, guardarPull: nada, apagarPull: nada, borrarCredencialPull: nada } as AccionesConfiguracion;
  const buzon: BuzonVista = { estado: 'inactivo', rotacion: null, secretoConfigurado: true, puedeAdministrar: true, llave: null, url: 'https://x.test/api', flotaId: 'f-1' };
  const entradas: EntradasVista = { config: null, puedeAdministrar: true, direccionCorreo: null, cofreConfigurado: true };
  const base = { sufijo: '', aviso: null, error: null, agenteApagado: null, tags: [], unidades: [], casetas: [], geocercas: [], cursos: [], convenios: [], mapeos: [], archivos: [], tiposGeocerca: ['origen'], buzon, entradas, acciones };

  it('con las secciones nuevas aparecen; sin ellas la pantalla de antes no cambia', () => {
    const con = renderToStaticMarkup(<VistaConfiguracionPeajes {...base} tarifario={{ tarifas: [], acciones: accionesT }} umbralesAvisos={{ config, puedeAdministrar: true, acciones: accionesU }} />);
    expect(con).toContain('id="tarifario"');
    expect(con).toContain('id="umbrales-avisos"');
    const sin = renderToStaticMarkup(<VistaConfiguracionPeajes {...base} />);
    expect(sin).not.toContain('id="tarifario"');
    expect(sin).not.toContain('id="umbrales-avisos"');
  });
});
