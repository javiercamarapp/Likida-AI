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
// ── EL PELIGRO DE ESTE ARCHIVO ERA QUE EL REGISTRO FUERA GLOBAL ──────────
//
// `ADAPTADORES` en `agente.ts` ERA un `Map` de módulo con clave `comercio`. O
// sea UNO por portal para todo el proceso — y en una función caliente de Vercel
// ese proceso atiende a varias flotas seguidas. Si la flota A registraba CAPUFE
// con su RFC y después llegaba un ticket de la flota B, `adaptadorDe('capufe')`
// devolvía el adaptador de A y el CFDI se emitía CON EL RFC DE OTRA EMPRESA.
//
// ESO YA NO PUEDE PASAR: el tenant va EN LA CLAVE del registro, y las firmas lo
// exigen sin default (`registrarAdaptador(tenantId, a)`,
// `adaptadorDe(tenantId, comercio)`). Quien lo olvide no compila.
//
// Lo de aquí deja de ser la defensa y pasa a ser lo que siempre debió ser: el
// CICLO DE VIDA de un lote. Sigue habiendo tres piezas y siguen valiendo:
//
//   · `registrarPortales` SIEMPRE sobrescribe. Nunca "si ya está, lo dejo": los
//     datos fiscales de una flota cambian (cambia de régimen, corrige su CP) y
//     un adaptador viejo cacheado factura con lo anterior.
//   · `exigirTenantRegistrado(tenantId)` LANZA si el lote abierto es de otra
//     flota. Ya no evita el CFDI ajeno —eso lo evita la clave— pero sí caza al
//     llamador que factura fuera de su lote, que es un bug igual.
//   · `conPortales()` deja un CENTINELA al terminar: un adaptador que no factura
//     nada y dice POR QUÉ. Sin él, `adaptadorDe` devolvería `null` y el mensaje
//     sería "todavía no hay adaptador para capufe" — que es el mismo texto que
//     se enseña cuando el portal de verdad no está escrito, y manda a buscar el
//     problema al sitio equivocado.
//
// ── DE DÓNDE SALE UN LOTE ────────────────────────────────────────────────
//
// `src/app/api/cron/facturar/route.ts`. Agrupa los gastos por flota y por
// portal, y por cada flota abre UN Chromium y envuelve su lote:
//
//     await conNavegador(async (abrirPagina) => {
//       await conPortales(
//         { flota: { tenantId, ...datosFiscales, correo }, abrirPagina },
//         async () => { …facturar los tickets de ESA flota… },
//       );
//     });
//
// UN NAVEGADOR POR FLOTA, no uno para toda la corrida: `SesionNavegador`
// comparte UN BrowserContext entre sus pestañas, o sea las cookies. CAPUFE
// reconoce la sesión entre códigos —que es lo que se quiere dentro de una
// flota— y por lo mismo podría recordar el RFC de la anterior si dos flotas
// compartieran contexto.
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
      registrarCapufe(op.flota.tenantId, {
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
 * QUÉ PORTALES SABE OPERAR EL CÓDIGO, independientemente de si hoy están
 * registrados para alguien.
 *
 * Se deriva de `TABLA` y por eso vive DEBAJO de ella: una segunda lista escrita
 * a mano es una lista que alguien olvida al agregar el segundo portal.
 *
 * Existe aparte de `portalesAutomatizados()` a propósito: aquella responde "qué
 * puedo hacer AHORA con la flota que está cargada", y esta "qué sé hacer". La
 * segunda es la que sirve para una pantalla de configuración; confundirlas es
 * cómo se acaba enseñándole al cliente una capacidad que su flota no tiene
 * habilitada.
 */
export const PORTALES_CONOCIDOS: readonly string[] = TABLA.map((p) => p.comercio);

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
  const tenantId = op.flota.tenantId;

  for (const portal of TABLA) {
    const falta = portal.revisar(op);
    if (falta.length > 0) {
      problemas.push(`${portal.comercio}: ${falta.join('; ')}`);
      // Y se pone un centinela EN SU LUGAR. Si esta flota venía de un lote
      // anterior con datos fiscales buenos y ahora ya no los tiene —se los
      // borraron, se corrigieron a medias—, dejar el adaptador viejo puesto sería
      // facturar con los datos de antes.
      registrarAdaptador(tenantId, centinela(portal.comercio, `Los datos fiscales de esta flota no sirven para facturar en ${portal.comercio}: ${falta.join('; ')}.`));
      ESTADO.set(marca(tenantId, portal.comercio), 'centinela');
      continue;
    }
    // Siempre sobrescribe. Ver el encabezado: "si ya está, lo dejo" es el bug.
    portal.registrar(op);
    ESTADO.set(marca(tenantId, portal.comercio), 'vivo');
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
 * Deja el registro DE ESA FLOTA inservible a propósito.
 *
 * Se sustituye por un centinela en vez de borrarlo (`olvidarAdaptadores`
 * existe y borra de verdad) porque el centinela dice POR QUÉ: `adaptadorDe`
 * sigue devolviendo algo y ese algo explica que el lote cerró, en vez de
 * convertirse en el "todavía no hay adaptador para capufe" que se enseña cuando
 * el portal de verdad no está escrito. Son dos problemas distintos y se
 * arreglan en sitios distintos.
 *
 * Lo que deja atrás es un objeto minúsculo por portal y por flota vista en este
 * proceso. Con un portal en la tabla eso es una entrada por flota y por
 * invocación caliente: no hace falta más ceremonia. Si algún día la tabla crece
 * y el proceso vive horas, `olvidarAdaptadores(tenantId)` de `agente.ts` libera
 * el cajón entero.
 */
export function olvidarPortales(tenantId: string): void {
  for (const portal of TABLA) {
    registrarAdaptador(tenantId, centinela(portal.comercio, `El lote de facturación ya cerró: hay que volver a registrar ${portal.comercio} con los datos fiscales de la flota antes de facturar otra vez.`));
    ESTADO.set(marca(tenantId, portal.comercio), 'centinela');
  }
  if (flotaVigente === tenantId) flotaVigente = null;
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
    olvidarPortales(op.flota.tenantId);
  }
}

/**
 * Los que están operables AHORA MISMO PARA ESA FLOTA, sin contar centinelas.
 *
 * Se cruza contra el registro de verdad (`portalesAutomatizados(tenantId)`) en
 * vez de devolver una lista propia: una segunda lista que se mantenga a mano se
 * desincroniza, y entonces esto afirmaría capacidades que el `Map` no tiene.
 */
export function portalesVivos(tenantId: string): string[] {
  return portalesAutomatizados(tenantId).filter((c) => ESTADO.get(marca(tenantId, c)) !== 'centinela');
}

// ═══════════════════════════════════════════════════════════════════════════

/**
 * Qué dejó puesto ESTE módulo en el registro, por flota y portal.
 *
 * El separador es un byte NULO y no un `|` ni un `:`: ningún identificador de
 * este sistema puede contener uno, así que la llave no se puede fabricar desde
 * fuera. Con un separador imprimible, un id que lo trajera haría que dos flotas
 * compartieran entrada y `portalesVivos` mentiría sobre cuál está operable — la
 * misma confusión que este archivo acaba de cerrar una capa más abajo.
 */
const ESTADO = new Map<string, 'vivo' | 'centinela'>();

const marca = (tenantId: string, comercio: string) => `${tenantId}\u0000${comercio}`;

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
