// ═══════════════════════════════════════════════════════════════════════════
// EL SELECTOR CENTRAL DE CANAL: texto/botones si la ventana de 24 h está
// abierta, plantilla si no — y constancia del motivo.
//
// Todo aviso que LIKIDA INICIA (jefe de tráfico, cobranza, escalación, «Mis
// reglas», relojes legales) pasa por aquí en vez de llamar a `sendText`:
//
//   · ventana ABIERTA      → texto (o botones). Si Meta aun así lo rechaza por
//                            ventana (el registro estaba viejo), plantilla.
//   · ventana CERRADA      → plantilla directa. Se evita la llamada de texto que
//                            Meta rechazaría con 131047 y la latencia que cuesta.
//   · ventana DESCONOCIDA  → texto y, si Meta lo rechaza por ventana, plantilla
//                            (el comportamiento de `avisarOficina` de siempre:
//                            un contacto sin fila puede tener la ventana abierta).
//
// ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
//   · Nunca lanza.
//   · Un rechazo que NO es de ventana (429, número inválido, red) NO cae a
//     plantilla: si es reintentable el texto ya quedó en `wa_outbox`, y mandar
//     además la plantilla duplicaría el aviso. El llamador recibe `reintentable`
//     para no consumir un sello/tier (RES-1).
//   · `ok:true` solo si Meta ACEPTÓ el mensaje (aceptado ≠ entregado).
//   · Cada decisión deja una fila en `wa_envio_registro` (motivo, canal, ventana)
//     y una línea de log — sin el teléfono completo.
// ═══════════════════════════════════════════════════════════════════════════
import { logger } from '@/lib/logger';
import { ventanaDeContacto, registrarDecisionEnvio, type EstadoVentana } from '@/lib/likida/wa_ventana';
import { encolarSalidaWhatsAppDedupe, leerSalidasPorLlave } from '@/lib/likida/wa_outbox';
import {
  enviarTexto, enviarBotones, sendTemplate, esReintentableMeta, motivoDeFalloWhatsApp,
  payloadBotones, payloadPlantilla, motivoDocumentoInvalido,
  type BotonAcuse, type EnvioWhatsApp, type DocumentoEncabezado,
} from './client';
import { armarComponentesPlantilla, type OpcionesPlantilla } from './plantilla_payload';

/** Rechazos de Meta que significan «fuera de la ventana de 24 h / el destinatario
 *  no abrió conversación»: solo una plantilla los atraviesa. */
export const CODIGOS_FUERA_VENTANA: readonly number[] = [131047, 131026, 131042];

export function esFueraDeVentana(codigo?: number): boolean {
  return codigo !== undefined && CODIGOS_FUERA_VENTANA.includes(codigo);
}

/** Misma regla que `esTokenMetaInvalido` de client.ts (190, o un 401 sin código): ese rechazo NO es «reintentable», pero
 *  `alFallarPorToken` SÍ deja el mensaje en `wa_outbox`. Copia local (y no importada) para no obligar a cada prueba que
 *  simula `./client` a exportar una función más. */
const esTokenVencido = (codigo?: number, status?: number): boolean => codigo === 190 || (codigo === undefined && status === 401);

/** (#132001) la plantilla no existe o no está aprobada. */
const PLANTILLA_NO_APROBADA = 132001;

export type MotivoEnvio =
  | 'ventana_abierta'
  | 'ventana_desconocida'
  | 'ventana_cerrada'
  | 'ventana_abierta_rechazada_por_meta'
  | 'ventana_desconocida_rechazada_por_meta'
  | 'ventana_cerrada_plantilla_no_aprobada_texto'
  | 'rechazo_no_ventana'
  | 'plantilla_rechazada';

export interface PlantillaRespaldo extends OpcionesPlantilla {
  nombre: string;
  idioma?: string;
}

