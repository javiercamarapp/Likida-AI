import { createHash, randomBytes } from 'node:crypto';
import { DatoInvalido } from './errores';
import { hoyMx, mxn, round2, TOLERANCIA_ABONO_MXN } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL PORTAL DE PAGO — LA PARTE QUE NO TOCA LA BASE.
//
// Todo lo de este archivo es puro: se le entra con strings y se sale con
// valores. Vive aparte de `portal_pago_lectura.ts` y `portal_pago_escritura.ts`
// por la misma razón que `llave-api.ts` vive aparte de su escritura: lo que
// decide si un token vale corre en CADA visita a una página pública, y no
// puede depender de que una pantalla del panel no se haya desestabilizado.
//
// ── QUÉ ES ESTE PORTAL, Y QUÉ NO ES ──────────────────────────────────────
//
// El cliente de la flota abre `/pago/<token>` y ve UNA factura: la suya. Ahí
// puede REGISTRAR el pago que ya hizo por su banco — fecha, monto, referencia.
// No hay pasarela, no hay cargo, no se procesa un peso. "Portal de pago"
// describe para qué sirve; llamarle así no lo convierte en un cobrador.
//
// Y lo que registra NO salda nada. Entra como PROPUESTA, en una tabla que la
// cartera no lee, y espera a que el contralor la concilie contra su estado de
// cuenta. La conciliación propone; el humano confirma. Si el formulario
// escribiera en `pago_recibido`, cualquiera con el link podría dejar una
// factura en ceros tecleando un número, y el saldo que el contralor cruza
// contra su banco dejaría de ser una medición para volverse un rumor.
//
// ── POR QUÉ EL TOKEN VA EN LA URL, QUE ES LO QUE `admin-context.ts` PROHÍBE ──
//
// Ese archivo dice, con razón, que "un query param no es fuente de
// autorización". La diferencia aquí es de qué autoriza: aquel token elegía
// QUÉ FLOTA ve un superadmin ya autenticado —una escalada de alcance dentro
// de una sesión— y por eso tenía que ir firmado y en cookie. Éste es la
// credencial COMPLETA de alguien que no tiene ni va a tener cuenta: el
// cliente de la flota. Es la misma figura que un enlace de restablecer
// contraseña o una invitación (`invitacion`, 0053), y se defiende igual:
//   · 32 bytes de `randomBytes` — no se adivina;
//   · en la base vive su sha256, no él (mig. 0228) — un volcado no abre nada;
//   · caduca por fecha declarada y es revocable en un clic;
//   · su alcance es UNA factura, así que ni robado sirve para listar otras;
//   · la página va `noindex, nofollow` y sin `Referer` hacia fuera.
// Lo que NO se puede evitar es que el link viva en el historial del navegador
// del cliente y en el correo donde se lo mandaron. Por eso caduca, y por eso
// lo que hay del otro lado es lectura de una factura y un formulario que
// propone — nunca una acción que mueva dinero.
// ═══════════════════════════════════════════════════════════════════════════

/** El prefijo fijo, para reconocer un token de portal de un vistazo en un log
 *  o en un pegado accidental — mismo criterio que `lk_live_` de las llaves. */
export const PREFIJO_TOKEN = 'pgo_';

/** Cuántos caracteres del cuerpo se guardan EN CLARO, para que el contralor
 *  reconozca en su pantalla cuál liga está revocando. No es secreto. */
export const LARGO_PISTA = 8;

/**
 * La vigencia por omisión de una liga.
 *
 * 90 días y no "para siempre": el link acaba escrito en un correo reenviado y
 * en el ERP del cliente. Sin fecha de muerte, la única forma de cerrarlo sería
 * que alguien se acordara de revocarlo — y nadie se acuerda de revocar algo
 * que sigue funcionando.
 */
export const DIAS_VIGENCIA_DEFAULT = 90;
const DIAS_VIGENCIA_MIN = 1;
const DIAS_VIGENCIA_MAX = 365;

export interface TokenNuevo {
  /** El token COMPLETO. Se enseña UNA vez y no se vuelve a poder leer. */
  enClaro: string;
  /** Los primeros caracteres, lo que sí se guarda en claro. */
  prefijo: string;
  /** sha256 hex. Es lo único que viaja a la base. */
  hash: string;
}

/**
 * Un token nuevo. 32 bytes de `randomBytes` — no `Math.random`, cuyo estado se
 * reconstruye observando salidas, y que aquí abriría la factura de un cliente.
 */
