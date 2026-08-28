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
//   `ok`            — la factura, su saldo REAL y lo que haya de REP.
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
  rep: RepDelPortal | null;
}

export type ResolucionPortal =
  | { ok: true; vista: VistaPortal }
  | { ok: false; motivo: 'no_valida' }
  | { ok: false; motivo: 'no_disponible' };

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

  const [factura, tenant, propuestas, rep] = await Promise.all([
    sb.from('factura_emitida')
      .select('id, cliente_id, serie, folio, cfdi_uuid, fecha, vence_en, estatus, total, moneda')
      .eq('id', liga.facturaId).eq('tenant_id', liga.tenantId).maybeSingle(),
    sb.from('tenant').select('nombre, razon_social').eq('id', liga.tenantId).maybeSingle(),
    sb.from('portal_pago_propuesta')
      .select('fecha, monto, referencia, estado, registrada_en')
      .eq('liga_id', liga.ligaId).eq('tenant_id', liga.tenantId)
      .order('registrada_en', { ascending: false }).limit(50),
    sb.from('rep_emitido')
      .select('cfdi_uuid, fecha_pago, imp_pagado, xml')
      .eq('factura_id', liga.facturaId).eq('tenant_id', liga.tenantId)
      .order('fecha_pago', { ascending: false }).limit(1),
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

  const t = (tenant.data ?? {}) as { nombre?: unknown; razon_social?: unknown };
  const filaRep = (rep.data ?? [])[0] as Record<string, unknown> | undefined;

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
        estatus: String(f.estatus),
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
      rep: filaRep
        ? {
            cfdiUuid: String(filaRep.cfdi_uuid),
            fechaPago: String(filaRep.fecha_pago),
            impPagado: Number(filaRep.imp_pagado),
            tieneXml: typeof filaRep.xml === 'string' && filaRep.xml.length > 0,
          }
        : null,
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
}

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

export interface PanelPortal {
  pendientes: PropuestaEnBandeja[];
  ligasVivas: LigaEnPanel[];
  /** Facturas emitidas sin liga viva: las candidatas a generar enlace. */
  facturasSinLiga: Array<{ id: string; factura: string; cliente: string; saldo: number | null }>;
}

/**
 * Todo lo del portal para UNA flota. Falla POR VALOR hacia arriba (lanza), como
 * el resto de las lecturas del panel: la pantalla pinta el error dicho, y no
 * una bandeja vacía que se leería como "ningún cliente ha registrado nada".
 */
export async function panelDelPortal(tenantId: string): Promise<PanelPortal> {
  const sb = supabaseAdmin();

  const [prop, ligas, facturas, saldos] = await Promise.all([
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
  ]);

  if (prop.error) throw new Error(`panelDelPortal: propuestas: ${prop.error.message}`);
  if (ligas.error) throw new Error(`panelDelPortal: ligas: ${ligas.error.message}`);
  if (facturas.error) throw new Error(`panelDelPortal: facturas: ${facturas.error.message}`);
  // El saldo se degrada: sin él la bandeja sigue sirviendo, y cada renglón
  // dirá «sin dato» en vez de un cero que invitaría a conciliar a ciegas.
  if (saldos.error) logger.error('portal_pago.panel_saldos', { err: saldos.error.message });

  const clientes = new Map<string, string>();
  const idsCliente = [...new Set((facturas.data ?? []).map((f) => String((f as { cliente_id: unknown }).cliente_id)))];
  if (idsCliente.length > 0) {
    const cli = await sb.from('cliente').select('id, nombre, razon_social')
      .eq('tenant_id', tenantId).in('id', idsCliente).limit(1000);
    if (cli.error) throw new Error(`panelDelPortal: clientes: ${cli.error.message}`);
    for (const c of cli.data ?? []) {
      const r = c as { id: unknown; nombre: unknown; razon_social: unknown };
      clientes.set(String(r.id), String(r.razon_social ?? r.nombre ?? 'Cliente'));
    }
  }

  const porFactura = new Map<string, { rotulo: string; cliente: string }>();
  for (const f of facturas.data ?? []) {
    const r = f as Record<string, unknown>;
    porFactura.set(String(r.id), {
      rotulo: rotuloFactura(r),
      cliente: clientes.get(String(r.cliente_id)) ?? 'Cliente',
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
        factura: meta?.rotulo ?? 'sin folio',
        cliente: meta?.cliente ?? 'Cliente',
        fecha: String(r.fecha),
        monto: Number(r.monto),
        referencia: String(r.referencia),
        metodo: (r.metodo as string | null) ?? null,
        registradaEn: String(r.registrada_en),
        saldo: saldoDe.get(fid) ?? null,
      };
    }),
    ligasVivas: (ligas.data ?? []).map((l) => {
      const r = l as Record<string, unknown>;
      const fid = String(r.factura_id);
      const meta = porFactura.get(fid);
      return {
        id: String(r.id),
        facturaId: fid,
        factura: meta?.rotulo ?? 'sin folio',
        cliente: meta?.cliente ?? 'Cliente',
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
  };
}

function rotuloFactura(r: Record<string, unknown>): string {
  const folio = (r.folio as string | null) ?? null;
  const serie = (r.serie as string | null) ?? null;
  if (folio) return serie ? `${serie}-${folio}` : folio;
  const uuid = (r.cfdi_uuid as string | null) ?? null;
  return uuid ?? 'sin folio';
}

/**
 * El XML del REP, solo para quien trae el token de ESA factura.
 *
 * Vive aquí y no en la vista porque un documento fiscal no tiene por qué
 * viajar en cada render de la página. `null` cubre los dos casos honestos —no
 * hay REP, o el REP no trae XML— y ninguno de los dos es un error.
 */
export async function xmlDelRep(liga: LigaResuelta): Promise<{ uuid: string; xml: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from('rep_emitido')
    .select('cfdi_uuid, xml')
    .eq('factura_id', liga.facturaId).eq('tenant_id', liga.tenantId)
    .not('xml', 'is', null)
    .order('fecha_pago', { ascending: false })
    .limit(1);

  if (error) {
    logger.error('portal_pago.xml_rep', { err: error.message });
    return null;
  }
  const fila = (data ?? [])[0] as { cfdi_uuid?: unknown; xml?: unknown } | undefined;
  if (!fila || typeof fila.xml !== 'string' || fila.xml.length === 0) return null;
  return { uuid: String(fila.cfdi_uuid), xml: fila.xml };
}
