// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · FIS-8 (MEDIO) + FE-23 (MEDIO) + FE-24 (MEDIO) — la pantalla
// que emite un CFDI ante el SAT.
//
// Se prueba LEYENDO LA FUENTE, el mismo patrón que `dashboard/estado.test.ts`
// usa para los contratos de una página server-only: `SeccionTimbrado` es un
// componente `async` con dos server actions y `revalidatePath`, y montarlo
// pediría el árbol de Next entero. Lo que estos tres hallazgos afirman es
// estructural —qué valor trae el selector, con qué función se formatea la
// cifra, y si la llamada al PAC está envuelta—, y eso sí se lee del archivo.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line security/detect-non-literal-fs-filename -- lee el archivo HERMANO de esta prueba, resuelto de `import.meta.url` en tiempo de prueba; la ruta no viene de ninguna entrada de usuario.
const FUENTE = readFileSync(fileURLToPath(new URL('./timbrar.tsx', import.meta.url)), 'utf8');

describe('FIS-8: el método de pago por defecto es PUE, y PPD dice lo que arrastra', () => {
  it('el selector arranca en PUE, no en PPD', () => {
    // Likida timbra el CFDI de ingreso, cobra el flete y NO emite el
    // complemento de pago que un PPD obliga (`pac/sw.ts` lo declara). Ofrecer
    // PPD por defecto dejaba a la flota con una obligación abierta que su
    // propio sistema de facturación no le decía.
    const selector = FUENTE.match(/<Selector nombre="metodoPago"[\s\S]*?\/>/)?.[0] ?? '';
    expect(selector).not.toBe('');
    expect(selector).toContain('valorInicial="PUE"');
    expect(selector).not.toContain('valorInicial="PPD"');
  });

  it('la pantalla dice que un PPD obliga a un complemento de pago que Likida no emite', () => {
    // El hueco estaba declarado en el PAC y NO en la pantalla, que es donde
    // alguien elige. Un rótulo tiene que ser verdad.
    expect(FUENTE).toMatch(/complemento de pago/i);
    expect(FUENTE).toMatch(/todav[íi]a no lo emite/i);
  });

  it('PPD sigue disponible: no se le quita una opción legítima a quien la necesita', () => {
    expect(FUENTE).toContain("valor: 'PPD'");
  });
});

describe('FE-23: los importes del CFDI se formatean con `mxn`, como el resto del panel', () => {
  it('ninguna cifra del ensayo sale por `String(...)`', () => {
    // «Flete 12345.5 + IVA 16% 1975.28 = Total 14320.78 MXN» es la cifra que
    // el contador confirma antes de emitir un comprobante irreversible, y se
    // leía distinta a como el mismo flete se enseña en las otras pantallas.
    expect(FUENTE).not.toMatch(/String\(ensayo\./);
    for (const campo of ['subTotal', 'iva', 'total', 'retencionIva']) {
      expect(FUENTE, `ensayo.${campo} sin mxn()`).toContain(`mxn(ensayo.${campo})`);
    }
  });

  it('el formato viene de lib/formato, nunca de un `toLocaleString` propio', () => {
    expect(FUENTE).toMatch(/from '@\/lib\/formato'/);
    expect(FUENTE).not.toMatch(/toLocaleString/);
  });
});

describe('FE-24: un fallo de red con el PAC no tira la página ni se traga el timbre', () => {
  it('`timbrarViaje` corre dentro de un try, con catch y finally', () => {
    const accion = FUENTE.match(/async function timbrar\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(accion).not.toBe('');
    const iTry = accion.indexOf('try {');
    const iLlamada = accion.indexOf('await timbrarViaje(');
    const iCatch = accion.indexOf('} catch');
    expect(iTry).toBeGreaterThan(-1);
    expect(iLlamada).toBeGreaterThan(iTry);
    expect(iCatch).toBeGreaterThan(iLlamada);
    expect(accion).toContain('mensajeParaPantalla(e, \'timbrar\')');
  });

  it('se revalida SIEMPRE, también cuando lanzó: el timbre pudo haber salido', () => {
    const accion = FUENTE.match(/async function timbrar\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(accion).toMatch(/\} finally \{\s*revalidatePath\(rutaActual\);/);
    // Y una sola vez: revalidar dentro del `try` además del `finally` haría
    // que el camino feliz recargara dos veces.
    expect(accion.match(/revalidatePath\(/g) ?? []).toHaveLength(1);
  });

  it('el mensaje no afirma que el CFDI no se emitió — nadie lo sabe todavía', () => {
    const accion = FUENTE.match(/async function timbrar\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(accion).toMatch(/No des el timbre por fallido/);
    expect(accion).toMatch(/panel de tu PAC/);
  });
});

// AUDITORÍA OLA 1, #26: la reserva ambigua tiene SALIDA en pantalla (con candado) y la
// ruta declara maxDuration (el PAC puede tardar 20 s de auth + 20 s de timbrado).
describe('#26: la reserva ambigua del PAC y la duración de la ruta', () => {
  it('la sección de reserva ofrece liberar el bloqueo SOLO con la declaración de haber verificado en el PAC', () => {
    expect(FUENTE).toContain('liberarReservaTimbre');
    expect(FUENTE).toMatch(/name="verificadoEnPac"/);
    expect(FUENTE).toMatch(/Verifiqué en el panel de mi PAC que NO existe un CFDI/);
    // el verbo: dueño o contador, no el jefe de tráfico
    const accion = FUENTE.slice(FUENTE.indexOf('async function liberarReserva'));
    expect(accion).toContain('puedeTimbrar(s.rol)');
  });
  it('y solo se muestra cuando la reserva no tiene folio fiscal', () => {
    expect(FUENTE).toMatch(/ctx\.reservaPendiente\.uuidFiscal === null && puedeEmitir/);
  });
  it('la página declara `export const maxDuration = 60;` (literal, que es lo que Next lee en build)', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- archivo HERMANO resuelto de `import.meta.url`; sin entrada de usuario.
    const pagina = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
    expect(pagina).toMatch(/^export const maxDuration = 60;$/m);
  });
});
