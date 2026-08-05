// ═══════════════════════════════════════════════════════════════════════════
// BOTONES INTERACTIVOS — el sobre que sale hacia la Graph API.
//
// Se prueba `sendButtons` por el mismo camino que `client_cableado.test.ts`
// prueba `sendText`: llamando la función real y mirando el JSON que se le
// entrega a `fetch`. Los límites de Meta (3 botones, título ≤ 20, id ≤ 256,
// cuerpo ≤ 1024) no son estilo nuestro: pasarse hace que Meta rechace el
// mensaje ENTERO, así que una validación que "arregle" truncando cambiaría el
// rótulo que ve el chofer sin evitar un solo fallo.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendButtons, type BotonAcuse } from './client';

// `vi.hoisted` porque la factory de `vi.mock` se iza por encima de las consts
// del módulo: sin esto el spy no existe todavía cuando el mock se registra.
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));

/** El cuerpo JSON que se le mandó a la Graph API en la llamada `n`. */
function cuerpoEnviado(spy: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  const [, init] = spy.mock.calls[n] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  fetchSpy = vi.fn(async () => new Response(
    JSON.stringify({ messages: [{ id: 'wamid.BTN' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

const CERRAR: BotonAcuse[] = [
  { id: 'cerrar_si', titulo: 'Sí, ya terminé' },
  { id: 'cerrar_no', titulo: 'Falta un gasto' },
];

describe('sendButtons arma el sobre que la Cloud API espera', () => {
  it('manda type interactive / button con el cuerpo y los botones', async () => {
    const id = await sendButtons('5219993700779', '¿Cierro tu viaje?', CERRAR);

    expect(id).toBe('wamid.BTN');
    const b = cuerpoEnviado(fetchSpy);
    expect(b.messaging_product).toBe('whatsapp');
    expect(b.type).toBe('interactive');
    expect(b.interactive).toEqual({
      type: 'button',
      body: { text: '¿Cierro tu viaje?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'cerrar_si', title: 'Sí, ya terminé' } },
          { type: 'reply', reply: { id: 'cerrar_no', title: 'Falta un gasto' } },
        ],
      },
    });
  });

  it('pega en /messages del phone number id, con el token y su timeout', async () => {
    await sendButtons('5219993700779', 'hola', CERRAR);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-de-prueba');
    // Sin `signal`, un envío colgado se lleva la invocación entera (ver el
    // comentario de SEND_TIMEOUT_MS en client.ts).
    expect(init.signal).toBeDefined();
  });

  // El mismo bug de dinero que ancla `client_cableado.test.ts`: Meta ENTREGA con
  // el "1" mexicano y RECHAZA los envíos que lo lleven.
  it('normaliza el destinatario mexicano igual que sendText', async () => {
    await sendButtons('5219993700779', 'hola', CERRAR);
    expect(cuerpoEnviado(fetchSpy).to).toBe('529993700779');
  });

  it('el éxito deja rastro en el log con el wamid', async () => {
    await sendButtons('5219993700779', 'hola', CERRAR);
    expect(logger.info).toHaveBeenCalledWith('wa.sendButtons.ok', { id: 'wamid.BTN', botones: 2 });
  });
});

describe('cuántos botones caben', () => {
  const botones = (n: number): BotonAcuse[] =>
    Array.from({ length: n }, (_, i) => ({ id: `op_${i}`, titulo: `Opción ${i}` }));

  it.each([1, 2, 3])('%i botón(es) sale(n)', async (n) => {
    const id = await sendButtons('5219993700779', 'elige', botones(n));
    expect(id).toBe('wamid.BTN');
    const accion = (cuerpoEnviado(fetchSpy).interactive as { action: { buttons: unknown[] } }).action;
    expect(accion.buttons).toHaveLength(n);
  });

  // 4 es el caso que importa: Meta rechaza el mensaje ENTERO, así que mandarlo
  // "a ver si pasa" deja al chofer sin ningún botón. Se para antes de la red.
  it('4 botones NO se manda: devuelve null y ni siquiera llama a Meta', async () => {
    const id = await sendButtons('5219993700779', 'elige', botones(4));
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('wa.sendButtons.invalido',
      expect.objectContaining({ motivo: 'cantidad', botones: 4, max: 3 }));
  });

  it('cero botones tampoco: un interactivo sin acción no es un mensaje', async () => {
    expect(await sendButtons('5219993700779', 'elige', [])).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('lo que no cabe se rechaza, NO se trunca', () => {
  // El daño de truncar: el chofer aprieta lo que LEE. Si el rótulo dice una cosa
  // y el id vale otra, decide con información que nosotros le cambiamos.
  it('un título de 21 caracteres detiene el envío y el log dice cuál fue', async () => {
    const largo = 'No cerrar todavía hoy';   // 21
    expect(largo.length).toBe(21);
    const id = await sendButtons('5219993700779', 'elige', [
      { id: 'cerrar_si', titulo: 'Sí' },
      { id: 'cerrar_no', titulo: largo },
    ]);

    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('wa.sendButtons.invalido',
      expect.objectContaining({ motivo: 'titulo_largo', id: 'cerrar_no', titulo: largo, largo: 21, max: 20 }));
  });

  // CONTROL. Sin esto, "validar" podría ser rechazar todo y las pruebas de
  // arriba seguirían verdes con el producto mudo.
  it('exactamente 20 caracteres SÍ pasa (el límite es <=, no <)', async () => {
    const justo = 'No cerrar todavía ho';   // 20
    expect(justo.length).toBe(20);
    expect(await sendButtons('5219993700779', 'elige', [{ id: 'x', titulo: justo }])).toBe('wamid.BTN');
  });

  it('un id de más de 256 no sale', async () => {
    const id = await sendButtons('5219993700779', 'elige', [{ id: 'x'.repeat(257), titulo: 'Sí' }]);
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('wa.sendButtons.invalido',
      expect.objectContaining({ motivo: 'id_largo', largo: 257, max: 256 }));
  });

  it('256 clavados sí pasa', async () => {
    expect(await sendButtons('5219993700779', 'elige', [{ id: 'x'.repeat(256), titulo: 'Sí' }])).toBe('wamid.BTN');
  });

  // Truncar el cuerpo puede partir una cifra a la mitad ($12,450 → $12,4), que
  // es justo la regla que el producto no rompe.
  it('un cuerpo de más de 1024 no sale', async () => {
    const id = await sendButtons('5219993700779', 'x'.repeat(1025), CERRAR);
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('wa.sendButtons.invalido',
      expect.objectContaining({ motivo: 'cuerpo_largo', largo: 1025, max: 1024 }));
  });

  it('1024 clavados sí pasa', async () => {
    expect(await sendButtons('5219993700779', 'x'.repeat(1024), CERRAR)).toBe('wamid.BTN');
  });

  it('un título vacío o solo espacios no sale', async () => {
    expect(await sendButtons('5219993700779', 'elige', [{ id: 'x', titulo: '   ' }])).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('un id vacío no sale: sin id no hay nada que leer al apretarlo', async () => {
    expect(await sendButtons('5219993700779', 'elige', [{ id: '', titulo: 'Sí' }])).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Meta exige títulos únicos. Aunque no lo exigiera: dos botones con el mismo
  // rótulo son la misma cosa para quien decide mirando la pantalla.
  it('dos títulos iguales no salen aunque el id sea distinto', async () => {
    const id = await sendButtons('5219993700779', 'elige', [
      { id: 'a', titulo: 'Sí' },
      { id: 'b', titulo: 'Sí' },
    ]);
    expect(id).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.sendButtons.invalido',
      expect.objectContaining({ motivo: 'titulo_repetido', titulo: 'Sí' }));
  });
});

describe('cuando Meta lo rechaza', () => {
  it('devuelve null y NO lanza (mismo contrato que sendText)', async () => {
    fetchSpy.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: '(#131047) Re-engagement message', code: 131047 } }),
      { status: 400 },
    ));

    // Fuera de la ventana de 24 h esto es exactamente lo que contesta Meta: un
    // interactivo NO es plantilla y no abre conversación.
    await expect(sendButtons('5219993700779', '¿Cierro tu viaje?', CERRAR)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.sendButtons', expect.objectContaining({ status: 400 }));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('un 200 sin wamid devuelve null, no undefined', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(sendButtons('5219993700779', 'hola', CERRAR)).resolves.toBeNull();
  });
});
