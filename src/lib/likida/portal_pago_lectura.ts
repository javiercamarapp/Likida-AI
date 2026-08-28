import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { mismoHash } from '@/lib/auth/llave-api';
import { estadoLiga, hashDeToken, prefijoDeToken, type EstadoLiga } from './portal_pago';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LA PÁGINA PÚBLICA PUEDE VER — Y NADA MÁS.
//
// Este archivo es la frontera. Del lado de afuera hay un token en una URL; del
// lado de adentro, `supabaseAdmin()`, que BYPASSA RLS y puede leer las
// facturas de todas las flotas del producto. La única cosa que impide que una
// se lea desde otra es que TODA consulta de aquí abajo va anclada al
// `factura_id` y al `tenant_id` de la liga resuelta — nunca a un parámetro de
// la URL, nunca a un `id` que el visitante controle.
//
// De ahí que la resolución devuelva un objeto ya armado y no un handle: quien
// llame a esto no recibe la capacidad de consultar, recibe la respuesta.
//
// ── LOS TRES DESENLACES, Y POR QUÉ NO SON DOS ────────────────────────────
//
//   `no_valida`     — el token no existe, caducó, lo revocaron o es basura.
//                     UN SOLO desenlace para los cuatro casos: distinguirlos
//                     convertiría esta página en un oráculo que le dice a
//                     quien prueba tokens cuál acertó a medias.
//   `no_disponible` — no se pudo PREGUNTAR (Supabase reportó error por valor).
//                     Es un desenlace aparte porque lleva a una conducta
//                     contraria: "vuelve en un rato" en vez de "pide otro
//                     enlace". Colapsarlo en `no_valida` haría que un bache de
//                     red le dijera a un cliente legítimo que su enlace murió,
//                     y saldría a pedir uno nuevo que no necesita.
//   `no_cobrable`   — la liga vale y la factura existe, pero ese CFDI ya no
//                     cobra: está CANCELADA (o es un borrador). Ver abajo.
//   `ok`            — la factura, su saldo REAL y lo que haya de REP.
//
// ── POR QUÉ `no_cobrable` ES UN DESENLACE Y NO UNA BANDERA MÁS ────────────
//
// AUDITORÍA 7, `c7-7` (alto). La liga se emite sobre una factura `emitida`; el
// cliente pide refacturación y el contralor la cancela. `cancelarFactura` solo
// exige que no haya pagos y NO tocaba `portal_pago_liga`, así que la liga
// seguía con `revocada_en IS NULL` y `estadoLiga` la reportaba VIGENTE. El
// cliente abría el mismo link y veía «Saldo pendiente $34,800.00» —la vista
// `factura_saldo` calcula `total − pagos` sin mirar el estatus—, el formulario
// activo, y al enviar recibía «Listo. Tu pago quedó registrado…». Le estábamos
// cobrando por un CFDI que ante el SAT ya no existe; y cuando el contralor
// intentara conciliar, `registrar_pago_tx` rebotaría con `motivo=cancelada`,
// dejando la propuesta inconciliable con el dinero real ya depositado.
//
// La corrección tiene dos capas y las dos hacen falta: `cancelarFactura` ahora
// revoca las ligas vivas de esa factura, y ESTE archivo degrada a
// `no_cobrable` mirando el `estatus` que ya leía y descartaba. La segunda capa
// es la que vale cuando la primera falla —una revocación que no se pudo
// escribir, una factura cancelada por fuera— y por eso la puerta que decide si
// se cobra está aquí, del lado de la lectura pública, y no solo en el verbo del
// contralor.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas candidatas del mismo prefijo se traen. Colisionar los 8 caracteres
 *  del prefijo es improbable; el tope existe para que ni siquiera provocándolo
 *  se pueda hacer que esta consulta escanee la tabla. */
const MAX_CANDIDATAS = 20;

export interface LigaResuelta {
  ligaId: string;
  tenantId: string;
  facturaId: string;
  estado: EstadoLiga;
}

export interface FacturaDelPortal {
  serie: string | null;
  folio: string | null;
  cfdiUuid: string | null;
  fecha: string;
  venceEn: string | null;
  estatus: string;
  total: number;
  moneda: string;
  /** `null` = NO SE PUDO SABER. Jamás 0: un cero aquí se lee como "ya no
   *  debes nada", que es la conclusión opuesta a "no pude preguntar". */
  saldo: number | null;
  pagado: number | null;
}

