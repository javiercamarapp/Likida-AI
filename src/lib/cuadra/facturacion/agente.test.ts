import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registrarAdaptador,
  adaptadorDe,
  portalesAutomatizados,
  olvidarAdaptadores,
  facturarConAgente,
  type AdaptadorPortal,
  type ModoAgente,
  type ResultadoAgente,
} from './agente';
import type { CampoListo } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// EL REGISTRO DE ADAPTADORES, Y POR QUÉ LA CLAVE LLEVA EL TENANT.
//
// `ADAPTADORES` es un `Map` de MÓDULO. En una función serverless caliente el
// módulo sobrevive entre invocaciones y el proceso atiende a varias flotas
// seguidas, así que lo que guarda ese `Map` no es un detalle de
// implementación: un adaptador de portal lleva DENTRO los datos fiscales con
// los que se llena el formulario, o sea el RFC que va impreso en un CFDI.
//
// Con la clave `comercio` a secas —como estaba— la secuencia era:
//
//     flota A registra CAPUFE con SUS datos → termina
//     llega un ticket de la flota B
//     adaptadorDe('capufe') devuelve el de A
//     se emite un CFDI con el RFC de A por un gasto de B
//
// Y un CFDI no se deshace: cancelarlo fuera de plazo se le queda al cliente en
// su contabilidad. El propio portal lo advierte en rojo en su página.
//
// LAS DOS PRIMERAS PRUEBAS DE ESTE ARCHIVO SE PONEN ROJAS si alguien vuelve a
// esa clave. No comprueban que el `Map` tenga dos niveles —eso sería probar la
// implementación—: comprueban que cada flota recibe SU adaptador y que la que
// no registró nada no recibe el de nadie.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

const CAMPOS: CampoListo[] = [
  { clave: 'codigo', etiqueta: 'código', valor: 'OK1234567890123456', requerido: true },
];

/**
 * Un adaptador que solo sabe decir de quién es.
 *
 * `rfc` va en `capturado`, que es donde el resultado real lleva lo que se tecleó
 * en el portal: es la evidencia de a nombre de quién iba a salir el CFDI.
 */
function adaptadorDe_(comercio: string, rfc: string): AdaptadorPortal {
  return {
    comercio,
    portal: `https://portal.example/${comercio}`,
    facturar: async (_campos: CampoListo[], modo: ModoAgente): Promise<ResultadoAgente> => ({
      modo, ok: true, capturado: { rfc },
    }),
  };
}

const FLOTAS = ['flota-a', 'flota-b', 'flota-c'];

beforeEach(() => {
  for (const f of FLOTAS) olvidarAdaptadores(f);
  for (const l of Object.values(logger)) l.mockReset();
});

describe('el registro va por flota', () => {
  it('DOS FLOTAS, EL MISMO COMERCIO: cada una recibe el suyo', async () => {
    // La prueba del bug. Con la clave por `comercio`, el segundo registro pisa
    // al primero y las dos flotas leen el mismo adaptador.
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-DE-A'));
    registrarAdaptador('flota-b', adaptadorDe_('capufe', 'RFC-DE-B'));

    expect(adaptadorDe('flota-a', 'capufe')).not.toBe(adaptadorDe('flota-b', 'capufe'));

    const a = await facturarConAgente({ tenantId: 'flota-a', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });
    const b = await facturarConAgente({ tenantId: 'flota-b', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });

    expect(a.capturado.rfc).toBe('RFC-DE-A');
    expect(b.capturado.rfc).toBe('RFC-DE-B');
    // Dicho al revés, que es la frase que describe la consecuencia:
    expect(a.capturado.rfc).not.toBe('RFC-DE-B');
  });

  it('la flota que no registró nada NO hereda el adaptador de la que sí', async () => {
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-DE-A'));

    expect(adaptadorDe('flota-c', 'capufe')).toBeNull();
    expect(portalesAutomatizados('flota-c')).toEqual([]);

    const r = await facturarConAgente({ tenantId: 'flota-c', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });
    expect(r.ok).toBe(false);
    expect(r.capturado).toEqual({});
    expect(r.error).toContain('capufe');
  });

  it('`portalesAutomatizados` responde por flota, no por proceso', () => {
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-DE-A'));
    registrarAdaptador('flota-a', adaptadorDe_('enerser', 'RFC-DE-A'));
    registrarAdaptador('flota-b', adaptadorDe_('capufe', 'RFC-DE-B'));

    expect(portalesAutomatizados('flota-a').sort()).toEqual(['capufe', 'enerser']);
    expect(portalesAutomatizados('flota-b')).toEqual(['capufe']);
    expect(portalesAutomatizados('flota-c')).toEqual([]);
  });

  it('registrar dos veces a la MISMA flota sobrescribe: sus datos fiscales cambian', async () => {
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-VIEJO'));
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-NUEVO'));

    const r = await facturarConAgente({ tenantId: 'flota-a', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });
    expect(r.capturado.rfc).toBe('RFC-NUEVO');
  });

  it('olvidar a una flota no toca a las demás', () => {
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-DE-A'));
    registrarAdaptador('flota-b', adaptadorDe_('capufe', 'RFC-DE-B'));

    olvidarAdaptadores('flota-a');

    expect(adaptadorDe('flota-a', 'capufe')).toBeNull();
    expect(adaptadorDe('flota-b', 'capufe')?.portal).toContain('capufe');
  });
});

