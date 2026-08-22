// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES Y TARIFAS — a quién le mueve la carga la flota, y a qué precio.
//
// La 0048 se llama, textualmente, "EL LADO DEL INGRESO", y creó `cliente`,
// `tarifa`, `viaje.cliente_id`, `viaje.ingreso_flete` y `viaje.km_recorridos`.
// Las tablas llevan desde entonces APLICADAS Y VACÍAS: `comercial.ts` sabe
// LEERLAS (`getCartera`, `getRentabilidad`, `getCobranza`) y nadie sabe
// ESCRIBIRLAS. Una tabla que solo se lee produce pantallas que solo pueden
// decir "todavía no hay dato" — el ingreso de la flota no entra a Likida por
// falta de esquema, entra por falta de captura.
//
// ESTE MÓDULO ES LA CAPTURA. Lo que NO es: un segundo `getCartera`. Ese ya
// existe y se reusa tal cual; aquí solo se le cuelgan las dos cosas que le
// faltaban para que la pantalla sirva — el saldo por cobrar de cada cliente y
// el catálogo de tarifas — y las cuatro escrituras (alta y edición de cliente,
// alta y edición de tarifa).
//
// ── LAS TRES REGLAS QUE GOBIERNAN CADA LÍNEA DE AQUÍ ──────────────────────
//
// 1. UN `null` NO ES UN `0`. `dias_credito` vacío es "no pactado", no
//    "contado"; un cliente sin facturas tiene saldo DESCONOCIDO, no cero; una
//    tarifa por km sin km capturados no cotiza $0, no cotiza. La migración lo
//    dice en sus propios comentarios y es la mitad del valor del producto: el
//    contralor cruza esto contra su PDF.
//
// 2. LA ESPECIFICIDAD DE UNA TARIFA SE DECIDE, NO SE ADIVINA. Con tarifa de
//    lista y tarifa negociada conviviendo, "cuál aplica" tiene una respuesta
//    correcta y varias plausibles. `tarifaSugerida` la elige con una regla
//    escrita y probada, y cuando dos empatan LO DICE en vez de escoger una en
//    silencio: cotizar de más pierde el flete, cotizar de menos lo pierde con
//    trabajo hecho.
//
// 3. EL `tenant_id` NUNCA VIENE DEL FORMULARIO. Va por closure desde la
//    sesión, y toda escritura que toque una fila existente la ancla con
//    `.eq('tenant_id', ...)` Y comprueba que haya tocado algo: un UPDATE que
//    no encontró nada es indistinguible de uno exitoso si nadie mira las filas
//    devueltas, y así es como un "guardado" se reporta sobre la flota de otro.
//    Es la lección de `crearViaje` (operacion.ts) con `operador_id`: el
//    `tenant_id` del INSERT acota la fila NUEVA, jamás la llave foránea que se
//    escribe dentro.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora, type EntidadBitacora } from '@/lib/likida/bitacora_escritura';
import { conteo, traerTodo } from './pg';
import { acotada } from './presupuesto';
// `getCartera` ya resuelve viajes e ingreso por cliente, con su regla de
// `null` ≠ 0 escrita y comentada. Reescribirla aquí sería una segunda
// oportunidad de escribir mal exactamente el conteo que da la concentración.
import { getCartera, type ClienteRow } from './comercial';
import { DatoInvalido } from './errores';
import { esRfcValido, esUuidValido, rfcChecksumOk } from './intake/cfdi';
import { round2, TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA — sin una sola consulta. Es la que se prueba y la que corre
// idéntica en el servidor (donde manda) y en cualquier vista previa.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los tres modos que admite `tarifa_modo_dominio` (0048).
 *
 * El comentario de la migración lo dice mejor que nadie: los tres caben en una
 * sola tabla porque el precio cambia de UNIDAD, no de naturaleza. Lo que sí
 * cambia por modo es QUÉ DATO DEL VIAJE hace falta para convertir el precio en
 * un monto — y ahí está el filo: `por_viaje` no necesita nada, `por_km`
 * necesita `viaje.km_recorridos`, y `por_tonelada` necesita un dato que HOY EL
 * ESQUEMA NO GUARDA EN NINGUNA PARTE (ver `CriterioTarifa.toneladas`).
 */
export const MODOS_TARIFA = [
  {
    valor: 'por_viaje', rotulo: 'Por viaje', unidad: 'MXN por viaje',
    detalle: 'Precio cerrado de la ruta. No necesita ningún otro dato del viaje.',
  },
  {
    valor: 'por_km', rotulo: 'Por kilómetro', unidad: 'MXN por km',
    detalle: 'Se multiplica por los kilómetros del viaje. Sin km capturados no se puede cotizar.',
  },
  {
    valor: 'por_tonelada', rotulo: 'Por tonelada', unidad: 'MXN por tonelada',
    detalle: 'Se multiplica por las toneladas de la carga. Likida todavía no guarda el tonelaje del viaje: hay que teclearlo.',
  },
] as const;

export type ModoTarifa = (typeof MODOS_TARIFA)[number]['valor'];

export function esModoTarifa(v: string): v is ModoTarifa {
  return MODOS_TARIFA.some((m) => m.valor === v);
}

/**
 * Topes de precio POR MODO, para atrapar el dedazo.
 *
 * No son gustos ni límites de la base (`numeric(12,2)` aguanta diez cifras
 * enteras): son el orden de magnitud del negocio. Un cero de más en una tarifa
 * por kilómetro convierte $28/km en $280/km y cotiza el flete diez veces
 * arriba — y como el número resultante sigue viéndose como dinero, nadie lo
 * ve raro hasta que el cliente deja de contestar. El mismo criterio de RANGOS
 * en `ajustes_operativos.ts`.
 */
const PRECIO_MAX: Record<ModoTarifa, number> = {
  // Un flete nacional de carga completa no llega al millón de pesos.
  por_viaje: 1_000_000,
  // Ni la ruta más cara de México se cotiza a mil pesos el kilómetro.
  por_km: 1_000,
  // Una tonelada de flete no cuesta cien mil pesos.
  por_tonelada: 100_000,
};

/** Solo MXN, y a propósito — ver `validarTarifa`. */
export const MONEDAS_TARIFA = ['MXN'] as const;

// ── Cliente ────────────────────────────────────────────────────────────────

/** Lo que llega del formulario: puros strings, porque un `<input>` no da otra cosa. */
export interface ClienteCrudo {
  nombre: string;
  rfc: string;
  contacto: string;
  correo: string;
  telefono: string;
  /** `''` es "no pactado" (NULL en la base). `'0'` es contado. NO son lo mismo. */
  diasCredito: string;
  activo: boolean;
}

export interface ClienteValido {
  nombre: string;
  rfc: string | null;
  contacto: string | null;
  correo: string | null;
  telefono: string | null;
  diasCredito: number | null;
  activo: boolean;
}

/** `''` → `null`. Un string vacío guardado es un dato que parece capturado. */
function opcional(crudo: string, campo: string, max: number): string | null {
  const t = crudo.trim();
  if (t === '') return null;
  if (t.length > max) throw new DatoInvalido(`${campo} no puede pasar de ${max} caracteres.`);
  return t;
}

/**
 * Correo con la forma mínima verificable, sin pretender validar más.
 *
 * El regex es LINEAL a propósito (tres clases negadas, sin cuantificador
 * anidado): un `(a+)+@` sobre un campo que teclea un usuario es un ReDoS, y
 * este repo ya tiene una guardia de tiempo por ese mismo motivo en el buscador
 * de fundamentos. Comprobar de verdad que un correo existe requiere mandarle
 * un mensaje; lo que esto atrapa es el dedazo obvio, que es lo que un
 * formulario puede atrapar honestamente.
 */
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarCliente(c: ClienteCrudo): ClienteValido {
  const nombre = c.nombre.trim();
  // Mismo piso que `crearFlota`: con menos de 3 caracteres no hay a quién
  // buscar en la lista, y el índice único por (tenant, nombre) haría chocar
  // dos clientes distintos capturados como "A" y "A ".
  if (nombre.length < 3) throw new DatoInvalido('El nombre del cliente necesita al menos 3 caracteres.');
  if (nombre.length > 120) throw new DatoInvalido('El nombre del cliente no puede pasar de 120 caracteres.');

  let rfc: string | null = null;
  if (c.rfc.trim() !== '') {
    // Misma normalización que `crearFlota`: mayúsculas y solo el alfabeto del
    // RFC. Guardar "  tme960204p56 " haría que el índice único por RFC no
    // detectara al mismo cliente capturado dos veces.
    rfc = c.rfc.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
    if (!esRfcValido(rfc) || !rfcChecksumOk(rfc)) {
      // Este RFC es el del RECEPTOR de las facturas que la flota va a emitir.
      // Un dígito verificador malo no se descubre aquí: se descubre cuando el
      // PAC rechaza el CFDI, con el viaje ya entregado y el cobro detenido.
      throw new DatoInvalido(
        `El RFC "${c.rfc.trim()}" no pasa el dígito verificador. Revísalo: es el RFC con el que le vas a facturar, ` +
        `y un CFDI a nombre de un RFC que no existe lo rebota el SAT.`,
      );
    }
  }

  const correo = opcional(c.correo, 'El correo', 160);
  if (correo !== null && !CORREO_RE.test(correo)) {
    throw new DatoInvalido(`"${correo}" no se ve como un correo. Escríbelo completo (nombre@empresa.com) o déjalo vacío.`);
  }

  // El teléfono se guarda COMO SE TECLEÓ (solo recortado), no normalizado a
  // dígitos: `operador.telefono` sí se normaliza porque ES la identidad de
  // WhatsApp con la que el motor empareja mensajes, pero éste es un contacto
  // de cobranza contra el que nada se empareja, y aplanarlo a dígitos borraría
  // la extensión ("55 1234 5678 ext. 210") que es justo lo que hace falta para
  // que alguien conteste.
  const telefono = opcional(c.telefono, 'El teléfono', 40);
  if (telefono !== null) {
    const digitos = telefono.replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 15) {
      throw new DatoInvalido('El teléfono necesita entre 10 y 15 dígitos (con lada). Déjalo vacío si no lo tienes.');
    }
  }

  // ── VACÍO NO ES CERO, Y AQUÍ ESO DECIDE SI ALGO SE PINTA DE ROJO ─────────
  //
  // `Number('')` da 0, y ese 0 significaría "contado": la cobranza le pondría
  // vencimiento el mismo día a cada factura y la cartera saldría vencida
  // entera. La migración lo escribe en el comentario de la columna: NULL es
  // "sin condiciones registradas". Es el mismo `'' vs '0'` de `armarPolitica`.
  let diasCredito: number | null = null;
  const dc = c.diasCredito.trim();
  if (dc !== '') {
    const n = Number(dc);
    if (!Number.isInteger(n)) throw new DatoInvalido('Los días de crédito tienen que ser un número entero de días.');
    // Espeja `cliente_dias_credito_sano` (0048). Si el constraint rebota, el
    // usuario ve un mensaje de Postgres con el nombre del check.
    if (n < 0 || n > 365) throw new DatoInvalido('Los días de crédito tienen que estar entre 0 y 365.');
    diasCredito = n;
  }

  return {
    nombre,
    rfc,
    contacto: opcional(c.contacto, 'El contacto', 120),
    correo,
    telefono,
    diasCredito,
    activo: c.activo,
  };
}

