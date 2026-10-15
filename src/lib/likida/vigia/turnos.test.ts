import { describe, it, expect } from 'vitest';
import {
  turnoActual, recibeAhora, filtrarPorTurno, horaLocal, esNoche, festivosOficialesMx, esFechaValida, aTurnoDirector, TURNOS_DIRECTOR,
  type TurnoDirector,
} from './turnos';

const MX = 'America/Mexico_City';
// Ciudad de México va en UTC-6 todo el año (sin horario de verano): hora local = UTC - 6.
const mx = (iso: string) => new Date(iso);

describe('turnoActual · reloj simulado en America/Mexico_City', () => {
  it('21:00 local es noche; 12:00 local es día (miércoles sin festivo)', () => {
    expect(turnoActual(mx('2026-10-15T03:00:00Z'), MX)).toBe('noche');   // mié 14-oct 21:00 local
    expect(turnoActual(mx('2026-10-14T18:00:00Z'), MX)).toBe('dia');     // mié 14-oct 12:00 local
  });

  it('16-sep es festivo si está en el calendario; sin calendario ese miércoles es día', () => {
    const mediodia = mx('2026-09-16T18:00:00Z');                         // mié 16-sep 12:00 local
    expect(turnoActual(mediodia, MX, ['2026-09-16'])).toBe('festivo');
    expect(turnoActual(mediodia, MX, [])).toBe('dia');
  });

  it('el día se mide en la zona de la flota, no en UTC: 23:30 local del 15-sep aún no es festivo del 16', () => {
    const noche15 = mx('2026-09-16T05:30:00Z');                          // mar 15-sep 23:30 local (ya es 16 en UTC)
    expect(horaLocal(noche15, MX)).toEqual({ fecha: '2026-09-15', hora: 23, diaSemana: 2 });
    expect(turnoActual(noche15, MX, ['2026-09-16'])).toBe('noche');
    expect(turnoActual(mx('2026-09-16T06:00:00Z'), MX, ['2026-09-16'])).toBe('festivo');   // 00:00 local del 16
  });

  it('sábado y domingo cuentan como festivo (el turno se llama festivos_y_fin_de_semana)', () => {
    expect(turnoActual(mx('2026-10-17T18:00:00Z'), MX)).toBe('festivo'); // sáb 17-oct 12:00
    expect(turnoActual(mx('2026-10-18T18:00:00Z'), MX)).toBe('festivo'); // dom 18-oct 12:00
    expect(turnoActual(mx('2026-10-19T18:00:00Z'), MX)).toBe('dia');     // lun 19-oct 12:00
  });
});

describe('fin de turno y ventana de noche configurable', () => {
  it('por omisión 20:00–07:00: desde incluido, hasta excluido', () => {
    expect(esNoche(19)).toBe(false);
    expect(esNoche(20)).toBe(true);
    expect(esNoche(0)).toBe(true);
    expect(esNoche(6)).toBe(true);
    expect(esNoche(7)).toBe(false);
  });
  it('en la zona de México: 19:59 → día, 20:00 → noche; 06:59 → noche, 07:00 → día', () => {
    expect(turnoActual(mx('2026-10-15T01:59:00Z'), MX)).toBe('dia');     // mié 19:59 local
    expect(turnoActual(mx('2026-10-15T02:00:00Z'), MX)).toBe('noche');   // mié 20:00 local
    expect(turnoActual(mx('2026-10-15T12:59:00Z'), MX)).toBe('noche');   // jue 06:59 local
    expect(turnoActual(mx('2026-10-15T13:00:00Z'), MX)).toBe('dia');     // jue 07:00 local
  });
  it('una ventana propia (22:00–06:00) y una que no cruza la medianoche (01:00–05:00)', () => {
    expect(esNoche(21, { desdeHora: 22, hastaHora: 6 })).toBe(false);
    expect(esNoche(22, { desdeHora: 22, hastaHora: 6 })).toBe(true);
    expect(esNoche(3, { desdeHora: 1, hastaHora: 5 })).toBe(true);
    expect(esNoche(12, { desdeHora: 1, hastaHora: 5 })).toBe(false);
  });
  it('ventana inválida → la de omisión; ventana de largo cero → no hay noche', () => {
    expect(esNoche(21, { desdeHora: 99, hastaHora: -1 })).toBe(true);
    expect(esNoche(21, { desdeHora: 8, hastaHora: 8 })).toBe(false);
  });
});

