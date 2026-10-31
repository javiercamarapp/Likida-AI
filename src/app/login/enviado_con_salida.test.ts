import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// AUDITORÍA 18, BAJO (B8) — `/login?enviado=1` era un estado terminal: el
// ternario reemplazaba TODO el bloque de acciones por la tarjeta de
// confirmación. Con un dedazo en el correo, no había forma de volver a
// intentar sin el botón Atrás. Se lee el fuente (patrón de
// `no_autoregistro.test.ts`): la vista es un server component con fuentes
// y cabeceras de Next y no se monta suelta.
const PAGINA = readFileSync(fileURLToPath(new URL('./vista-login.tsx', import.meta.url)), 'utf8');

describe('/login?enviado=1 conserva el formulario (B8)', () => {
  it('el aviso de enviado es condicional (&&), no un ternario que sustituye las acciones', () => {
    expect(PAGINA).toMatch(/\{enviado && \(/);
    expect(PAGINA).not.toMatch(/\{enviado \? \(/);
  });

  it('los dos formularios siguen fuera de cualquier rama de `enviado`', () => {
    const aviso = PAGINA.indexOf('{enviado && (');
    const cierreAviso = PAGINA.indexOf('</>\n                )}', aviso);
    expect(aviso).toBeGreaterThan(-1);
    expect(cierreAviso).toBeGreaterThan(aviso);
    // Ninguna rama de `enviado` contiene un formulario ni sustituye a las acciones: ambas siguen montadas.
    expect(PAGINA.slice(aviso, cierreAviso)).not.toContain('<form');
    expect(PAGINA).toContain('action={entrarConGoogle}');
    expect(PAGINA).toContain('action={entrarConEmail}');
  });

  it('el aviso dice cómo reintentar con otro correo', () => {
    expect(PAGINA).toContain('te equivocaste de correo? Vuelve a escribirlo arriba');
  });
});