export interface OpcionesEnvioConFallback {
  /** El mensaje completo para cuando se puede mandar texto libre. */
  texto: string;
  /** Si se dan, dentro de ventana salen como botones de respuesta rápida. */
  botones?: BotonAcuse[];
  /**
   * Documento (p. ej. el PDF de una liquidación) que viaja en el ENCABEZADO: en
   * ventana, el mensaje de botones lleva `header: document` (exige `botones`:
   * un documento sin botones se manda por la plantilla o no se manda); fuera de
   * ventana, la plantilla lleva el mismo documento en su encabezado (la
   * plantilla aprobada debe tener encabezado DOCUMENT; si no se da
   * `plantilla.encabezado`, se arma con este).
   */
  documento?: DocumentoEncabezado;
  /** Lo único que entra fuera de ventana. */
  plantilla: PlantillaRespaldo;
  /** Quién avisa («reglas.vigilante», «cobranza», …), para el registro. */
  contexto: string;
  tenantId?: string | null;
  ahora?: Date;
}

export type ResultadoEnvioConFallback =
  | { ok: true; via: 'texto' | 'botones' | 'plantilla'; id: string | null; motivo: MotivoEnvio; ventana: EstadoVentana }
  | {
    ok: false;
    motivo: MotivoEnvio;
    /** Lo que el encargado puede accionar, en palabras. */
    mensaje: string;
    codigo?: number;
    /** Código con que Meta rechazó el TEXTO (cuando se intentó) antes de la plantilla. */
    codigoTexto?: number;
    status?: number;
    /** El texto rebotó por ventana y la plantilla tampoco salió. */
    fueraDeVentana: boolean;
    /** «Vuelve más tarde» (429, bloqueo temporal): no consumir sellos/tiers. */
    reintentable: boolean;
    /** El cliente de Meta YA dejó este mensaje en `wa_outbox` (reintentable o token vencido 190/401, que no es
     *  «vuelve más tarde» pero sí se encola). Quien reclama un «una sola vez» NO debe soltar el reclamo ni reenviar. */
    encolado?: boolean;
    ventana: EstadoVentana;
  };

