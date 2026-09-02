import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { escrituraPermitida, esCampoDeContrasena } from './vinculo_senales';
import type { CampoInventariado, InventarioPagina } from './adaptadores/playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDA DE `type="password"` Y SU ÚNICA PUERTA.
//
// El #146 estableció que escribir en un campo de contraseña está prohibido, y
// el 0233 abre EXACTAMENTE una excepción: el re-login autorizado. Estas
// pruebas fijan las dos mitades:
//
//   · la guarda sigue dura por default (un llamador nuevo que no sepa de esto
//     queda del lado seguro sin acordarse de nada);
//   · y la puerta la pasa UN solo archivo del repo. Esa parte es estructural
//     —se lee el código fuente— porque es la clase de regla que se rompe
//     copiando una línea, no razonando.
// ═══════════════════════════════════════════════════════════════════════════

const campo = (p: Partial<CampoInventariado> = {}): CampoInventariado => ({
  tag: 'input', type: 'text', id: '', name: '', placeholder: '', etiqueta: '',
  visible: true, opciones: [], ...p,
});

const INV: InventarioPagina = {
  url: 'https://portal.example.mx/Account/Login',
  titulo: 'Entrar',
  campos: [
    campo({ id: 'Usuario', name: 'Usuario' }),
    // Un portal PUEDE llamarle `txt3` a su campo de contraseña: el `type` es
    // lo único que no miente, y por eso la guarda mira el inventario.
    campo({ type: 'password', id: 'txt3', name: 'txt3' }),
  ],
  botones: [], captcha: [], texto: '',
};

describe('la guarda, por default, sigue dura', () => {
  it('rechaza el campo de contraseña aunque su nombre no lo delate', () => {
    expect(esCampoDeContrasena('#txt3', INV)).toBe(true);
    expect(escrituraPermitida('#txt3', INV)).toBe(false);
  });

  it('rechaza también con el objeto de opciones vacío o en false', () => {
    expect(escrituraPermitida('#txt3', INV, {})).toBe(false);
    expect(escrituraPermitida('#txt3', INV, { permitirCampoPassword: false })).toBe(false);
  });

  it('deja pasar cualquier otro campo, que es lo que el piloto necesita', () => {
    expect(escrituraPermitida('#Usuario', INV)).toBe(true);
  });

  it('la puerta abre SOLO con el `true` explícito', () => {
    expect(escrituraPermitida('#txt3', INV, { permitirCampoPassword: true })).toBe(true);
  });
});

// ── La regla estructural ───────────────────────────────────────────────────
//
// Se mide sobre el CÓDIGO con `grep`, igual que los guardias de `formato.ts`,
// y no con una lista escrita a mano: una lista se desactualiza en silencio, y
// esta es justo la clase de regla que se rompe copiando una línea sin pensar.
// Los `.test.ts` quedan fuera —una prueba PUEDE nombrar la bandera para
// probarla, y prohibírselo obligaría a borrar la prueba que la vigila.

/** Los archivos de `src/` (sin pruebas) que contienen ese patrón. */
function conElPatron(patron: string): string[] {
  return execSync(`grep -rlE ${JSON.stringify(patron)} src/ --include='*.ts' --include='*.tsx' || true`, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('.test.'));
}

describe('la puerta la pasa un solo camino, y es el re-login', () => {
  it('`permitirCampoPassword: true` aparece en `relogin.ts` y en ningún otro sitio', () => {
    // `vinculo_senales.ts` queda fuera porque es donde la guarda se DEFINE y
    // su prosa nombra la bandera para explicarla; lo que se vigila aquí es
    // quién la USA.
    const culpables = conElPatron('permitirCampoPassword: *true')
      .filter((f) => !f.endsWith('vinculo_senales.ts'));
    expect(
      culpables,
      `estos archivos se saltan la guarda de contraseñas:\n${culpables.join('\n')}`,
    ).toEqual(['src/lib/likida/facturacion/relogin.ts']);
  });

  it('el camino de FACTURAR no puede leer una contraseña de portal', () => {
    // La separación que el #146 estableció: `facturar` no vuelve a tener
    // acceso a una contraseña. `contrasenaDePortal` vive en `relogin_portal.ts`
    // justamente para que este grep sea posible y siga siendo verdad.
    const culpables = conElPatron('contrasenaDePortal')
      .filter((f) => !f.endsWith('relogin.ts') && !f.endsWith('relogin_portal.ts'));
    expect(
      culpables,
      `estos archivos abren el cofre de contraseñas fuera del re-login:\n${culpables.join('\n')}`,
    ).toEqual([]);
  });

  it('el piloto de visión no tiene su propia copia de la guarda', () => {
    // Una guarda copiada en dos sitios es una guarda que alguien relaja en uno
    // solo. La del piloto tiene que ser la compartida.
    const piloto = readFileSync('src/lib/likida/facturacion/adaptadores/piloto_vision.ts', 'utf8');
    expect(piloto).toMatch(/escrituraPermitida/);
    expect(piloto).not.toMatch(/c\.type === 'password'/);
  });
});
