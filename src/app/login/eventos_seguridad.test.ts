import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// CT-SEG-11: un login que no termina en sesión deja fila en evento_seguridad. Los server actions de /login no se exportan, así que
// (mismo patrón que limite_por_cuenta.test.ts) se lee la fuente: cada salida de error de la página registra su motivo.
const leer = (rel: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- prueba de arquitectura: lee fuentes del propio repo
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGINA = leer('./page.tsx');
const CALLBACK = leer('../auth/callback/route.ts');

describe('/login registra el login fallido', () => {
  it('importa el registro de acceso', () => {
    expect(PAGINA).toMatch(/from '@\/lib\/seguridad\/registro_acceso'/);
  });
  it.each(['limite_ip', 'limite_cuenta', 'oauth_error', 'correo_invalido'])('registra el motivo «%s»', (motivo) => {
    expect(PAGINA).toContain(`registrarLoginFallido({ motivo: '${motivo}'`);
  });
  it('el límite por cuenta registra la cuenta (huella) y el de IP no', () => {
    expect(PAGINA).toMatch(/motivo: 'limite_cuenta', email/);
    expect(PAGINA).not.toMatch(/motivo: 'limite_ip', email/);
  });
  it('NUNCA pasa el correo al detalle: solo como `email`, que el registro convierte en huella', () => {
    expect(PAGINA).not.toMatch(/detalle:\s*\{[^}]*email/);
  });
});

describe('/auth/callback registra el enlace que no abrió sesión', () => {
  it('registra el motivo cuando hubo code o error_code y no se obtuvo sesión', () => {
    expect(CALLBACK).toMatch(/from '@\/lib\/seguridad\/registro_acceso'/);
    expect(CALLBACK).toMatch(/registrarLoginFallido\(\{ motivo: `callback_\$\{motivo\}`/);
  });
});
