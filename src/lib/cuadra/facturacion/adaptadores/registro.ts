import { logger } from '@/lib/logger';
import { registrarAdaptador, portalesAutomatizados, type AdaptadorPortal, type ModoAgente } from '../agente';
import { registrarCapufe, revisarReceptor, type DatosReceptorCapufe, type OpcionesCapufe } from './capufe';
import type { FabricaDePagina } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// DÓNDE SE DECIDE QUÉ PORTALES SABE OPERAR EL AGENTE.
//
// `agente.ts` tiene el registro (`registrarAdaptador`, `adaptadorDe`,
// `portalesAutomatizados`) y `capufe.ts` tiene el adaptador — pero hasta este
// archivo NADIE llamaba a `registrarAdaptador` en producción. Verificado con
// grep antes de escribir esto: las únicas llamadas vivas eran la de
// `registrarCapufe()` (que hay que invocar, no se auto-registra) y una prueba.
//
// La consecuencia era exacta y silenciosa: `portalesAutomatizados()` devolvía
// `[]` siempre, así que `/api/cron/facturar` entraba por su rama de
// "no hay adaptadores", respondía 200 y quedaba VERDE en el panel de Vercel.
// Un cron en verde que no factura nada es peor que uno en rojo: nadie lo mira.
//
// ── POR QUÉ EL REGISTRO NO PUEDE SER DE NIVEL DE MÓDULO ──────────────────
//
// Porque un adaptador necesita DOS cosas que no existen al importar:
//
//   1. Una fábrica de páginas —o sea un navegador— que no debe arrancarse por el
//      hecho de importar un módulo, y que además no se puede bundlear a ciegas:
//      por eso este archivo NO importa `pagina_playwright.ts`. Recibe la fábrica
//      y así se puede probar entero sin Chromium.
//   2. LOS DATOS FISCALES DE LA FLOTA, que son por tenant.
//
// ── EL PELIGRO DE ESTE ARCHIVO: EL REGISTRO ES GLOBAL Y EL RFC NO ────────
//
// `ADAPTADORES` en `agente.ts` es un `Map` de módulo con clave `comercio`. O sea
// UNO por portal para todo el proceso — y en una función caliente de Vercel ese
// proceso atiende a varias flotas seguidas. Si la flota A registra CAPUFE con su
// RFC y después llega un ticket de la flota B sin registrar nada, `adaptadorDe`
// devuelve el adaptador de A y el CFDI se emite CON EL RFC DE OTRA EMPRESA. Es
// irreversible y es exactamente la clase de fuga entre tenants que este repo
// persigue en todos lados.
//
// Mientras `agente.ts` no lleve el tenant en la clave, la defensa vive aquí y
// son tres piezas:
//
//   · `registrarPortales` SIEMPRE sobrescribe. Nunca "si ya está, lo dejo": esa
//     optimización es justo el bug.
//   · `exigirTenantRegistrado(tenantId)` LANZA si el registro vigente es de otra
//     flota. Quien vaya a llamar a `facturarConAgente` debería llamarla antes.
//   · `conPortales()` deja un CENTINELA al terminar: un adaptador que no factura
//     nada y dice por qué. Así una llamada fuera de su lote falla cerrado en vez
//     de facturar con el receptor del lote anterior.
//
// ── LO QUE FALTA PARA QUE EL CRON DEJE DE SER UN NO-OP ───────────────────
//
// Una línea en `src/app/api/cron/facturar/route.ts` (y otra en `al_vuelo.ts`):
// traer los datos fiscales de la flota del gasto y envolver el lote en
// `conPortales`. No se hace aquí porque esos archivos son de otro agente en esta
// misma sesión. El esqueleto es:
//
//     await conPortales(
//       { flota: { tenantId, ...datosFiscales, correo }, abrirPagina },
//       async () => { …facturar los tickets de ESA flota… },
//     );
//
// donde `abrirPagina` sale de `conNavegador()` en `pagina_playwright.ts`, para
// que todo el lote comparta un solo Chromium.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los datos con los que se factura A NOMBRE de la flota.
 *
 * Los cinco fiscales son los mismos de `saas/fiscal.ts` (`tenant.rfc`,
 * `razon_social`, `regimen_fiscal`, `codigo_postal_fiscal`, `uso_cfdi`). El
 * CORREO no está ahí ni en `getConfig()`: hoy no hay columna para la dirección a
 * la que el portal manda el CFDI, así que tiene que entrar por aquí y el día que
 * exista la columna se lee de ella. Sin correo válido el portal emite y no manda
 * nada a ningún lado, y el ensayo pasaría igual.
 */
