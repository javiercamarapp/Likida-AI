import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · LAS FUNCIONES DEL AVISO SEGUÍAN SIN EJECUTARSE NUNCA.
//
// La ronda 6 anotó que `liberarEnvioAviso` no corría en ninguna prueba y escribió
// `aviso_constancia.test.ts` para cerrarlo. Pero ese arnés la MOCKEA: comprueba
// que el processor la LLAME, no que su cuerpo haga algo. La línea seguía sin
// ejecutarse, con una prueba encima diciendo que sí.
//
// Aquí corren las tres de verdad, contra un PostgREST de mentira que solo hace
// de cable: registra qué RPC se llamó y con qué, y devuelve lo que se le diga.
// Las SEMÁNTICAS del SQL —que la reserva expira, que la constancia no se toca—
// no se prueban aquí y no se pueden: eso es el bloque 17 de
// `supabase/verificaciones.sql`, contra la base real. Un test con Supabase
// mockeado prueba el mock.
//
// ── LO QUE ESTABA MAL, Y NO ERA LA COBERTURA ───────────────────────────────
//
// `liberarEnvioAviso` ponía `aviso_privacidad_en` y `_version` en NULL. Hasta la
// 0033 la reserva y la constancia eran la misma fila, así que soltar la reserva
// BORRABA la constancia. Con un aviso que cambia de versión —`versionAviso` es un
// hash del texto, y el texto lleva la liga del aviso integral, que es una tarea
// abierta— el camino es:
//
//   v1 entregado hace tres meses → la flota corrige su liga → v2 → llega un
//   mensaje → la reserva gana porque la versión cambió y PISA la constancia de
//   v1 → Meta rechaza el envío (pasó el 28-jul) → liberar pone las dos en NULL.
//
// La base termina diciendo que ese operador nunca recibió ningún aviso. Y sí lo
// recibió. Ante la autoridad la carga de probar el art. 16 de la LFPDPPP es del
// responsable: "no consta" es el peor estado, y se llegaba a él destruyendo una
// prueba verdadera.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que se le pidió a la base, en orden. */
const llamadas: Array<{ tipo: 'rpc' | 'tabla'; nombre: string; args: unknown }> = [];
let respuesta: { data: unknown; error: unknown } = { data: true, error: null };

const rpc = vi.fn(async (nombre: string, args: unknown) => {
  llamadas.push({ tipo: 'rpc', nombre, args });
  return respuesta;
});

// Si alguna de las tres vuelve a escribir por tabla en vez de por RPC, queda
// registrado aquí y las pruebas de abajo lo ven. Un `update` directo sobre
// `operador` es exactamente la forma que tenía el bug.
const from = vi.fn((tabla: string) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'eq', 'limit', 'maybeSingle']) {
    enlace[m] = (...a: unknown[]) => { llamadas.push({ tipo: 'tabla', nombre: `${tabla}.${m}`, args: a }); return enlace; };
  }
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(respuesta).then(r);
  return enlace;
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from }) }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { reclamarEnvioAviso, confirmarEnvioAviso, liberarEnvioAviso } = await import('./repo');

beforeEach(() => {
  llamadas.length = 0;
  respuesta = { data: true, error: null };
  rpc.mockClear(); from.mockClear();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
});