// ── Tarifa ─────────────────────────────────────────────────────────────────

export interface TarifaCruda {
  /** `''` = tarifa de lista (aplica a cualquier cliente). */
  clienteId: string;
  origen: string;
  destino: string;
  modo: string;
  precio: string;
  moneda: string;
  vigenteDesde: string;
  vigenteHasta: string;
  activa: boolean;
}

export interface TarifaValida {
  clienteId: string | null;
  origen: string | null;
  destino: string | null;
  modo: ModoTarifa;
  precio: number;
  moneda: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fecha(crudo: string, campo: string): string {
  const t = crudo.trim();
  if (t === '') throw new DatoInvalido(`Falta ${campo}.`);
  if (!FECHA_RE.test(t)) throw new DatoInvalido(`${campo} tiene que venir como AAAA-MM-DD.`);
  // `new Date('2026-02-31')` no truena: rueda al 3 de marzo. Un rango de
  // vigencia que empieza tres días después de lo que alguien tecleó desaparece
  // sin avisar del cotizador, que es exactamente lo que el constraint
  // `tarifa_vigencia_coherente` se propuso evitar por el otro lado.
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    throw new DatoInvalido(`${campo} no es una fecha que exista.`);
  }
  return t;
}

export function validarTarifa(t: TarifaCruda): TarifaValida {
  const modo = t.modo.trim();
  // Espeja `tarifa_modo_dominio` (0048): sin esto el error llega como un check
  // constraint de Postgres, con el nombre del constraint en pantalla.
  if (!esModoTarifa(modo)) throw new DatoInvalido('Elige cómo se cobra la tarifa: por viaje, por kilómetro o por tonelada.');

  const crudoPrecio = t.precio.trim();
  if (crudoPrecio === '') throw new DatoInvalido('Falta el precio de la tarifa.');
  // La coma decimal es como se teclea en México — mismo trato que
  // `ajustes_operativos.ts`. Se quitan también los separadores de millar: un
  // precio pegado desde Excel llega como "28,500.00" y `Number` daría NaN.
  const precio = Number(crudoPrecio.replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(precio)) throw new DatoInvalido('El precio tiene que ser un número.');
  // Espeja `tarifa_precio_positivo`. Un precio de 0 no es una tarifa barata:
  // es una tarifa que cotizaría el flete gratis y se vería como una medición.
  if (precio <= 0) throw new DatoInvalido('El precio tiene que ser mayor que cero.');
  const tope = PRECIO_MAX[modo];
  if (precio > tope) {
    const m = MODOS_TARIFA.find((x) => x.valor === modo)!;
    throw new DatoInvalido(`${precio} es demasiado para una tarifa ${m.rotulo.toLowerCase()} (${m.unidad}). Revisa si sobra un cero.`);
  }

  const moneda = (t.moneda.trim() || 'MXN').toUpperCase();
  // ── POR QUÉ SOLO PESOS, HOY ─────────────────────────────────────────────
  // La columna acepta cualquier texto y las flotas de cruce sí cotizan en
  // dólares. Lo que Likida no tiene es conversión: una tarifa en USD saldría
  // sumada al ingreso en pesos y formateada con `mxn()`, o sea impresa con
  // signo de pesos siendo dólares. Eso no es una limitación de pantalla, es
  // una cifra falsa. Se abre cuando exista tipo de cambio, no antes.
  if (!(MONEDAS_TARIFA as readonly string[]).includes(moneda)) {
    throw new DatoInvalido('Por ahora las tarifas solo se capturan en pesos: Likida todavía no convierte moneda, y mezclar dólares con pesos daría un ingreso que no es de nadie.');
  }

  let clienteId: string | null = null;
  if (t.clienteId.trim() !== '') {
    clienteId = t.clienteId.trim();
    // Un id con basura llega a Postgres como `22P02 invalid input syntax for
    // type uuid`, que en pantalla no le dice nada a nadie.
    if (!esUuidValido(clienteId)) throw new DatoInvalido('El cliente de la tarifa no es válido. Vuelve a elegirlo de la lista.');
  }

  const vigenteDesde = fecha(t.vigenteDesde, 'la fecha desde la que rige la tarifa');
  const vigenteHasta = t.vigenteHasta.trim() === '' ? null : fecha(t.vigenteHasta, 'la fecha hasta la que rige la tarifa');
  // Espeja `tarifa_vigencia_coherente`, con la razón que da la propia
  // migración: una vigencia al revés deja la tarifa fuera de TODO rango y
  // desaparece sin avisar — quien la capturó cree que puso un precio y el
  // cotizador no encuentra ninguno.
  if (vigenteHasta !== null && vigenteHasta < vigenteDesde) {
    throw new DatoInvalido('La tarifa no puede terminar antes de empezar: revisa las dos fechas.');
  }

  return {
    clienteId,
    origen: opcional(t.origen, 'El origen', 120),
    destino: opcional(t.destino, 'El destino', 120),
    modo,
    precio: round2(precio),
    moneda,
    vigenteDesde,
    vigenteHasta,
    activa: t.activa,
  };
}

