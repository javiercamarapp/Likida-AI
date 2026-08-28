import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COMERCIOS } from './comercios';
import { cuentasCompartidas, credencialDePortal } from './cuentas';

// ── Mocks SOLO para el lector del cofre (`cuentas.ts`). Las pruebas del conteo
// de abajo no tocan base ni cofre.
const respuesta = vi.fn();
const cofreOk = vi.fn(() => true);
const descifrarMock = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const q = {
      select: () => q, eq: () => q,
      like: async () => respuesta(),
      maybeSingle: async () => respuesta(),
    };
    return { from: () => q };
  },
}));
vi.mock('../conectores/cofre', () => ({
  cofreConfigurado: () => cofreOk(),
  descifrar: (s: string) => descifrarMock(s),
}));

// ═══════════════════════════════════════════════════════════════════════════
// CUÁNTOS PORTALES EXIGEN CUENTA — el dato que decide la arquitectura.
//
// El encabezado de `comercios.ts` afirmaba "42 de 60 exigen crear cuenta", y
// estaba INVERTIDO: 42/60 es 70%, que es la proporción de los que NO la exigen.
// Javier lo cazó por conocimiento de campo el 4-ago-2026 y el propio registro le
// dio la razón — nadie lo había contado contra los datos.
//
// No es trivia: si el 70% exigiera cuenta, automatizar la autofacturación sería
// administrar contraseñas en 42 portales por flota, y la ruta correcta sería
// mandarle los datos a una persona. Como es al revés, la mayoría se factura con
// lo que ya se leyó del ticket.
//
// Esta prueba existe para que la cifra del comentario no vuelva a divergir de la
// tabla que tiene debajo.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR DEL COFRE (`cuentas.ts`): qué portales tienen cuenta compartida.
//
// Las dos reglas que estas pruebas fijan:
//   1. FALLA CERRADO HACIA EL ENCARGADO. Base caída o cofre sin configurar =
//      "no hay cuentas", que es el mundo de antes; nunca un ticket esperando a
//      un robot que no va a poder entrar.
//   2. El secreto no sale de aquí: si el descifrado falla, se devuelve null y
//      el error dice el hecho, no el contenido.
// ═══════════════════════════════════════════════════════════════════════════
describe('cuentasCompartidas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cofreOk.mockReturnValue(true);
  });

  it('traduce los conector_id del cofre a claves de comercio', async () => {
    respuesta.mockResolvedValue({
      data: [
        { conector_id: 'portal_facturacion:oxxo_gas' },
        { conector_id: 'portal_facturacion:la_gas' },
      ],
      error: null,
    });
    const s = await cuentasCompartidas('t1');
    expect([...s].sort()).toEqual(['la_gas', 'oxxo_gas']);
  });

  it('base caída → conjunto vacío, no un throw: el ticket va con la persona', async () => {
    respuesta.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await cuentasCompartidas('t1')).size).toBe(0);
  });

  it('sin LIKIDA_COFRE_LLAVE ni siquiera se consulta: no habría cómo descifrar', async () => {
    cofreOk.mockReturnValue(false);
    expect((await cuentasCompartidas('t1')).size).toBe(0);
    expect(respuesta).not.toHaveBeenCalled();
  });
});

describe('credencialDePortal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cofreOk.mockReturnValue(true);
  });

  it('descifra y entrega los valores al robot', async () => {
    respuesta.mockResolvedValue({ data: { valores_cifrados: 'v1.xxx' }, error: null });
    descifrarMock.mockReturnValue({ usuario: 'flota@correo.mx', contrasena: 's3creta' });
    const v = await credencialDePortal('t1', 'la_gas');
    expect(v?.usuario).toBe('flota@correo.mx');
  });

  it('cofre rotado o fila corrupta → null, y el secreto no viaja en el error', async () => {
    respuesta.mockResolvedValue({ data: { valores_cifrados: 'v1.corrupta' }, error: null });
    descifrarMock.mockImplementation(() => { throw new Error('no descifra'); });
    expect(await credencialDePortal('t1', 'la_gas')).toBeNull();
  });

  it('sin credencial activa → null: el llamador manda el ticket con la persona', async () => {
    respuesta.mockResolvedValue({ data: null, error: null });
    expect(await credencialDePortal('t1', 'oxxo_gas')).toBeNull();
  });
});

