import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registrarPortales,
  olvidarPortales,
  conPortales,
  exigirTenantRegistrado,
  tenantRegistrado,
  portalesVivos,
  PORTALES_CONOCIDOS,
  type FlotaFiscal,
} from './registro';
import { adaptadorDe, portalesAutomatizados, facturarConAgente } from '../agente';
import type { PaginaPortal } from './playwright_base';
import type { CampoListo } from '../pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTE ARCHIVO PROTEGE ES DE QUÉ EMPRESA SALE LA FACTURA.
//
// El registro de `agente.ts` es un `Map` de MÓDULO y en una función caliente de
// Vercel ese módulo sobrevive entre invocaciones, así que atiende a varias
// flotas seguidas. "Quién quedó registrado" no es un detalle de implementación:
// es el RFC que va impreso en un CFDI irreversible.
//
// La clave de ese `Map` lleva EL TENANT. Cuando era `comercio` a secas, la
// flota A registraba CAPUFE con sus datos fiscales, llegaba un ticket de la
// flota B y `adaptadorDe('capufe')` devolvía el de A. La prueba de abajo
// —«dos flotas, el mismo portal»— es la que se pone roja si alguien vuelve a
// esa clave.
//
// El resto no mira si se registra, sino si se DESREGISTRA — y qué pasa cuando
// alguien factura fuera de su lote.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

/** El registro no necesita navegador: la fábrica es parte del contrato, no del arranque. */
const PAGINA_FALSA: PaginaPortal = {
  abrir: async () => {},
  escribir: async () => {},
  hacerClic: async () => {},
  leerTexto: async () => null,
  captura: async () => 'sin-captura',
};
const abrirPagina = async () => PAGINA_FALSA;

const FLOTA_A: FlotaFiscal = {
  tenantId: 'tenant-a',
  rfc: 'GMX0902279I1',
  nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
  codigoPostal: '37000',
  regimenFiscal: '601',
  usoCfdi: 'G03',
  correo: 'facturas@transportesdelbajio.mx',
};

/** Otro RFC, con su dígito verificador bueno: `revisarReceptor` lo comprueba. */
const FLOTA_B: FlotaFiscal = { ...FLOTA_A, tenantId: 'tenant-b', rfc: 'MAR890215AA9', nombre: 'AUTOTRANSPORTES DEL MAR SA DE CV' };

const CAMPOS: CampoListo[] = [
  { clave: 'codigo', etiqueta: 'Código de caseta', valor: 'OK1234567890123456', requerido: true },
];

beforeEach(() => {
  // El `Map` de `agente.ts` es de módulo y sobrevive entre pruebas del archivo.
  // Empezar cada una desde "nadie registrado" es parte de lo que se prueba, y se
  // limpian LAS DOS flotas: con el tenant en la clave, olvidar a una deja a la
  // otra puesta —que es justo lo que se quiere en producción y lo que aquí
  // contaminaría la prueba siguiente.
  olvidarPortales(FLOTA_A.tenantId);
  olvidarPortales(FLOTA_B.tenantId);
});

