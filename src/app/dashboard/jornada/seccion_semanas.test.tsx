import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { componerJornada } from '@/lib/likida/jornada/modelo';
import { evaluarSemanas, type SemanaEvaluada } from '@/lib/likida/jornada/semanas';
import type { Asiento, TipoAsiento } from '@/lib/likida/jornada/modelo';
import { SeccionSemanas } from './vista';

// ═══════════════════════════════════════════════════════════════════════════
// El render del eje semanal (tableros al día, 28-ago-2026). Lo que se fija:
// `null` (no se evaluó) y `[]` (cero semanas completas) se DICEN distinto; una
// semana con huecos no se concluye y nombra los días; y el exceso llega con
// su fundamento citable. Las semanas de los casos salen de `evaluarSemanas`
// REAL — no de utilería que pueda divergir del motor.
// ═══════════════════════════════════════════════════════════════════════════

let n = 0;
function asiento(tipo: TipoAsiento, momento: string): Asiento {
  n += 1;
  return {
    id: `a-${n}`, tipo, momento, procedencia: 'declarado_operador',
    origenRef: null, waMessageId: null, viajeId: null, registradoPorEmail: null,
    nota: null, corrigeA: null, anuladoEn: null, anuladoPorEmail: null, anuladoMotivo: null,
  };
}
function dia(diaStr: string, horas: number) {
  return {
    operadorId: 'o-1', operadorNombre: 'Juan Pérez', dia: diaStr,
    jornada: componerJornada([
      asiento('inicio_jornada', `${diaStr}T08:00:00-06:00`),
      asiento('fin_jornada', `${diaStr}T${String(8 + horas).padStart(2, '0')}:00:00-06:00`),
    ]),
  };
}
const SEMANA = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];

function semanaReal(entradas: Parameters<typeof evaluarSemanas>[0]): SemanaEvaluada[] {
  return evaluarSemanas(entradas, null, '2026-08-17', '2026-08-23');
}

describe('SeccionSemanas — el eje semanal dice la verdad', () => {
  it('null con lectura truncada: «no se evaluó», jamás «no hay semanas»', () => {
    const html = renderToStaticMarkup(<SeccionSemanas semanas={null} truncada={true} />);
    expect(html).toContain('la lectura vino recortada');
    expect(html).not.toContain('no contiene ninguna semana completa');
  });

  it('cero semanas completas: se explica y se acciona (amplía el rango)', () => {
    const html = renderToStaticMarkup(<SeccionSemanas semanas={[]} truncada={false} />);
    expect(html).toContain('ninguna semana completa');
    expect(html).toContain('Amplía el rango');
  });

  it('la semana de 63 h sale con el exceso y su fundamento citable', () => {
    const semanas = semanaReal(SEMANA.map((d) => dia(d, 9)));
    const html = renderToStaticMarkup(<SeccionSemanas semanas={semanas} truncada={false} />);
    expect(html).toContain('63');
    expect(html).toContain('tope ordinario del año:');
    expect(html).toContain('Transitorios Segundo y Cuarto');
    // El art. 69 también: 7 días trabajados sin descanso.
    expect(html).toContain('LFT art. 69');
  });

  it('la semana con un hueco no se concluye: nombra el día y aclara que no son cero horas', () => {
    const semanas = semanaReal(SEMANA.filter((d) => d !== '2026-08-20').map((d) => dia(d, 8)));
    const html = renderToStaticMarkup(<SeccionSemanas semanas={semanas} truncada={false} />);
    expect(html).toContain('no se concluye');
    expect(html).toContain('no son cero horas');
    expect(html).toContain('2026-08-20');
  });
});
