import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { sendDocument, esReintentableMeta } from '@/lib/meta/client';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { appUrl } from '@/lib/env';
import { alertarOperador } from '@/lib/observability/alerta';
import { variantesTelefono } from './conv';
import { armarAvisoJefe, type ResumenLiquidacion, type DiferenciaResumen } from './cierre_aviso';
import { telefonoParaDineroDe } from './contactos';
import { acuseSoloFolioAlEncargado } from './acuse_folio';
import { avisarPerfilTarjetasUnaVez } from './aviso_perfil_tarjetas';
import { after } from 'next/server';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LA OFICINA SE ENTERA CUANDO UN CHOFER CIERRA.
//
// `cierre_aviso.ts` decide QUÉ decir y es puro (30 pruebas, con un mapa
// exhaustivo de los 31 tipos de diferencia). Aquí va el resto: leer la
// liquidación recién cerrada, armar el resumen y mandarlo.
//
// ── POR QUÉ EL JEFE RECIBE EL PDF Y NO UN "ENTRA AL PANEL" ───────────────
//
// El PDF es el documento que va a archivar y que le va a dar a su contador. Si
// para tenerlo hay que entrar a una pantalla, la mitad de las veces no entra —
// y la liquidación existe pero nadie la mira. Mandarlo por el mismo canal por
// el que entró el trabajo es lo que cierra el circuito.
//
// ── NO SE LE AVISA DE TODO ───────────────────────────────────────────────
//
// `armarAvisoJefe` devuelve `requiereDecision`. Cuando es `false` —la
// liquidación cuadró y no hay nada que resolver— NO se manda mensaje de texto,
// solo el PDF. Avisarle con urgencia de algo que no la tiene es como se quema
// un canal: en dos semanas deja de abrir los mensajes, y el que sí importaba
// llega igual que los demás.
//
// ── FALLA HACIA ADELANTE, SIEMPRE ────────────────────────────────────────
//
// Todo esto corre DESPUÉS de que la liquidación quedó cerrada y el chofer ya
// tiene su PDF. Nada de aquí puede tumbar ese camino: un jefe sin teléfono
// registrado o un WhatsApp caído no pueden costar una liquidación.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoAvisoCierre {
  enviado: boolean;
  /** Por qué no salió, en palabras que digan qué arreglar. */
  motivo?: string;
  /** Por dónde salió el texto de decisión (AGEN-5): fuera de la ventana de
   *  24 h Meta solo deja pasar la plantilla. */
  via?: 'texto' | 'plantilla';
  /** El texto rebotó por ventana cerrada y la plantilla tampoco salió. */
  fueraDeVentana?: boolean;
  /**
   * AUDITORÍA 25 (MEDIO, agentico.md:526) — si el jefe SÍ recibió el PDF.
   * `null` = no se le pasó `urlPdf` a esta llamada (nada que enviar aquí, o
   * ya lo tiene por otro hilo — ver `cierre.jefe_es_el_chofer`); `true`/
   * `false` = se intentó y el resultado. `enviado: true` con
   * `pdfEnviado: false` es justo el caso que antes se leía como éxito
   * completo sin serlo: el llamador NO debe sellar `avisada_oficina_en` en
   * ese caso, para que el siguiente «listo» (`entregarCierrePendiente`)
   * reintente el PDF en vez de darlo por entregado para siempre.
   */
  pdfEnviado: boolean | null;
  /**
   * AG-A1 (auditoría 28, agentico.md:32) — LO MISMO que `pdfEnviado`, pero con
   * el detalle que decide si el llamador puede sellar sin martillar Meta en
   * cada «gracias» del chofer:
   *   · `'enviado'`    — Meta aceptó el documento.
   *   · `'encolado'`   — no salió, pero `sendDocument` YA lo metió a
   *     `wa_outbox` (red caída, o un código de `esReintentableMeta`): el
   *     outbox lo reintenta solo, y sellar aquí no pierde el PDF.
   *   · `'definitivo'` — Meta lo rechazó con un código NO reintentable (p.
   *     ej. 131030, destinatario fuera de la lista de pruebas): reintentarlo
   *     desde el chat nunca va a funcionar, así que el llamador puede sellar
   *     y avisar UNA vez en vez de repetir el intento por cada mensaje.
   *   · `null` — no se pasó `urlPdf` a esta llamada (nada que enviar aquí), o
   *     `sendDocument` lanzó de verdad (excepción, no un `{ok:false}` — caso
   *     que en teoría ya no ocurre, ver el comentario de más abajo).
   */
  pdfEstado: 'enviado' | 'encolado' | 'definitivo' | null;
}

