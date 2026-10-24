import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { createHash } from 'node:crypto';
import { enviarTexto, sendTemplate, motivoDeFalloWhatsApp, esReintentableMeta, esTokenMetaInvalido } from '@/lib/meta/client';
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { getPorFacturar, type TicketPorFacturar } from './pendientes';
import { enrutar, mensajeParaEncargado, repartir } from './enrutar';
import { portalesOperables } from './adaptadores/registro';
import { portalesAutomatizados } from './agente';
import { cuentasCompartidas } from './cuentas';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO POR WHATSAPP DE LO QUE HAY QUE FACTURAR.
//
// Cierra el camino que empieza en el OCR: se leyó la liga del ticket, se
// reconoció el portal, se calculó el plazo, y ahora sale por el mismo canal por
// el que entró la foto.
//
// ── SE AVISA POR LOTE, NO POR TICKET ─────────────────────────────────────
//
// Un viaje de 22 comprobantes generaría 21 mensajes. Nadie lee 21 mensajes, y
// WhatsApp cobra cada plantilla. Va UNO por flota con lo que urge, ordenado por
// plazo. El encargado abre el teléfono una vez y ve toda su tarea.
//
// ── QUÉ SE AVISA Y QUÉ NO ────────────────────────────────────────────────
//
// Solo lo que la persona puede resolver: los que piden cuenta (tiene la sesión)
// y los que urgen. Lo que la máquina puede hacer sola no se le manda — avisarle
// de algo que ya se está haciendo entrena a ignorar el aviso.
//
// Y lo VENCIDO no va: ya no se puede facturar. Se ve en la pantalla, con su
// monto perdido, pero no se le manda a alguien a intentar lo imposible.
// ═══════════════════════════════════════════════════════════════════════════

/** Plantilla de Meta para el aviso de plazo. Tiene que estar aprobada. */
const PLANTILLA_PLAZO = 'plazo_factura';

/** A37-S43-07: cuántos avisos por flota y por día, como máximo. El cron corre
 *  cada 15 min y cada bloqueo nuevo disparaba el aviso completo otra vez. */
const TOPE_AVISOS_POR_DIA = 3;
/** Meta: fuera de la ventana de 24 h el texto libre se rechaza (y SOLO ahí
 *  tiene sentido la plantilla). */
const CODIGO_FUERA_DE_VENTANA = 131047;

export interface ResultadoAviso {
  enviado: boolean;
  /** A cuántos tickets se refiere el aviso. */
  tickets: number;
  /** Por qué no salió, en palabras que digan qué arreglar. */
  motivo?: string;
  /** El texto que se armó, para poder enseñarlo aunque el envío falle. */
  texto: string;
  /**
   * Por cuál de los dos caminos salió. `texto` es el bueno —lleva la liga, los
   * campos y el plazo—; `plantilla` es el plan B y solo dice el conteo, así que
   * quien lea `via: 'plantilla'` sabe que el encargado NO tiene el detalle en
   * el teléfono y lo va a buscar en el panel.
   */
  via?: 'texto' | 'plantilla';
}

/**
 * Arma el aviso de una flota: qué falta por facturar y qué urge.
 *
 * NO MANDA NADA si no hay nada que la persona pueda hacer. Un aviso vacío —"no
 * tienes pendientes"— gasta una plantilla de pago y enseña a ignorar el canal.
 */
/**
 * `sabeOperarlo` sale de `portalesOperables()` —los adaptadores escritos más
 * los pilotables cuando el piloto está encendido—, que es «qué sé hacer» y no
 * «qué puedo hacer ahora con la flota cargada» (eso es `portalesAutomatizados`).
 * La distinción importa aquí dos veces: al encargado hay que avisarle de un
 * portal que NADIE va a operar —eso no se arregla solo—, y NO hay que avisarle
 * de uno que el piloto va a intentar en la siguiente corrida: avisar de algo
 * que ya se está haciendo entrena a ignorar el aviso.
 *
 * `cuentaCompartida` es la MISMA pregunta que decide `facturarAlVuelo`/
 * `facturarLoteAlVuelo` (`cuentasCompartidas(tenantId)`, `facturacion/cuentas.ts`):
 * ¿la flota ya compartió en el cofre la cuenta de ESE portal? Sin pasarla, esta
 * función la evaluaba siempre como `false` —el default de `enrutar`— y el aviso
 * podía decirle al encargado "ese portal pide cuenta" para un comercio que el
 * cofre YA tiene cubierto, mientras la decisión real de facturación sí veía la
 * cuenta compartida y mandaba el ticket por el camino automático: dos lecturas
 * distintas del mismo dato, en el mismo flujo.
 */
