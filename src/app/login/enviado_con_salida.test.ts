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
    expect(PAGINA).toMatch(/\{\s*enviado\s*&&\s*\(/);
    expect(PAGINA).not.toMatch(/\{\s*enviado\s*\?\s*\(/);
  });

  it('los dos formularios siguen fuera de cualquier rama de `enviado`', () => {
    // Regex tolerante a formato (sangría, saltos de línea, `<>` vs `<React.Fragment>`): lo que importa es el CONTENIDO de la rama.
    const rama = PAGINA.match(/\{\s*enviado\s*&&\s*\(([\s\S]*?)<\/>\s*\)\s*\}/);
    expect(rama, 'no encontré la rama `{enviado && (...)}`').not.toBeNull();
    // Ninguna rama de `enviado` contiene un formulario ni sustituye a las acciones: ambas siguen montadas.
    expect(rama![1]).not.toMatch(/<form[\s>]/);
    expect(PAGINA).toMatch(/action=\{\s*entrarConGoogle\s*\}/);
    expect(PAGINA).toMatch(/action=\{\s*entrarConEmail\s*\}/);
    // Y los dos `<form` están antes o después de la rama, nunca dentro de ella.
    const ini = PAGINA.indexOf(rama![0]);
    for (const m of PAGINA.matchAll(/<form[\s>]/g)) {
      expect(m.index! < ini || m.index! > ini + rama![0].length).toBe(true);
    }
  });

  it('el aviso dice cómo reintentar con otro correo', () => {
    expect(PAGINA.replace(/\s+/g, ' ')).toContain('te equivocaste de correo? Vuelve a escribirlo arriba');
  });
});