/**
 * ¿Ya se puede sellar la entrega del PDF del jefe? (AG-A1)
 *
 * `!pdfUrl` — nunca hubo nada que mandar aquí: no hay nada pendiente.
 * `pdfEnviado === true` — Meta lo aceptó (compatibilidad con el contrato
 * viejo, por si un llamador construye el resultado a mano, como hacen varias
 * pruebas que mockean `avisarCierreAlJefe` entero).
 * `pdfEstado === 'encolado' | 'definitivo'` — no llegó, pero no hay ningún
 * reintento del CHAT que lo vaya a arreglar: el outbox lo tiene, o Meta ya
 * dijo que no. Machacar `entregarCierrePendiente` sobre esto no ayuda, solo
 * gasta Storage y Graph API una vez por «gracias».
 */
export function pdfListoParaSellar(
  pdfUrl: string | null | undefined,
  rj: Pick<ResultadoAvisoCierre, 'pdfEnviado' | 'pdfEstado'>,
): boolean {
  if (!pdfUrl) return true;
  if (rj.pdfEnviado === true) return true;
  return rj.pdfEstado === 'encolado' || rj.pdfEstado === 'definitivo';
}

/**
 * El estado del PDF a partir de lo que YA devolvió `sendDocument` — sin
 * volver a decidir si Meta lo aceptó, solo a traducirlo (AG-A1).
 *
 * EXPORTADA: el mismo contrato de `sendDocument` (`{ok, codigo?}`) lo usan
 * DOS llamadores — el PDF del jefe (aquí abajo) y el PDF del CHOFER
 * (`entregarCierrePendiente`, processor.ts). Un solo lugar decide qué
 * significa cada `codigo`, para que los dos lean lo mismo.
 */
export function pdfEstadoDe(r: { ok: boolean; codigo?: number }): 'enviado' | 'encolado' | 'definitivo' {
  if (r.ok) return 'enviado';
  // Sin código: fue el catch de red de `sendDocument` (fetch nunca contestó),
  // y ESE camino ya encola el payload antes de devolver `{ok:false}` — ver
  // `meta/client.ts`. No hay nada "definitivo" que decir de un socket caído.
  if (r.codigo === undefined) return 'encolado';
  return esReintentableMeta(r.codigo) ? 'encolado' : 'definitivo';
}

/**
 * Arma el resumen desde la liquidación guardada.
 *
 * SE LEE DE LA BASE, no se recibe del que llama. Es a propósito: lo que se le
 * manda al jefe tiene que ser lo mismo que quedó asentado y lo mismo que dice
 * el PDF. Un resumen armado en memoria puede diverger de la fila por un bug de
 * orden, y entonces el jefe estaría leyendo una cifra que no existe en ningún
 * lado.
 */
export async function resumenDeCierre(tenantId: string, viajeId: string): Promise<ResumenLiquidacion | null> {
  // Con techo (auditoría 18, A23): esto corre en el cierre, con la
  // liquidación YA escrita; un socket que Supabase acepta y no contesta se
  // quedaba aquí 300s y mataba la invocación antes de `saveConversation`.
  const admin = supabaseAdmin();
  const [rLiq, rViaje] = await Promise.all([
    acotada(admin.from('liquidacion')
      .select('total_comprobado, total_anticipo, diferencia, diferencias, created_at')
      .eq('viaje_id', viajeId).eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(), 'resumenDeCierre.liquidacion'),
    acotada(admin.from('viaje')
      .select('folio, operador:operador_id(nombre)')
      .eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(), 'resumenDeCierre.viaje'),
  ]);

  // Fallar cerrado: sin esto, un error de lectura se leería como "no hay
  // liquidación" y el jefe simplemente no recibiría nada, sin que quede rastro.
  if (rLiq.error) throw new Error(`resumenDeCierre/liquidacion: ${rLiq.error.message}`);
  if (rViaje.error) throw new Error(`resumenDeCierre/viaje: ${rViaje.error.message}`);
  if (!rLiq.data || !rViaje.data) return null;

  const l = rLiq.data;
  const rel = rViaje.data.operador as { nombre?: string } | Array<{ nombre?: string }> | null;
  const nombre = Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre;

  return {
    folio: (rViaje.data.folio as string) ?? 'sin folio',
    operador: nombre ?? 'Operador sin nombre',
    anticipo: Number(l.total_anticipo ?? 0),
    totalComprobado: Number(l.total_comprobado ?? 0),
    diferencia: Number(l.diferencia ?? 0),
    diferencias: (Array.isArray(l.diferencias) ? l.diferencias : []) as DiferenciaResumen[],
    ...(typeof l.created_at === 'string' ? { cerradaEn: l.created_at } : {}),
  };
}