export interface FlotaFiscal extends DatosReceptorCapufe {
  /** De quién son estos datos. Es lo que impide facturarle a la flota de al lado. */
  tenantId: string;
}

export interface OpcionesRegistro {
  flota: FlotaFiscal;
  /** Cómo se consigue una página. En producción, `SesionNavegador.fabrica()`. */
  abrirPagina: FabricaDePagina;
  /** Ajustes por portal, para cuando uno resulte distinto en campo. */
  capufe?: Omit<Partial<OpcionesCapufe>, 'abrirPagina' | 'receptor'>;
}

export interface ResultadoRegistro {
  /** Los que quedaron operables para ESTA flota. Es lo que verá el cron. */
  registrados: string[];
  /** Por qué no quedó alguno. Vacío = todos entraron. */
  problemas: string[];
}

/**
 * QUÉ PORTALES SABE OPERAR EL CÓDIGO, independientemente de si hoy están
 * registrados para alguien.
 *
 * Existe aparte de `portalesAutomatizados()` a propósito: aquella responde "qué
 * puedo hacer AHORA con la flota que está cargada", y esta "qué sé hacer". La
 * segunda es la que sirve para una pantalla de configuración; confundirlas es
 * cómo se acaba enseñándole al cliente una capacidad que su flota no tiene
 * habilitada.
 */
export const PORTALES_CONOCIDOS: readonly string[] = obtenerConocidos();

/**
 * LA TABLA. Agregar un portal es agregar una entrada aquí y nada más.
 *
 * `revisar` va SEPARADO de `registrar` porque no todos los portales piden los
 * mismos datos: el día que entre uno que no necesite régimen fiscal, no puede
 * quedar fuera porque la flota no lo tenga capturado.
 */
const TABLA: ReadonlyArray<{
  comercio: string;
  /** Qué le falta a esta flota para poder facturar en ESTE portal. */
  revisar(op: OpcionesRegistro): string[];
  registrar(op: OpcionesRegistro): void;
}> = [
  {
    comercio: 'capufe',
    revisar: (op) => revisarReceptor(op.flota),
    registrar: (op) => {
      registrarCapufe({
        ...op.capufe,
        abrirPagina: op.abrirPagina,
        // Se copian los campos uno por uno y no con un spread de `op.flota`: así
        // el `tenantId` NO viaja dentro del receptor. Un objeto que lleva de todo
        // es cómo un identificador interno acaba impreso en un CFDI.
        receptor: {
          rfc: op.flota.rfc,
          nombre: op.flota.nombre,
          codigoPostal: op.flota.codigoPostal,
          regimenFiscal: op.flota.regimenFiscal,
          usoCfdi: op.flota.usoCfdi,
          correo: op.flota.correo,
        },
      });
    },
  },
];

/**
 * Se deriva de `TABLA` en vez de escribirse a mano: una segunda lista es una
 * lista que alguien va a olvidar de actualizar al agregar el segundo portal.
 * Va en función para poder declararse ARRIBA sin caer en la zona muerta de
 * `TABLA`, que es donde se lee.
 */
function obtenerConocidos(): readonly string[] {
  return TABLA.map((p) => p.comercio);
}

/** De qué flota son los adaptadores que están puestos ahora mismo. */
let flotaVigente: string | null = null;

/**
 * Deja el agente listo para facturarle a ESTA flota.
 *
 * NO LANZA cuando los datos fiscales no sirven: registra lo que pueda, devuelve
 * los problemas por escrito y deja el portal FUERA. Que un portal no aparezca en
 * `portalesAutomatizados()` significa "hoy no se puede facturar ahí", que es
 * verdad; registrarlo igual y fallar después significaría "se puede pero nunca
 * sale", que es la clase de verde que engaña.
 */
