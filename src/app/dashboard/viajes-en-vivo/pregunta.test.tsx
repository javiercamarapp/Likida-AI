import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { renderToStaticMarkup } from 'react-dom/server';
import { PreguntaAlAsistente } from './pregunta';
import { PREGUNTAS_OPERACION } from './respuesta';

describe('la caja de preguntas del asistente', () => {
  it('muestra las preguntas sugeridas de OPERACIÓN (ninguna de dinero) y dice que no decide por su cuenta', () => {
    const html = renderToStaticMarkup(<PreguntaAlAsistente tenantParam={null} />);
    expect(html).toContain('Pregúntale al asistente');
    for (const p of PREGUNTAS_OPERACION) expect(html).toContain(p.replace('¿', '¿'));
    expect(PREGUNTAS_OPERACION.join(' ')).not.toMatch(/comprobado|acreditable|diésel|cuadre|IVA|pesos/i);
    expect(html).toContain('deja una tarea para una persona');
    expect(html).toContain('disabled=""'); // «Preguntar» arranca deshabilitado sin texto
  });
});