export interface PropuestaDelPortal {
  fecha: string;
  monto: number;
  referencia: string;
  estado: 'pendiente' | 'conciliada' | 'descartada';
  registradaEn: string;
}

export interface RepDelPortal {
  cfdiUuid: string;
  fechaPago: string;
  impPagado: number;
  /** true si hay XML descargable. El XML en sí NO viaja aquí: se pide por su
   *  propia ruta, para no cargar un documento fiscal en cada render. */
  tieneXml: boolean;
}

/** Cuántos complementos de pago se listan. Una factura pagada en parcialidades
 *  tiene uno por parcialidad; 50 es un techo generoso y declarado, no una
 *  ventana silenciosa como la que dejaba el `.limit(1)` anterior. */
const MAX_REPS = 50;

export interface VistaPortal {
  ligaId: string;
  tenantId: string;
  facturaId: string;
  /** Quién emitió la factura, como el cliente la reconoce. */
  flota: string;
  /** A quién se la emitieron. */
  cliente: string;
  factura: FacturaDelPortal;
  propuestas: PropuestaDelPortal[];
  /** TODOS los complementos de esta factura, del más reciente al más viejo.
   *  Con parcialidades son varios y el cliente necesita todos: cada uno
   *  acredita el IVA de su mes. */
  reps: RepDelPortal[];
}

/** Los estatus en los que este portal NO pide dinero. Lista cerrada y con el
 *  sentido invertido a propósito: se enumera lo que SÍ cobra (`emitida`,
 *  `pagada`) y todo lo demás cae a `no_cobrable`. Un estatus nuevo en
 *  `factura_emitida` entra por omisión al lado seguro. */
const ESTATUS_QUE_COBRAN = new Set(['emitida', 'pagada']);

export type ResolucionPortal =
  | { ok: true; vista: VistaPortal }
  | { ok: false; motivo: 'no_valida' }
  | { ok: false; motivo: 'no_disponible' }
  | { ok: false; motivo: 'no_cobrable'; estatus: string };

/**
 * Del token en la URL a la liga, o nada.
 *
 * Recorre TODAS las candidatas del prefijo aunque la primera cuadre —igual que
 * `resolverLlave`— para que no sea medible cuántas comparten prefijo, y compara
 * en tiempo constante.
 */
export async function resolverLiga(token: string): Promise<
  { ok: true; liga: LigaResuelta } | { ok: false; motivo: 'no_valida' | 'no_disponible' }
> {
  const prefijo = prefijoDeToken(token);
  // Sin forma de token ni se consulta. Una ráfaga contra /pago/loquesea no
  // debe poder gastar el presupuesto de lecturas.
  if (!prefijo) return { ok: false, motivo: 'no_valida' };

  const { data, error } = await supabaseAdmin()
    .from('portal_pago_liga')
    .select('id, tenant_id, factura_id, token_hash, expira_en, revocada_en')
    .eq('token_prefijo', prefijo)
    .limit(MAX_CANDIDATAS);

  if (error) {
    logger.error('portal_pago.resolver_liga', { err: error.message });
    return { ok: false, motivo: 'no_disponible' };
  }

  const esperado = hashDeToken(token.trim());
  let hallada: LigaResuelta | null = null;
  for (const f of data ?? []) {
    if (!mismoHash(String(f.token_hash), esperado)) continue;
    hallada = {
      ligaId: String(f.id),
      tenantId: String(f.tenant_id),
      facturaId: String(f.factura_id),
      estado: estadoLiga({
        expira_en: String(f.expira_en),
        revocada_en: (f.revocada_en as string | null) ?? null,
      }),
    };
  }

  if (!hallada) return { ok: false, motivo: 'no_valida' };
  if (hallada.estado !== 'vigente') {
    // Se deja constancia de que alguien llegó con una liga muerta: le sirve al
    // contralor para saber que tiene que reenviar el enlace. La página, en
    // cambio, contesta lo mismo que a un token inventado.
    void anotarAcceso(
      hallada,
      hallada.estado === 'revocada' ? 'liga_revocada' : 'liga_expirada',
    );
    return { ok: false, motivo: 'no_valida' };
  }

  return { ok: true, liga: hallada };
}

