import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { calcularEstancias, resumirEstadias, valorarEstancias, type FilaEstadia } from '@/lib/likida/conductor/estadias_anden';
import { hitoVacio } from '@/lib/likida/conductor/memoria.fixture';
import type { HitoFila, TipoHito } from '@/lib/likida/conductor/tipos';
import { promedioCerradas, VistaEstadias } from './vista';

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
function hito(tipo: TipoHito, iso: string | null, extra: Partial<HitoFila> = {}): HitoFila {
  return hitoVacio({ id: `h-${tipo}`, tipo, viajeId: 'v1', ...(iso ? { estado: 'recibido', fuente: 'texto', mensajeEn: iso, recibidoEn: iso } : {}), ...extra });
}
const viaje = { id: 'v1', folio: 'F-1042', estatus: 'abierto', operadorNombre: 'Juan Pérez', clienteId: 'c1', clienteNombre: 'Cliente A', terminalNombre: 'Tlaquepaque', origenSitio: 'Planta Zapopan', destinoSitio: null, origen: 'Zapopan', destino: 'Monterrey' };
const filasDe = (hs: HitoFila[]): FilaEstadia[] =>
  valorarEstancias(viaje, calcularEstancias({ id: 'v1', estatus: 'abierto' }, hs, AHORA, { validaciones: new Map([['h-llegada_carga', 'validado']]), evidencias: new Map([['h-salida_carga', 2]]) }), { porCliente: new Map(), flota: null });

const base = {
  sufijo: '', filtros: { desde: '2026-09-26', hasta: '2026-10-02', terminalId: '', clienteId: '', operadorId: '' },
  catalogos: { terminales: [], clientes: [], operadores: [] }, truncada: false, error: null, csvUrl: null, ocultos: {},
};
const pintar = (filas: FilaEstadia[], o: Partial<Parameters<typeof VistaEstadias>[0]> = {}) =>
  renderToStaticMarkup(<VistaEstadias {...base} filas={filas} resumen={resumirEstadias(filas)} {...o} />);

describe('estadías en andén', () => {
  const filas = filasDe([hito('llegada_carga', hace(300)), hito('salida_carga', hace(150))]);

  it('hora exacta con segundos, fuente, validación y fotos de cada parada', () => {
    const html = pintar(filas);
    expect(html).toContain('F-1042');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('2026-10-02 07:00:00'); // 13:00Z = 07:00 MX
    expect(html).toContain('mensaje del chofer');
    expect(html).toContain('validada con ubicación');
    expect(html).toContain('2 foto(s)');
    expect(html).toContain('2 horas y 30 minutos');
    expect(html).toContain('Planta Zapopan');
  });

  it('el tiempo medio se calcula SOLO sobre las paradas cerradas y dice sobre cuántas', () => {
    const html = pintar(filas);
    expect(html).toContain('Tiempo medio en carga');
    expect(html).toContain('sobre 1 paradas cerradas');
    expect(html).toContain('sin datos'); // descarga: ninguna cerrada
    expect(promedioCerradas(filas, 'carga')).toEqual({ promedio: 150, n: 1 });
    expect(promedioCerradas(filas, 'descarga')).toBeNull();
  });

  it('una parada en curso no entra al promedio y se cuenta como «en el andén ahora»', () => {
    const f = filasDe([hito('llegada_carga', hace(60))]);
    expect(promedioCerradas(f, 'carga')).toBeNull();
    const html = pintar(f);
    expect(html).toContain('En el andén ahora');
    expect(html).toContain('En curso (sigue en el andén)');
  });

  it('CERO pesos: ni monto, ni tarifa, ni horas libres en esta pantalla', () => {
    const html = pintar(filasDe([hito('llegada_carga', hace(500)), hito('salida_carga', hace(100))]));
    // La única mención es la nota de quién descarga el CSV de cobro: ninguna cifra, ninguna columna, ninguna moneda.
    expect(html).not.toMatch(/\$\s?\d|MXN|USD/);
    const tabla = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(tabla).not.toMatch(/monto|tarifa|libres|cobrable/i);
  });

  it('el CSV de cobro solo se ofrece a quien ve dinero; a los demás se les dice quién lo descarga', () => {
    expect(pintar(filas)).toContain('lo descargan el dueño de la flota y el contador');
    expect(pintar(filas)).not.toContain('CSV para cobro de estadías');
    const con = pintar(filas, { csvUrl: '/api/v1/estadias?desde=2026-09-26&hasta=2026-10-02&formato=csv' });
    expect(con).toContain('CSV para cobro de estadías');
    expect(con).toContain('/api/v1/estadias?desde=2026-09-26');
  });

  it('periodo sin paradas: lo dice; lectura caída: lo dice sin pintar ceros', () => {
    expect(pintar([])).toContain('Ninguna parada con llegada registrada');
    const html = pintar([], { error: 'No se pudieron leer las estadías ahora mismo.' });
    expect(html).toContain('No se pudieron leer las estadías');
    expect(html).not.toContain('Paradas del periodo');
  });

  it('una lectura truncada NO se presenta como el total', () => {
    expect(pintar(filas, { truncada: true })).toContain('Lo que ves NO es el total');
  });

  it('el periodo se rotula por la hora de LLEGADA, en días de México', () => {
    expect(pintar(filas)).toContain('Periodo por la hora del aviso de LLEGADA');
  });

  it('conserva el tenant de la vista de superadmin en el formulario', () => {
    expect(pintar(filas, { ocultos: { tenant: 't-9' } })).toContain('name="tenant" value="t-9"');
  });
});