describe('cuántos comercios exigen cuenta', () => {
  const conCuenta = COMERCIOS.filter((c) => c.requiereCuenta);

  it('la MAYORÍA se factura sin crear cuenta', () => {
    expect(conCuenta.length / COMERCIOS.length).toBeLessThan(0.5);
  });

  // ── ESTA AFIRMACIÓN DEJÓ DE SER CIERTA, Y EL RECON ES POR QUÉ ─────────────
  //
  // Hasta el 28-ago-2026 esta prueba exigía que **la mitad o más** de los
  // comercios con cuenta fueran de peaje, y pasaba. El reconocimiento de campo
  // visitó los portales y movió cuatro fichas en las DOS direcciones:
  //
  //   SALIERON del grupo "exige cuenta" — los dos son de PEAJE:
  //     · `red_estatal_autopistas` — su portal ofrece «Factura Express … sin
  //       necesidad de registro». El flag estaba INVERTIDO.
  //     · `supercarreteras` — su portal nuevo no pide login ni captcha.
  //   ENTRARON al grupo — las dos son GASOLINERAS:
  //     · `shell` — la ruta "sin usuario" devuelve pantalla de error.
  //     · `bp`    — esa misma ruta devuelve 404, y además hay captcha.
  //
  // O sea que la generalización «los que exigen cuenta son sobre todo de peaje»
  // era un artefacto de fichas sin verificar. Se sustituye por lo que sigue
  // siendo cierto y sí está medido: **la mayoría se factura sin cuenta** (la
  // prueba de arriba, que es la que decide la arquitectura) y **el peaje sigue
  // sobrerrepresentado** respecto de su peso en el catálogo, aunque ya no sea
  // mayoría absoluta.
  //
  // Se prefiere bajar el listón con la razón escrita antes que borrar la prueba:
  // el día que alguien vuelva a "arreglar" un flag sin visitar el portal, esta
  // proporción se mueve y hay que pasar por aquí a explicarlo.
  it('el peaje sigue sobrerrepresentado entre los que exigen cuenta', () => {
    const esPeaje = (c: { nombre: string; clave: string }) =>
      /peaje|autopista|iave|pase|telev|pinfra|carretera|caseta/i.test(`${c.nombre} ${c.clave}`);

    const peajeConCuenta = conCuenta.filter(esPeaje).length;
    const peajeEnTodo = COMERCIOS.filter(esPeaje).length;

    // La proporción de peaje entre los que piden cuenta tiene que ser MAYOR que
    // su proporción en el catálogo entero. Eso es lo que "sobrerrepresentado"
    // significa, y se mide en vez de afirmarse.
    expect(peajeConCuenta / conCuenta.length).toBeGreaterThan(peajeEnTodo / COMERCIOS.length);
  });

  it('los dos portales de peaje que el recon liberó ya no piden cuenta', () => {
    // La regresión concreta: los dos tenían `requiereCuenta: true` y su portal
    // real no la pide. Cada uno vale un comercio entero movido de la columna
    // "asistido" a la de "automatizable".
    for (const clave of ['red_estatal_autopistas', 'supercarreteras']) {
      const c = COMERCIOS.find((x) => x.clave === clave);
      expect(c, clave).toBeDefined();
      expect(c!.requiereCuenta, `${clave}: su portal factura sin registro`).toBe(false);
    }
  });

  it('Shell y BP sí la piden, aunque su plataforma hermana no', () => {
    // El contrapeso, y la razón por la que no se puede inferir de la plataforma:
    // los tres corren ControlGAS® con los mismos `id`, pero solo FacturaGAS
    // expone el camino "sin usuario". En Shell devuelve error y en BP, 404.
    for (const clave of ['shell', 'bp']) {
      const c = COMERCIOS.find((x) => x.clave === clave);
      expect(c, clave).toBeDefined();
      expect(c!.requiereCuenta, `${clave}: no hay camino sin registro`).toBe(true);
    }
  });

  it('el encabezado AFIRMA el hecho correcto, no el invertido', async () => {
    // Se comprueba lo que el comentario AFIRMA, no que la frase vieja no
    // aparezca: la corrección la cita a propósito para dejar el rastro del
    // error. Lo que no puede volver es la afirmación en forma de viñeta.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./comercios.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/LA MAYOR[ÍI]A NO EXIGE CUENTA/);
    expect(src).not.toMatch(/^\/\/\s+- 42 de 60 exigen/m);
  });
});
