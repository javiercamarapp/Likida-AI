import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// REVISIÓN FINAL de la rama de auth — dos propiedades de /login que un cambio
// de una línea puede deshacer sin que ninguna otra prueba se entere.
//
//  · `shouldCreateUser: false`. El default de Supabase es `true`: sin esa
//    opción, CUALQUIER correo tecleado en la caja crea un `auth.users` real,
//    justo lo contrario de la decisión 1 del spec (nadie se da de alta solo;
//    las cuentas las crea `provisionarFlotaAdmin`). Es una omisión invisible:
//    la pantalla se comporta igual.
//  · El límite por IP. El passcode que este login reemplaza lo tenía
//    (`acceso/page.tsx`); aquí el costo de no tenerlo es mayor, porque cada
//    intento gasta cuota del SMTP de Supabase — la única vía de entrada
//    mientras Google OAuth no esté configurado.
//
// Se lee el fuente, como en `dashboard/foto_no_expuesta.test.ts`: los server
// actions viven dentro del componente y no se pueden importar sueltos.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('/login no se autoregistra ni se queda sin límite', () => {
  it('pide shouldCreateUser: false al mandar el magic link', () => {
    expect(PAGINA).toMatch(/shouldCreateUser:\s*false/);
  });

  it('limita por IP antes de llamar a Supabase', () => {
    expect(PAGINA).toMatch(/rateLimit\(/);
    expect(PAGINA).toMatch(/dentroDelLimite\('login:email'\)/);
  });

  it('el correo sin cuenta no se distingue del enviado: ambos caen en enviado=1', () => {
    // Si esto se rompe, /login vuelve a ser un oráculo para enumerar qué
    // correos son contralores reales.
    expect(PAGINA).toMatch(/esCorreoSinCuenta/);
    expect(PAGINA).toMatch(/otp_disabled/);
  });
});