/**
 * Todo lo que la página pública enseña, para UNA liga ya resuelta.
 *
 * Cada lectura comprueba su `error` por separado y decide distinto:
 *  · la factura y el emisor son el piso — sin ellos no hay página que pintar,
 *    y se contesta `no_disponible`;
 *  · el saldo se degrada a `null` y la pantalla lo dice ("sin dato"), porque
 *    una factura sin saldo visible sigue siendo información útil;
 *  · las propuestas y el REP se degradan a vacío y `null`. Aquí la degradación
 *    es discutible y por eso está escrita: un cliente que registró su pago y no
 *    lo ve listado podría registrarlo otra vez — el índice único de la 0228 lo
 *    absorbe, así que el peor caso es un mensaje de "ya lo tenemos", no una
 *    propuesta duplicada en la bandeja del contralor.
 */
export async function vistaDelPortal(liga: LigaResuelta): Promise<ResolucionPortal> {
  const sb = supabaseAdmin();

  const [factura, tenant, propuestas, rep, repsConXml] = await Promise.all([
    sb.from('factura_emitida')
      .select('id, cliente_id, serie, folio, cfdi_uuid, fecha, vence_en, estatus, total, moneda')
      .eq('id', liga.facturaId).eq('tenant_id', liga.tenantId).maybeSingle(),
    sb.from('tenant').select('nombre, razon_social').eq('id', liga.tenantId).maybeSingle(),
    sb.from('portal_pago_propuesta')
      .select('fecha, monto, referencia, estado, registrada_en')
      .eq('liga_id', liga.ligaId).eq('tenant_id', liga.tenantId)
      .order('registrada_en', { ascending: false }).limit(50),
    // TODOS los complementos, no el último: ver `c7-16` en la cabecera de
    // `textoDelRep`.
    sb.from('rep_emitido')
      .select('cfdi_uuid, fecha_pago, imp_pagado')
      .eq('factura_id', liga.facturaId).eq('tenant_id', liga.tenantId)
      .order('fecha_pago', { ascending: false }).limit(MAX_REPS),
    // CUÁLES tienen XML, sin traer un solo byte de XML. La columna guarda hasta
    // 500 KB por fila y la pregunta de esta página es «¿hay archivo?», no «dame
    // el archivo»: pedir `xml` para mirarle el largo cargaría hasta 25 MB de
    // documentos fiscales en cada render para no enseñar ninguno.
    sb.from('rep_emitido')
      .select('cfdi_uuid')
      .eq('factura_id', liga.facturaId).eq('tenant_id', liga.tenantId)
      .not('xml', 'is', null).limit(MAX_REPS),
  ]);

  if (factura.error) {
    logger.error('portal_pago.factura', { err: factura.error.message });
    return { ok: false, motivo: 'no_disponible' };
  }
  if (!factura.data) {
    // La liga existe pero su factura no. La FK con cascada lo hace casi
    // imposible; si pasara, el visitante no tiene por qué enterarse de la
    // diferencia entre "no existe" y "se borró".
    return { ok: false, motivo: 'no_valida' };
  }
  if (tenant.error) {
    logger.error('portal_pago.tenant', { err: tenant.error.message });
    return { ok: false, motivo: 'no_disponible' };
  }

  const f = factura.data as Record<string, unknown>;

  // ── LA PUERTA DEL CFDI CANCELADO (`c7-7`) ────────────────────────────────
  // Antes de leer un saldo y de armar un formulario: si ese CFDI ya no cobra,
  // esta página no cobra. Se decide sobre el `estatus` REAL de la factura y no
  // sobre el estado de la liga, porque cancelar una factura no revocaba (ni
  // revocará siempre, si la escritura falla) su enlace. Fail-closed: lo que no
  // está en la lista de los que cobran, no cobra.
  const estatus = String(f.estatus);
  if (!ESTATUS_QUE_COBRAN.has(estatus)) {
    return { ok: false, motivo: 'no_cobrable', estatus };
  }

  // El saldo: su propia lectura, y su propio modo de falla.
  let saldo: number | null = null;
  let pagado: number | null = null;
  const saldoRes = await sb.from('factura_saldo')
    .select('saldo, pagado')
    .eq('factura_id', liga.facturaId).eq('tenant_id', liga.tenantId).maybeSingle();
  if (saldoRes.error) {
    logger.error('portal_pago.saldo', { err: saldoRes.error.message });
  } else if (saldoRes.data) {
    const s = saldoRes.data as { saldo: unknown; pagado: unknown };
    saldo = numeroONull(s.saldo);
    pagado = numeroONull(s.pagado);
  }

  // El nombre del cliente sale de su propia fila; la factura solo trae el id.
  let cliente = 'Cliente';
  const cli = await sb.from('cliente')
    .select('nombre, razon_social')
    .eq('id', String(f.cliente_id)).eq('tenant_id', liga.tenantId).maybeSingle();
  if (cli.error) {
    logger.error('portal_pago.cliente', { err: cli.error.message });
  } else if (cli.data) {
    const c = cli.data as { nombre: unknown; razon_social: unknown };
    cliente = String(c.razon_social ?? c.nombre ?? 'Cliente');
  }

  if (propuestas.error) {
    logger.error('portal_pago.propuestas', { err: propuestas.error.message });
  }
  if (rep.error) {
    logger.error('portal_pago.rep', { err: rep.error.message });
  }
  if (repsConXml.error) {
    logger.error('portal_pago.rep_con_xml', { err: repsConXml.error.message });
  }

  const t = (tenant.data ?? {}) as { nombre?: unknown; razon_social?: unknown };
  // Si la segunda lectura falló, NINGÚN complemento se anuncia como
  // descargable. Un botón que no baja nada es peor que no ofrecerlo, y esta es
  // la degradación que respeta esa regla: el cliente ve el folio citable.
  const conXml = new Set(
    (repsConXml.data ?? []).map((r) => String((r as { cfdi_uuid: unknown }).cfdi_uuid)),
  );

  return {
    ok: true,
    vista: {
      ligaId: liga.ligaId,
      tenantId: liga.tenantId,
      facturaId: liga.facturaId,
      flota: String(t.razon_social ?? t.nombre ?? 'La flota'),
      cliente,
      factura: {
        serie: (f.serie as string | null) ?? null,
        folio: (f.folio as string | null) ?? null,
        cfdiUuid: (f.cfdi_uuid as string | null) ?? null,
        fecha: String(f.fecha),
        venceEn: (f.vence_en as string | null) ?? null,
        estatus,
        total: Number(f.total),
        moneda: String(f.moneda ?? 'MXN'),
        saldo,
        pagado,
      },
      propuestas: (propuestas.data ?? []).map((p) => {
        const r = p as Record<string, unknown>;
        return {
          fecha: String(r.fecha),
          monto: Number(r.monto),
          referencia: String(r.referencia),
          estado: r.estado as PropuestaDelPortal['estado'],
          registradaEn: String(r.registrada_en),
        };
      }),
      reps: (rep.data ?? []).map((fila) => {
        const r = fila as Record<string, unknown>;
        return {
          cfdiUuid: String(r.cfdi_uuid),
          fechaPago: String(r.fecha_pago),
          impPagado: Number(r.imp_pagado),
          tieneXml: conXml.has(String(r.cfdi_uuid)),
        };
      }),
    },
  };
}

