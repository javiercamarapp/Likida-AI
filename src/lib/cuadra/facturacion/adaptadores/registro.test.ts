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
// El registro de `agente.ts` es un `Map` de MÓDULO con clave `comercio`: uno por
// portal para todo el proceso. En una función caliente de Vercel ese proceso
// atiende a varias flotas seguidas, así que "quién quedó registrado" no es un
// detalle de implementación: es el RFC que va impreso en un CFDI irreversible.
//
// De ahí que la mitad de estas pruebas no miren si se registra, sino si se
// DESREGISTRA — y qué pasa cuando alguien factura fuera de su lote.
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
  // Empezar cada una desde "nadie registrado" es parte de lo que se prueba.
  olvidarPortales();
});

describe('registrarPortales', () => {
  it('deja CAPUFE operable — que es lo que hacía que el cron fuera un no-op', () => {
    // Antes de registrar, `portalesAutomatizados()` no tiene un solo portal vivo:
    // ese `[]` es el que ponía el cron en verde sin facturar nada.
    expect(portalesVivos()).toEqual([]);

    const r = registrarPortales({ flota: FLOTA_A, abrirPagina });

    expect(r.registrados).toEqual(['capufe']);
    expect(r.problemas).toEqual([]);
    expect(portalesVivos()).toEqual(['capufe']);
    expect(portalesAutomatizados()).toContain('capufe');
    expect(adaptadorDe('capufe')?.portal).toContain('facturacionrapida');
  });

  it('el adaptador queda con el receptor de ESA flota, no con el del registro anterior', async () => {
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    expect(registrarPortales({ flota: FLOTA_B, abrirPagina }).registrados).toEqual(['capufe']);

    // El receptor es privado, pero lo que se escribió en el portal no:
    // `capturado` lleva campo por campo lo que se tecleó. Es la evidencia de a
    // nombre de quién iba a salir el CFDI.
    const r = await facturarConAgente({ comercio: 'capufe', campos: CAMPOS });
    expect(r.capturado.rfc).toBe(FLOTA_B.rfc);
    expect(r.capturado.nombre).toBe(FLOTA_B.nombre);
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
    expect(portalesVivos()).toEqual([]);

    // Aun así hay adaptador, y lo que hace es explicarse. No lanza.
    const salida = await facturarConAgente({ comercio: 'capufe', campos: CAMPOS });
    expect(salida.ok).toBe(false);
    expect(salida.modo).toBe('ensayo');
    expect(salida.error).toContain('no sirven para facturar');
  });

  it('registrar para otra flota SOBRESCRIBE (nunca "si ya está, lo dejo")', () => {
    registrarPortales({ flota: FLOTA_A, abrirPagina });
    expect(tenantRegistrado()).toBe('tenant-a');

    registrarPortales({ flota: FLOTA_B, abrirPagina });
    expect(tenantRegistrado()).toBe('tenant-b');
    // Si esto se "optimizara" saltándose el registro repetido, la flota B
    // facturaría con el RFC de la A. Por eso el candado es una prueba y no un
    // comentario.
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
      return portalesVivos();
    });

    expect(dentro).toEqual(['capufe']);
    expect(tenantRegistrado()).toBeNull();
    expect(portalesVivos()).toEqual([]);
  });

  it('desregistra AUNQUE el lote reviente', async () => {
    await expect(
      conPortales({ flota: FLOTA_A, abrirPagina }, async () => {
        throw new Error('el portal se cayó a media sesión');
      }),
    ).rejects.toThrow('el portal se cayó a media sesión');

    // Sin el `finally`, los adaptadores de esta flota se quedan puestos y la
    // siguiente invocación de la misma instancia caliente factura con SU RFC.
    expect(tenantRegistrado()).toBeNull();
    expect(portalesVivos()).toEqual([]);
  });

  it('después del lote, facturar falla CERRADO y dice qué falta', async () => {
    await conPortales({ flota: FLOTA_A, abrirPagina }, async () => {});

    const r = await facturarConAgente({ comercio: 'capufe', campos: CAMPOS, modo: 'emitir' });
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
    expect(portalesVivos()).toEqual([]);
  });
});