describe('soltar la reserva no puede borrar la constancia', () => {
  it('`liberarEnvioAviso` NO escribe sobre las columnas de la constancia', () => {
    // El corazón del hallazgo. La versión vieja hacía
    //   .from('operador').update({ aviso_privacidad_en: null, aviso_privacidad_version: null })
    // y esa forma es la que no puede volver.
    return liberarEnvioAviso('t1', 'op1').then(() => {
      const escrituras = llamadas.filter((l) => l.tipo === 'tabla');
      expect(escrituras, 'liberar volvió a escribir por tabla en vez de por RPC').toEqual([]);

      const cuerpo = JSON.stringify(llamadas);
      expect(cuerpo).not.toContain('aviso_privacidad_en');
      expect(cuerpo).not.toContain('aviso_privacidad_version');
    });
  });

  it('suelta la reserva y solo la reserva', async () => {
    await liberarEnvioAviso('t1', 'op1');
    expect(llamadas).toEqual([{
      tipo: 'rpc',
      nombre: 'liberar_aviso_privacidad',
      args: { p_operador: 'op1', p_tenant: 't1' },
    }]);
  });

  it('y va acotada por tenant: una flota no puede soltar la reserva de otra', async () => {
    await liberarEnvioAviso('t-ajeno', 'op1');
    expect((llamadas[0].args as { p_tenant: string }).p_tenant).toBe('t-ajeno');
  });

  it('un fallo de la base se registra, no se lanza', async () => {
    // Es best-effort a propósito: el mensaje al operador ya falló, y tirar aquí
    // además convertiría un aviso no entregado en un mensaje no procesado.
    respuesta = { data: null, error: { message: 'sin respuesta en 8000 ms' } };
    await expect(liberarEnvioAviso('t1', 'op1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('privacidad.liberar_falló', expect.objectContaining({ tenantId: 't1' }));
  });

  it('soltar algo que ya no estaba reservado avisa, pero no es error', async () => {
    // La reserva expira sola a los 5 minutos. Que ya no esté es información
    // —cambia por qué reintentará el siguiente mensaje— pero no es un fallo.
    respuesta = { data: false, error: null };
    await liberarEnvioAviso('t1', 'op1');
    expect(logger.warn).toHaveBeenCalledWith('privacidad.liberar_sin_reserva', expect.anything());
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('la constancia la escribe el envío confirmado, y nada más', () => {
  it('`confirmarEnvioAviso` pasa la versión, que es lo que el art. 15 fr. VI exige comparar', async () => {
    await confirmarEnvioAviso('t1', 'op1', 'abc123');
    expect(llamadas).toEqual([{
      tipo: 'rpc',
      nombre: 'confirmar_aviso_privacidad',
      args: { p_operador: 'op1', p_tenant: 't1', p_version: 'abc123' },
    }]);
  });

  it('si no tocó ninguna fila, se grita: el mensaje salió y la prueba no quedó', async () => {
    // PostgREST devuelve el resultado POR VALOR, no lanzando. Sin este ramo, un
    // fallo de aislamiento entre flotas —operador de otro tenant— se vería
    // exactamente igual que un éxito.
    respuesta = { data: false, error: null };
    await confirmarEnvioAviso('t1', 'op-de-otro', 'abc123');
    expect(logger.error).toHaveBeenCalledWith('privacidad.constancia_sin_fila', expect.anything());
  });

  it('y un error de la base tampoco se traga', async () => {
    respuesta = { data: null, error: { message: 'PGRST202' } };
    await confirmarEnvioAviso('t1', 'op1', 'abc123');
    expect(logger.error).toHaveBeenCalledWith('privacidad.constancia_no_escrita', expect.anything());
  });
});

describe('reservar sigue siendo un claim y sigue lanzando', () => {
  it('devuelve true solo cuando ESTE llamado ganó la reserva', async () => {
    respuesta = { data: true, error: null };
    await expect(reclamarEnvioAviso('t1', 'op1', 'v')).resolves.toBe(true);
    respuesta = { data: false, error: null };
    await expect(reclamarEnvioAviso('t1', 'op1', 'v')).resolves.toBe(false);
  });

  it('un error SÍ lanza aquí, al revés que en liberar', async () => {
    // Y es a propósito: si no se sabe si se ganó la reserva, mandar el aviso
    // puede duplicarlo. El `catch` de `ponerAvisoADisposicion` lo convierte en
    // "no se puso a disposición", que es el lado seguro.
    respuesta = { data: null, error: { message: 'boom' } };
    await expect(reclamarEnvioAviso('t1', 'op1', 'v')).rejects.toThrow(/boom/);
  });

  it('reservar NO escribe la constancia — es toda la separación de la 0033', async () => {
    await reclamarEnvioAviso('t1', 'op1', 'v');
    expect(llamadas[0].nombre).toBe('marcar_aviso_privacidad');
    expect(JSON.stringify(llamadas)).not.toContain('aviso_privacidad_en');
  });
});