describe('registrarPortales', () => {
  it('deja CAPUFE operable — que es lo que hacía que el cron fuera un no-op', () => {
    // Antes de registrar, `portalesAutomatizados()` no tiene un solo portal vivo:
    // ese `[]` es el que ponía el cron en verde sin facturar nada.
    expect(portalesVivos('tenant-a')).toEqual([]);

    const r = registrarPortales({ flota: FLOTA_A, abrirPagina });

    expect(r.registrados).toEqual(['capufe']);
    expect(r.problemas).toEqual([]);
    expect(portalesVivos('tenant-a')).toEqual(['capufe']);
    expect(portalesAutomatizados('tenant-a')).toContain('capufe');
    expect(adaptadorDe('tenant-a', 'capufe')?.portal).toContain('facturacionrapida');
  });

  it('DOS FLOTAS, EL MISMO PORTAL: cada una recibe SU adaptador', async () => {
    // ESTA ES LA PRUEBA DEL BUG. Con la clave por `comercio` a secas, el segundo
    // registro pisaba al primero y `adaptadorDe('capufe')` devolvía el de B para
    // las dos flotas: la A emitía su CFDI con el RFC de B.
    //
    // Se registran EN ORDEN y después se pregunta por la PRIMERA, que es la que
    // el bug perdía. Y se mide donde importa: `capturado` lleva campo por campo
    // lo que se tecleó en el portal, o sea a nombre de quién iba a salir el CFDI.
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    registrarPortales({ flota: FLOTA_B, abrirPagina });

    expect(adaptadorDe('tenant-a', 'capufe')).not.toBe(adaptadorDe('tenant-b', 'capufe'));

    const a = await facturarConAgente({ tenantId: 'tenant-a', comercio: 'capufe', campos: CAMPOS });
    expect(a.capturado.rfc).toBe(FLOTA_A.rfc);
    expect(a.capturado.nombre).toBe(FLOTA_A.nombre);

    const b = await facturarConAgente({ tenantId: 'tenant-b', comercio: 'capufe', campos: CAMPOS });
    expect(b.capturado.rfc).toBe(FLOTA_B.rfc);
    expect(b.capturado.nombre).toBe(FLOTA_B.nombre);

    // Y ninguna se llevó el RFC de la otra. Redundante a propósito: es la línea
    // que describe la consecuencia irreversible.
    expect(a.capturado.rfc).not.toBe(FLOTA_B.rfc);
    expect(b.capturado.rfc).not.toBe(FLOTA_A.rfc);
  });

  it('una flota sin lote abierto NO hereda el adaptador de la que sí', async () => {
    // El otro lado del mismo bug: la flota B no tiene lote abierto. Con la clave
    // por comercio, `adaptadorDe('capufe')` le devolvía el de A y su ticket se
    // facturaba con el RFC de A sin que nada avisara.
    registrarPortales({ flota: FLOTA_A, abrirPagina });

    expect(portalesVivos('tenant-b')).toEqual([]);

    const r = await facturarConAgente({ tenantId: 'tenant-b', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });

    // Falla CERRADO: ni emite, ni escribe un dato fiscal en el portal. Lo que se
    // mide es `capturado`, que es lo que se habría tecleado — con el bug traía
    // el RFC de A.
    expect(r.ok).toBe(false);
    expect(r.cfdiUuid).toBeUndefined();
    expect(r.capturado).toEqual({});
    expect(r.error).not.toContain(FLOTA_A.rfc);
  });

  it('con datos fiscales inservibles NO registra el portal, y dice qué falta', async () => {
    const r = registrarPortales({
      flota: { ...FLOTA_A, rfc: 'NOPE', codigoPostal: '370', usoCfdi: '3' },
      abrirPagina,
    });

    expect(r.registrados).toEqual([]);
    expect(r.problemas[0]).toContain('capufe');
    expect(r.problemas[0]).toContain('NOPE');
    // Y no queda vivo: un portal que aparece como automatizado y nunca emite es
    // el mismo verde engañoso, una capa más abajo.
    expect(portalesVivos('tenant-a')).toEqual([]);

    // Aun así hay adaptador, y lo que hace es explicarse. No lanza.
    const salida = await facturarConAgente({ tenantId: 'tenant-a', comercio: 'capufe', campos: CAMPOS });
    expect(salida.ok).toBe(false);
    expect(salida.modo).toBe('ensayo');
    expect(salida.error).toContain('no sirven para facturar');
  });

  it('volver a registrar a la MISMA flota SOBRESCRIBE (nunca "si ya está, lo dejo")', async () => {
    // Los datos fiscales de una flota cambian: corrige su CP, cambia de régimen.
    // Un adaptador cacheado factura con lo anterior, y eso llega al SAT.
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    registrarPortales({ flota: { ...FLOTA_A, codigoPostal: '44100' }, abrirPagina });

    const r = await facturarConAgente({ tenantId: 'tenant-a', comercio: 'capufe', campos: CAMPOS });
    expect(r.capturado.codigoPostal).toBe('44100');
  });

  it('`tenantRegistrado` dice de quién es el lote abierto', () => {
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    expect(tenantRegistrado()).toBe('tenant-a');

    registrarPortales({ flota: FLOTA_B, abrirPagina });
    expect(tenantRegistrado()).toBe('tenant-b');
    expect(() => exigirTenantRegistrado('tenant-b')).not.toThrow();
    expect(() => exigirTenantRegistrado('tenant-a')).toThrow(/OTRA flota/);
  });
});

