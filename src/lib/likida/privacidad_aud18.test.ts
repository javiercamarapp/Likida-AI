import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { avisoIntegral, avisoProspectos, pieAvisoProspectos, RUTA_AVISO_PROSPECTOS, DIAS_RETENCION_PROSPECTO_PERSONA } from './privacidad';

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

describe('C2 · el aviso de prospectos: Likida como responsable', () => {
  const D = { razonSocial: 'Likida SA de CV', domicilio: 'Monterrey, NL', contacto: 'likida.ai@gmail.com' };
  const secciones = avisoProspectos(D);
  const texto = secciones.flatMap((s) => s.parrafos).join('\n');

  it('cubre las seis fracciones del art. 15 (y las I-IV primero: el simplificado del 16 fr. II)', () => {
    const f = secciones.map((s) => s.fundamento);
    expect(f[0]).toMatch(/art\. 15 fr\. I\b/);
    expect(f[1]).toMatch(/fr\. II/);
    expect(f[2]).toMatch(/fr\. III/);
    expect(f[3]).toMatch(/fr\. IV/);
    expect(f.some((x) => /fr\. V\b/.test(x))).toBe(true);
    expect(f.some((x) => /fr\. VI\b/.test(x))).toBe(true);
  });
  it('dice de dónde salieron los datos, incluidos los correos DEDUCIDOS (0138 origen=inferido)', () => {
    expect(texto).toMatch(/fuentes de acceso público/);
    expect(texto).toMatch(/DENUE/);
    expect(texto).toMatch(/se dedujeron/);
  });
  it('promete solo lo que el código ejecuta: nombre sin salir al modelo, purga a 12 meses, ARCO por correo', () => {
    expect(texto).toMatch(/tu nombre no sale de Likida/);
    expect(texto).toMatch(new RegExp(`a los ${Math.round(DIAS_RETENCION_PROSPECTO_PERSONA / 30.4)} meses sin ningún contacto`));
    expect(texto).toContain(D.contacto);
    expect(texto).toMatch(/20 días hábiles/);
  });
  it('cita las fracciones correctas: encargada XII, transferencia XX', () => {
    expect(texto).toMatch(/personas encargadas \(art\. 2 fr\. XII\)/);
    expect(texto).toMatch(/no es una transferencia\*\* \(art\. 2 fr\. XX\)/);
  });
  it('sin razón social ni domicilio, la sección lo DICE en vez de inventarlos', () => {
    const s = avisoProspectos({ ...D, razonSocial: null, domicilio: null })[0];
    expect(s.pendiente).toBe(true);
    expect(s.parrafos[0]).toMatch(/pendiente/);
  });
  it('el pie que va en cada toque apunta a /aviso/prospectos en el dominio de la app', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.likida.ai';
    expect(pieAvisoProspectos()).toBe(`Aviso de privacidad para contactos comerciales: https://app.likida.ai${RUTA_AVISO_PROSPECTOS}`);
  });
  it('/privacidad manda a ese grupo de titulares a su aviso', () => {
    expect(PAGINA).toMatch(/\/aviso\/prospectos/);
  });
});
