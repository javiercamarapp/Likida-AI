import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaReasignar } from './reasignar-forma';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · FE-11 — reasignar chofer deja de tumbar la pantalla.
//
// El `<form action={accion}>` viejo no tenía `pending` (doble clic = dos
// reasignaciones) ni región de aviso: el rechazo de la action —chofer dado de
// baja, red caída— subía a `error.tsx` y se comía el detalle entero. Aquí se
// fija lo que la pantalla TIENE que traer; el rechazo en forma de valor lo
// garantiza la firma `(previo, fd) => ResultadoAccion` del server action.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const pintar = () => renderToStaticMarkup(
  <FormaReasignar accion={async () => null} buscar={async () => []}
    actual="op-1" actualNombre="Juan Pérez" total={7500} />,
);

describe('FormaReasignar', () => {
  it('trae el combo con el chofer actual ya puesto y su botón', () => {
    const html = pintar();
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('Reasignar chofer');
    expect(html).toContain('name="operadorId"');
  });

  it('tiene la región de aviso SIEMPRE presente — un `aria-live` que nace con su texto no se anuncia', () => {
    expect(pintar()).toContain('aria-live="polite"');
  });
});