describe('exigirTenantRegistrado', () => {
  it('lanza cuando no hay nadie registrado', () => {
    expect(() => exigirTenantRegistrado('tenant-a')).toThrow(/No hay portales registrados/);
  });

  it('lanza —y nombra el riesgo— cuando el registro es de otra flota', () => {
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    expect(() => exigirTenantRegistrado('tenant-b')).toThrow(/RFC de la otra empresa/);
  });

  it('deja pasar a la flota que registró', () => {
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    expect(() => exigirTenantRegistrado('tenant-a')).not.toThrow();
  });
});

describe('conPortales', () => {
  it('registra, corre y desregistra', async () => {
    const dentro = await conPortales({ flota: FLOTA_A, abrirPagina }, async (registro) => {
      expect(registro.registrados).toEqual(['capufe']);
      expect(tenantRegistrado()).toBe('tenant-a');
      return portalesVivos('tenant-a');
    });

    expect(dentro).toEqual(['capufe']);
    expect(tenantRegistrado()).toBeNull();
    expect(portalesVivos('tenant-a')).toEqual([]);
  });

  it('desregistra AUNQUE el lote reviente', async () => {
    await expect(
      conPortales({ flota: FLOTA_A, abrirPagina }, async () => {
        throw new Error('el portal se cayó a media sesión');
      }),
    ).rejects.toThrow('el portal se cayó a media sesión');

    // Sin el `finally`, los adaptadores de esta flota se quedan puestos y una
    // llamada suelta de la misma instancia caliente facturaría con datos de un
    // lote que ya cerró.
    expect(tenantRegistrado()).toBeNull();
    expect(portalesVivos('tenant-a')).toEqual([]);
  });

  it('cerrar el lote de una flota NO desregistra a la otra', async () => {
    // Con el tenant en la clave, cada lote es independiente. Si `olvidarPortales`
    // barriera el registro entero, dos crones solapados —o dos flotas en la misma
    // invocación— se apagarían el uno al otro y la segunda flota reportaría "no
    // hay adaptador" sin que nada estuviera mal.
    registrarPortales({ flota: FLOTA_B, abrirPagina });

    await conPortales({ flota: FLOTA_A, abrirPagina }, async () => {});

    expect(portalesVivos('tenant-a')).toEqual([]);
    expect(portalesVivos('tenant-b')).toEqual(['capufe']);
  });

  it('después del lote, facturar falla CERRADO y dice qué falta', async () => {
    await conPortales({ flota: FLOTA_A, abrirPagina }, async () => {});

    const r = await facturarConAgente({ tenantId: 'tenant-a', comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });
    expect(r.ok).toBe(false);
    expect(r.modo).toBe('emitir');
    expect(r.error).toContain('El lote de facturación ya cerró');
    // Lo que NO puede pasar: que devuelva ok con el receptor del lote anterior.
    expect(r.cfdiUuid).toBeUndefined();
  });
});

describe('la lista de portales conocidos', () => {
  it('dice qué sabe operar el código, aunque no haya nadie registrado', () => {
    expect(PORTALES_CONOCIDOS).toContain('capufe');
    // Son dos preguntas distintas y se responden distinto: "qué sé hacer" contra
    // "qué puedo hacer ahora con la flota que está cargada".
    expect(portalesVivos('tenant-a')).toEqual([]);
  });
});