export function armarAviso(
  tickets: TicketPorFacturar[],
  sabeOperarlo: (clave: string) => boolean = (c) => portalesOperables().includes(c),
  cuentaCompartida: (clave: string) => boolean = () => false,
): { texto: string; cuantos: number; ids: string[] } {
  const { mensajes, incompletos } = repartir(tickets, sabeOperarlo, cuentaCompartida);

  // Los que necesitan a una persona: los de cuenta, y los incompletos que aún
  // no vencen (esos sí se pueden salvar buscando el dato en el papel).
  const paraPersona = [
    ...mensajes.map((x) => x.t),
    ...incompletos.filter((x) => !x.t.caducidad.vencido && !x.t.caducidad.desconocido).map((x) => x.t),
  // A37-S43-06: lo que se factura MENSUAL contra la cuenta (TAG de peaje) no es un
  // comprobante «sin factura» que la persona pueda resolver: inflaba el conteo.
  ].filter((t) => t.comercio?.noAutomatizable?.razon !== 'factura_mensual_por_cuenta');

  if (paraPersona.length === 0) return { texto: '', cuantos: 0, ids: [] };

  // Lo que vence primero, arriba. Es lo único con remedio.
  // Los de fecha ilegible no tienen plazo que correr: van al final (A37-S43-05).
  const urgencia = (t: TicketPorFacturar) => (t.caducidad.desconocido ? Number.POSITIVE_INFINITY : t.caducidad.diasRestantes);
  const orden = [...paraPersona].sort((a, b) => urgencia(a) - urgencia(b));

  const urgentes = orden.filter((t) => t.caducidad.urgente);
  const lineas: string[] = [];

  lineas.push(
    urgentes.length > 0
      ? `Tienes ${orden.length} comprobante(s) sin factura, y ${urgentes.length} vence(n) en 2 días o menos.`
      : `Tienes ${orden.length} comprobante(s) sin factura.`,
  );
  lineas.push('');

  // Máximo 6 en el cuerpo: lo que cabe en una pantalla de teléfono. El resto se
  // cuenta al final — decir "y 14 más" es honesto; listar 20 hace que no se lea
  // ninguno.
  for (const t of orden.slice(0, 6)) {
    const r = enrutar(t, t.comercio ? sabeOperarlo(t.comercio.clave) : false, t.comercio ? cuentaCompartida(t.comercio.clave) : false);
    if (r.via === 'mensaje') {
      lineas.push(mensajeParaEncargado(t, r));
    } else {
      const falta = r.via === 'incompleto' ? r.falta.join('; ') : '';
      const dias = t.caducidad.desconocido
        ? 'sin fecha legible'
        : t.caducidad.urgente
        ? (t.caducidad.diasRestantes === 0 ? '⚠️ VENCE HOY' : `⚠️ ${t.caducidad.diasRestantes} día(s)`)
        : `${t.caducidad.diasRestantes} días`;
      lineas.push(`${t.concepto} — ${dias}${falta ? ` · falta: ${falta}` : ''}`);
    }
    lineas.push('');
  }

  if (orden.length > 6) lineas.push(`…y ${orden.length - 6} más en el panel.`);

  return { texto: lineas.join('\n').trim(), cuantos: orden.length, ids: orden.map((t) => t.gastoId).sort() };
}

/** La huella de lo que se está avisando: el día y los gastos. Mismo conjunto el
 *  mismo día = mismo aviso; un ticket nuevo cambia la huella. */
export function huellaDelAviso(dia: string, ids: string[]): string {
  return createHash('sha256').update(`${dia}|${[...ids].sort().join(',')}`).digest('hex').slice(0, 32);
}

/**
 * A37-S43-07: lo que ya se avisó HOY a esta flota, leído de la bitácora donde
 * `avisarPorFacturar` deja constancia. Devuelve `null` si no se pudo leer —y
 * quien llama NO manda—: un mensaje a una persona se falla cerrado, y el cron
 * lo reintenta en 15 min.
 */
