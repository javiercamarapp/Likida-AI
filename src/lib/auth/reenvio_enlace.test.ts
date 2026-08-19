import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// Las propiedades del reenvío automático que un cambio de una línea puede
// deshacer sin que nada más se entere — el mismo criterio (y el mismo método:
// leer el fuente) que `login/no_autoregistro.test.ts`, porque este módulo
// manda correo real y toca los mismos tres candados de /login:
//
//  · `shouldCreateUser: false` — el reenvío tampoco da de alta a nadie.
//  · El límite por IP con la MISMA llave del formulario (`login:email`):
//    una llave propia duplicaría el techo de correo que la auditoría del
//    15-ago vino a cerrar.
//  · La cookie de espera con TTL de 300 s, puesta ANTES de conocer el
//    resultado del envío: sin eso, cada visita a un enlace muerto dispara un
//    correo (spam contra la propia bandeja) o un fallo reintenta sin freno.
// ═══════════════════════════════════════════════════════════════════════════

const FUENTE = readFileSync(fileURLToPath(new URL('./reenvio_enlace.ts', import.meta.url)), 'utf8');

describe('el reenvío automático conserva los candados de /login', () => {
  it('no da de alta a nadie: shouldCreateUser false', () => {
    expect(FUENTE).toMatch(/shouldCreateUser:\s*false/);
  });

  it('gasta del MISMO límite por IP que el formulario (llave login:email, 10 / 5 min)', () => {
    expect(FUENTE).toMatch(/rateLimit\(`login:email:\$\{ip\}`,\s*10,\s*5\s*\*\s*60_000\)/);
  });

  it('máximo un reenvío cada 5 minutos, y la cookie va antes del envío', () => {
    expect(FUENTE).toMatch(/ESPERA_SEGUNDOS = 5 \* 60/);
    // El orden importa: el candado se pone aunque el envío falle. Si el set
    // de la cookie de espera apareciera DESPUÉS del signInWithOtp, un fallo
    // repetido reintentaría en cada visita al enlace muerto.
    const pone = FUENTE.indexOf('COOKIE_ESPERA, \'1\'');
    const manda = FUENTE.indexOf('signInWithOtp');
    expect(pone).toBeGreaterThan(-1);
    expect(manda).toBeGreaterThan(-1);
    expect(pone).toBeLessThan(manda);
  });

  it('las cookies son httpOnly: las lee el servidor, nunca un script', () => {
    expect(FUENTE).toMatch(/httpOnly:\s*true/);
  });

  it('sin cookie de correo no se reenvía nada — jamás se adivina el destinatario', () => {
    expect(FUENTE).toMatch(/if \(!email\) return 'no'/);
  });
});