/**
 * Tope de lo que un accesorio puede retrasar al llamador cuando NO hay ámbito de
 * petición donde programarlo (cron, reintento fuera del webhook): peor caso real
 * del acuse eran ~48 s de techos encadenados sobre un margen de cierre ya agotado.
 */
export const TECHO_ACCESORIOS_SIN_AFTER_MS = 6_000;

/**
 * Corre un accesorio del cierre FUERA de la ruta crítica (M2).
 *
 * - En una petición de Next (webhook de WhatsApp y su `after()`): se programa con
 *   `after()` y la función devuelve de inmediato; el sello de entrega no espera.
 * - Sin ámbito de petición (`after` lanza: cron `wa-pendientes`, pruebas): se espera
 *   con un TECHO duro, y si lo rebasa se sigue sin él — nunca más de
 *   `TECHO_ACCESORIOS_SIN_AFTER_MS` sobre el cierre. Los accesorios son idempotentes
 *   (sellos propios), así que lo que se corte lo retoma un intento posterior.
 * Nunca lanza.
 */
export async function enSegundoPlano(etiqueta: string, tarea: () => Promise<void>): Promise<void> {
  const protegida = () => tarea().catch((e) => logger.warn(`${etiqueta}_fallo`, { err: e instanceof Error ? e.message : String(e) }));
  try {
    after(protegida);
    return;
  } catch {
    /* sin ámbito de petición: cae al camino acotado */
  }
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const techo = new Promise<void>((resolver) => {
    reloj = setTimeout(() => { logger.warn(`${etiqueta}_techo`, { ms: TECHO_ACCESORIOS_SIN_AFTER_MS }); resolver(); }, TECHO_ACCESORIOS_SIN_AFTER_MS);
  });
  await Promise.race([protegida(), techo]);
  if (reloj) clearTimeout(reloj);
}

/**
 * Le manda al jefe el cierre: el PDF siempre, el texto solo si hay que decidir.
 *
 * `urlPdf` viene firmada y de vida corta — se pasa desde el cierre en vez de
 * volver a firmarla aquí para no duplicar el criterio del TTL, que ya está
 * decidido en un solo lugar. Tiene que ser el ejemplar COMPLETO (el del
 * contralor, `${tenant}/${viaje}.pdf`), no el del operador: el jefe lo archiva
 * y se lo pasa a su contador, y el del operador trae recortados justo los
 * veredictos que el contador resuelve (auditoría 18, M26). Sin URL se manda
 * el texto igual: el aviso de decisión no depende del papel (M27).
 */
