import { describe, it, expect } from 'vitest';
import { avisoProspectos, type DatosAvisoProspectos } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, ALTO (línea 27): el investigador (`agentes/investigador.ts`)
// manda al modelo de lenguaje el texto de las páginas del sitio del prospecto
// y le pide extraer nombre, correo y teléfono de personas — pero el aviso de
// prospectos no nombraba al modelo entre sus encargadas, y afirmaba de más
// ("tu nombre no sale de Likida") sobre un flujo que sí lo saca.
// ═══════════════════════════════════════════════════════════════════════════

const DATOS: DatosAvisoProspectos = {
  razonSocial: 'LIKIDA TECNOLOGÍA SA DE CV',
  domicilio: 'CDMX',
  contacto: 'privacidad@likida.ai',
};

describe('LEG-1 aud25 · el aviso de prospectos nombra al modelo de lenguaje entre sus encargadas', () => {
  it('la sección "Con quién se comparten" incluye a los modelos de lenguaje', () => {
    const seccion = avisoProspectos(DATOS).find((s) => s.titulo === 'Con quién se comparten');
    expect(seccion).toBeDefined();
    const t = seccion!.parrafos.join(' ');
    expect(t).toMatch(/modelo(s)? de lenguaje/i);
  });

  it('advierte que la investigación previa no va seudonimizada', () => {
    const t = avisoProspectos(DATOS).flatMap((s) => s.parrafos).join(' ');
    expect(t).toMatch(/investigación previa no va seudonimizada|no va seudonimizada/i);
  });
});