export async function enviarConFallback(
  telefono: string,
  op: OpcionesEnvioConFallback,
): Promise<ResultadoEnvioConFallback> {
  const ventana = await ventanaDeContacto(telefono, op.ahora);

  const enviarLibre = (): Promise<EnvioWhatsApp> => (
    op.botones && op.botones.length > 0
      ? (op.documento ? enviarBotones(telefono, op.texto, op.botones, op.documento) : enviarBotones(telefono, op.texto, op.botones))
      : enviarTexto(telefono, op.texto)
  );
  const viaLibre: 'texto' | 'botones' = op.botones && op.botones.length > 0 ? 'botones' : 'texto';
  const { nombre, idioma, ...resto } = conDocumento(op.plantilla, op.documento);

  const registrar = async (r: ResultadoEnvioConFallback, canal: 'texto' | 'botones' | 'plantilla' | 'ninguno', codigo?: number) => {
    logger.info('wa.envio_con_fallback', {
      contexto: op.contexto, ventana: ventana.estado, canal, motivo: r.motivo, ok: r.ok, codigo,
    });
    await registrarDecisionEnvio({
      tenantId: op.tenantId, contexto: op.contexto, telefono, ventana: ventana.estado,
      canal, motivo: r.motivo, plantilla: canal === 'plantilla' ? nombre : null, ok: r.ok, codigoMeta: codigo,
    });
    return r;
  };

  const conPlantilla = async (motivoOk: MotivoEnvio, estadoTexto?: { codigo?: number; status?: number }): Promise<ResultadoEnvioConFallback> => {
    const p = await sendTemplate(telefono, nombre, { idioma, ...resto });
    if (p.ok) return registrar({ ok: true, via: 'plantilla', id: p.id, motivo: motivoOk, ventana: ventana.estado }, 'plantilla');

    // Plantilla sin aprobar con la ventana «cerrada» según el registro: el registro
    // puede estar viejo (el webhook anota con mejor esfuerzo). Un texto cuesta una
    // llamada y es lo único que aún podría entregar; si de verdad está cerrada,
    // Meta contesta 131047 y se reporta el motivo de la plantilla.
    if (ventana.estado === 'cerrada' && p.codigo === PLANTILLA_NO_APROBADA) {
      const t = await enviarLibre();
      if (t.ok) {
        return registrar({ ok: true, via: viaLibre, id: t.id, motivo: 'ventana_cerrada_plantilla_no_aprobada_texto', ventana: ventana.estado }, viaLibre);
      }
    }

    const reintentable = esReintentableMeta(p.codigo, p.status) || esReintentableMeta(undefined, estadoTexto?.status);
    // Lo que `sendTemplate` encoló: «vuelve más tarde» (código, 429/5xx o timeout) y el token vencido.
    const encolado = esReintentableMeta(p.codigo, p.status) || esTokenVencido(p.codigo, p.status);
    return registrar({
      ok: false, motivo: 'plantilla_rechazada', mensaje: motivoDeFalloWhatsApp(p.error, p.codigo),
      codigo: p.codigo, codigoTexto: estadoTexto?.codigo, status: p.status ?? estadoTexto?.status, fueraDeVentana: true, reintentable, encolado, ventana: ventana.estado,
    }, 'ninguno', p.codigo);
  };

  try {
    if (ventana.estado === 'cerrada') return await conPlantilla('ventana_cerrada');

    const t = await enviarLibre();
    if (t.ok) {
      return await registrar({
        ok: true, via: viaLibre, id: t.id,
        motivo: ventana.estado === 'abierta' ? 'ventana_abierta' : 'ventana_desconocida',
        ventana: ventana.estado,
      }, viaLibre);
    }

    if (!esFueraDeVentana(t.codigo)) {
      // Rechazo que NO es de ventana: si es reintentable ya quedó en el outbox y
      // una plantilla duplicaría el aviso; si no, una plantilla no lo arregla.
      return await registrar({
        ok: false, motivo: 'rechazo_no_ventana',
        mensaje: t.codigo !== undefined ? motivoDeFalloWhatsApp(t.error, t.codigo) : t.error,
        codigo: t.codigo, status: t.status, fueraDeVentana: false,
        reintentable: esReintentableMeta(t.codigo, t.status),
        encolado: esReintentableMeta(t.codigo, t.status) || esTokenVencido(t.codigo, t.status), ventana: ventana.estado,
      }, 'ninguno', t.codigo);
    }

    return await conPlantilla(
      ventana.estado === 'abierta' ? 'ventana_abierta_rechazada_por_meta' : 'ventana_desconocida_rechazada_por_meta',
      { codigo: t.codigo, status: t.status },
    );
  } catch (e) {
    // Los envíos no lanzan; esto es el cinturón (p. ej. una variable de entorno
    // de Meta ausente lanza dentro de `token()` antes del fetch).
    const error = e instanceof Error ? e.message : 'error inesperado al enviar';
    logger.error('wa.envio_con_fallback.lanzo', { contexto: op.contexto, error });
    return {
      ok: false, motivo: 'rechazo_no_ventana', mensaje: error, fueraDeVentana: false, reintentable: false, ventana: ventana.estado,
    };
  }
}