describe('DST: zonas IANA sin suponer horario de verano', () => {
  const NY = 'America/New_York';
  it('21:00 local es noche en invierno (UTC-5) y en verano (UTC-4)', () => {
    expect(horaLocal(new Date('2026-01-14T02:00:00Z'), NY).hora).toBe(21);
    expect(horaLocal(new Date('2026-07-15T01:00:00Z'), NY).hora).toBe(21);
    expect(turnoActual(new Date('2026-01-14T02:00:00Z'), NY)).toBe('noche');
    expect(turnoActual(new Date('2026-07-15T01:00:00Z'), NY)).toBe('noche');
  });
  it('el mismo instante UTC es noche en una zona y día en otra', () => {
    const t = new Date('2026-10-14T03:00:00Z');                          // 21:00 en México (mar 13-oct), 12:00 en Tokio (mié)
    expect(turnoActual(t, MX)).toBe('noche');
    expect(turnoActual(t, 'Asia/Tokyo')).toBe('dia');
  });
  it('zona inválida o vacía no lanza: usa la de México', () => {
    expect(() => horaLocal(new Date('2026-10-15T03:00:00Z'), 'No/Existe')).not.toThrow();
    expect(horaLocal(new Date('2026-10-15T03:00:00Z'), '').hora).toBe(21);
  });
});

describe('recibeAhora y filtrarPorTurno', () => {
  const noche = mx('2026-10-15T03:00:00Z');     // mié 21:00 local
  const dia = mx('2026-10-14T18:00:00Z');       // mié 12:00 local
  const sab = mx('2026-10-17T18:00:00Z');       // sáb 12:00 local
  const sabNoche = mx('2026-10-18T03:00:00Z');  // sáb 21:00 local

  it('cada turno por su cuenta', () => {
    expect(recibeAhora('siempre', dia, MX)).toBe(true);
    expect(recibeAhora('noche', noche, MX)).toBe(true);
    expect(recibeAhora('noche', dia, MX)).toBe(false);
    expect(recibeAhora('festivos_y_fin_de_semana', sab, MX)).toBe(true);
    expect(recibeAhora('festivos_y_fin_de_semana', dia, MX)).toBe(false);
    expect(recibeAhora('festivos_y_fin_de_semana', dia, MX, ['2026-10-14'])).toBe(true);
  });
  it('un sábado por la noche reciben a la vez los de noche y los de fin de semana (un turno no tapa al otro)', () => {
    expect(recibeAhora('noche', sabNoche, MX)).toBe(true);
    expect(recibeAhora('festivos_y_fin_de_semana', sabNoche, MX)).toBe(true);
  });

  const lista: Array<{ id: string; turno: TurnoDirector }> = [
    { id: 'a', turno: 'siempre' }, { id: 'b', turno: 'noche' }, { id: 'c', turno: 'festivos_y_fin_de_semana' },
  ];
  it('de día entre semana: solo los «siempre»; de noche: siempre + noche; en sábado: siempre + fin de semana', () => {
    expect(filtrarPorTurno(lista, dia, MX).lista.map((d) => d.id)).toEqual(['a']);
    expect(filtrarPorTurno(lista, noche, MX).lista.map((d) => d.id)).toEqual(['a', 'b']);
    expect(filtrarPorTurno(lista, sab, MX).lista.map((d) => d.id)).toEqual(['a', 'c']);
  });
  it('si el filtro deja la lista vacía, cae al total y lo avisa (nunca sin destinatario)', () => {
    const soloNoche = [{ id: 'b', turno: 'noche' as TurnoDirector }, { id: 'c', turno: 'festivos_y_fin_de_semana' as TurnoDirector }];
    const r = filtrarPorTurno(soloNoche, dia, MX);
    expect(r.lista.map((d) => d.id)).toEqual(['b', 'c']);
    expect(r.cayoATodos).toBe(true);
  });
  it('lista vacía → vacía sin alarma; todos «siempre» → intacta', () => {
    expect(filtrarPorTurno([], dia, MX)).toEqual({ lista: [], cayoATodos: false });
    expect(filtrarPorTurno([{ turno: 'siempre' as TurnoDirector }], dia, MX).cayoATodos).toBe(false);
  });
  it('un valor de turno desconocido se trata como «siempre»', () => {
    expect(aTurnoDirector('quincena')).toBe('siempre');
    expect(aTurnoDirector(null)).toBe('siempre');
    for (const t of TURNOS_DIRECTOR) expect(aTurnoDirector(t)).toBe(t);
  });
});

describe('festivos oficiales de México (sugerencia)', () => {
  it('2026: las siete fechas de la LFT, ordenadas, con el 16-sep dentro y sin el 1-oct (no es año de transmisión)', () => {
    const f = festivosOficialesMx(2026);
    expect(f.map((x) => x.fecha)).toEqual(['2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25']);
  });
  it('2030 trae el 1 de octubre; 2025 no', () => {
    expect(festivosOficialesMx(2030).some((x) => x.fecha === '2030-10-01')).toBe(true);
    expect(festivosOficialesMx(2025).some((x) => x.fecha.endsWith('-10-01'))).toBe(false);
  });
  it('todas las fechas son válidas y tienen nombre', () => {
    for (const a of [2026, 2027, 2028, 2030]) for (const x of festivosOficialesMx(a)) { expect(esFechaValida(x.fecha)).toBe(true); expect(x.nombre.length).toBeGreaterThan(0); }
  });
  it('esFechaValida rechaza lo que no existe', () => {
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('16/09/2026')).toBe(false);
    expect(esFechaValida(20260916)).toBe(false);
    expect(esFechaValida('2028-02-29')).toBe(true);
  });
});