export function generarTokenPortal(): TokenNuevo {
  const cuerpo = randomBytes(32).toString('base64url');
  const enClaro = `${PREFIJO_TOKEN}${cuerpo}`;
  return {
    enClaro,
    prefijo: `${PREFIJO_TOKEN}${cuerpo.slice(0, LARGO_PISTA)}`,
    hash: hashDeToken(enClaro),
  };
}

export function hashDeToken(enClaro: string): string {
  return createHash('sha256').update(enClaro, 'utf8').digest('hex');
}

/**
 * El prefijo con el que se busca el candidato en la base, o `null` si la
 * cadena ni siquiera tiene forma de token.
 *
 * Sin forma no se consulta: una ráfaga de basura contra `/pago/loquesea` no
 * debe poder gastar el presupuesto de lecturas de Supabase.
 */
export function prefijoDeToken(enClaro: string): string | null {
  const t = enClaro.trim();
  if (!t.startsWith(PREFIJO_TOKEN)) return null;
  const cuerpo = t.slice(PREFIJO_TOKEN.length);
  if (cuerpo.length < LARGO_PISTA) return null;
  // base64url y nada más: un token con `/`, `+` o `%` no salió de aquí, y
  // dejarlo pasar sería mandar a la base lo que un atacante quiera escribir.
  if (!/^[A-Za-z0-9_-]+$/.test(cuerpo)) return null;
  return `${PREFIJO_TOKEN}${cuerpo.slice(0, LARGO_PISTA)}`;
}

/** Cuántos días vive una liga, según la configuración. Fuera de rango o
 *  ilegible → el default, nunca un valor absurdo: `0` dejaría ligas muertas al
 *  nacer y `999999` es "para siempre" escrito de otra forma. */
export function diasDeVigencia(crudo: string | undefined = process.env.PORTAL_PAGO_DIAS_VIGENCIA): number {
  const n = Number(crudo);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DIAS_VIGENCIA_DEFAULT;
  if (n < DIAS_VIGENCIA_MIN || n > DIAS_VIGENCIA_MAX) return DIAS_VIGENCIA_DEFAULT;
  return n;
}

/** El instante en que caduca una liga que nace ahora. */
export function expiracionDesde(ahora: Date, dias: number = diasDeVigencia()): string {
  return new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000).toISOString();
}

export type EstadoLiga = 'vigente' | 'revocada' | 'expirada';

/**
 * En qué estado está una liga. El orden importa: una liga revocada Y caducada
 * se reporta como REVOCADA, porque eso es lo que un humano decidió y es lo que
 * el contralor tiene que ver en su pantalla.
 */
export function estadoLiga(
  liga: { expira_en: string; revocada_en: string | null },
  ahora: Date = new Date(),
): EstadoLiga {
  if (liga.revocada_en) return 'revocada';
  const expira = Date.parse(liga.expira_en);
  // Una fecha de caducidad ilegible se trata como CADUCADA. Fallar cerrado:
  // el modo de falla contrario abriría una factura por un dato corrupto.
  if (!Number.isFinite(expira)) return 'expirada';
  return ahora.getTime() >= expira ? 'expirada' : 'vigente';
}

/**
 * El ÚNICO texto que ve quien llega con un token que no sirve — no exista, esté
 * caducado, esté revocado o sea basura.
 *
 * Es el mismo para los cuatro casos A PROPÓSITO. "Este enlace expiró" le
 * confirma a quien prueba tokens que acertó uno; "no encontramos ese enlace"
 * le dice que no. Con un solo texto, probar no enseña nada. Es la misma
 * decisión que toma `resolverLlave` con su 401 uniforme, y la que toma
 * `/aviso/[tenant]` al no distinguir "no existe" de "está a medias".
 */
export const TEXTO_LIGA_NO_VALIDA =
  'Este enlace no está disponible. Puede haber caducado o haber sido reemplazado por uno nuevo. Pídele a quien te lo envió que te comparta el enlace vigente.';

// ── EL FORMULARIO DEL CLIENTE ──────────────────────────────────────────────

/**
 * Las formas de pago que el portal ofrece. Lista CERRADA y corta: el campo
 * acaba en `pago_recibido.metodo` cuando el contralor concilia, y ahí un texto
 * libre tecleado por un tercero se vuelve una columna que nadie puede agrupar.
 */