// ── Resolver qué tarifa aplica ─────────────────────────────────────────────

export interface TarifaRow {
  id: string;
  clienteId: string | null;
  /** Nombre resuelto para pantalla. `null` en una tarifa de lista. */
  clienteNombre: string | null;
  origen: string | null;
  destino: string | null;
  modo: ModoTarifa;
  precio: number;
  moneda: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
  creadaEn: string;
}

export interface CriterioTarifa {
  clienteId?: string | null;
  origen?: string | null;
  destino?: string | null;
  /** `viaje.km_recorridos`. `null` = no capturado, y entonces una tarifa por
   *  km NO se resuelve a un monto. */
  km?: number | null;
  /**
   * Toneladas de la carga.
   *
   * NO SALE DE LA BASE, PORQUE LA BASE NO LA GUARDA. Ni `viaje` ni ninguna
   * tabla de la 0047-0051 tiene tonelaje; `tarifa` permite cobrar por tonelada
   * y el viaje no sabe cuántas trae. Este parámetro existe para que un humano
   * lo teclee en un cotizador; cuando no viene, la sugerencia sale con
   * `falta: 'toneladas'` y SIN monto. Inventar un tonelaje típico sería
   * exactamente la cifra que este producto no puede permitirse.
   */
  toneladas?: number | null;
  /** Contra qué día se juzga la vigencia, AAAA-MM-DD. */
  fecha: string;
}

