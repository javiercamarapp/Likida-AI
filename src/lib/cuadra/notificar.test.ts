import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE ASIGNACIÓN — lo que hoy se dice por teléfono, o no se dice.
//
// `crearViaje` y `reasignarOperador` escriben el `operador_id` y ahí se acaba
// el camino. Este archivo fija las tres cosas que hacen que el aviso sirva:
//
//   1. NO SE INVENTA UNA CIFRA. Sin unidad o sin anticipo, el mensaje dice qué
//      falta. El chofer lee esto de pie junto a la unidad y decide si sale con
//      dinero propio: un "$0.00" que en realidad es un dato sin capturar le
//      cuesta su gasolina.
//   2. FALLA CERRADO. Sin teléfono no se intenta el envío.
//   3. EL FALLO SE DICE, NO SE TRAGA. La plantilla está en revisión en Meta:
//      hoy TODOS los envíos vuelven con 132001. Si eso se devolviera como un
//      silencio, el despachador creería que ya avisó y el chofer no sabría que
//      tiene viaje.
//
// Se mockea SOLO `sendTemplate`: `motivoDeFalloWhatsApp` corre de verdad, que
// es lo único que prueba que el código de Meta se traduce a algo accionable.
// ═══════════════════════════════════════════════════════════════════════════

const { sendTemplate } = vi.hoisted(() => ({ sendTemplate: vi.fn() }));

vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendTemplate,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { armarAvisoViaje, notificarAsignacion } = await import('./notificar');

/** Meta rechaza los mexicanos con el "1": se manda el que sí acepta. */
const TELEFONO = '529993700779';

const COMPLETO = {
  folio: 'VJ-104',
  origen: 'Guadalajara',
  destino: 'Monterrey',
  fechaInicio: '2026-08-05',
  anticipo: 5000,
  unidad: 'ECO-42',
};

beforeEach(() => {
  sendTemplate.mockReset();
  sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.TEST' });
});

describe('armarAvisoViaje', () => {
  it('con todos los datos dice folio, ruta, cuándo y qué se espera de él', () => {
    const t = armarAvisoViaje(COMPLETO);
    expect(t).toContain('VJ-104');
    expect(t).toContain('Guadalajara → Monterrey');
    expect(t).toContain('05 ago 2026');
    expect(t).toContain('ECO-42');
    expect(t).toContain(mxnEsperado(5000));
    // Lo que tiene que hacer: sin esto es una notificación, no una instrucción.
    expect(t).toMatch(/ticket/i);
  });

  it('sin unidad asignada lo DICE — no pone "N/A" ni la deja en blanco', () => {
    const t = armarAvisoViaje({ ...COMPLETO, unidad: null });
    expect(t).toMatch(/falta asignarte una/i);
    expect(t).not.toMatch(/N\/A/i);
    // El anticipo, que sí existe, sigue estando: falta un dato, no el mensaje.
    expect(t).toContain(mxnEsperado(5000));
  });

  it('sin anticipo dice que no hay — nunca escribe $0.00', () => {
    for (const anticipo of [null, undefined, 0]) {
      const t = armarAvisoViaje({ ...COMPLETO, anticipo });
      expect(t).toMatch(/sin anticipo registrado/i);
      // `crearViaje` guarda `anticipo ?? 0`: un 0 en la base puede ser "no
      // llevas dinero" o "nadie lo capturó", y las dos se ven igual. Imprimirlo
      // como cifra afirma la primera sin poder distinguirla de la segunda.
      expect(t).not.toContain('$0.00');
    }
  });

  it('una ruta a medias dice cuál de los dos extremos falta', () => {
    expect(armarAvisoViaje({ ...COMPLETO, destino: null })).toMatch(/falta capturar el destino/i);
    expect(armarAvisoViaje({ ...COMPLETO, origen: null })).toMatch(/falta capturar el origen/i);
  });

  it('sin fecha de salida no pinta un guion: dice que falta', () => {
    const t = armarAvisoViaje({ ...COMPLETO, fechaInicio: null });
    expect(t).toMatch(/falta capturar la fecha/i);
    expect(t).not.toContain('Salida: —');
  });
});

describe('notificarAsignacion', () => {
  it('manda la plantilla aprobada y devuelve enviado', async () => {
    const r = await notificarAsignacion({ telefono: TELEFONO, viaje: COMPLETO, tenantId: 't-1' });
    expect(r).toEqual({ enviado: true });

    const [to, plantilla, opciones] = sendTemplate.mock.calls[0] as [string, string, { parametros: string[] }];
    expect(to).toBe(TELEFONO);
    expect(plantilla).toBe('viaje_asignado');
    expect(opciones.parametros.join(' ')).toContain('VJ-104');
  });

  it('los parámetros no llevan saltos de línea — Meta los rechaza', async () => {
    // Origen tecleado a mano, pegado de otro sistema: llega con salto y
    // espacios de sobra. El rechazo de Meta se ve como "el chofer no recibió
    // nada", sin ninguna pista de por qué.
    await notificarAsignacion({
      telefono: TELEFONO,
      viaje: { ...COMPLETO, origen: 'Guadalajara,\n  Jalisco' },
      tenantId: 't-1',
    });
    const { parametros } = (sendTemplate.mock.calls[0] as [string, string, { parametros: string[] }])[2];
    for (const p of parametros) expect(p).not.toMatch(/[\n\t]|\s{4}/);
  });

  it('sin teléfono NO intenta enviar y dice qué falta', async () => {
    for (const telefono of [null, undefined, '', '   ', 'n/a']) {
      const r = await notificarAsignacion({ telefono, viaje: COMPLETO, tenantId: 't-1' });
      expect(r.enviado).toBe(false);
      expect(r.motivo).toMatch(/teléfono/i);
    }
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('un viaje sin folio ni ruta no gasta una plantilla', async () => {
    const r = await notificarAsignacion({
      telefono: TELEFONO,
      viaje: { anticipo: 5000, unidad: 'ECO-42' },
      tenantId: 't-1',
    });
    expect(r.enviado).toBe(false);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('la plantilla no aprobada (132001) vuelve traducida, no en silencio', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      error: 'Template name does not exist in the translation',
      codigo: 132001,
    });

    const r = await notificarAsignacion({ telefono: TELEFONO, viaje: COMPLETO, tenantId: 't-1' });
    expect(r.enviado).toBe(false);
    expect(r.motivo).toMatch(/no está aprobada/i);
    // El crudo de Meta no le sirve a nadie en pantalla.
    expect(r.motivo).not.toContain('Template name does not exist');
  });

  it('el número fuera de la lista de pruebas (131030) también se explica', async () => {
    sendTemplate.mockResolvedValue({ ok: false, error: '(#131030) Recipient not in allowed list', codigo: 131030 });
    const r = await notificarAsignacion({ telefono: TELEFONO, viaje: COMPLETO, tenantId: 't-1' });
    expect(r.motivo).toMatch(/lista de pruebas/i);
  });
});

/**
 * La cifra tal como la imprime `mxn`, sin reimplementar el formato aquí: una
 * prueba que escribiera "$5,000.00" a mano dejaría de proteger el día que el
 * formato cambie —pasaría verde mientras el mensaje del chofer dice otra cosa.
 */
function mxnEsperado(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
