import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, MEDIO (línea 243): el anexo de subencargados —el documento al
// que `/privacidad` remite por escrito (`src/app/privacidad/page.tsx:131`)—
// no tenía a Stripe ni a Cal.com, y Cal.com guarda el nombre, el correo y las
// respuestas del prospecto 365 días sin que ningún aviso lo dijera. Un
// documento no se puede "probar" en el sentido normal, pero sí se puede
// probar que no se quedó atrás del código — mismo criterio que
// `src/lib/observability/runbook.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const DOC = readFileSync(
  join(process.cwd(), 'docs/conocimiento/52-anexo-subencargados.md'),
  'utf8',
);

describe('LEG-6 aud25 · el anexo de subencargados nombra a Stripe y a Cal.com', () => {
  it('lista a Stripe en la cadena', () => {
    expect(DOC).toMatch(/\bStripe\b/);
  });

  it('lista a Cal.com en la cadena', () => {
    expect(DOC).toMatch(/Cal\.com/);
  });

  it('dice el plazo de 365 días de retención del payload de Cal.com', () => {
    expect(DOC).toMatch(/Cal\.com[\s\S]{0,600}365 días/);
  });
});
