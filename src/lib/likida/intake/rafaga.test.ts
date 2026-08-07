import { describe, it, expect, beforeEach } from 'vitest';
import {
  anotarFoto, anotarIncidencia, pedirTurnoDeConfirmacion, cerrarRafaga,
  lineaIncidencias, olvidarRafagas,
} from './rafaga';

beforeEach(() => olvidarRafagas());

describe('la libreta de la ráfaga', () => {
  it('cuenta las fotos vistas y devuelve lo anotado al cerrar', () => {
    anotarFoto('v1'); anotarFoto('v1'); anotarFoto('v1');
    anotarIncidencia('v1', { tipo: 'ilegible' });
    anotarIncidencia('v1', { tipo: 'fecha_dudosa', monto: 1234, etiqueta: 'Diésel' });
    const r = cerrarRafaga('v1');
    expect(r.vistas).toBe(3);
    expect(r.incidencias).toHaveLength(2);
  });

  it('cerrar OLVIDA: la ráfaga siguiente empieza limpia', () => {
    anotarFoto('v1'); anotarIncidencia('v1', { tipo: 'ilegible' });
    cerrarRafaga('v1');
    const r = cerrarRafaga('v1');
    expect(r).toEqual({ vistas: 0, incidencias: [] });
  });

  it('cada viaje lleva su propia libreta (dos choferes a la vez)', () => {
    anotarFoto('v1'); anotarIncidencia('v1', { tipo: 'ilegible' });
    anotarFoto('v2'); anotarFoto('v2');
    expect(cerrarRafaga('v2')).toEqual({ vistas: 2, incidencias: [] });
    expect(cerrarRafaga('v1').incidencias).toHaveLength(1);
  });

  it('el turno de confirmación es un ordinal, que es contra lo que se compara el tope', () => {
    expect(pedirTurnoDeConfirmacion('v1')).toBe(1);
    expect(pedirTurnoDeConfirmacion('v1')).toBe(2);
    expect(pedirTurnoDeConfirmacion('v1')).toBe(3);
    // Y el contador se olvida con la ráfaga: el tope es POR ráfaga, no de por vida.
    cerrarRafaga('v1');
    expect(pedirTurnoDeConfirmacion('v1')).toBe(1);
  });

  it('una ráfaga que arranca TIRA lo que dejó una que nunca cerró', () => {
    // Pasa de verdad: si una invocación muere entre el `+1` y el `-1`, el
    // contador queda atascado hasta que la 0031 lo olvida (10 min) y ninguna
    // foto ve `quedan === 0`, así que la libreta no se cierra. Sin este
    // descarte, el resumen de la ráfaga SIGUIENTE diría «de tus 9 fotos» a
    // quien mandó tres — una cifra inventada.
    anotarFoto('v1'); anotarFoto('v1'); anotarFoto('v1');
    anotarIncidencia('v1', { tipo: 'ilegible' });

    anotarFoto('v1', true);   // el contador pasó de 0 a 1: ráfaga nueva
    const r = cerrarRafaga('v1');
    expect(r.vistas).toBe(1);
    expect(r.incidencias).toHaveLength(0);
  });

  it('pero a media ráfaga NO tira nada', () => {
    anotarFoto('v1', true);
    anotarFoto('v1', false);
    anotarFoto('v1', false);
    expect(cerrarRafaga('v1').vistas).toBe(3);
  });

  it('el techo de anotaciones no deja de CONTAR (el número es lo que no puede mentir)', () => {
    for (let i = 0; i < 200; i++) anotarIncidencia('v1', { tipo: 'ilegible', monto: i });
    expect(cerrarRafaga('v1').incidencias).toHaveLength(200);
  });
});

describe('lineaIncidencias — lo que se le dice al cerrar la ráfaga', () => {
  it('sin incidencias no dice NADA: el silencio es correcto cuando todo entró', () => {
    expect(lineaIncidencias(22, [])).toBeNull();
  });

  it('cuenta cada tipo y enseña los montos de las fechas dudosas', () => {
    const t = lineaIncidencias(22, [
      { tipo: 'ilegible' }, { tipo: 'ilegible' }, { tipo: 'ilegible' },
      { tipo: 'fecha_dudosa', monto: 1234.5, etiqueta: 'Diésel' },
      { tipo: 'fecha_dudosa', monto: 560, etiqueta: 'Caseta' },
    ])!;
    expect(t).toContain('De tus 22 fotos');
    expect(t).toMatch(/\*3\*/);
    expect(t).toMatch(/\*2\*/);
    // Los montos, con el formato de `formato.ts` y no con uno propio.
    expect(t).toContain('$1,234.50');
    expect(t).toContain('$560.00');
  });

  it('el fallo NUESTRO se dice como nuestro y promete que la foto no se perdió', () => {
    const t = lineaIncidencias(5, [{ tipo: 'fallo_tecnico' }, { tipo: 'fallo_tecnico' }])!;
    expect(t).toMatch(/de mi lado/i);
    expect(t).toMatch(/no se pierden|no se pierde/i);
    // Y NUNCA manda a un trámite que no existe.
    expect(t).not.toMatch(/captur/i);
  });

  it('un solo tipo no arma una lista con "y" colgando', () => {
    const t = lineaIncidencias(4, [{ tipo: 'ilegible' }])!;
    expect(t).not.toMatch(/, y /);
    expect(t).toContain('De tus 4 fotos');
  });

  it('con una sola foto vista no dice "de tus 1 fotos"', () => {
    const t = lineaIncidencias(1, [{ tipo: 'ilegible' }])!;
    expect(t).not.toMatch(/tus 1 foto/);
  });

  it('con más de tres montos no lee una lista entera', () => {
    const t = lineaIncidencias(9, [1, 2, 3, 4, 5].map((n) => ({ tipo: 'fecha_dudosa' as const, monto: n * 100 })))!;
    expect(t).toContain('y 2 más');
  });

  it('las que pasaron el tope de botones NO se dicen aquí: las dice mensajeDemasiadasDudas', () => {
    // Decirlo en los dos sitios ponía la misma cuenta dos veces en un mismo
    // mensaje. Aquí se cuentan (entran en `vistas` y en el log) y no se enuncian.
    expect(lineaIncidencias(12, [{ tipo: 'duda', monto: 100 }, { tipo: 'duda', monto: 200 }])).toBeNull();
  });

  it('pero una duda AL LADO de otras incidencias no borra el resto del párrafo', () => {
    const t = lineaIncidencias(12, [{ tipo: 'duda', monto: 100 }, { tipo: 'ilegible' }])!;
    expect(t).toMatch(/no la pude leer/i);
  });
});
