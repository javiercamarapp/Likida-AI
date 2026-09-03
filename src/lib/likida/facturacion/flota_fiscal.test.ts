import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CON QUÉ DATOS SE LLENA EL PORTAL — o sea de qué empresa sale el CFDI.
//
// Dos cosas se prueban aquí y las dos duelen en producción:
//
//   1. QUE NO SE ARME UNA FLOTA A MEDIAS. Si esto devolviera un objeto con
//      huecos, `registrarPortales` lo aceptaría, el adaptador quedaría vivo y el
//      fallo aparecería tecleando en el portal. Aquí se falla ANTES, sin gastar
//      navegador, y se dice qué falta.
//   2. EL CORREO. No hay columna para él —se buscó— y sin correo el portal EMITE
//      IGUAL y no manda el comprobante a nadie: el ensayo pasa, el timbrado
//      ocurre, y el CFDI se pierde. Es de los datos que solo duelen cuando ya no
//      se pueden arreglar.
// ═══════════════════════════════════════════════════════════════════════════

const getDatosFiscales = vi.fn();
vi.mock('@/lib/saas/fiscal', () => ({ getDatosFiscales }));

/** Lo que devuelve la consulta de cuentas de oficina. */
let cuentas: { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
const filtros: Array<[string, unknown[]]> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const nodo: Record<string, unknown> = {};
      // `or` entra con la ALTO de la reauditoría 25: el filtro de la baja va
      // también en la base. El doble devuelve la tabla entera igual que con
      // los demás encadenados, así que lo que las pruebas de abajo ejercen es
      // la capa de TS — que es donde vive la regla.
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'or']) {
        nodo[m] = (...a: unknown[]) => { filtros.push([`${tabla}.${m}`, a]); return nodo; };
      }
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(cuentas).then(r);
      return nodo;
    },
  }),
}));

const { getFiscalDeFlota } = await import('./flota_fiscal');

/** Datos fiscales completos y con RFC que pasa el dígito verificador. */
const BUENOS = {
  rfc: 'GMX0902279I1',
  razonSocial: 'TRANSPORTES DEL BAJIO SA DE CV',
  regimenFiscal: '601',
  codigoPostal: '37000',
  usoCfdi: 'G03',
};

beforeEach(() => {
  filtros.length = 0;
  getDatosFiscales.mockReset();
  getDatosFiscales.mockResolvedValue(BUENOS);
  cuentas = { data: [{ rol: 'flota_admin', email: 'jefe@flota.mx' }], error: null };
});

describe('cuando la flota está completa', () => {
  it('devuelve los seis datos, con el tenantId aparte del receptor', async () => {
    const { flota, falta } = await getFiscalDeFlota('t-1');

    expect(falta).toEqual([]);
    expect(flota).toEqual({
      tenantId: 't-1',
      rfc: 'GMX0902279I1',
      nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
      codigoPostal: '37000',
      regimenFiscal: '601',
      usoCfdi: 'G03',
      correo: 'jefe@flota.mx',
    });
  });

  it('el CONTADOR gana al flota_admin: es quien archiva el CFDI', async () => {
    cuentas = {
      data: [
        { rol: 'flota_admin', email: 'jefe@flota.mx' },
        { rol: 'contador', email: 'contador@despacho.mx' },
      ],
      error: null,
    };
    const { flota } = await getFiscalDeFlota('t-1');
    expect(flota?.correo).toBe('contador@despacho.mx');
  });

  it('solo pregunta por roles de OFICINA: un chofer no recibe los CFDI de su flota', async () => {
    // `operador` y `encargado` son personal de ruta y patio. Mandarles los
    // comprobantes fiscales de la empresa es una fuga de información, no una
    // comodidad.
    await getFiscalDeFlota('t-1');

    const [, args] = filtros.find(([m]) => m === 'app_user.in')!;
    expect(args[1]).toEqual(['contador', 'flota_admin']);
  });

  it('la consulta va acotada al tenant', async () => {
    await getFiscalDeFlota('t-1');
    expect(filtros).toContainEqual(['app_user.eq', ['tenant_id', 't-1']]);
  });
});

