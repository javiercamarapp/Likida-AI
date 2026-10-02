// ═══════════════════════════════════════════════════════════════════════════
// EL RESPALDO POR CORREO DEL ESCALAMIENTO (0673/0674).
//
// El aviso de escalamiento sale por WhatsApp (`avisarEscalamiento`, por el selector `enviarConFallback`). Si no sale —la plantilla
// no está aprobada, la ventana de 24 h está cerrada y no hay plantilla que la atraviese, Meta lo rechaza— hoy nadie se entera.
// Con `respaldo_correo` encendido en la flota, ese MISMO aviso se manda por correo (Resend, `lib/correo/enviar.ts`) a quien tenga
// correo en la lista de directores del nivel.
//
// LO QUE ESTE ARCHIVO GARANTIZA
//   · Un correo por (aviso, persona): el envío se RECLAMA antes de salir (`reclamarCorreo`: insertar la llave es reclamarla, con
//     arriendo) y la misma llave viaja a Resend como `Idempotency-Key`. Dos corridas solapadas no mandan dos correos; si la
//     corrida que lo llevaba murió, el cron retoma el arriendo vencido y Resend deduplica si el primer POST sí había salido.
//   · Nada falla en silencio: sin llave de Resend (o sin dominio verificado) el resultado es «no se pudo mandar por correo: falta
//     configuración», queda en la tabla y en la bitácora, y se ve en el tablero. No se reintenta solo (un aviso viejo mandado
//     horas después sería ruido): la flota lo atiende.
//   · Nunca lanza hacia el escalamiento: un correo que no sale no tumba el barrido.
//   · No lleva teléfonos ni texto de clientes: solo el nombre del cliente, el motivo, el tiempo y la liga al tablero.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { enviarCorreo as enviarCorreoReal } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { normalizarTelefonoWa } from '../wa_ventana';
import { textoDeMotivoEscalamiento } from './avisos';
import type { ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import type { DepsVigia } from './puertos';
import type { DatosAvisoCorreo, DestinatarioAviso, Director, NivelDirector } from './tipos';

export const TEXTO_SIN_CONFIGURAR = 'No se pudo mandar por correo: falta configuración (llave o dominio de Resend).';
export const MAX_DIRECTORES_POR_NIVEL = 10;

export type ResultadoRespaldo = 'enviado' | 'duplicado' | 'sin_configurar' | 'rechazado' | 'red' | 'sin_reclamo';

/** Una huella corta del correo (nunca el correo) para la llave del envío y la bitácora. */
export function hashCorreo(correo: string): string {
  return createHash('sha256').update(correo.trim().toLowerCase()).digest('hex');
}

/** La llave del correo: única por (aviso de escalamiento, persona). */
export function claveCorreo(claveAviso: string, correo: string): string {
  return `${claveAviso}:c:${hashCorreo(correo).slice(0, 16)}`;
}

/**
 * ¿El aviso por WhatsApp que falló merece el respaldo por correo? Sí si NO salió y NO quedó en camino. Un rechazo «vuelve más
 * tarde» (429, bloqueo temporal) o un mensaje que el cliente de Meta ya dejó en la cola de reintento (`encolado`) saldrá solo:
 * mandar además un correo duplicaría el aviso. PURA.
 */
export function debeRespaldarPorCorreo(r: ResultadoEnvioConFallback): boolean {
  return !r.ok && !r.reintentable && r.encolado !== true;
}

/** El correo del aviso de escalamiento. PURO: el mismo hecho que el WhatsApp, con la liga al tablero y el porqué de que llegue por correo. */
export function correoDeEscalamiento(d: DatosAvisoCorreo): Correo {
  const cliente = (d.cliente || 'Un cliente').replace(/\s+/g, ' ').trim().slice(0, 80);
  const motivo = textoDeMotivoEscalamiento(d.motivo, d.minutos);
  return {
    asunto: `Vigía de servicio: ${cliente} necesita atención (nivel ${d.nivel})`,
    avance: `${cliente} ${motivo}.`,
    titulo: 'Un cliente necesita atención',
    parrafos: [
      `El cliente ${cliente} ${motivo}. Es un aviso de nivel ${d.nivel} de escalamiento del Vigía de servicio.`,
      'Te llega por correo porque el aviso por WhatsApp no pudo entregarse. Revisa la conversación y atiéndela, o tómala desde el tablero.',
    ],
    datos: [['Cliente', cliente], ['Motivo', motivo], ['Nivel de escalamiento', String(d.nivel)]],
    boton: { texto: 'Abrir el tablero del Vigía', href: `${appUrl()}/dashboard/agentes/vigia` },
    porQueLoRecibes: 'Recibes este aviso porque estás en la lista de directores del Vigía de servicio al cliente de tu flota en Likida. El dueño de la flota puede cambiar esa lista en el tablero del Vigía.',
  };
}

export interface EntradaRespaldo {
  tenantId: string;
  conversacionId: string;
  /** La llave final del correo (`claveCorreo`). */
  clave: string;
  nivel: NivelDirector;
  directorId: string | null;
  correo: string;
  datos: DatosAvisoCorreo;
}

/**
 * Reclama, manda y cierra UN correo de respaldo. Nunca lanza.
 *
 * `duplicado`: otra corrida lo lleva o ya salió (no se manda nada). `sin_reclamo`: no se pudo ni reclamar (la base no respondió o
 * no tiene la migración 0674): no se manda a ciegas, porque sin el reclamo no habría cómo evitar el duplicado.
 */
export async function respaldarPorCorreo(e: EntradaRespaldo, deps: DepsVigia): Promise<ResultadoRespaldo> {
  const { repo } = deps;
  const base = { conversacionId: e.conversacionId, nivel: e.nivel, destinatarioHash: hashCorreo(e.correo) };
  let reclamo;
  try {
    reclamo = await repo.reclamarCorreo(e.tenantId, { conversacionId: e.conversacionId, clave: e.clave, nivel: e.nivel, directorId: e.directorId, destino: e.correo, datos: e.datos });
  } catch (err) {
    logger.error('vigia.correo_reclamo_fallo', { tenant: e.tenantId, err: err instanceof Error ? err.message : String(err) });
    await repo.evento(e.tenantId, { ...base, tipo: 'correo_fallo', clave: `${e.clave}:sin_reclamo`, detalle: { motivo: 'sin_reclamo', mensaje: 'No se pudo mandar por correo: no se pudo reservar el envío.' } }).catch(() => false);
    return 'sin_reclamo';
  }
  if (!reclamo) return 'duplicado';

  let estado: 'enviado' | 'sin_configurar' | 'rechazado' | 'red';
  let detalle: string | null = null;
  try {
    const r = await (deps.enviarCorreo ?? enviarCorreoReal)(e.correo, correoDeEscalamiento(e.datos), { idempotencyKey: e.clave });
    if (r.ok) estado = 'enviado';
    else if (r.motivo === 'sin_configurar') { estado = 'sin_configurar'; detalle = TEXTO_SIN_CONFIGURAR; }
    else { estado = r.motivo; detalle = r.detalle; }
  } catch (err) {
    estado = 'red';
    detalle = err instanceof Error ? err.message : String(err);
  }

  await repo.cerrarCorreo(e.tenantId, reclamo.id, reclamo.token, estado, detalle).catch((err) => {
    logger.error('vigia.correo_cierre_fallo', { tenant: e.tenantId, err: err instanceof Error ? err.message : String(err) });
    return false;
  });
  if (estado === 'enviado') {
    await repo.evento(e.tenantId, { ...base, tipo: 'correo_enviado', clave: `${e.clave}:fin`, detalle: { director: e.directorId } }).catch(() => false);
  } else {
    logger.warn('vigia.correo_respaldo_no_salio', { tenant: e.tenantId, estado });
    await repo.evento(e.tenantId, {
      ...base, tipo: 'correo_fallo', clave: `${e.clave}:fin`,
      detalle: { motivo: estado, mensaje: estado === 'sin_configurar' ? TEXTO_SIN_CONFIGURAR : `No se pudo mandar por correo (${estado}).` },
    }).catch(() => false);
  }
  return estado;
}

/**
 * El cron retoma los correos cuyo arriendo venció sin cerrarse (la corrida que los llevaba murió entre reclamar y cerrar). Pasa
 * por el MISMO reclamo: si otra corrida ya lo retomó, pierde y no manda nada. Devuelve cuántos retomó. Nunca lanza.
 */
export async function reintentarCorreosVencidos(deps: DepsVigia, limite = 20): Promise<number> {
  const ahora = deps.ahora ? deps.ahora() : new Date();
  let filas;
  try {
    filas = await deps.repo.correosVencidos(limite, ahora);
  } catch (err) {
    logger.error('vigia.correos_vencidos_fallo', { err: err instanceof Error ? err.message : String(err) });
    return 0;
  }
  let n = 0;
  for (const f of filas) {
    const r = await respaldarPorCorreo({
      tenantId: f.tenantId, conversacionId: f.conversacionId, clave: f.clave, nivel: f.nivel, directorId: f.directorId, correo: f.destino, datos: f.datos,
    }, deps);
    if (r !== 'duplicado') n += 1;
  }
  return n;
}

/**
 * Quita repetidos: la misma persona por teléfono o por correo es UNA (se juntan sus dos canales). PURA y estable.
 * NUNCA pierde un canal: si dos filas coinciden en un canal pero traen el OTRO distinto (mismo correo y teléfonos distintos, o al
 * revés), lo que no cabe en la fila previa se conserva como una persona aparte con solo ese canal.
 */
export function unirDestinatarios(lista: readonly DestinatarioAviso[]): DestinatarioAviso[] {
  const salida: DestinatarioAviso[] = [];
  for (const d of lista) {
    const tel = d.telefono ? normalizarTelefonoWa(d.telefono) : null;
    const correo = d.correo ? d.correo.trim().toLowerCase() : null;
    const previo = salida.find((x) => (tel && x.telefono === tel) || (correo && x.correo === correo));
    if (!previo) { salida.push({ ...d, telefono: tel, correo }); continue; }
    const telAparte = tel && previo.telefono && previo.telefono !== tel ? tel : null;
    const correoAparte = correo && previo.correo && previo.correo !== correo ? correo : null;
    previo.telefono = previo.telefono ?? tel;
    previo.correo = previo.correo ?? correo;
    previo.userId = previo.userId ?? d.userId;
    previo.directorId = previo.directorId ?? d.directorId;
    previo.nombre = previo.nombre ?? d.nombre;
    if (telAparte || correoAparte) {
      const resto = { ...d, telefono: telAparte, correo: correoAparte };
      if (!salida.some((x) => x.telefono === resto.telefono && x.correo === resto.correo)) salida.push(resto);
    }
  }
  return salida;
}

// ── Validación de la lista de directores (la pantalla y la base dicen lo mismo) ─────────────────────

export interface EntradaDirector { nivel: unknown; nombre: unknown; telefono: unknown; correo: unknown }
export interface ValoresDirector { nivel: NivelDirector; nombre: string; telefono: string | null; correo: string | null }

const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Teléfono mexicano en la forma de la allowlist (52 + 10 dígitos), o `null`. */
export function telefonoDeDirector(crudo: string): string | null {
  const n = normalizarTelefonoWa(crudo);
  if (/^52\d{10}$/.test(n)) return n;
  if (/^\d{10}$/.test(n)) return `52${n}`;
  return null;
}

export function validarDirector(e: EntradaDirector): { ok: true; valor: ValoresDirector } | { ok: false; error: string } {
  const nivel = Number(String(e.nivel ?? '').trim());
  if (nivel !== 1 && nivel !== 2) return { ok: false, error: 'Elige el nivel: 1 (gerente) o 2 (director o dueño).' };
  const nombre = String(e.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 1 || nombre.length > 120) return { ok: false, error: 'Escribe el nombre de la persona (hasta 120 letras).' };
  const telCrudo = String(e.telefono ?? '').trim();
  const correoCrudo = String(e.correo ?? '').trim();
  if (!telCrudo && !correoCrudo) return { ok: false, error: 'Escribe un WhatsApp, un correo o los dos: sin ninguno no hay a dónde avisar.' };
  let telefono: string | null = null;
  if (telCrudo) {
    telefono = telefonoDeDirector(telCrudo);
    if (!telefono) return { ok: false, error: 'El WhatsApp debe ser de 10 dígitos (o con 52).' };
  }
  let correo: string | null = null;
  if (correoCrudo) {
    if (correoCrudo.length > 254 || !FORMA_CORREO.test(correoCrudo)) return { ok: false, error: 'El correo no parece válido.' };
    correo = correoCrudo;
  }
  return { ok: true, valor: { nivel, nombre, telefono, correo } };
}

export function aDestinatario(d: Director): DestinatarioAviso {
  return { userId: null, directorId: d.id, nombre: d.nombre, telefono: d.telefono, correo: d.correo };
}
