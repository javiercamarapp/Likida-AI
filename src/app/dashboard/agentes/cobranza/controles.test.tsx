import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BotonEjecutar, BotonPausa } from './controles';

// `BotonEjecutar` llama `useRouter()` (refresh tras una corrida) y el render
// estático de prueba no monta el App Router: el doble devuelve lo mínimo que
// ese efecto toca. Mismo patrón que `proveedores/vista.test.tsx`.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const accionEjecutar = async () => null;
const accionSimple = async () => null;

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 1 (auditoría, A7 Cobranza): estos controles no tenían ninguna
// prueba. El repo no instala @testing-library/react ni corre vitest con un
// entorno DOM (vitest.config.ts es `environment` por defecto = node), así
// que "interacción" aquí —como en el resto del repo— se prueba sobre el
// RENDER REAL en cada combinación de props que un clic produciría del lado
// del servidor: deshabilitado/habilitado, pausado/activo, con y sin error,
// con y sin resultado de una corrida ya hecha. No se simulan eventos del DOM
// porque no hay entorno que los corra; se fija el contrato de qué pinta cada
// estado, igual que `proveedores/vista.test.tsx` fija el de `SeccionBuzon`.
// ═══════════════════════════════════════════════════════════════════════════

describe('BotonEjecutar — el gateo antes de confirmar', () => {
  it('agente pausado: el botón sale deshabilitado con su título explicando por qué', () => {
    const html = renderToStaticMarkup(<BotonEjecutar ejecutarAhora={accionEjecutar} enCola={5} activo={false} />);
    expect(html).toContain('Ejecutar ahora');
    expect(html).toContain('title="El agente está pausado"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
  });

  it('cola vacía: deshabilitado con el título "No hay a quién contactar"', () => {
    const html = renderToStaticMarkup(<BotonEjecutar ejecutarAhora={accionEjecutar} enCola={0} activo={true} />);
    expect(html).toContain('title="No hay a quién contactar"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
  });

  it('activo y con cola: habilitado, con el título que explica qué hace', () => {
    const html = renderToStaticMarkup(<BotonEjecutar ejecutarAhora={accionEjecutar} enCola={3} activo={true} />);
    expect(html).toContain('title="Correr la cobranza ahora, sin esperar la ventana"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>/);
  });

  it('el estado inicial de useActionState es null: no pinta error ni resultado de una corrida que no pasó', () => {
    const html = renderToStaticMarkup(<BotonEjecutar ejecutarAhora={accionEjecutar} enCola={3} activo={true} />);
    expect(html).not.toContain('fallos');
    expect(html).not.toContain('Contactó a');
    expect(html).not.toContain('El reloj cortó la corrida');
  });

  it('singular/plural: "1 chofer" (texto del paso de confirmación) no se pinta sin confirmar, pero la cuenta vive en el título', () => {
    // El paso de confirmación solo aparece tras el clic (estado local,
    // irreproducible sin un entorno DOM); se fija aquí que el render inicial
    // nunca lo muestra por accidente.
    const html = renderToStaticMarkup(<BotonEjecutar ejecutarAhora={accionEjecutar} enCola={1} activo={true} />);
    expect(html).not.toContain('¿Mandar WhatsApp a');
    expect(html).not.toContain('Sí, mandar');
  });
});

describe('BotonPausa — pausar y reanudar', () => {
  it('activo: el botón ofrece "Pausar agente"', () => {
    const html = renderToStaticMarkup(<BotonPausa alternarPausa={accionSimple} activo={true} />);
    expect(html).toContain('Pausar agente');
    expect(html).not.toContain('Reanudar agente');
    expect(html).toContain('title="El agente deja de contactar hasta que lo reanudes"');
  });

  it('pausado: el botón ofrece "Reanudar agente"', () => {
    const html = renderToStaticMarkup(<BotonPausa alternarPausa={accionSimple} activo={false} />);
    expect(html).toContain('Reanudar agente');
    expect(html).not.toContain('Pausar agente');
    expect(html).toContain('title="El agente vuelve a contactar en su ventana"');
  });

  it('sin error en el estado inicial: no pinta ningún mensaje de error', () => {
    const html = renderToStaticMarkup(<BotonPausa alternarPausa={accionSimple} activo={true} />);
    expect(html).not.toContain('style="color:var(--bad)"');
  });
});

describe('A37-S12-04 · BotonPausa manda el estado deseado', () => {
  it('activo → el form pide «pausado»; pausado → pide «activo»', () => {
    expect(renderToStaticMarkup(<BotonPausa alternarPausa={accionSimple} activo={true} />)).toMatch(/name="deseado"[^>]*value="pausado"|value="pausado"[^>]*name="deseado"/);
    expect(renderToStaticMarkup(<BotonPausa alternarPausa={accionSimple} activo={false} />)).toMatch(/name="deseado"[^>]*value="activo"|value="activo"[^>]*name="deseado"/);
  });
});
