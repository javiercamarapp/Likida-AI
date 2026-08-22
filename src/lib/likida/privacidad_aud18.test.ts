import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { avisoIntegral } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · cumplimiento legal (grupo E): lo que el aviso DICE tiene que
// ser lo que el código HACE, y el artículo citado tiene que ser el correcto.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA = {
  razonSocial: 'Transportes Prueba SA de CV',
  domicilio: 'Av. Siempre Viva 1, Escobedo, NL',
  urlAvisoIntegral: null,
  contactoPrivacidad: null,
};

const todo = () => avisoIntegral(FLOTA).flatMap((s) => s.parrafos).join('\n');
const PAGINA = readFileSync('src/app/privacidad/page.tsx', 'utf8');

describe('B6 · "persona encargada" se cita con su fracción, la XII', () => {
  // La fr. XX es la definición de TRANSFERENCIA (normas/lfpdppp-2-XII-XX.yaml).
  // Citarla para definir quién es la encargada, en el renglón que dice quién
  // responde por los datos, es un fundamento mal citado en el documento del
  // art. 15 — el que se presenta ante la autoridad.
  it('en el aviso integral de la flota', () => {
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 15 fr. I')!;
    const t = s.parrafos.join(' ');
    expect(t).toMatch(/persona encargada\*\* \(art\. 2 fr\. XII\)/);
    expect(t).not.toMatch(/encargada\*\* \(art\. 2 fr\. XX\)/);
  });
  it('y en la política de Likida', () => {
    expect(PAGINA).toMatch(/como persona encargada \(art\. 2 fr\. XII\)/);
    expect(PAGINA).not.toMatch(/como persona encargada \(art\. 2 fr\. XX\)/);
  });
  it('la fr. XX sigue citada donde sí toca: la exclusión de la encargada de "transferencia"', () => {
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 35')!;
    expect(s.parrafos.join(' ')).toMatch(/no es una transferencia\*\* \(art\. 2 fr\. XX\)/);
  });
});
