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
  urlAvisoIntegral: 'https://app.likida.ai/aviso/11111111-1111-1111-1111-111111111111',
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

describe('M7 · los modelos de lenguaje reciben las fotos Y el texto del chat', () => {
  // processor.ts arma `turns = [...conv.turns, { role: 'user', content: msg.text }]`
  // y runAgent lo manda verbatim a OpenRouter. "Los modelos que leen las fotos"
  // le decía al operador que lo que escribe se queda dentro.
  it('la cláusula del art. 35 nombra las dos clases de dato que salen', () => {
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 35')!;
    const t = s.parrafos.join(' ');
    expect(t).toMatch(/modelos de lenguaje/);
    expect(t).toMatch(/fotos de tus comprobantes/);
    expect(t).toMatch(/texto de tus mensajes/);
    expect(t, 'no acotar el flujo a las fotos').not.toMatch(/modelos de lenguaje que leen las fotos,/);
  });
});

describe('B7 · el código no afirma un ZDR que nadie contrató', () => {
  // `data_collection: 'deny'` es una preferencia de ruteo por llamada. La
  // auditoría 8 lo sacó del aviso; la justificación interna decía lo contrario
  // y es lo que un ingeniero repetiría en una due diligence.
  it('models.ts ya no dice que el gateway "fuerza ZDR"', () => {
    const m = readFileSync('src/lib/llm/models.ts', 'utf8');
    expect(m).not.toMatch(/fuerza ZDR/);
    expect(m).toMatch(/PREFERENCIA DE RUTEO/);
    expect(m).toMatch(/NO es Zero Data Retention/);
  });
});