describe('cuando falta algo, NO se arma una flota a medias', () => {
  it('sin cuenta de oficina no hay a dónde mandar el CFDI', async () => {
    cuentas = { data: [], error: null };
    const { flota, falta } = await getFiscalDeFlota('t-1');

    expect(flota).toBeNull();
    expect(falta.join(' ')).toMatch(/no hay a dónde mandar el CFDI/);
  });

  it('un correo en blanco cuenta como ausente, no como correo', async () => {
    cuentas = { data: [{ rol: 'flota_admin', email: '   ' }], error: null };
    expect((await getFiscalDeFlota('t-1')).flota).toBeNull();
  });

  it('sin ficha en `tenant` se dice, en vez de inventar los cinco datos', async () => {
    getDatosFiscales.mockResolvedValue(null);
    const { flota, falta } = await getFiscalDeFlota('t-1');

    expect(flota).toBeNull();
    expect(falta.join(' ')).toMatch(/no existe o no tiene ficha/);
  });

  it('un RFC que no pasa el dígito verificador NO pasa: el portal lo rechazaría', async () => {
    // Se revisa aquí para no gastar un navegador descubriéndolo, con el MISMO
    // validador que usa el registro: dos criterios distintos serían dos
    // respuestas distintas a "¿se puede facturar?".
    getDatosFiscales.mockResolvedValue({ ...BUENOS, rfc: 'GMX0902279I2' });
    const { flota, falta } = await getFiscalDeFlota('t-1');

    expect(flota).toBeNull();
    expect(falta.join(' ')).toMatch(/dígito verificador/);
  });

  it('un dato fiscal vacío se reporta con su nombre, no como "faltan datos"', async () => {
    getDatosFiscales.mockResolvedValue({ ...BUENOS, codigoPostal: null, usoCfdi: null });
    const { flota, falta } = await getFiscalDeFlota('t-1');

    expect(flota).toBeNull();
    expect(falta.join(' ')).toMatch(/código postal/);
    expect(falta.join(' ')).toMatch(/uso de CFDI/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · ALTO (reauditoría) — LA BAJA CERRABA WHATSAPP Y DEJABA
// ABIERTO EL CORREO. Misma causa raíz exacta que AGEN-C1 (commit 24ce4c2,
// contactos.ts): `desactivarUsuario` escribe `activo=false` y NO borra
// `app_user.email`, así que esta consulta lo seguía encontrando.
//
// Escenario medido: Innovativos da de baja a Marisol, su contadora. El panel
// la echa, la RLS la echa, el WhatsApp también — pero el cron de facturación
// seguía resolviendo `correoDeFacturacion('innovativos')` a
// `marisol@despacho-anterior.mx`, y el portal le mandaba el CFDI de la flota:
// RFC, razón social e importe, a un despacho que ya no es el suyo.
// ═══════════════════════════════════════════════════════════════════════════
describe('ALTO (reauditoría 25) · el correo también respeta la baja', () => {
  it('un contador DADO DE BAJA no recibe el CFDI aunque sea la única cuenta', async () => {
    cuentas = { data: [{ rol: 'contador', email: 'marisol@despacho-anterior.mx', activo: false }], error: null };
    expect((await getFiscalDeFlota('t-1')).flota).toBeNull();
  });

  it('con el contador de baja, el CFDI cae al flota_admin VIVO, no al ex-contador', async () => {
    cuentas = {
      data: [
        { rol: 'contador', email: 'marisol@despacho-anterior.mx', activo: false },
        { rol: 'flota_admin', email: 'jefe@flota.mx', activo: true },
      ],
      error: null,
    };
    const { flota } = await getFiscalDeFlota('t-1');
    expect(flota?.correo).toBe('jefe@flota.mx');
  });

  it('un `activo` ausente en la fila NO da de baja: solo el false explícito (base sin la 0294)', async () => {
    cuentas = { data: [{ rol: 'flota_admin', email: 'jefe@flota.mx' }], error: null };
    expect((await getFiscalDeFlota('t-1')).flota?.correo).toBe('jefe@flota.mx');
  });
});

describe('cuando la base no contesta', () => {
  it('el error SUBE: "no tiene datos" y "no pude preguntar" no son lo mismo', async () => {
    // Confundirlos haría que una caída de Supabase se leyera como "ningún
    // cliente tiene datos fiscales" y el cron reportara flotas incompletas que
    // están perfectamente configuradas.
    cuentas = { data: null, error: { message: 'timeout' } };
    await expect(getFiscalDeFlota('t-1')).rejects.toThrow(/timeout/);
  });
});