describe('el tenantId es obligatorio y no tiene default', () => {
  // Omitirlo no compila —lo exige la firma— así que lo que queda por cerrar es
  // el valor vacío: un `undefined` colado por un `as`, un id que no se leyó de
  // la fila. Un cajón por default para esos casos sería el bug otra vez.
  const vacios = ['', '   '];

  it('no se puede registrar en un cajón sin dueño', () => {
    for (const v of vacios) {
      expect(() => registrarAdaptador(v, adaptadorDe_('capufe', 'X')), `«${v}»`).toThrow(/tenantId/);
    }
    expect(() => registrarAdaptador(undefined as unknown as string, adaptadorDe_('capufe', 'X'))).toThrow(/tenantId/);
  });

  it('no se puede leer de un cajón sin dueño', () => {
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-DE-A'));
    for (const v of vacios) {
      expect(() => adaptadorDe(v, 'capufe'), `«${v}»`).toThrow(/tenantId/);
    }
    expect(() => portalesAutomatizados('')).toThrow(/tenantId/);
  });

  it('el error dice POR QUÉ, no solo que faltó un argumento', () => {
    // Quien lo lea a las 3 a.m. tiene que entender que esto no es una validación
    // de forma: es la que impide emitir con el RFC de otra empresa.
    expect(() => adaptadorDe('', 'capufe')).toThrow(/RFC de otra/i);
  });
});

describe('facturarConAgente', () => {
  it('sin adaptador para esa flota no improvisa: lo dice y no emite', async () => {
    const r = await facturarConAgente({ tenantId: 'flota-a', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });
    expect(r.ok).toBe(false);
    expect(r.modo).toBe('emitir');
    expect(r.cfdiUuid).toBeUndefined();
  });

  it('un campo requerido vacío no llega al portal', async () => {
    const facturar = vi.fn();
    registrarAdaptador('flota-a', { comercio: 'capufe', portal: 'x', facturar });

    const r = await facturarConAgente({
      tenantId: 'flota-a',
      comercio: 'capufe',
      campos: [{ clave: 'codigo', etiqueta: 'código', valor: null, requerido: true }],
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('código');
    expect(facturar).not.toHaveBeenCalled();
  });

  it('EL DEFAULT ES ENSAYO: sin pedirlo no se emite nada', async () => {
    const facturar = vi.fn(async (_c: CampoListo[], modo: ModoAgente) => ({ modo, ok: true, capturado: {} }));
    registrarAdaptador('flota-a', { comercio: 'capufe', portal: 'x', facturar });

    await facturarConAgente({ tenantId: 'flota-a', comercio: 'capufe', campos: CAMPOS });

    expect(facturar).toHaveBeenCalledWith(CAMPOS, 'ensayo');
  });

  it('si el adaptador revienta NO se reintenta: un reintento a ciegas duplica el CFDI', async () => {
    const facturar = vi.fn().mockRejectedValue(new Error('el portal se cayó'));
    registrarAdaptador('flota-a', { comercio: 'capufe', portal: 'x', facturar });

    const r = await facturarConAgente({ tenantId: 'flota-a', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });

    expect(r.ok).toBe(false);
    expect(r.error).toBe('el portal se cayó');
    expect(facturar).toHaveBeenCalledTimes(1);
  });

  it('el log lleva la flota: sin ella no se puede auditar de quién salió cada intento', async () => {
    registrarAdaptador('flota-a', adaptadorDe_('capufe', 'RFC-DE-A'));
    await facturarConAgente({ tenantId: 'flota-a', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });

    expect(logger.info).toHaveBeenCalledWith('agente.facturacion', {
      tenant: 'flota-a', comercio: 'capufe', modo: 'emitir', ok: true,
    });
  });
});
