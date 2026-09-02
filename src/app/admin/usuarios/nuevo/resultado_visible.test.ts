// ═══════════════════════════════════════════════════════════════════════════
// ADM-7 (auditoría 24) — EL ALTA DE USUARIOS DE /admin DEJA DE SER A CIEGAS.
//
// El éxito redirigía a `/admin?creado=1`, que /admin no lee; los errores a
// `?error=1`/`?error=2`, que el componente no recibía; y `provisionarUsuario`
// corría SIN `try`, así que un correo ya registrado tiraba la página de error
// de Next y se perdía la captura entera. Dar de alta al equipo de Innovativos
// así es dar de alta sin saber si quedó.
//
// La página es un server component con `requireSuperadmin` y una closure que
// no se puede importar suelta, así que se lee el fuente — mismo patrón que
// `arco/fundamento_legal.test.ts` y `login/no_autoregistro.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROTULOS_ROL } from '@/lib/auth/roles';
import { descifrarErrorProvision } from '@/lib/auth/invitar';
import { DatoInvalido } from '@/lib/likida/errores';

// La ruta la arma `import.meta.url`, no entrada de nadie: es el archivo
// de al lado. La regla no distingue eso de un path de usuario.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('el resultado del alta se ve en la pantalla', () => {
  it('ya no queda ningún redirect que tire la captura (el `?creado=1` que nadie leía se fue)', () => {
    // Se miran las LLAMADAS, no la prosa: el comentario de la página cita los
    // destinos viejos a propósito, para que se entienda por qué se quitaron.
    expect(PAGINA).not.toMatch(/^\s*redirect\(/m);
    expect(PAGINA).not.toContain("from 'next/navigation'");
  });

  it('la forma es `FormaConAviso` (useActionState): los inputs conservan lo escrito al fallar', () => {
    expect(PAGINA).toContain('<FormaConAviso accion={crear}');
    expect(PAGINA).not.toContain('<form action={crear}');
  });

  it('`provisionarUsuario` va dentro de un try que traduce el error a mensaje', () => {
    expect(PAGINA).toMatch(/try \{\s*\n\s*await provisionarUsuario\(/);
    expect(PAGINA).toContain('descifrarErrorProvision(e)');
  });

  it('el rol se valida con LISTA BLANCA (ADM-12: `vendedor` con tenant ya no entra)', () => {
    expect(PAGINA).toContain('if (!ROLES_VALIDOS.has(rol))');
    expect(PAGINA).not.toContain("if (rol === 'superadmin') redirect");
  });
});

describe('los rótulos de rol son los del catálogo único (H18)', () => {
  it('la lista se arma con ROTULOS_ROL, no con textos propios', () => {
    expect(PAGINA).toContain('ROTULOS_ROL.encargado.detalle');
    // Los textos viejos decían cosas falsas: el encargado NO exporta dinero y
    // el contador no es "solo lectura" (captura clientes y tarifas).
    expect(PAGINA).not.toContain('asigna viajes, exporta, sin facturación');
    expect(PAGINA).not.toContain('solo lectura y exportar');
  });

  it('y el catálogo describe al encargado sin acceso al dinero', () => {
    expect(ROTULOS_ROL.encargado.detalle).toContain('No ve un peso');
  });
});

describe('aquí el correo duplicado SÍ se dice con todas sus letras (a diferencia del panel del cliente)', () => {
  it('el error de Auth se traduce a un DatoInvalido que sale verbatim', () => {
    const r = descifrarErrorProvision(new Error('A user with this email address has already been registered'));
    expect(r).toBeInstanceOf(DatoInvalido);
    expect(r?.message).toContain('ya tiene una cuenta registrada');
  });
});