export interface SugerenciaTarifa {
  tarifa: TarifaRow;
  /** `null` cuando falta el dato que la unidad de la tarifa exige. NUNCA 0. */
  monto: number | null;
  /** Qué dato falta para poder poner precio. `null` si no falta nada. */
  falta: 'km' | 'toneladas' | null;
  /** Por qué ganó ésta, en palabras de pantalla. */
  porque: string;
  /** Cuántas otras tarifas también aplicaban y perdieron por menos específicas. */
  desplazadas: number;
  /**
   * Dos tarifas igual de específicas y con la misma vigencia, con precios
   * distintos. Se elige una para poder enseñar algo, pero se DICE: el catálogo
   * está mal y la cotización depende de cuál se tecleó al último.
   */
  ambigua: boolean;
}

/**
 * Compara plazas sin pelearse con acentos ni mayúsculas.
 *
 * Exacta después de normalizar, NO por subcadena: con `includes`, una tarifa
 * de "Monterrey" cotizaría un viaje a "Nuevo Monterrey" y una de "León" uno a
 * "Nuevo León" — dos rutas distintas al mismo precio. Cuando no coincide, la
 * pantalla dice "no hay tarifa para esa ruta", que es la verdad y se corrige
 * capturando la tarifa.
 */
export function normalizarPlaza(s: string | null | undefined): string | null {
  if (s == null) return null;
  // `NFD` separa la letra de su acento y `\p{M}` borra el acento suelto:
  // "León" y "Leon" tienen que ser la misma plaza, o media flota captura sus
  // tarifas sin acento y ninguna aplica.
  const t = s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

/** Cuánto pesa la especificidad de una tarifa. Ver `tarifaSugerida`. */
function especificidad(t: TarifaRow): number {
  // El cliente vale más que la ruta entera (4 > 1+1) porque una tarifa
  // negociada es un acuerdo firmado con ESE cliente: gana sobre la de lista
  // aunque la de lista describa la ruta con más detalle. Lo dice el comentario
  // de `tarifa.cliente_id` en la 0048: "negociada, y esa gana sobre la de lista".
  return (t.clienteId ? 4 : 0) + (t.origen ? 1 : 0) + (t.destino ? 1 : 0);
}

function montoDe(t: TarifaRow, c: CriterioTarifa): { monto: number | null; falta: 'km' | 'toneladas' | null } {
  switch (t.modo) {
    case 'por_viaje':
      return { monto: round2(t.precio), falta: null };
    case 'por_km':
      // `km <= 0` se trata como NO CAPTURADO, no como cero: un viaje de cero
      // kilómetros no existe, y `precio * 0` daría $0.00 con cara de medición.
      // El constraint `viaje_km_sanos` ya prohíbe el 0 en la base; esto cubre
      // el caso de un cotizador que todavía no lo ha tecleado.
      return c.km != null && c.km > 0
        ? { monto: round2(t.precio * c.km), falta: null }
        : { monto: null, falta: 'km' };
    case 'por_tonelada':
      return c.toneladas != null && c.toneladas > 0
        ? { monto: round2(t.precio * c.toneladas), falta: null }
        : { monto: null, falta: 'toneladas' };
  }
}

function porqueGano(t: TarifaRow): string {
  const quien = t.clienteId ? 'Negociada con este cliente' : 'De lista';
  if (t.origen && t.destino) return `${quien}, para esta ruta exacta`;
  if (t.origen) return `${quien}, para todo lo que sale de ${t.origen}`;
  if (t.destino) return `${quien}, para todo lo que va a ${t.destino}`;
  return `${quien}, sin ruta: aplica a cualquier viaje`;
}

/**
 * Qué tarifa aplica a un viaje, y cuánto sale — o `null` si ninguna aplica.
 *
 * PURA A PROPÓSITO: recibe el catálogo en vez de ir por él. Es la única
 * función de este archivo que decide dinero, y una que consulta la base no se
 * puede probar sin montar una base. `getPanelClientes` es quien la alimenta.
 *
 * ── EL ORDEN EN QUE SE DESCARTA, Y POR QUÉ IMPORTA ─────────────────────────
 * Primero se ELIMINA lo que no puede aplicar (inactiva, fuera de vigencia,
 * negociada con otro cliente, ruta que no es). Eso no admite grados: una
 * tarifa que venció no es "menos aplicable", es inaplicable, y usarla porque
 * era la única cotizaría a un precio que ya no rige.
 *
 * Entre las que SÍ aplican gana la más ESPECÍFICA, y ahí sí hay grados:
 *   negociada con el cliente (4) > ruta completa (2) > media ruta (1) > lista (0)
 * A igual especificidad gana la que entró en vigor DESPUÉS: un precio nuevo
 * reemplaza al viejo, no compite con él. Y si hasta ahí empatan con precios
 * distintos, se marca `ambigua`: el catálogo tiene dos verdades y la pantalla
 * tiene que decirlo, porque elegir en silencio es cotizar a suerte.
 */
export function tarifaSugerida(
  tarifas: readonly TarifaRow[],
  criterio: CriterioTarifa,
): SugerenciaTarifa | null {
  const origen = normalizarPlaza(criterio.origen);
  const destino = normalizarPlaza(criterio.destino);

  const aplican = tarifas.filter((t) => {
    if (!t.activa) return false;
    // Comparación de strings AAAA-MM-DD, no de `Date`: son fechas de
    // calendario sin hora, y `new Date('2026-08-04')` es medianoche UTC — leída
    // en hora de México cae el día ANTERIOR, y una tarifa que entra en vigor
    // hoy no aplicaría hoy. Lexicográfico sobre ese formato es exacto.
    if (t.vigenteDesde > criterio.fecha) return false;
    // `vigenteHasta` es INCLUSIVO: el último día pactado la tarifa todavía rige.
    if (t.vigenteHasta !== null && t.vigenteHasta < criterio.fecha) return false;
    // Una tarifa negociada con OTRO cliente no es una tarifa de lista.
    if (t.clienteId !== null && t.clienteId !== (criterio.clienteId ?? null)) return false;
    const to = normalizarPlaza(t.origen);
    const td = normalizarPlaza(t.destino);
    if (to !== null && to !== origen) return false;
    if (td !== null && td !== destino) return false;
    return true;
  });

  if (aplican.length === 0) return null;

  const ordenadas = [...aplican].sort((a, b) => {
    const e = especificidad(b) - especificidad(a);
    if (e !== 0) return e;
    if (a.vigenteDesde !== b.vigenteDesde) return a.vigenteDesde < b.vigenteDesde ? 1 : -1;
    // Último desempate: la capturada más tarde, y luego el id. No es una
    // preferencia de negocio —a estas alturas el catálogo ya está ambiguo—,
    // es determinismo: sin él la misma cotización cambia entre dos cargas de
    // la página según cómo devuelva las filas Postgres.
    if (a.creadaEn !== b.creadaEn) return a.creadaEn < b.creadaEn ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });

  const gana = ordenadas[0];
  const empatadas = ordenadas.filter(
    (t) => especificidad(t) === especificidad(gana) && t.vigenteDesde === gana.vigenteDesde,
  );
  const ambigua = empatadas.some((t) => t.precio !== gana.precio || t.modo !== gana.modo);

  const { monto, falta } = montoDe(gana, criterio);
  return {
    tarifa: gana,
    monto,
    falta,
    porque: porqueGano(gana),
    desplazadas: aplican.length - 1,
    ambigua,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE CON BASE DE DATOS.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántos viajes sin ingreso se listan. El TOTAL siempre se dice aparte:
 *  recortar la lista está bien, recortar la cifra sin decirlo no. */
const LIMITE_SIN_INGRESO = 12;

export interface ClienteConMetricas extends ClienteRow {
  /**
   * Contacto, correo y teléfono. NO vienen de `getCartera` —a la cartera no le
   * hacen falta— y aun así se leen aquí, porque el formulario de EDICIÓN
   * guarda la fila completa: sin estos tres, abrir "editar" y guardar los
   * borraría en silencio. Es el mismo daño que `armarPolitica` evita
   * reponiendo las reglas por ruta que su formulario no edita.
   */
  contacto: string | null;
  correo: string | null;
  telefono: string | null;
  /**
   * Saldo por cobrar del cliente. `null` cuando NO TIENE FACTURAS
   * REGISTRADAS — que no es lo mismo que deber $0.00. Un cliente que pagó todo
   * y un cliente al que nunca se le ha facturado se ven idénticos si los dos
   * salen en cero, y la decisión que se toma con ese número (a quién le
   * hablo hoy) es distinta en cada caso.
   */
  saldoPorCobrar: number | null;
  /** Del saldo, lo que ya pasó de su fecha pactada. `null` por lo mismo. */
  vencido: number | null;
  facturas: number;
  /** Tarifas capturadas para este cliente (negociadas), vigentes o no. */
  tarifas: number;
}

export interface ViajeSinIngreso {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  km: number | null;
  fecha: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  /** Qué tarifa del catálogo aplicaría. `null` = ninguna aplica. */
  sugerencia: SugerenciaTarifa | null;
}

export interface PanelClientes {
  clientes: ClienteConMetricas[];
  /** Suma de `viaje.ingreso_flete` capturado. NO incluye lo no capturado. */
  ingresoTotal: number;
  /** % del ingreso que depende del cliente más grande. `null` sin ingreso. */
  concentracion: number | null;
  viajesSinCliente: number;
  tarifas: TarifaRow[];
  /** Los más recientes, hasta `LIMITE_SIN_INGRESO`. */
  sinIngreso: ViajeSinIngreso[];
  /** Cuántos hay EN TOTAL, aunque la lista de arriba venga recortada. */
  sinIngresoTotal: number;
  /** Viajes que SÍ traen ingreso capturado — el denominador de `ingresoTotal`. */
  conIngreso: number;
  /** El día contra el que se juzgó la vigencia de las tarifas. */
  hoy: string;
}

/**
 * Todo lo que la pantalla de Clientes y tarifas necesita, en una llamada.
 *
 * SIN CATCH POR DENTRO. Un fallo de cualquiera de estas lecturas tiene que
 * subir: supabase-js reporta el error POR VALOR, así que una base caída se lee
 * como "esta flota no tiene clientes" — y esta pantalla existe justamente para
 * contestar "¿a quién le facturo?". `traerTodo`/`exigir` ya traducen el error
 * por valor a excepción; la página decide si pinta el error o se cae.
 */
export async function getPanelClientes(
  tenantId: string,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<PanelClientes> {
  const admin = supabaseAdmin();

  const [cartera, contactos, tarifasCrudas, saldos, sinIngresoCrudos, conIngreso] = await Promise.all([
    getCartera(tenantId),
    // Las tres columnas que `getCartera` no trae y el formulario de edición sí
    // necesita. Sí, es una segunda pasada por `cliente`: reescribir `getCartera`
    // para ahorrársela sería una segunda copia del conteo que da la
    // concentración, y ése es el número que no puede tener dos versiones.
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('cliente').select('id, contacto, correo, telefono', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getPanelClientes.contacto',
    ),
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('tarifa')
        .select('id, cliente_id, origen, destino, modo, precio, moneda, vigente_desde, vigente_hasta, activa, creada_en', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getPanelClientes.tarifa',
    ),
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('factura_saldo')
        .select('factura_id, cliente_id, saldo, vencida, estatus', conteo(d))
        .eq('tenant_id', tenantId).order('factura_id').range(d, h),
      'getPanelClientes.saldo',
    ),
    // Solo los que NO tienen ingreso: es la lista que la pantalla enseña, y
    // pedir la tabla entera para tirar el 90% es pagar por nada.
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('viaje')
        .select('id, folio, origen, destino, km_recorridos, cliente_id, fecha_inicio', conteo(d))
        .eq('tenant_id', tenantId).is('ingreso_flete', null).order('id').range(d, h),
      'getPanelClientes.viajeSinIngreso',
    ),
    contarViajesConIngreso(tenantId),
  ]);

  const nombrePorCliente = new Map(cartera.clientes.map((c) => [c.id, c.nombre]));

  const tarifas: TarifaRow[] = tarifasCrudas.map((t) => ({
    id: t.id as string,
    clienteId: (t.cliente_id as string) ?? null,
    clienteNombre: t.cliente_id ? nombrePorCliente.get(t.cliente_id as string) ?? null : null,
    origen: (t.origen as string) ?? null,
    destino: (t.destino as string) ?? null,
    // `tarifa_modo_dominio` (0048) garantiza que sea uno de los tres.
    modo: t.modo as ModoTarifa,
    precio: round2(Number(t.precio)),
    moneda: String(t.moneda ?? 'MXN'),
    vigenteDesde: String(t.vigente_desde),
    vigenteHasta: (t.vigente_hasta as string) ?? null,
    activa: Boolean(t.activa),
    creadaEn: String(t.creada_en),
  })).sort((a, b) => (a.clienteNombre ?? '').localeCompare(b.clienteNombre ?? '', 'es')
    || (a.origen ?? '').localeCompare(b.origen ?? '', 'es'));

  // Saldo por cliente. Se ignoran canceladas y borradores, igual que
  // `getCobranza`: una factura cancelada no es dinero que alguien deba.
  const saldoPorCliente = new Map<string, { saldo: number; vencido: number; facturas: number }>();
  for (const s of saldos) {
    const estatus = String(s.estatus);
    if (estatus === 'cancelada' || estatus === 'borrador') continue;
    const cid = (s.cliente_id as string) ?? null;
    if (!cid) continue;
    const a = saldoPorCliente.get(cid) ?? { saldo: 0, vencido: 0, facturas: 0 };
    const saldo = Number(s.saldo ?? 0);
    a.saldo += saldo;
    if (s.vencida === true) a.vencido += saldo;
    a.facturas++;
    saldoPorCliente.set(cid, a);
  }

  const tarifasPorCliente = new Map<string, number>();
  for (const t of tarifas) {
    if (!t.clienteId) continue;
    tarifasPorCliente.set(t.clienteId, (tarifasPorCliente.get(t.clienteId) ?? 0) + 1);
  }

  const contactoPorId = new Map(contactos.map((c) => [c.id as string, c]));

  const clientes: ClienteConMetricas[] = cartera.clientes.map((c) => {
    const s = saldoPorCliente.get(c.id);
    const d = contactoPorId.get(c.id);
    return {
      ...c,
      contacto: (d?.contacto as string) ?? null,
      correo: (d?.correo as string) ?? null,
      telefono: (d?.telefono as string) ?? null,
      saldoPorCobrar: s ? round2(s.saldo) : null,
      vencido: s ? round2(s.vencido) : null,
      facturas: s?.facturas ?? 0,
      tarifas: tarifasPorCliente.get(c.id) ?? 0,
    };
  });

  // Lo más reciente primero; un viaje sin fecha de inicio va al final (no se
  // le inventa una fecha para poder ordenarlo).
  const ordenados = [...sinIngresoCrudos].sort((a, b) => {
    const fa = (a.fecha_inicio as string) ?? '';
    const fb = (b.fecha_inicio as string) ?? '';
    if (fa !== fb) return fa < fb ? 1 : -1;
    return String(a.id) < String(b.id) ? 1 : -1;
  });

  const sinIngreso: ViajeSinIngreso[] = ordenados.slice(0, LIMITE_SIN_INGRESO).map((v) => {
    const clienteId = (v.cliente_id as string) ?? null;
    const km = v.km_recorridos == null ? null : Number(v.km_recorridos);
    return {
      id: v.id as string,
      folio: (v.folio as string) ?? null,
      origen: (v.origen as string) ?? null,
      destino: (v.destino as string) ?? null,
      km,
      fecha: (v.fecha_inicio as string) ?? null,
      clienteId,
      clienteNombre: clienteId ? nombrePorCliente.get(clienteId) ?? null : null,
      sugerencia: tarifaSugerida(tarifas, {
        clienteId,
        origen: (v.origen as string) ?? null,
        destino: (v.destino as string) ?? null,
        km,
        fecha: hoy,
      }),
    };
  });

  return {
    clientes,
    ingresoTotal: cartera.ingresoTotal,
    concentracion: cartera.concentracion,
    viajesSinCliente: cartera.viajesSinCliente,
    tarifas,
    sinIngreso,
    sinIngresoTotal: sinIngresoCrudos.length,
    conIngreso,
    hoy,
  };
}

/**
 * Cuántos viajes traen `ingreso_flete` capturado.
 *
 * Con `head: true` no viaja ni una fila: solo el `count` de PostgREST. Y el
 * `count == null` se trata como FALLO, no como cero — un conteo que no llegó
 * no es un conteo de cero, y ese cero se leería en pantalla como "esta flota
 * nunca ha capturado un ingreso".
 */
async function contarViajesConIngreso(tenantId: string): Promise<number> {
  const { count, error } = await acotada(
    supabaseAdmin().from('viaje').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).not('ingreso_flete', 'is', null),
    'contarViajesConIngreso',
  );
  if (error) throw new Error(`contarViajesConIngreso: ${error.message}`);
  if (count == null) throw new Error('contarViajesConIngreso: PostgREST no devolvió el conteo');
  return count;
}

// ── Escrituras ─────────────────────────────────────────────────────────────

/**
 * Deja constancia. Best-effort A PROPÓSITO, igual que en `administracion.ts` y
 * `facturacion/avisar.ts`: si la bitácora falla, el alta YA ocurrió y tirarla
 * dejaría el sistema peor que sin el registro. El fallo se loguea para que no
 * se pierda en silencio.
 *
 * Es una tarifa: el "¿con qué precio se cotizó en marzo?" de dentro de seis
 * meses no lo contesta la fila actual, que para entonces ya es otra.
 */
async function anotar(
  tenantId: string,
  accion: string,
  entidad: EntidadBitacora,
  entidadId: string,
  detalle: Record<string, unknown>,
  actor?: { id?: string; email?: string },
): Promise<void> {
  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion, entidad, entidadId, detalle },
    { evento: 'clientes.bitacora_no_escribio' },
  );
}