async function avisosDeHoy(tenantId: string, dia: string): Promise<{ huellas: string[]; total: number } | null> {
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from('bitacora_auditoria')
      .select('detalle')
      .eq('accion', 'facturacion.aviso_enviado')
      .eq('entidad', 'tenant')
      .eq('entidad_id', tenantId)
      .gte('ocurrio_en', `${dia}T00:00:00-06:00`)
      .order('ocurrio_en', { ascending: false })
      .order('id', { ascending: false })
      .limit(20), 'facturacion.avisos_de_hoy');
    if (error) {
      logger.warn('facturacion.aviso_bitacora_ilegible', { tenantId, err: error.message });
      return null;
    }
    const filas = (data ?? []) as Array<{ detalle?: { huella?: unknown } | null }>;
    return {
      huellas: filas.map((f) => f.detalle?.huella).filter((h): h is string => typeof h === 'string'),
      total: filas.length,
    };
  } catch (e) {
    logger.warn('facturacion.aviso_bitacora_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Manda el aviso al encargado de una flota.
 *
 * PRIMERO EL TEXTO COMPLETO, y la plantilla solo de respaldo. Dentro de la
 * ventana de 24 h WhatsApp entrega texto libre, y ese texto lleva lo que el
 * encargado necesita para facturar desde el teléfono: la liga, los campos y el
 * plazo. Fuera de la ventana Meta lo rechaza y entra `sendTemplate` con la
 * plantilla aprobada — que solo puede decir el conteo. Si la plantilla tampoco
 * sale, se DICE: un aviso que falla en silencio deja al encargado sin saber
 * que tiene tickets venciéndose.
 */
export async function avisarPorFacturar(args: {
  tenantId: string;
  /** Teléfono del encargado. Sin él no hay a quién escribirle. */
  telefono: string;
  hoy?: string;
}): Promise<ResultadoAviso> {
  const tickets = await getPorFacturar(args.tenantId, args.hoy);
  // La misma pregunta que ve `facturarAlVuelo`/`facturarLoteAlVuelo` antes de decidir
  // quién factura: solo se lee el cofre si hay algún comercio que pida cuenta, igual
  // que allá (una lectura de base por lote, no por ticket).
  const cuentas = tickets.some((t) => t.comercio?.requiereCuenta) ? await cuentasCompartidas(args.tenantId) : new Set<string>();
  // A37-S43-01: «qué sé operar» se pregunta POR FLOTA, igual que lo hace
  // `facturarAlVuelo` (`adaptadorDe(tenantId, …)`). El registro global
  // (`portalesOperables`) decía «sí» para una flota sin datos fiscales cuyos
  // adaptadores nunca se registraron: el ticket salía `sin_adaptador`, el aviso
  // lo enrutaba como «automático» y nadie lo veía hasta que vencía.
  const delaFlota = new Set(portalesAutomatizados(args.tenantId));
  const { texto: base, cuantos, ids } = armarAviso(tickets, (clave) => delaFlota.has(clave), (clave) => cuentas.has(clave));
  const texto = cuantos > 0 && delaFlota.size === 0
    ? `${base}\n\nNo se pueden facturar solos: faltan datos fiscales de la flota (RFC, razón social, código postal, régimen o correo).`
    : base;

  if (cuantos === 0) {
    return { enviado: false, tickets: 0, texto: '', motivo: 'No hay nada que una persona tenga que facturar.' };
  }
  if (!args.telefono) {
    return { enviado: false, tickets: cuantos, texto, motivo: 'Esa flota no tiene un teléfono de encargado registrado.' };
  }

  // ── EL TEXTO BUENO PRIMERO, LA PLANTILLA DESPUÉS ─────────────────────────
  //
  // `armarAviso` construye el mensaje completo —la liga del portal, el WebID y
  // cada campo que ese portal pide, el plazo— y hasta el 20-ago-2026 ese texto
  // SE TIRABA: lo único que salía era la plantilla con el conteo, y el
  // encargado recibía "tienes 3 comprobantes" sin la liga ni los datos que son
  // el punto del aviso. El mismo bug que `escalar_viaje.ts` ya pagó con
  // `armarAvisoJefe`: el texto que sí se escribió para esto, sin un llamador.
  //
  // El texto libre solo lo entrega WhatsApp dentro de la ventana de 24 h desde
  // el último mensaje del destinatario. Fuera de ella Meta lo rechaza (131047)
  // y ahí entra la plantilla, que es lo único que sí se entrega — dice el
  // conteo y deja el detalle en el panel. Por eso se intenta en este orden y
  // no al revés: el aviso rico cuando se puede, el pobre solo como respaldo.
  // A37-S43-07: SIN repetir ni inundar. Se mira lo ya avisado hoy: el mismo
  // conjunto de gastos no se reenvía, y hay un tope diario por flota. Si la
  // bitácora no se puede leer NO se manda (fail-closed hacia una persona).
  const dia = args.hoy ?? hoyMx();
  const huella = huellaDelAviso(dia, ids);
  const previos = await avisosDeHoy(args.tenantId, dia);
  if (!previos) {
    return { enviado: false, tickets: cuantos, texto, motivo: 'No se pudo comprobar si ya se avisó hoy; se reintenta en la siguiente corrida.' };
  }
  if (previos.huellas.includes(huella)) {
    return { enviado: false, tickets: cuantos, texto, motivo: 'Ya se avisó hoy de estos mismos comprobantes.' };
  }
  if (previos.total >= TOPE_AVISOS_POR_DIA) {
    return { enviado: false, tickets: cuantos, texto, motivo: `Ya se mandaron ${TOPE_AVISOS_POR_DIA} avisos hoy a esta flota; lo nuevo va en el siguiente día.` };
  }

  const envio = await enviarTexto(args.telefono, texto);
  let via: 'texto' | 'plantilla' = 'texto';
  let wamid: string | null = envio.ok ? envio.id : null;

  if (!envio.ok) {
    // A37-S43-07: la plantilla SOLO si Meta dijo «fuera de la ventana de 24 h».
    // Un error ambiguo (timeout, 5xx) pudo haber entregado el texto —y
    // `enviarTexto` ya lo dejó en la cola con reintento—: mandar además la
    // plantilla eran DOS mensajes.
    if (envio.codigo !== CODIGO_FUERA_DE_VENTANA) {
      logger.warn('facturacion.aviso_texto_no_salio', { tenantId: args.tenantId, codigo: envio.codigo, status: envio.status });
      // Si `enviarTexto` lo dejó EN COLA (ambiguo, rate limit, token), el
      // mensaje puede llegar solo: se anota para que la corrida siguiente no
      // lo vuelva a mandar encima. Un rechazo definitivo no se anota.
      if (esReintentableMeta(envio.codigo, envio.status) || esTokenMetaInvalido(envio.codigo, envio.status)) {
        await anotarBitacora(
          { tenantId: args.tenantId, actor: 'sistema', accion: 'facturacion.aviso_enviado', entidad: 'tenant', entidadId: args.tenantId,
            detalle: { tickets: cuantos, wamid: null, via: 'texto', huella, en_cola: true } },
          { evento: 'facturacion.bitacora' },
        );
      }
      return { enviado: false, tickets: cuantos, texto, motivo: motivoDeFalloWhatsApp(envio.error, envio.codigo) };
    }
    via = 'plantilla';
    const r = await sendTemplate(args.telefono, PLANTILLA_PLAZO, {
      parametros: [String(cuantos)],
    });
    if (!r.ok) {
      logger.warn('facturacion.aviso_no_salio', { tenantId: args.tenantId, codigo: r.codigo });
      return { enviado: false, tickets: cuantos, texto, motivo: motivoDeFalloWhatsApp(r.error, r.codigo) };
    }
    wamid = r.id ?? null;
  }

  // Queda constancia de a quién se le avisó, de cuántos, y POR CUÁL camino: un
  // aviso por plantilla no llevó el detalle, y mañana eso explica por qué el
  // encargado preguntó "¿cuáles?" en vez de facturar.
  //
  // La entidad es la FLOTA (el aviso es un lote por tenant, no un gasto: hasta
  // la auditoría 18 decía `gasto` con el id del tenant, y quien copiaba ese id
  // para buscar el gasto no lo encontraba). El actor es `'sistema'` a
  // propósito: lo manda el cron, sin persona detrás; el encargado es el
  // DESTINATARIO, no quien actuó, y su teléfono no va a la bitácora.
  await anotarBitacora(
    { tenantId: args.tenantId, actor: 'sistema', accion: 'facturacion.aviso_enviado', entidad: 'tenant', entidadId: args.tenantId,
      detalle: { tickets: cuantos, wamid, via, huella } },
    { evento: 'facturacion.bitacora' },
  );

  return { enviado: true, tickets: cuantos, texto, via };
}
