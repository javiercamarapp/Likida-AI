import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Fuel } from 'lucide-react';
import { KpiTile, ChartCard, StatCard } from './kit';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, ALTO — `KpiTile` manda "$0.00" en el HTML servido, sea cual
// sea la cifra real.
//
// `useCountUp(valor, !reducido)` (`kit.tsx`): en el servidor
// `usePrefersReducedMotion()` devuelve su `getServerSnapshot()`, que vale
// `false` — no es una medición, es el default de "no sé, asumo que no". Con
// `reducido=false`, `animar=true`, y `useCountUp` devuelve su `useState(0)`
// inicial porque en el servidor no corre NINGÚN `useEffect` que lo mueva.
// Eso es lo que sale en el HTML: "$0.00" sobre una flota que comprobó
// $1,234,567.89 — exactamente el cero que CLAUDE.md prohíbe, uno que se lee
// como medición.
//
// Se prueba con `renderToStaticMarkup`, el mismo mecanismo que produce el
// HTML que un navegador con JS lento, roto o bloqueado se queda viendo.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO = <Fuel width={15} height={15} />;

describe('KpiTile — el HTML servido (antes de hidratar)', () => {
  it('con una cifra real distinta de cero, el texto servido NO es "$0.00"', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="Monto comprobado" valor={1234567.89} formato="mxn" />,
    );
    expect(html).not.toContain('$0.00');
  });

  it('con una cifra real distinta de cero, el texto servido ES la cifra real', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="Monto comprobado" valor={1234567.89} formato="mxn" />,
    );
    expect(html).toContain('$1,234,567.89');
  });

  it('mismo caso con un entero (viajes liquidados), no solo con moneda', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="Viajes liquidados" valor={12} formato="entero" />,
    );
    expect(html).not.toContain('>0<');
    expect(html).toContain('>12<');
  });

  it('un valor que de verdad es cero SÍ se sirve como "$0.00" — no es el mismo bug al revés', () => {
    // El arreglo no puede ser "nunca mostrar 0": una flota que de verdad
    // comprobó $0 tiene que poder decirlo. El bug era mostrar 0 CUANDO LA
    // CIFRA REAL NO ES 0, no la existencia del cero en sí.
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="Monto comprobado" valor={0} formato="mxn" />,
    );
    expect(html).toContain('$0.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, MEDIO — rótulos cortados a la mitad. "IVA acreditable
// documentado" salía visible al 52% en el panel fiscal a 1280px: `truncate`
// (una sola línea + "…") cortaba la palabra que carga el significado
// fiscal ("documentado"). `line-clamp-2` deja envolver a una segunda línea
// antes de recortar, así que a los anchos reales del producto (~1100px de
// contenido tras descontar sidebar + rail) el rótulo entero cabe.
// ═══════════════════════════════════════════════════════════════════════════
describe('KpiTile y ChartCard — el rótulo ya no se corta a la mitad', () => {
  it('KpiTile: ninguna clase del tile es `truncate` (una sola línea + elipsis)', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="IVA acreditable documentado" valor={12480} formato="mxn" />,
    );
    expect(html).not.toContain('truncate');
    expect(html).toContain('line-clamp-2');
  });

  it('KpiTile: el rótulo completo sigue en el DOM, sin recortar el texto', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="IVA acreditable documentado" valor={12480} formato="mxn" />,
    );
    expect(html).toContain('IVA acreditable documentado');
  });

  it('ChartCard: el título tampoco usa `truncate` — "El gasto del periodo, por su suerte fiscal" se cortaba al 98%', () => {
    const html = renderToStaticMarkup(
      <ChartCard titulo="El gasto del periodo, por su suerte fiscal">
        <div />
      </ChartCard>,
    );
    expect(html).not.toContain('truncate');
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('El gasto del periodo, por su suerte fiscal');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 1, CRÍTICO (Frontend) — `StatCard` colapsaba `null` a `0` y pintaba
// "$0.00" + "0% · sin movimiento" en la primera tarjeta del Resumen cuando NO
// había viajes que medir (costo por viaje = división indefinida). El backend
// devuelve `null` a propósito; la UI lo tapaba con un cero con cara de medición.
// ═══════════════════════════════════════════════════════════════════════════
describe('KpiTile — no medible (valor null) pinta guion, no 0/0%', () => {
  it('con valor null muestra "—" y el mensaje de `vacio`, sin "0%"', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={ICONO} etiqueta="Sin CFDI" valor={null} formato="porcentaje"
        vacio="Sin comprobantes de estos conceptos todavía" />,
    );
    expect(html).toContain('—');
    expect(html).toContain('Sin comprobantes de estos conceptos');
    expect(html).not.toContain('0%');
  });
});

describe('StatCard — no medible (valor null) NO es "$0.00"', () => {
  it('con valor null pinta un guion y DICE por qué, sin cifra ni "sin movimiento"', () => {
    const html = renderToStaticMarkup(
      <StatCard icono={ICONO} etiqueta="Costo por viaje" valor={null} formato="mxn"
        sinDato="sin viajes en el periodo" />,
    );
    expect(html).toContain('—');
    expect(html).toContain('sin viajes en el periodo');
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('sin movimiento');
  });

  it('con un 0 REAL (medido) sigue mostrando la cifra, no el guion', () => {
    const html = renderToStaticMarkup(
      <StatCard icono={ICONO} etiqueta="Liquidado" valor={0} formato="mxn" />,
    );
    // Un 0 medido es "$0.00", no "sin dato": la distinción que el arreglo protege.
    expect(html).toContain('$0.00');
    expect(html).not.toContain('sin viajes en el periodo');
  });
});