/** La plantilla con el documento en su encabezado (si no traía uno propio). */
function conDocumento(p: PlantillaRespaldo, d?: DocumentoEncabezado): PlantillaRespaldo {
  if (!d || p.encabezado) return p;
  return { ...p, encabezado: { tipo: 'documento', link: d.url, nombreArchivo: d.nombreArchivo } };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO DURABLE: el mismo criterio de canal, pero por la cola `wa_outbox`.
//
// Para los mensajes que NO pueden mandarse dos veces ni perderse —una
// liquidación es un pago, y la puede empujar el POST del cliente y el cron a la
// vez— el envío directo no basta: el selector directo no tiene llave de
// idempotencia y, ante un 429 o un timeout, el cliente de Meta ya dejó el
// mensaje en el outbox, de modo que reintentar desde afuera lo duplicaría.
// Aquí el mensaje se ENCOLA con llave estable (`<llave>:sesion` /
// `<llave>:plantilla`); encolar dos veces es la misma fila; el outbox
// reclama, reintenta con backoff y concilia los recibos.
//
// La decisión es la del selector directo, adaptada a una cola:
//   · ventana CERRADA            → se encola DIRECTO la plantilla (sin gastar el
//                                  intento de sesión que Meta rechazaría).
//   · ABIERTA o DESCONOCIDA      → se encola la sesión (botones con documento).
//   · la sesión murió por ventana (131047/131026/131042/re-engagement) → se
//     encola la plantilla, UNA vez (la llave lo garantiza aunque dos cron
//     coincidan). Si murió por otra causa NO se cae a plantilla: no la arreglaría.
// Cada decisión deja su fila en `wa_envio_registro`.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionesEnvioDurable extends OpcionesEnvioConFallback {
  /** Llave base, estable por mensaje (p. ej. `liqext:<id>:g<generación>`). */
  llave: string;
}

export const llaveSesionDurable = (llave: string) => `${llave}:sesion`;
export const llavePlantillaDurable = (llave: string) => `${llave}:plantilla`;

export type ResultadoDurable =
  | { estado: 'en_cola'; via: 'sesion' | 'plantilla'; ventana: EstadoVentana | null }
  | { estado: 'enviada'; via: 'sesion' | 'plantilla'; wamid: string; ventana: EstadoVentana | null }
  // `reintentable`: fallo NUESTRO y transitorio (no se pudo leer/encolar en el
  // outbox; Meta ni se enteró). Un `dead` del outbox NO lo es.
  | { estado: 'fallida'; via: 'sesion' | 'plantilla'; error: string; reintentable: boolean; ventana: EstadoVentana | null };

/** ¿Meta rechazó por ventana de 24 h cerrada? El outbox guarda el cuerpo del
 *  error de Meta en `ultimo_error`. */
export function murioPorVentana(error: string | null): boolean {
  if (!error) return false;
  if (CODIGOS_FUERA_VENTANA.some((c) => error.includes(String(c)))) return true;
  return /re-?engagement/i.test(error);
}

type FilaCola = { estado: 'pending' | 'sending' | 'sent' | 'dead'; provider_message_id: string | null; ultimo_error: string | null };

function aResultado(f: FilaCola, via: 'sesion' | 'plantilla', ventana: EstadoVentana | null): ResultadoDurable {
  if (f.estado === 'sent') return { estado: 'enviada', via, wamid: f.provider_message_id ?? '', ventana };
  if (f.estado === 'dead') {
    return { estado: 'fallida', via, error: (f.ultimo_error ?? 'el outbox agotó los reintentos').slice(0, 500), reintentable: false, ventana };
  }
  return { estado: 'en_cola', via, ventana };
}

/**
 * Entrega durable e IDEMPOTENTE: llamarla otra vez con la misma `llave` NO
 * manda un segundo mensaje, avanza el mismo y devuelve su estado actual. Nunca
 * lanza. `op.botones` es obligatorio cuando hay `documento` (el mensaje de
 * sesión con documento es el interactivo de botones).
 */