export function registrarPortales(op: OpcionesRegistro): ResultadoRegistro {
  const registrados: string[] = [];
  const problemas: string[] = [];

  for (const portal of TABLA) {
    const falta = portal.revisar(op);
    if (falta.length > 0) {
      problemas.push(`${portal.comercio}: ${falta.join('; ')}`);
      // Y se pone un centinela EN SU LUGAR. Si el proceso venía con el adaptador
      // de otra flota puesto, dejarlo ahí sería facturarle a la flota anterior
      // con los tickets de esta.
      registrarAdaptador(centinela(portal.comercio, `Los datos fiscales de esta flota no sirven para facturar en ${portal.comercio}: ${falta.join('; ')}.`));
      ESTADO.set(portal.comercio, 'centinela');
      continue;
    }
    // Siempre sobrescribe. Ver el encabezado: "si ya está, lo dejo" es el bug.
    portal.registrar(op);
    ESTADO.set(portal.comercio, 'vivo');
    registrados.push(portal.comercio);
  }

  flotaVigente = op.flota.tenantId;
  logger.info('facturacion.portales_registrados', {
    tenant: op.flota.tenantId,
    registrados: registrados.join(','),
    problemas: problemas.length,
  });

  return { registrados, problemas };
}

/** Para quién están puestos los adaptadores. `null` = para nadie. */
export function tenantRegistrado(): string | null {
  return flotaVigente;
}

/**
 * El candado que hay que echar ANTES de facturar.
 *
 * Lanza —y no devuelve `false`— porque el llamador que se olvide de mirar el
 * booleano emitiría un CFDI a nombre de otra empresa. Un error que sube es
 * ruidoso; un `false` ignorado es irreversible.
 */
export function exigirTenantRegistrado(tenantId: string): void {
  if (flotaVigente === tenantId) return;
  throw new Error(
    flotaVigente === null
      ? `No hay portales registrados: hay que llamar a registrarPortales() con los datos fiscales de la flota ${tenantId} antes de facturar.`
      : `Los adaptadores de portal están puestos para OTRA flota (${flotaVigente}), no para ${tenantId}. Facturar así emitiría el CFDI con el RFC de la otra empresa.`,
  );
}

/**
 * Deja el registro inservible a propósito.
 *
 * No se puede BORRAR —`agente.ts` no exporta forma de quitar del `Map`— así que
 * se sustituye por un centinela, que es mejor de todos modos: `adaptadorDe`
 * sigue devolviendo algo y ese algo explica qué falta, en vez de convertirse en
 * el "todavía no hay adaptador para capufe" que ya se enseña cuando el portal
 * de verdad no existe.
 */
export function olvidarPortales(): void {
  for (const portal of TABLA) {
    registrarAdaptador(centinela(portal.comercio, `El lote de facturación ya cerró: hay que volver a registrar ${portal.comercio} con los datos fiscales de la flota antes de facturar otra vez.`));
    ESTADO.set(portal.comercio, 'centinela');
  }
  flotaVigente = null;
}

/**
 * UN LOTE DE FACTURACIÓN, de una flota, con su registro puesto y retirado.
 *
 * El `finally` es la razón de que exista: sin él, los adaptadores de la última
 * flota se quedan puestos hasta que otra los pise, y la siguiente invocación de
 * la misma instancia caliente factura con el receptor de quien pasó antes.
 */
export async function conPortales<T>(
  op: OpcionesRegistro,
  fn: (registro: ResultadoRegistro) => Promise<T>,
): Promise<T> {
  const registro = registrarPortales(op);
  try {
    return await fn(registro);
  } finally {
    olvidarPortales();
  }
}

/**
 * Los que están operables AHORA MISMO, sin contar centinelas.
 *
 * Se cruza contra el registro de verdad (`portalesAutomatizados()`) en vez de
 * devolver una lista propia: una segunda lista que se mantenga a mano se
 * desincroniza, y entonces esto afirmaría capacidades que el `Map` no tiene.
 */
export function portalesVivos(): string[] {
  return portalesAutomatizados().filter((c) => ESTADO.get(c) !== 'centinela');
}

// ═══════════════════════════════════════════════════════════════════════════

/** Qué dejó puesto ESTE módulo en el registro global. */
const ESTADO = new Map<string, 'vivo' | 'centinela'>();

/**
 * Un adaptador que no factura y dice por qué.
 *
 * NO LANZA: `AdaptadorPortal.facturar` promete un `ResultadoAgente`, y el
 * llamador ya sabe leer `ok: false` con un `error` escrito para una persona.
 * Lanzar aquí mandaría este caso —que es de configuración— por el camino de los
 * errores inesperados.
 */
function centinela(comercio: string, motivo: string): AdaptadorPortal {
  return {
    comercio,
    portal: '',
    facturar: async (_campos, modo: ModoAgente) => ({
      modo: modo === 'emitir' ? 'emitir' : 'ensayo',
      ok: false,
      capturado: {},
      error: motivo,
    }),
  };
}
