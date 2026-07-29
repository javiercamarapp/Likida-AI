import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO del rubro pruebas — `liberarEnvioAviso`, el arreglo de
// la "constancia falsa", NO SE EJECUTA EN NINGUNA PRUEBA.
//
// El fallo que cierra: la reserva del envío va ANTES de mandar (si no, el aviso
// sale dos o tres veces), pero la CONSTANCIA solo vale si el mensaje salió.
// `sendText` devolvía `void` y no lanza al fallar, así que la fila se escribía
// igual: el 28-jul la base afirmó que un operador recibió su aviso DIEZ MINUTOS
// ANTES del commit que arregló el destinatario que Meta rechazaba.
//
// Ante la autoridad esa fila es la prueba del art. 16 de la LFPDPPP. Una prueba
// falsa es peor que ninguna: convierte un incumplimiento en una afirmación
// documentada y falsa.
//
// Los tres arneses que ejecutan `processInbound` mockean `liberarEnvioAviso` con
// un `vi.fn()` y ninguno comprueba que se llame. La función existía sin que
// nadie la corriera nunca.
// ═══════════════════════════════════════════════════════════════════════════

const sendText = vi.fn();
const reclamarEnvioAviso = vi.fn();
const liberarEnvioAviso = vi.fn(async () => {});
const getDatosResponsable = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/meta/client', () => ({ sendText, sendDocument: vi.fn(), verifySignature: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./repo', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDatosResponsable, reclamarEnvioAviso, liberarEnvioAviso,
}));

const { ponerAvisoADisposicion } = await import('./processor');

const RESPONSABLE = {
  razonSocial: 'Transportes del Norte SA de CV',
  domicilio: 'Av. Vallarta 1234, Guadalajara, Jalisco',
  urlAvisoIntegral: 'https://ejemplo.mx/aviso',
};

beforeEach(() => {
  sendText.mockReset(); reclamarEnvioAviso.mockReset(); liberarEnvioAviso.mockReset();
  getDatosResponsable.mockReset();
  logger.info.mockReset(); logger.error.mockReset();
  getDatosResponsable.mockResolvedValue(RESPONSABLE);
  reclamarEnvioAviso.mockResolvedValue(true);   // este llamado es el que reserva
  liberarEnvioAviso.mockResolvedValue(undefined);
});

describe('la constancia del aviso solo se conserva si el mensaje salió', () => {
  it('con envío exitoso, la reserva se queda y NO se libera', async () => {
    sendText.mockResolvedValue('wamid.OK1');
    const ok = await ponerAvisoADisposicion('t1', 'op1', '5219990000001');
    expect(ok).toBe(true);
    expect(liberarEnvioAviso).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('privacidad.aviso_enviado', expect.objectContaining({ id: 'wamid.OK1' }));
  });

  it('si Meta NO entrega, la constancia se LIBERA — es la línea sin cobertura', async () => {
    // `sendText` devuelve null: aceptado no es entregado, y no lanza.
    sendText.mockResolvedValue(null);
    const ok = await ponerAvisoADisposicion('t1', 'op1', '5219990000002');

    expect(ok, 'sin aviso puesto a disposición no puede haber tratamiento').toBe(false);
    expect(liberarEnvioAviso).toHaveBeenCalledWith('t1', 'op1');
    expect(logger.error).toHaveBeenCalledWith('privacidad.aviso_no_entregado', expect.anything());
  });

  it('y liberarla es lo que permite que el SIGUIENTE mensaje reintente', async () => {
    sendText.mockResolvedValue(null);
    await ponerAvisoADisposicion('t1', 'op1', '5219990000003');
    expect(liberarEnvioAviso).toHaveBeenCalledTimes(1);

    // Segundo mensaje: la reserva está libre, se vuelve a intentar y ahora sí sale.
    sendText.mockResolvedValue('wamid.OK2');
    const ok = await ponerAvisoADisposicion('t1', 'op1', '5219990000003');
    expect(ok).toBe(true);
    expect(liberarEnvioAviso).toHaveBeenCalledTimes(1); // no se liberó de nuevo
  });

  it('si ya se le había puesto a disposición, no se reenvía ni se libera', async () => {
    reclamarEnvioAviso.mockResolvedValue(false);
    const ok = await ponerAvisoADisposicion('t1', 'op1', '5219990000004');
    expect(ok).toBe(true);
    expect(sendText).not.toHaveBeenCalled();
    expect(liberarEnvioAviso).not.toHaveBeenCalled();
  });

  it('sin responsable identificable NO se manda nada y el tratamiento se detiene', async () => {
    // `getDatosResponsable` exige razón social y domicilio: son la fr. I del
    // art. 15 y no se pueden fingir.
    getDatosResponsable.mockResolvedValue(null);
    const ok = await ponerAvisoADisposicion('t1', 'op1', '5219990000005');
    expect(ok).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('un fallo inesperado tampoco deja una constancia en pie', async () => {
    sendText.mockImplementation(() => { throw new Error('boom'); });
    const ok = await ponerAvisoADisposicion('t1', 'op1', '5219990000006');
    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('privacidad.aviso_error', expect.anything());
  });
});
