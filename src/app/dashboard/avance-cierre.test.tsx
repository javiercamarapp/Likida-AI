import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AvanceCierre from './avance-cierre';
import type { DiaViajes } from './serie-diaria';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 — dos hallazgos en el mismo componente.
//
// MEDIO: "Semana | Mes | Todo" contra "7d | 30d | Todo" de `GlobalFilter`,
// 130px abajo en la misma pantalla — dos vocabularios para la misma medida.
// Ahora los dos hablan igual.
//
// BAJO: sin viajes en el periodo, el componente dibujaba la pista Y la
// barra a `width:0%` — una barra vacía, justo lo que `chofer/vista.tsx`
// (Barra) prohíbe con estas palabras: "SIN ANTICIPO NO SE DIBUJA BARRA.
// Una barra vacía se lee como 'llevas 0%'."
//
// ── FE-5 (22-ago-2026) ─────────────────────────────────────────────────────
// El componente ya no recibe `ViajeRow[]` ni el reloj: recibe los buckets ya
// contados por SQL. La razón está en el archivo — contar en memoria sobre las
// 100 filas más recientes hacía que "7d", "30d" y "Todo" midieran los mismos
// ~90 minutos de operación a 50k viajes/mes.
// ═══════════════════════════════════════════════════════════════════════════

/** 30 días vacíos, del más viejo al más reciente — la forma que manda el
 *  servidor. `dia` no lo lee el componente (solo la gráfica), pero se pone
 *  real para que la fixture no mienta sobre su propia forma. */
function serieVacia(): DiaViajes[] {
  return Array.from({ length: 30 }, (_, i) => ({
    dia: `2026-07-${String(i + 7).padStart(2, '0')}`, viajes: 0, liquidados: 0,
  }));
}

/** La misma serie con actividad en el día `desdeElFinal`-ésimo contando desde
 *  hoy (0 = hoy). Así se distingue lo que cae dentro de 7d de lo que solo
 *  cae dentro de 30d — que es la distinción que el `rango` decide. */
function serieCon(desdeElFinal: number, viajes: number, liquidados: number): DiaViajes[] {
  const s = serieVacia();
  s[s.length - 1 - desdeElFinal] = { dia: s[s.length - 1 - desdeElFinal].dia, viajes, liquidados };
  return s;
}

describe('AvanceCierre — un solo filtro para toda la pantalla (7-ago-2026)', () => {
  it('ya no dibuja su propio botón de periodo — el "7d"/"30d"/"Todo" ahora es de `GlobalFilter`, arriba', () => {
    // Retirado el propio toggle: dos controles de periodo en la misma
    // pantalla podían mostrar estados distintos (el hallazgo original de
    // esta prueba). Ahora `rango` llega por prop desde `resolverRango` en
    // `page.tsx`, y aquí no se pinta ningún botón — ni "7d"/"30d" ni
    // "Semana"/"Mes".
    const html = renderToStaticMarkup(<AvanceCierre porDia={serieVacia()} historico={null} rango="30" />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Semana');
    expect(html).not.toContain('>Mes<');
  });

  it('el `rango` que recibe decide la ventana — "30" cuenta 30 días, no 7', () => {
    // Un viaje hace 20 días: DENTRO de 30d, FUERA de 7d. Si el componente
    // ignorara el rango, las dos aserciones no podrían ser ciertas a la vez.
    const serie = serieCon(20, 1, 1);
    expect(renderToStaticMarkup(<AvanceCierre porDia={serie} historico={null} rango="30" />))
      .toContain('1 de 1 viaje');
    expect(renderToStaticMarkup(<AvanceCierre porDia={serie} historico={null} rango="7" />))
      .toContain('No hay viajes iniciados en este periodo.');
  });

  it('"Todo" NO suma los 30 buckets: usa el histórico, que es otra ventana', () => {
    // Sumar los 30 días y llamarlo "todo el histórico" sería rotular un mes
    // como si fuera la vida de la flota. El histórico llega aparte.
    const html = renderToStaticMarkup(
      <AvanceCierre porDia={serieCon(2, 3, 1)} historico={{ viajes: 900, liquidados: 720 }} rango="todo" />,
    );
    expect(html).toContain('720 de 900 viajes');
    expect(html).toContain('80%');
  });

  it('sin histórico legible, "Todo" lo dice — no enseña 0%', () => {
    const html = renderToStaticMarkup(<AvanceCierre porDia={serieVacia()} historico={null} rango="todo" />);
    expect(html).toContain('No se pudo leer el histórico');
    expect(html).not.toMatch(/width:\s*0%/);
  });
});

describe('AvanceCierre — sin viajes en el periodo, no se dibuja una barra vacía', () => {
  it('con actividad, la barra (role="progressbar") SÍ se dibuja', () => {
    const html = renderToStaticMarkup(<AvanceCierre porDia={serieCon(1, 2, 1)} historico={null} />);
    expect(html).toContain('h-2 rounded-full overflow-hidden');
  });

  it('sin ningún viaje, la pista/barra NO se dibuja — antes salía a width:0%', () => {
    const html = renderToStaticMarkup(<AvanceCierre porDia={serieVacia()} historico={null} />);
    expect(html).not.toContain('h-2 rounded-full overflow-hidden');
    expect(html).not.toMatch(/width:\s*0%/);
    expect(html).toContain('No hay viajes iniciados en este periodo.');
  });

  it('con viajes que existen pero caen FUERA de la ventana por defecto (7d), tampoco se dibuja', () => {
    // El default del componente es 'semana' (7d): un viaje de hace 25 días
    // no cae DENTRO del periodo activo, así que `dentro` sigue en 0 aunque la
    // serie no esté vacía — el mismo caso que `estado.test.ts` ya marcó como
    // el más traicionero (actividad real, cero en la ventana).
    const html = renderToStaticMarkup(<AvanceCierre porDia={serieCon(25, 4, 4)} historico={null} />);
    expect(html).not.toMatch(/width:\s*0%/);
    expect(html).toContain('No hay viajes iniciados en este periodo.');
  });
});