/** `null` si no hay número. `Number(null)` es 0 y aquí un 0 mentiría. */
function numeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type TipoAcceso = 'vista' | 'pago_propuesto' | 'rep_mostrado' | 'liga_expirada' | 'liga_revocada';

/**
 * La bitácora del portal. SIN IP Y SIN USER-AGENT, y no es un olvido.
 *
 * El visitante es un tercero que nunca aceptó un aviso de privacidad de
 * Likida. Para lo que esta bitácora existe —"¿el cliente ya vio la factura?",
 * "¿desde cuándo dice que pagó?"— la IP no aporta y sí crea un dato personal
 * que habría que declarar, resguardar y purgar. Minimización, mismo criterio
 * que `sitio_evento` (0223).
 *
 * NUNCA LANZA: la bitácora no puede impedirle a un cliente ver su factura.
 */
export async function anotarAcceso(
  liga: { ligaId: string; tenantId: string },
  tipo: TipoAcceso,
  detalle?: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from('portal_pago_acceso').insert({
      tenant_id: liga.tenantId,
      liga_id: liga.ligaId,
      tipo,
      detalle: detalle ?? null,
    });
    if (error) logger.warn('portal_pago.bitacora', { tipo, err: error.message });
  } catch (e) {
    logger.warn('portal_pago.bitacora', { tipo, err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Sello del último acceso, para que el contralor sepa si la liga llegó a manos
 * del cliente antes de perseguirlo por teléfono. Best-effort a propósito, igual
 * que `ultimo_uso_en` de las llaves de API: negarle la factura a un cliente por
 * no poder anotar una fecha sería el peor intercambio posible.
 */
export async function sellarUltimoAcceso(liga: { ligaId: string; tenantId: string }): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from('portal_pago_liga')
      .update({ ultimo_acceso_en: new Date().toISOString() })
      .eq('id', liga.ligaId).eq('tenant_id', liga.tenantId);
    if (error) logger.warn('portal_pago.sello_acceso', { err: error.message });
  } catch (e) {
    logger.warn('portal_pago.sello_acceso', { err: e instanceof Error ? e.message : String(e) });
  }
}

// ── LO QUE VE EL CONTRALOR ─────────────────────────────────────────────────

export interface PropuestaEnBandeja {
  id: string;
  facturaId: string;
  factura: string;
  cliente: string;
  fecha: string;
  monto: number;
  referencia: string;
  metodo: string | null;
  registradaEn: string;
  /** El saldo REAL de la factura en este momento. `null` = no se pudo leer, y
   *  la pantalla lo dice: conciliar a ciegas contra un cero inventado es
   *  exactamente lo que esta columna existe para impedir. */
  saldo: number | null;
  /** false = la factura de esta propuesta NO se pudo resolver, y entonces
   *  `factura` y `cliente` traen el texto que lo dice en vez de un rótulo
   *  inventado. La pantalla apaga el botón de conciliar. */
  identificada: boolean;
  /** El estatus REAL de la factura, o `null` si no se pudo resolver. Conciliar
   *  contra una cancelada rebota en `registrar_pago_tx`: verlo antes de
   *  apretar es la diferencia entre decidir y adivinar. */
  estatus: string | null;
}

/** Lo que se pinta cuando la factura de una propuesta no se pudo resolver.
 *
 *  AUDITORÍA 7, `c7-23`: antes decía «sin folio · Cliente», que son dos textos
 *  con dueño. «sin folio» es la VERDAD de `identificaFactura` cuando una
 *  factura no tiene ni folio ni UUID; usarlo aquí lo convertía en «no la pude
 *  resolver», y «Cliente» aparecía donde hay una razón social real. El
 *  contralor decidía sobre dinero mirando una fila que no identificaba nada.
 */
const NO_IDENTIFICADA = 'no se pudo identificar';

export interface LigaEnPanel {
  id: string;
  facturaId: string;
  factura: string;
  cliente: string;
  prefijo: string;
  expiraEn: string;
  /** `null` = NUNCA SE ABRIÓ. No se lee como "hace mucho". */
  ultimoAccesoEn: string | null;
}

/**
 * Un REP ya registrado, como lo ve el CONTRALOR (no el pagador).
 *
 * `rep_emitido` sólo se leía del lado del cliente (`vistaDelPortal`): quien
 * registra el complemento lo hacía a ciegas y no volvía a verlo nunca. La
 * pantalla incluso prometía lo contrario. Sin esta lista no había forma de
 * contestar «¿ya le mandamos el complemento a este cliente?» sin abrir la
 * base — y menos «¿ya lo abrió?», que es lo que `entregadoEn` responde.
 */
export interface RepEnPanel {
  id: string;
  facturaId: string;
  factura: string;
  cliente: string;
  cfdiUuid: string;
  fechaPago: string;
  impPagado: number | null;
  formaPago: string | null;
  registradoEn: string;
  /** `null` = el cliente NUNCA lo ha abierto. No se lee como "hace mucho". */
  entregadoEn: string | null;
}

export interface PanelPortal {
  pendientes: PropuestaEnBandeja[];
  ligasVivas: LigaEnPanel[];
  /** Facturas emitidas sin liga viva: las candidatas a generar enlace. */
  facturasSinLiga: Array<{ id: string; factura: string; cliente: string; saldo: number | null }>;
  /** Los últimos REPs registrados por esta flota, del más nuevo al más viejo. */
  reps: RepEnPanel[];
  /** `true` si hay más REPs de los que cupieron: un tope callado es una cifra
   *  inventada, así que la pantalla lo DICE (hallazgo c7-4). */
  repsTruncados: boolean;
}

/** Cuántos REPs trae el panel. Se declara para poder decir "hay más". */
export const TOPE_REPS_PANEL = 50;

/**
 * Todo lo del portal para UNA flota. Falla POR VALOR hacia arriba (lanza), como
 * el resto de las lecturas del panel: la pantalla pinta el error dicho, y no
 * una bandeja vacía que se leería como "ningún cliente ha registrado nada".
 */
export async function panelDelPortal(tenantId: string): Promise<PanelPortal> {
  const sb = supabaseAdmin();

  const [prop, ligas, facturas, saldos, reps] = await Promise.all([
    sb.from('portal_pago_propuesta')
      .select('id, factura_id, fecha, monto, referencia, metodo, registrada_en')
      .eq('tenant_id', tenantId).eq('estado', 'pendiente')
      .order('registrada_en', { ascending: true }).limit(200),
    sb.from('portal_pago_liga')
      .select('id, factura_id, token_prefijo, expira_en, ultimo_acceso_en')
      .eq('tenant_id', tenantId).is('revocada_en', null)
      .order('creada_en', { ascending: false }).limit(200),
    sb.from('factura_emitida')
      .select('id, serie, folio, cfdi_uuid, cliente_id, estatus')
      .eq('tenant_id', tenantId).in('estatus', ['emitida', 'pagada'])
      .order('fecha', { ascending: false }).limit(300),
    sb.from('factura_saldo')
      .select('factura_id, saldo')
      .eq('tenant_id', tenantId).limit(1000),
    // NO se selecciona `xml`: son 50 blobs de CFDI que la lista no pinta.
    // Se pide UNO más que el tope para saber si hay más sin traerlos todos.
    // `.order()` va SIEMPRE con `.limit()` — un tope sin orden alimentando una
    // lista publicada es una lista inventada (c7-4).
    sb.from('rep_emitido')
      .select('id, factura_id, cfdi_uuid, fecha_pago, imp_pagado, forma_pago_p, registrado_en, entregado_en')
      .eq('tenant_id', tenantId)
      .order('registrado_en', { ascending: false })
      .limit(TOPE_REPS_PANEL + 1),
  ]);

  if (prop.error) throw new Error(`panelDelPortal: propuestas: ${prop.error.message}`);
  if (ligas.error) throw new Error(`panelDelPortal: ligas: ${ligas.error.message}`);
  if (facturas.error) throw new Error(`panelDelPortal: facturas: ${facturas.error.message}`);
  // Los REPs LANZAN como las otras tres: una lista vacía por una consulta
  // caída se leería como «no hemos emitido ninguno», que es justo la
  // conclusión que haría emitir uno repetido.
  if (reps.error) throw new Error(`panelDelPortal: reps: ${reps.error.message}`);
  // El saldo se degrada: sin él la bandeja sigue sirviendo, y cada renglón
  // dirá «sin dato» en vez de un cero que invitaría a conciliar a ciegas.
  if (saldos.error) logger.error('portal_pago.panel_saldos', { err: saldos.error.message });

  // ── LAS FACTURAS QUE LA PRIMERA LECTURA NO ALCANZÓ (`c7-23`) ─────────────
  //
  // La consulta de arriba trae las 300 más recientes y SOLO las `emitida` /
  // `pagada`, porque es la lista de candidatas a generar enlace. Pero la
  // bandeja y los enlaces vivos pueden apuntar a facturas fuera de ese corte:
  // una que se canceló después de registrar la propuesta, o cualquiera más
  // vieja que las 300. Esas se resuelven aquí, POR ID y sin filtro de estatus.
  // Lo que no aparezca ni así se pinta como «no se pudo identificar» — nunca
  // con un rótulo inventado.
  const filasFactura = [...(facturas.data ?? [])];
  const yaResueltas = new Set(filasFactura.map((f) => String((f as { id: unknown }).id)));
  const faltantes = [...new Set([
    ...(prop.data ?? []).map((p) => String((p as { factura_id: unknown }).factura_id)),
    ...(ligas.data ?? []).map((l) => String((l as { factura_id: unknown }).factura_id)),
    // Los REPs entran a la misma resolución: un complemento se registra sobre
    // una factura que a menudo YA se pagó y cayó fuera de las 300 recientes.
    // Sin esto, la lista de REPs se pintaría entera «no se pudo identificar».
    ...(reps.data ?? []).map((r) => String((r as { factura_id: unknown }).factura_id)),
  ])].filter((id) => !yaResueltas.has(id));

  if (faltantes.length > 0) {
    const extra = await sb.from('factura_emitida')
      .select('id, serie, folio, cfdi_uuid, cliente_id, estatus')
      .eq('tenant_id', tenantId).in('id', faltantes.slice(0, 400)).limit(400);
    // Se degrada, no se lanza: sin estas filas la bandeja sigue sirviendo y los
    // renglones afectados DICEN que no se pudieron identificar. Tirar la
    // pantalla entera por una factura vieja sería peor.
    if (extra.error) logger.error('portal_pago.panel_facturas_extra', { err: extra.error.message });
    else filasFactura.push(...(extra.data ?? []));
  }

  const clientes = new Map<string, string>();
  const idsCliente = [...new Set(filasFactura.map((f) => String((f as { cliente_id: unknown }).cliente_id)))];
  if (idsCliente.length > 0) {
    const cli = await sb.from('cliente').select('id, nombre, razon_social')
      .eq('tenant_id', tenantId).in('id', idsCliente).limit(1000);
    if (cli.error) throw new Error(`panelDelPortal: clientes: ${cli.error.message}`);
    for (const c of cli.data ?? []) {
      const r = c as { id: unknown; nombre: unknown; razon_social: unknown };
      clientes.set(String(r.id), String(r.razon_social ?? r.nombre ?? 'Cliente'));
    }
  }

  const porFactura = new Map<string, { rotulo: string; cliente: string; estatus: string }>();
  for (const f of filasFactura) {
    const r = f as Record<string, unknown>;
    porFactura.set(String(r.id), {
      rotulo: rotuloFactura(r),
      // El cliente sí puede caer a «Cliente»: ahí el `null` significa que esa
      // fila de `cliente` no trae ni razón social ni nombre, no que no se haya
      // podido resolver la factura.
      cliente: clientes.get(String(r.cliente_id)) ?? 'Cliente',
      estatus: String(r.estatus),
    });
  }

  const saldoDe = new Map<string, number | null>();
  for (const s of saldos.data ?? []) {
    const r = s as { factura_id: unknown; saldo: unknown };
    saldoDe.set(String(r.factura_id), numeroONull(r.saldo));
  }

  const conLiga = new Set((ligas.data ?? []).map((l) => String((l as { factura_id: unknown }).factura_id)));

  return {
    pendientes: (prop.data ?? []).map((p) => {
      const r = p as Record<string, unknown>;
      const fid = String(r.factura_id);
      const meta = porFactura.get(fid);
      return {
        id: String(r.id),
        facturaId: fid,
        factura: meta?.rotulo ?? NO_IDENTIFICADA,
        cliente: meta?.cliente ?? NO_IDENTIFICADA,
        fecha: String(r.fecha),
        monto: Number(r.monto),
        referencia: String(r.referencia),
        metodo: (r.metodo as string | null) ?? null,
        registradaEn: String(r.registrada_en),
        saldo: saldoDe.get(fid) ?? null,
        identificada: meta !== undefined,
        estatus: meta?.estatus ?? null,
      };
    }),
    ligasVivas: (ligas.data ?? []).map((l) => {
      const r = l as Record<string, unknown>;
      const fid = String(r.factura_id);
      const meta = porFactura.get(fid);
      return {
        id: String(r.id),
        facturaId: fid,
        factura: meta?.rotulo ?? NO_IDENTIFICADA,
        cliente: meta?.cliente ?? NO_IDENTIFICADA,
        prefijo: String(r.token_prefijo),
        expiraEn: String(r.expira_en),
        ultimoAccesoEn: (r.ultimo_acceso_en as string | null) ?? null,
      };
    }),
    facturasSinLiga: (facturas.data ?? [])
      .filter((f) => !conLiga.has(String((f as { id: unknown }).id)))
      .map((f) => {
        const r = f as Record<string, unknown>;
        const fid = String(r.id);
        return {
          id: fid,
          factura: rotuloFactura(r),
          cliente: clientes.get(String(r.cliente_id)) ?? 'Cliente',
          saldo: saldoDe.get(fid) ?? null,
        };
      })
      // Solo las que todavía deben algo: un enlace de pago sobre una factura
      // saldada no tiene para qué existir. Las de saldo desconocido SÍ entran —
      // «no sé» no es «ya pagó».
      .filter((f) => f.saldo === null || f.saldo > 0.01)
      .slice(0, 50),
    reps: (reps.data ?? []).slice(0, TOPE_REPS_PANEL).map((f) => {
      const r = f as Record<string, unknown>;
      const fid = String(r.factura_id);
      const meta = porFactura.get(fid);
      return {
        id: String(r.id),
        facturaId: fid,
        factura: meta?.rotulo ?? NO_IDENTIFICADA,
        cliente: meta?.cliente ?? NO_IDENTIFICADA,
        cfdiUuid: String(r.cfdi_uuid),
        fechaPago: String(r.fecha_pago),
        impPagado: numeroONull(r.imp_pagado),
        formaPago: (r.forma_pago_p as string | null) ?? null,
        registradoEn: String(r.registrado_en),
        entregadoEn: (r.entregado_en as string | null) ?? null,
      };
    }),
    repsTruncados: (reps.data ?? []).length > TOPE_REPS_PANEL,
  };
}

function rotuloFactura(r: Record<string, unknown>): string {
  const folio = (r.folio as string | null) ?? null;
  const serie = (r.serie as string | null) ?? null;
  if (folio) return serie ? `${serie}-${folio}` : folio;
  const uuid = (r.cfdi_uuid as string | null) ?? null;
  return uuid ?? 'sin folio';
}

export type XmlDelRep =
  | { ok: true; uuid: string; xml: string }
  /** No hay XML para ese folio: o el REP no existe en esta factura, o existe y
   *  la flota no cargó el archivo. Es un HECHO comprobado. */
  | { ok: false; motivo: 'sin_xml' }
  /** No se pudo PREGUNTAR. No es lo mismo, y por eso no comparte desenlace. */
  | { ok: false; motivo: 'no_disponible' };

/**
 * El XML de UN complemento, solo para quien trae el token de ESA factura.
 *
 * Vive aquí y no en la vista porque un documento fiscal no tiene por qué
 * viajar en cada render de la página.
 *
 * ── EL FOLIO VIENE DE LA URL, Y NO AMPLÍA NADA (`c7-16`) ─────────────────
 *
 * Con parcialidades hay varios REP y el cliente necesita bajar cada uno, así
 * que la ruta lleva el folio del que se pide. Ese folio NO es una llave de
 * alcance: la consulta sigue anclada al `factura_id` y al `tenant_id` de la
 * liga resuelta, y el folio solo elige DENTRO de eso. Un UUID de otra flota (o
 * de otra factura de la misma) no encuentra fila; se contesta `sin_xml`, que es
 * lo mismo que contestaría un folio inventado.
 *
 * ── Y EL ERROR DE LA BASE NO SE DISFRAZA DE «NO HAY» (`c7-24`) ───────────
 *
 * Antes esto devolvía `null` tanto cuando no había XML como cuando Supabase
 * reportaba un error, y la ruta contestaba 404 con «Todavía no hay un XML de
 * complemento para esta factura» — una afirmación de hecho FALSA por un hipo
 * de la base, que manda al cliente a molestar a la flota por un archivo que sí
 * está ahí. Los dos desenlaces van separados y la ruta contesta distinto.
 */
export async function xmlDelRep(liga: LigaResuelta, cfdiUuid: string): Promise<XmlDelRep> {
  const uuid = cfdiUuid.trim().toLowerCase();
  // Sin forma de UUID ni se consulta: es la misma economía que `prefijoDeToken`
  // sobre la ruta pública, y de paso no se manda a la base lo que un visitante
  // quiera escribir.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return { ok: false, motivo: 'sin_xml' };
  }

  const { data, error } = await supabaseAdmin()
    .from('rep_emitido')
    .select('cfdi_uuid, xml')
    .eq('factura_id', liga.facturaId).eq('tenant_id', liga.tenantId)
    .eq('cfdi_uuid', uuid)
    .not('xml', 'is', null)
    .limit(1);

  if (error) {
    logger.error('portal_pago.xml_rep', { err: error.message });
    return { ok: false, motivo: 'no_disponible' };
  }
  const fila = (data ?? [])[0] as { cfdi_uuid?: unknown; xml?: unknown } | undefined;
  if (!fila || typeof fila.xml !== 'string' || fila.xml.length === 0) {
    return { ok: false, motivo: 'sin_xml' };
  }
  return { ok: true, uuid: String(fila.cfdi_uuid), xml: fila.xml };
}