/** Los índices únicos de la 0048, dichos en palabras de quien capturó. */
function traducirChoque(mensaje: string, c: ClienteValido): DatoInvalido | null {
  if (mensaje.includes('cliente_nombre_unico')) {
    return new DatoInvalido(`Ya tienes un cliente que se llama "${c.nombre}". Si es otro, distínguelo en el nombre (razón social, plaza).`);
  }
  if (mensaje.includes('cliente_rfc_unico')) {
    return new DatoInvalido(`Ya tienes un cliente con el RFC ${c.rfc}. Búscalo en la lista en vez de darlo de alta otra vez.`);
  }
  return null;
}

export async function crearCliente(
  tenantId: string,
  c: ClienteValido,
  actor?: { id?: string; email?: string },
): Promise<string> {
  const { data, error } = await acotada(supabaseAdmin().from('cliente').insert({
    // El tenant viene por argumento desde la sesión del servidor, NUNCA del
    // formulario: un campo oculto con el tenant es un IDOR con formulario.
    tenant_id: tenantId,
    nombre: c.nombre,
    rfc: c.rfc,
    contacto: c.contacto,
    correo: c.correo,
    telefono: c.telefono,
    dias_credito: c.diasCredito,
    activo: c.activo,
  }).select('id').single(), 'crearCliente');

  if (error) {
    const choque = traducirChoque(error.message, c);
    if (choque) throw choque;
    throw new Error(`crearCliente: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearCliente: el insert no devolvió id');

  await anotar(tenantId, 'cliente.creado', 'cliente', id as string, {
    nombre: c.nombre, rfc: c.rfc, diasCredito: c.diasCredito,
  }, actor);
  return id as string;
}

export async function editarCliente(
  tenantId: string,
  clienteId: string,
  c: ClienteValido,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(clienteId)) throw new DatoInvalido('No se reconoce ese cliente. Vuelve a abrir la pantalla.');

  // ── EL `.eq('tenant_id')` NO BASTA SI NADIE MIRA LO QUE DEVOLVIÓ ─────────
  // Con el id de un cliente de OTRA flota, este UPDATE toca cero filas y
  // Postgres no lo considera un error. Sin el `.select()` de abajo, la
  // pantalla diría "guardado" sobre un cambio que no ocurrió — y el usuario se
  // iría creyendo que corrigió los días de crédito de su cliente.
  const { data, error } = await acotada(supabaseAdmin().from('cliente').update({
    nombre: c.nombre,
    rfc: c.rfc,
    contacto: c.contacto,
    correo: c.correo,
    telefono: c.telefono,
    dias_credito: c.diasCredito,
    activo: c.activo,
  }).eq('id', clienteId).eq('tenant_id', tenantId).select('id'), 'editarCliente');

  if (error) {
    const choque = traducirChoque(error.message, c);
    if (choque) throw choque;
    throw new Error(`editarCliente: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró ese cliente en tu flota. Puede que alguien lo haya borrado — recarga la pantalla.');
  }

  await anotar(tenantId, 'cliente.editado', 'cliente', clienteId, {
    nombre: c.nombre, rfc: c.rfc, diasCredito: c.diasCredito, activo: c.activo,
  }, actor);
}

/**
 * Que el cliente de la tarifa sea de ESTA flota.
 *
 * Es el candado de `operadorPropio`/`unidadPropia` (operacion.ts) aplicado a
 * la única llave foránea que este módulo escribe. El `tenant_id` del INSERT
 * acota la fila NUEVA; no dice nada del `cliente_id` que va adentro. Sin esto,
 * un POST directo al server action con el uuid de un cliente de otra flota
 * crea una tarifa de la flota A colgada de un cliente de B — y la pantalla de
 * A imprimiría el nombre de ese cliente ajeno en la columna de al lado.
 */
async function clientePropio(tenantId: string, clienteId: string): Promise<boolean> {
  const filas = await traerTodo<{ id: unknown }>(
    (d, h) => supabaseAdmin().from('cliente').select('id', conteo(d))
      .eq('tenant_id', tenantId).eq('id', clienteId).order('id').range(d, h),
    'clientePropio',
  );
  return filas.length > 0;
}

function filaTarifa(tenantId: string, t: TarifaValida) {
  return {
    tenant_id: tenantId,
    cliente_id: t.clienteId,
    origen: t.origen,
    destino: t.destino,
    modo: t.modo,
    precio: t.precio,
    moneda: t.moneda,
    vigente_desde: t.vigenteDesde,
    vigente_hasta: t.vigenteHasta,
    activa: t.activa,
  };
}

export async function crearTarifa(
  tenantId: string,
  t: TarifaValida,
  actor?: { id?: string; email?: string },
): Promise<string> {
  if (t.clienteId && !(await clientePropio(tenantId, t.clienteId))) {
    throw new DatoInvalido('Ese cliente no es de tu flota. Vuelve a elegirlo de la lista.');
  }

  const { data, error } = await acotada(
    supabaseAdmin().from('tarifa').insert(filaTarifa(tenantId, t)).select('id').single(),
    'crearTarifa',
  );
  if (error) throw new Error(`crearTarifa: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearTarifa: el insert no devolvió id');

  await anotar(tenantId, 'tarifa.creada', 'tarifa', id as string, {
    clienteId: t.clienteId, origen: t.origen, destino: t.destino,
    modo: t.modo, precio: t.precio, vigenteDesde: t.vigenteDesde,
  }, actor);
  return id as string;
}

export async function editarTarifa(
  tenantId: string,
  tarifaId: string,
  t: TarifaValida,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(tarifaId)) throw new DatoInvalido('No se reconoce esa tarifa. Vuelve a abrir la pantalla.');
  if (t.clienteId && !(await clientePropio(tenantId, t.clienteId))) {
    throw new DatoInvalido('Ese cliente no es de tu flota. Vuelve a elegirlo de la lista.');
  }

  const { data, error } = await acotada(
    supabaseAdmin().from('tarifa').update(filaTarifa(tenantId, t))
      .eq('id', tarifaId).eq('tenant_id', tenantId).select('id'),
    'editarTarifa',
  );
  if (error) throw new Error(`editarTarifa: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró esa tarifa en tu flota. Puede que alguien la haya borrado — recarga la pantalla.');
  }

  // El detalle guarda los VALORES, no "se editó": lo que hay que poder
  // contestar dentro de seis meses es a qué precio se cotizó en marzo, y la
  // fila de hoy ya no lo sabe.
  await anotar(tenantId, 'tarifa.editada', 'tarifa', tarifaId, {
    clienteId: t.clienteId, origen: t.origen, destino: t.destino,
    modo: t.modo, precio: t.precio,
    vigenteDesde: t.vigenteDesde, vigenteHasta: t.vigenteHasta, activa: t.activa,
  }, actor);
}
