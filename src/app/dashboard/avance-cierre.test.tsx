import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AvanceCierre from './avance-cierre';
import type { ViajeRow } from '@/lib/likida/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 — dos hallazgos en el mismo componente.
//
// MEDIO: "Semana | Mes | Todo" contra "7d | 30d | Todo" de `GlobalFilter",
// 130px abajo en la misma pantalla — dos vocabularios para la misma medida.
// Ahora los dos hablan igual.
//
// BAJO: sin viajes en el periodo, el componente dibujaba la pista Y la
// barra a `width:0%` — una barra vacía, justo lo que `chofer/vista.tsx`
// (Barra) prohíbe con estas palabras: "SIN ANTICIPO NO SE DIBUJA BARRA.
// Una barra vacía se lee como 'llevas 0%'."
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-08-05T12:00:00.000Z');

let contador = 0;
function viaje(fechaInicio: string | null, estatus: string): ViajeRow {
  contador += 1;
  return {
    id: `v${contador}`, folio: `VJ-${contador}`, origen: null, destino: null,
    estatus, anticipo: 0, operadorNombre: null, fechaInicio, intakePendientes: 0,
    avisadoEn: null, aceptadoEn: null, escaladoEn: null, avisosEnviados: 0,
  };
}

describe('AvanceCierre — un solo filtro para toda la pantalla (7-ago-2026)', () => {
  it('ya no dibuja su propio botón de periodo — el "7d"/"30d"/"Todo" ahora es de `GlobalFilter`, arriba', () => {
    // Retirado el propio toggle: dos controles de periodo en la misma
    // pantalla podían mostrar estados distintos (el hallazgo original de
    // esta prueba). Ahora `rango` llega por prop desde `resolverRango` en
    // `page.tsx`, y aquí no se pinta ningún botón — ni "7d"/"30d" ni
    // "Semana"/"Mes".
    const html = renderToStaticMarkup(<AvanceCierre viajes={[]} ahoraMs={AHORA} rango="30" />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Semana');
    expect(html).not.toContain('>Mes<');
  });

  it('el `rango` que recibe decide la ventana — "30" cuenta 30 días, no 7', () => {
    const dentroDe30 = { fechaInicio: '2026-07-15', estatus: 'liquidado' } as ViajeRow;
    const html = renderToStaticMarkup(<AvanceCierre viajes={[{ ...viaje(null, 'abierto'), ...dentroDe30 }]} ahoraMs={AHORA} rango="30" />);
    expect(html).toContain('1 de 1 viaje');
  });
});

describe('AvanceCierre — sin viajes en el periodo, no se dibuja una barra vacía', () => {
  it('con actividad, la barra (role="progressbar") SÍ se dibuja', () => {
    const viajes = [viaje('2026-08-04', 'liquidado'), viaje('2026-08-03', 'abierto')];
    const html = renderToStaticMarkup(<AvanceCierre viajes={viajes} ahoraMs={AHORA} />);
    expect(html).toContain('h-2 rounded-full overflow-hidden');
  });

  it('sin ningún viaje, la pista/barra NO se dibuja — antes salía a width:0%', () => {
    const html = renderToStaticMarkup(<AvanceCierre viajes={[]} ahoraMs={AHORA} />);
    expect(html).not.toContain('h-2 rounded-full overflow-hidden');
    expect(html).not.toMatch(/width:\s*0%/);
    expect(html).toContain('No hay viajes iniciados en este periodo.');
  });

  it('con viajes que existen pero caen FUERA de la ventana por defecto (30d), tampoco se dibuja', () => {
    // El default del componente es 'mes' (30d): un viaje de hace 65 días no
    // cae DENTRO del periodo activo, así que `dentro` sigue en 0 aunque el
    // arreglo `viajes` no esté vacío — el mismo caso que `estado.test.ts`
    // ya marcó como el más traicionero (actividad real, cero en la ventana).
    const viejo = [viaje('2026-06-01', 'liquidado')];
    const html = renderToStaticMarkup(<AvanceCierre viajes={viejo} ahoraMs={AHORA} />);
    expect(html).not.toMatch(/width:\s*0%/);
    expect(html).toContain('No hay viajes iniciados en este periodo.');
  });
});
