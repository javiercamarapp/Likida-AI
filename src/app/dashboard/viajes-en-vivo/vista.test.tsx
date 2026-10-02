import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { armarTableroViajes } from '@/lib/likida/orquestador/tablero_viajes';
import { datosVacios, hitosDe, viajeTablero } from '@/lib/likida/orquestador/fuentes.fixture';
import { TareasAbiertas, VistaViajesEnVivo } from './vista';

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const futuro = new Date(AHORA.getTime() + 600 * 60_000).toISOString();
const cfg = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana] };

function pintar(opciones: { posiciones?: Record<string, { lat: number; lng: number; medidaEn: string }> | null; filtros?: { terminalId: string; clienteId: string; soloExcepciones: boolean }; vacio?: boolean } = {}) {
  const sano = viajeTablero('1', { citaOrigenEn: futuro });
  const mudo = viajeTablero('2', { aceptadoEn: hace(300), operadorNombre: 'Chofer Dos', terminalNombre: 'Monterrey' });
  const datos = opciones.vacio ? datosVacios() : { ...datosVacios(), viajes: [sano, mudo], hitos: [...hitosDe('1'), ...hitosDe('2')] };
  const posiciones = opciones.posiciones === undefined
    ? new Map([['u-1', { lat: 20.67, lng: -103.35, medidaEn: hace(4) }], ['u-2', { lat: 25.68, lng: -100.31, medidaEn: hace(900) }]])
    : opciones.posiciones === null ? null : new Map(Object.entries(opciones.posiciones));
  const tablero = armarTableroViajes({ datos, config: cfg, posiciones, ahora: AHORA });
  return renderToStaticMarkup(
    <VistaViajesEnVivo
      tablero={tablero} filtros={opciones.filtros ?? { terminalId: '', clienteId: '', soloExcepciones: false }}
      catalogo={{ terminales: [{ id: 't1', nombre: 'Guadalajara' }], clientes: [{ id: 'c1', nombre: 'Cliente A' }] }}
      accionUrl="/dashboard/viajes-en-vivo" ocultos={{ tenant: 't-9' }} hrefMapa="/dashboard/mapa" tareas={null}
    />,
  );
}

describe('la pantalla de viajes en vivo', () => {
  it('pinta cada viaje con su posición, su antigüedad y su excepción, lo urgente primero', () => {
    const html = pintar();
    expect(html).toContain('F-1');
    expect(html).toContain('F-2');
    expect(html).toContain('hace 15 h'); // 900 min
    expect(html).toContain('hace 4 min');
    expect(html).toContain('Sin señal de vida');
    expect(html).toContain('Obsoleta');
    expect(html.indexOf('F-2')).toBeLessThan(html.indexOf('F-1')); // el urgente antes que el sano
    expect(html).toContain('Ver el mapa');
  });

  it('trae los filtros por terminal y cliente y conserva el tenant en los campos ocultos', () => {
    const html = pintar();
    expect(html).toContain('name="terminal"');
    expect(html).toContain('name="cliente"');
    expect(html).toContain('Guadalajara');
    expect(html).toContain('name="tenant" value="t-9"');
  });

  it('si no se pudo leer el GPS lo dice y NO pinta «sin posición» como hecho', () => {
    const html = pintar({ posiciones: null });
    expect(html).toContain('No se pudieron leer las posiciones del GPS');
    expect(html).not.toContain('Sin posición reportada');
  });

  it('sin viajes, o sin viajes que cumplan el filtro, lo dice distinto', () => {
    expect(pintar({ vacio: true })).toContain('No hay viajes en curso.');
    expect(pintar({ vacio: true, filtros: { terminalId: 't1', clienteId: '', soloExcepciones: false } })).toContain('Ningún viaje cumple los filtros.');
  });

  it('no pinta un solo peso (área operación)', () => {
    expect(pintar()).not.toMatch(/\$\s?\d|MXN|anticipo/i);
  });
});

describe('las tareas del asistente', () => {
  const t = [{ id: 'e1', creadaEn: hace(10), destino: 'mesa_de_control' as const, motivo: 'posible_emergencia' as const, viajeFolio: 'F-2', resumen: 'Chofer sin señal', pedidaPorRol: 'encargado' }];
  it('lista la tarea con a quién va y ofrece «Marcar atendida» solo a quien puede', () => {
    const con = renderToStaticMarkup(<TareasAbiertas tareas={t} accion={async () => {}} ocultos={{}} />);
    expect(con).toContain('Para la mesa de control');
    expect(con).toContain('viaje F-2');
    expect(con).toContain('Marcar atendida');
    expect(renderToStaticMarkup(<TareasAbiertas tareas={t} accion={null} ocultos={{}} />)).not.toContain('Marcar atendida');
  });
  it('sin tareas lo dice; con la tabla sin migrar no pinta nada (el asistente avisa por chat)', () => {
    expect(renderToStaticMarkup(<TareasAbiertas tareas={[]} accion={null} ocultos={{}} />)).toContain('No hay tareas abiertas');
    expect(renderToStaticMarkup(<TareasAbiertas tareas={null} accion={null} ocultos={{}} />)).toBe('');
  });
});