export const METODOS_PORTAL = [
  { id: 'transferencia', rotulo: 'Transferencia (SPEI)' },
  { id: 'deposito', rotulo: 'Depósito en ventanilla' },
  { id: 'cheque', rotulo: 'Cheque' },
  { id: 'efectivo', rotulo: 'Efectivo' },
  { id: 'otro', rotulo: 'Otro' },
] as const;

export type MetodoPortal = (typeof METODOS_PORTAL)[number]['id'];

export function esMetodoPortal(v: string): v is MetodoPortal {
  return METODOS_PORTAL.some((m) => m.id === v);
}

export interface PropuestaCruda {
  fecha: string;
  monto: string;
  referencia: string;
  metodo: string;
}

export interface PropuestaValida {
  fecha: string;
  monto: number;
  referencia: string;
  metodo: MetodoPortal;
}

/** El contexto REAL contra el que se valida. `saldo: null` significa NO SE
 *  PUDO SABER — y entonces no se acepta nada (ver `validarPropuesta`). */
export interface ContextoFactura {
  /** `YYYY-MM-DD` de la factura: nadie paga antes de que le facturen. */
  fechaFactura: string;
  /** El saldo REAL de `factura_saldo`. `null` = no se pudo leer. */
  saldo: number | null;
  /** Hoy en México. Se inyecta para que la prueba no dependa del reloj. */
  hoy?: string;
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REFERENCIA_MIN = 3;
const REFERENCIA_MAX = 80;

/** Dígitos y nada más. Sin cuantificadores anidados a propósito: una expresión
 *  con dos niveles de repetición sobre texto que llega de una página pública es
 *  una puerta de ReDoS, y el reglón de este portal es que lo público no puede
 *  costar tiempo ilimitado. Por eso las ortografías de abajo se comprueban
 *  partiendo la cadena, no con una expresión que las describa entera. */
const SOLO_DIGITOS = /^[0-9]+$/;

/**
 * ¿La parte entera está bien escrita?
 *
 * Las DOS formas buenas: `1234` (sin separadores) y `1,234` (coma de millares
 * en grupos de exactamente tres). Cualquier otra cosa —`1,16`, `11,60`,
 * `1.234`— es ambigua, y lo ambiguo se rechaza.
 */
function enteroSano(entero: string): boolean {
  const grupos = entero.split(',');
  if (!grupos.every((g) => SOLO_DIGITOS.test(g))) return false;
  if (grupos.length === 1) return true;
  if (grupos[0].length < 1 || grupos[0].length > 3) return false;
  return grupos.slice(1).every((g) => g.length === 3);
}

/**
 * El instructivo que se le da a quien tecleó algo que no se entiende. Se dice
 * CÓMO escribirlo en vez de solo "está mal": el cliente está mirando el
 * comprobante de su banco y lo único que quiere es copiar una cifra.
 */
const COMO_ESCRIBIR_EL_MONTO =
  'Escríbelo con punto para los centavos y sin puntos de millares, así: 1234.50';

/**
 * Un monto tecleado por una persona, o un error que dice cómo escribirlo.
 *
 * AUDITORÍA 7, `c7-14` — antes esto barría `$`, espacios y COMAS y le dejaba a
 * `Number` adivinar el resto. Un cliente que pega «1.234,50» desde su banca
 * —punto de millares, coma decimal— acababa registrando **$1.23** por un
 * depósito de **$1,234.50**, sin una sola advertencia: la coma se borraba,
 * quedaba `"1.23450"`, y `Number` leía un punto decimal donde había un
 * separador de millares. Verificado también: `"1.234"` daba 1.23, `"1e4"` daba
 * 10000 y `"0x10"` daba 16 — `Number` acepta notación científica y hexadecimal,
 * que nadie teclea en una caja de pesos.
 *
 * La corrección no es adivinar mejor: es NO ADIVINAR. Se aceptan exactamente
 * dos ortografías (`1234.50` y `1,234.50`) y todo lo demás se rechaza diciendo
 * cómo escribirlo. Una cifra ambigua sobre dinero de un tercero se pregunta,
 * no se interpreta — y la que más caro sale es justo la que "casi" funciona.
 *
 * `c7-33` va en la misma línea: el redondeo era `Math.round(n * 100) / 100`,
 * reimplementado a mano, que es el caso que `round2()` documenta como ALTO
 * REINCIDENTE (`Math.round(1.005 * 100) / 100` da 1, no 1.01). Ahora se usa el
 * redondeo de la casa. Con el filtro de arriba ya no entran tres decimales,
 * pero el redondeo correcto no depende de que el filtro nunca cambie.
 */
export function montoTecleado(crudo: string, queEs = 'el monto que pagaste'): number {
  const limpio = crudo.replace(/[$\s]/g, '');
  if (limpio === '') throw new DatoInvalido(`Escribe ${queEs}.`);

  const partes = limpio.split('.');
  const centavos = partes.length === 2 ? partes[1] : '';
  const malEscrito =
    // Dos puntos decimales no son un monto; son un monto y una duda.
    partes.length > 2
    || !enteroSano(partes[0])
    // Los centavos son DOS dígitos. Un tercero suele ser el separador de
    // millares de otra ortografía («1.234» son mil doscientos treinta y cuatro
    // pesos para media América Latina, y 1.23 para `Number`).
    || (partes.length === 2 && (centavos.length > 2 || !SOLO_DIGITOS.test(centavos)));
  if (malEscrito) {
    throw new DatoInvalido(`Ese monto no se entiende. ${COMO_ESCRIBIR_EL_MONTO}`);
  }

  const n = Number(limpio.replace(/,/g, ''));
  // Cinturón y tirantes: las dos expresiones de arriba ya excluyen todo lo que
  // `Number` podría leer como NaN o Infinity, y aun así no se devuelve una
  // cifra de dinero sin comprobar que es finita.
  if (!Number.isFinite(n)) {
    throw new DatoInvalido(`Ese monto no se entiende. ${COMO_ESCRIBIR_EL_MONTO}`);
  }
  return round2(n);
}

/**
 * Valida lo que el cliente tecleó, contra la factura REAL.
 *
 * FALLA CERRADO CUANDO NO SABE. Si `saldo` viene `null` —la lectura de
 * `factura_saldo` no se pudo hacer— NO se acepta el registro. La tentación es
 * "guárdalo de todas formas, ya lo revisará el contralor"; el problema es que
 * sin saldo tampoco se puede decir en pantalla cuánto debe, así que el cliente
 * estaría tecleando a ciegas contra una cifra que nadie verificó. Es preferible
 * decirle que vuelva en un rato.
 */
export function validarPropuesta(c: PropuestaCruda, ctx: ContextoFactura): PropuestaValida {
  if (ctx.saldo === null) {
    throw new DatoInvalido(
      'Ahora mismo no podemos mostrar el saldo de esta factura, así que tampoco podemos registrar tu pago. Vuelve a intentarlo en unos minutos.',
    );
  }

  const fecha = c.fecha.trim();
  if (!RE_FECHA.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) {
    throw new DatoInvalido('La fecha del pago no se entiende. Usa el calendario.');
  }
  const hoy = ctx.hoy ?? hoyMx();
  if (fecha > hoy) {
    throw new DatoInvalido('La fecha del pago no puede ser posterior a hoy.');
  }
  if (fecha < ctx.fechaFactura) {
    throw new DatoInvalido(
      `La fecha del pago no puede ser anterior a la de la factura (${ctx.fechaFactura}). Revisa el comprobante de tu banco.`,
    );
  }

  const monto = montoTecleado(c.monto);
  if (monto <= 0) throw new DatoInvalido('El monto tiene que ser mayor que cero.');
  // LA MISMA TOLERANCIA QUE LA BASE, importada de un solo sitio.
  //
  // AUDITORÍA 7, `c7-6`: aquí decía `+ 0.01` y `registrar_pago_tx` dice
  // `+ 0.005`. El comentario que lo justificaba citaba `factura_total_cuadra`
  // (0049), que es la holgura de `total = subtotal + iva` — otra pregunta. Con
  // un saldo de $1,160.00 y un tecleo de $1,160.01, el portal aceptaba y la RPC
  // rechazaba: propuesta INCONCILIABLE para siempre, con el dinero ya
  // depositado y el cliente viendo «por confirmar» sin fecha. Que el portal sea
  // MÁS estricto que la base no puede pasar tampoco, y por eso no se copia el
  // número: se importa.
  if (monto > ctx.saldo + TOLERANCIA_ABONO_MXN) {
    throw new DatoInvalido(
      `El saldo pendiente de esta factura es ${mxn(ctx.saldo)}. Si pagaste de más, o si ese depósito cubre varias facturas, escríbele directamente a quien te la emitió: aquí solo se puede registrar el pago de ESTA factura.`,
    );
  }

  const referencia = c.referencia.trim();
  if (referencia.length < REFERENCIA_MIN) {
    throw new DatoInvalido(
      'Escribe la referencia bancaria de tu pago (la clave de rastreo, el número de operación o el folio del depósito). Sin ella nadie puede encontrar el movimiento.',
    );
  }
  if (referencia.length > REFERENCIA_MAX) {
    throw new DatoInvalido(`La referencia no puede pasar de ${REFERENCIA_MAX} caracteres.`);
  }

  const metodo = c.metodo.trim();
  if (!esMetodoPortal(metodo)) {
    throw new DatoInvalido('Elige cómo pagaste.');
  }

  return { fecha, monto, referencia, metodo };
}

/**
 * Cómo se normaliza una referencia para comparar dos registros.
 *
 * Espeja EXACTAMENTE el índice `portal_pago_propuesta_unica_pendiente` (0237,
 * que corrigió el de la 0228: `upper(btrim(referencia))`, ahora anclado a la
 * FACTURA y solo sobre las PENDIENTES). Se escribe aquí para que el mensaje de
 * "ya lo registraste" pueda armarse sin ir a la base, pero la garantía la da el
 * índice: esta función es la explicación, no el candado.
 */
export function normalizarReferencia(r: string): string {
  return r.trim().toUpperCase();
}

/**
 * El honeypot. Un campo que ninguna persona ve y que casi todo bot llena.
 *
 * Devuelve true si hay que descartar EN SILENCIO — contestando 200, como hace
 * `/api/marketing/prospecto`: avisarle al bot que lo cachamos es enseñarle a
 * esquivarlo la próxima vez.
 */
export function esCarnada(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim() !== '';
}

/**
 * Cómo se nombra una factura para un humano.
 *
 * El folio (con su serie) es lo que el cliente tiene impreso en su papel; el
 * UUID es el respaldo cuando no hay folio; y «sin folio» es la VERDAD cuando no
 * hay ninguno de los dos — no un guion, que en una pantalla de cobranza se lee
 * como un dato que no se pudo cargar.
 */
export function identificaFactura(
  f: { serie: string | null; folio: string | null; cfdiUuid: string | null },
): string {
  if (f.folio) return f.serie ? `${f.serie}-${f.folio}` : f.folio;
  if (f.cfdiUuid) return f.cfdiUuid;
  return 'sin folio';
}

/**
 * El texto de la caja del REP, según lo que de verdad hay.
 *
 * Cuatro estados y ninguno se disfraza del otro: sin REP todavía (el contralor
 * aún no lo registra), UN REP con XML (hay archivo que bajar), UN REP sin XML
 * (solo existe el folio fiscal) y VARIOS, que es lo normal en una factura
 * pagada en parcialidades. El tercero es el que se presta a mentir: un botón
 * de descarga que no baja nada es peor que no ofrecerlo.
 *
 * AUDITORÍA 7, `c7-16` — antes esto recibía UN rep y decía «Tu complemento de
 * pago ya está listo» en singular sobre una factura que podía tener tres. Los
 * complementos 1 y 2 —los que el contador del cliente necesita para acreditar
 * el IVA de esos meses— no tenían ninguna ruta que los entregara, y la página
 * ni siquiera decía que existían.
 */
export function textoDelRep(reps: Array<{ cfdi_uuid: string; tieneXml: boolean }>): string {
  if (reps.length === 0) {
    return 'Cuando tu pago quede conciliado y su complemento (REP) esté timbrado, aparecerá aquí.';
  }
  if (reps.length > 1) {
    const conXml = reps.filter((r) => r.tieneXml).length;
    const cuantos = `Esta factura tiene ${reps.length} complementos de pago: uno por cada pago que se le aplicó.`;
    if (conXml === reps.length) {
      return `${cuantos} Abajo está cada uno con su folio fiscal, y puedes descargar su XML por separado.`;
    }
    if (conXml === 0) {
      return `${cuantos} Abajo está cada uno con su folio fiscal citable. Los archivos XML no están cargados en Likida: pídeselos a quien te emitió la factura citando esos folios.`;
    }
    return `${cuantos} Abajo está cada uno con su folio fiscal. De ${conXml} hay XML para descargar aquí; el resto tienes que pedírselo a quien te emitió la factura, citando su folio.`;
  }
  const rep = reps[0];
  if (rep.tieneXml) {
    return 'Tu complemento de pago ya está listo. Puedes descargar el XML desde esta misma página.';
  }
  return `Tu complemento de pago ya está timbrado. Su folio fiscal (UUID) es ${rep.cfdi_uuid}. El archivo XML no está cargado en Likida: pídeselo a quien te emitió la factura citando ese folio.`;
}