export async function avisarCierreAlJefe(args: {
  tenantId: string;
  viajeId: string;
  urlPdf?: string | null;
  /** El teléfono del CHOFER que acaba de cerrar. Si el jefe resulta ser el
   *  mismo número, este aviso no se manda: ya lo recibió por el otro lado. */
  telefonoOperador?: string | null;
}): Promise<ResultadoAvisoCierre> {
  // A QUIEN VE DINERO, no al primer teléfono de oficina (auditoría 18, A28):
  // este aviso lleva anticipo, comprobado, diferencia y el PDF completo. El
  // encargado no ve nada de eso en el panel, y no lo va a ver por aquí.
  const tel = await telefonoParaDineroDe(args.tenantId);
  if (!tel) {
    // ERROR y no WARN: esta flota no se va a enterar de NINGÚN cierre hasta que
    // alguien capture el teléfono, y no hay otro lugar donde se note.
    logger.error('cierre.sin_telefono_de_jefe', { tenantId: args.tenantId, viaje: args.viajeId });
    return { enviado: false, motivo: 'Esa flota no tiene un teléfono de oficina registrado.', pdfEnviado: null, pdfEstado: null };
  }

  // ── DUEÑO-OPERADOR: UN SOLO NÚMERO, UN SOLO AVISO ───────────────────────
  //
  // Que un número sea a la vez chofer y oficina es correcto por diseño
  // (`contactos.ts` lo documenta, y `variantesTelefono` normaliza 52/521).
  // Lo que NO es correcto es lo que pasaba entonces: al cerrar, esa persona
  // recibía su liquidación en PDF por el camino del chofer y, un segundo
  // después, OTRO PDF del mismo cierre con distinto nombre de archivo más un
  // "necesita tu decisión" dirigido a sí misma. Visto en producción el
  // 24-ago-2026, y se lee como que el sistema se duplicó.
  //
  // No es un caso raro: el dueño que también maneja es un cliente entero de
  // este producto. Se detecta con las MISMAS variantes que usa el resolutor de
  // operadores, no comparando cadenas crudas — con 52/521 de por medio, la
  // comparación literal habría dicho "son distintos" casi siempre.
  if (args.telefonoOperador) {
    const delChofer = new Set(variantesTelefono(args.telefonoOperador));
    if (variantesTelefono(tel).some((v) => delChofer.has(v))) {
      logger.info('cierre.jefe_es_el_chofer', { viaje: args.viajeId });
      // pdfEnviado:true — no se intenta OTRO envío (es justo lo que este
      // caso evita), pero el papel YA lo tiene por el hilo del chofer: no
      // hay nada pendiente que el sello deba dejar para reintentar.
      return { enviado: true, motivo: 'el jefe y el chofer son el mismo número: ya lo recibió por su propio hilo', pdfEnviado: true, pdfEstado: 'enviado' };
    }
  }

  const resumen = await resumenDeCierre(args.tenantId, args.viajeId);
  if (!resumen) return { enviado: false, motivo: 'No se encontró la liquidación cerrada.', pdfEnviado: null, pdfEstado: null };

  const { texto, requiereDecision } = armarAvisoJefe(resumen);

  // AUDITORÍA 21 (agéntico, ALTO): el texto y el PDF son DOS escrituras
  // independientes. Antes, un `return` temprano cuando `sendText` fallaba
  // (rate limit, blip de red) se llevaba también el `sendDocument` que viene
  // abajo — justo en el caso `requiereDecision: true`, cuando el contralor
  // más necesita el documento que YA estaba firmado y listo. El fallo del
  // texto se sigue reportando (`enviado: false`), pero ya no corta el PDF:
  // la garantía del encabezado es "el PDF siempre".
  //
  // AUDITORÍA 24 · AGEN-5 / WA-4 (ALTO): el jefe de una flota grande RECIBE y
  // no escribe, así que su ventana de 24 h está cerrada casi siempre y el
  // texto libre rebotaba con 131047 — no reintentable, sin plantilla, solo un
  // `warn`. Sale por `avisarOficina`: texto y, si Meta lo rechaza por
  // ventana, la plantilla `aviso_operacion_v1`. Si NI la plantilla sale, la
  // liquidación que requiere decisión se queda sin quien la decida: alerta
  // operativa, no un warn.
  let motivoTexto: string | null = null;
  let via: ResultadoAvisoCierre['via'];
  let fueraDeVentana = false;
  if (requiereDecision) {
    const r = await avisarOficina(tel, texto, {
      parametros: parametrosAvisoOficina(resumen.operador, `Liquidación ${resumen.folio}: requiere tu decisión`, `${appUrl()}/dashboard/viajes`),
      contexto: { tenant: args.tenantId, viaje: args.viajeId, evento: 'cierre' },
    });
    if (r.ok) {
      via = r.via;
    } else {
      motivoTexto = `WhatsApp no aceptó el mensaje al jefe: ${r.motivo}`;
      fueraDeVentana = r.fueraDeVentana;
      if (r.fueraDeVentana) {
        await alertarOperador('cierre.jefe_sin_ventana', { tenant: args.tenantId, viaje: args.viajeId, folio: resumen.folio, motivo: r.motivo, codigo: r.codigo }).catch(() => {});
      }
    }
  }

  // AUDITORÍA 25 (MEDIO, agentico.md:526): `null` = no se pasó `urlPdf`
  // (nada que enviar aquí — puede ser que nunca hubo PDF del contralor, y
  // eso lo decide el LLAMADOR, no esta función). `true`/`false` = si de
  // verdad se intentó y llegó. El `warn` de abajo ya existía; lo que
  // faltaba era que este hecho saliera de la función, porque antes se
  // perdía en el log y `enviado: true` lo tapaba entero.
  let pdfEnviado: boolean | null = null;
  let pdfEstado: ResultadoAvisoCierre['pdfEstado'] = null;
  if (args.urlPdf) {
    // En su propio try: el texto ya salió, y perder el adjunto no debe borrar
    // el aviso que sí llegó.
    //
    // `sendDocument` YA NO LANZA (ver `meta/client.ts`, misma ronda): un
    // rechazo de Meta o un fallo de red devuelven `{ok:false}` en vez de la
    // excepción que este `catch` esperaba atrapar. Sin revisar `r.ok`, un PDF
    // que nunca llegó pasaba SIN un solo log —el `catch` de abajo es letra
    // muerta para ese caso— y esta función seguía devolviendo `enviado: true`
    // sobre un documento que el jefe nunca recibió y que es justo el que
    // archiva para su contador. Se revisa el resultado explícitamente; el
    // `try/catch` se conserva como red por si el día de mañana algo de aquí sí
    // lanza.
    try {
      const r = await sendDocument(tel, args.urlPdf, `liquidacion-${resumen.folio}.pdf`,
        `Liquidación de ${resumen.operador} — ${resumen.folio}`);
      pdfEnviado = r.ok;
      pdfEstado = pdfEstadoDe(r);
      if (!r.ok) logger.warn('cierre.pdf_al_jefe_falló', { viaje: args.viajeId, err: r.error });
    } catch (e) {
      // Excepción de verdad, no un `{ok:false}` — en teoría ya no debería
      // ocurrir (ver el comentario de arriba), así que no se le atribuye un
      // estado que no se puede sustentar: se queda `null`, y el llamador NO
      // sella (AG-A1-b) — es justo la excepción "transitoria por naturaleza"
      // que el diseño acepta dejar sin sellar.
      pdfEnviado = false;
      logger.warn('cierre.pdf_al_jefe_falló', { viaje: args.viajeId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // El fallo del texto se reporta DESPUÉS de intentar el PDF: el llamador
  // sigue viendo `enviado: false` (y loguea `cierre.jefe_no_avisado`), pero
  // el documento ya se intentó mandar de todos modos.
  // Los ACCESORIOS del cierre (el acuse «solo folio» del encargado y el aviso único del
  // perfil de tarjetas) NO van en la ruta crítica (M2): ni el resultado de este aviso ni
  // el sello de entrega que el llamador pone DESPUÉS dependen de ellos. Se programan para
  // después de la respuesta (`after()`); ver `enSegundoPlano`.
  await enSegundoPlano('cierre.accesorios', async () => {
    await acuseSoloFolioAlEncargado({ tenantId: args.tenantId, viajeId: args.viajeId, resumen, requiereDecision, telefonoDinero: tel, telefonoOperador: args.telefonoOperador })
      .catch((e) => logger.warn('cierre.acuse_folio_fallo', { viaje: args.viajeId, err: e instanceof Error ? e.message : String(e) }));
    // M5: UN aviso por flota (no uno por viaje) mientras las tarjetas del diésel sigan sin declarar.
    if (resumen.diferencias.some((d) => d.tipo === 'tarjeta_sin_declarar')) {
      await avisarPerfilTarjetasUnaVez({ tenantId: args.tenantId, telefonoDinero: tel, folio: resumen.folio, operador: resumen.operador })
        .catch((e) => logger.warn('cierre.aviso_perfil_tarjetas_fallo', { viaje: args.viajeId, err: e instanceof Error ? e.message : String(e) }));
    }
  });

  if (motivoTexto) return { enviado: false, motivo: motivoTexto, fueraDeVentana, pdfEnviado, pdfEstado };

  logger.info('cierre.avisado_al_jefe', { viaje: args.viajeId, requiereDecision, via, pdfEnviado, pdfEstado });
  return via ? { enviado: true, via, pdfEnviado, pdfEstado } : { enviado: true, pdfEnviado, pdfEstado };
}