export async function enviarConFallbackDurable(
  telefono: string,
  op: OpcionesEnvioDurable,
): Promise<ResultadoDurable> {
  const kS = llaveSesionDurable(op.llave);
  const kP = llavePlantillaDurable(op.llave);
  try {
    if (op.documento) {
      const malo = motivoDocumentoInvalido(op.documento);
      if (malo) return { estado: 'fallida', via: 'sesion', error: `documento inválido: ${malo}`, reintentable: false, ventana: null };
    }
    const filas = await leerSalidasPorLlave([kS, kP]);
    if (!filas) {
      return { estado: 'fallida', via: 'sesion', error: 'no se pudo leer el outbox', reintentable: true, ventana: null };
    }
    const sesion = filas.get(kS);
    const plantilla = filas.get(kP);

    // 1. Si ya se pasó a plantilla, ESA es la que manda.
    if (plantilla) return aResultado(plantilla, 'plantilla', null);

    const armarPlantilla = (): { ok: true; payload: Record<string, unknown>; nombre: string } | { ok: false; error: string } => {
      const { nombre, idioma, ...resto } = conDocumento(op.plantilla, op.documento);
      const armado = armarComponentesPlantilla(resto);
      if (!armado.ok) return { ok: false, error: `Plantilla ${nombre} mal armada: ${armado.error}` };
      return { ok: true, payload: payloadPlantilla(telefono, nombre, idioma ?? 'es_MX', armado.componentes), nombre };
    };

    const encolarPlantilla = async (motivo: MotivoEnvio, ventana: EstadoVentana | null): Promise<ResultadoDurable> => {
      const a = armarPlantilla();
      if (!a.ok) return { estado: 'fallida', via: 'plantilla', error: a.error, reintentable: false, ventana };
      const q = await encolarSalidaWhatsAppDedupe(kP, a.payload, `${op.contexto}: por plantilla`);
      await registrarDecisionEnvio({
        tenantId: op.tenantId, contexto: op.contexto, telefono, ventana: ventana ?? 'desconocida',
        canal: 'plantilla', motivo, plantilla: a.nombre, ok: q !== null,
      });
      if (!q) return { estado: 'fallida', via: 'plantilla', error: 'no se pudo encolar la plantilla (el outbox no respondió)', reintentable: true, ventana };
      return aResultado({ estado: q.estado, provider_message_id: q.providerMessageId, ultimo_error: null }, 'plantilla', ventana);
    };

    // 2. La sesión murió por ventana cerrada: plantilla, una sola vez.
    if (sesion?.estado === 'dead' && murioPorVentana(sesion.ultimo_error)) {
      return await encolarPlantilla('ventana_abierta_rechazada_por_meta', null);
    }

    // 3. La sesión ya está en el outbox: se reporta su estado real.
    if (sesion) return aResultado(sesion, 'sesion', null);

    // 4. Nada encolado: se decide el canal por la ventana registrada.
    const ventana = await ventanaDeContacto(telefono, op.ahora);
    if (ventana.estado === 'cerrada') return await encolarPlantilla('ventana_cerrada', ventana.estado);

    if (!op.botones || op.botones.length === 0) {
      return { estado: 'fallida', via: 'sesion', error: 'el modo durable exige botones para el mensaje de sesión', reintentable: false, ventana: ventana.estado };
    }
    const payload = payloadBotones(telefono, op.texto, op.botones, op.documento);
    const q = await encolarSalidaWhatsAppDedupe(kS, payload, op.contexto);
    await registrarDecisionEnvio({
      tenantId: op.tenantId, contexto: op.contexto, telefono, ventana: ventana.estado,
      canal: 'botones', motivo: ventana.estado === 'abierta' ? 'ventana_abierta' : 'ventana_desconocida', ok: q !== null,
    });
    if (!q) return { estado: 'fallida', via: 'sesion', error: 'no se pudo encolar el mensaje (el outbox no respondió)', reintentable: true, ventana: ventana.estado };
    return aResultado({ estado: q.estado, provider_message_id: q.providerMessageId, ultimo_error: null }, 'sesion', ventana.estado);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'error inesperado al encolar';
    logger.error('wa.envio_durable.lanzo', { contexto: op.contexto, error });
    return { estado: 'fallida', via: 'sesion', error, reintentable: true, ventana: null };
  }
}
