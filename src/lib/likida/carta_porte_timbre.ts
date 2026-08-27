// ═══════════════════════════════════════════════════════════════════════════
// EL FLUJO DE TIMBRE (0226) — quien lee, quien llama al PAC y quien persiste.
//
// El armado del CFDI es puro (carta_porte_cfdi.ts) y el transporte es la capa
// PAC (pac/); este módulo es el ÚNICO escritor de `flota_fiscal`, de los
// datos fiscales del receptor en `cliente` y de `ccp_timbre` — con bitácora.
//
// Las reglas que este archivo hace cumplir:
//   · UN humano aprieta el botón (el actor viaja a bitácora y a la fila);
//     ningún cron llama aquí.
//   · CLAIM-THEN-ACT (0227, auditoría Fable c6-1). La reserva se INSERTA
//     ANTES de llamar al PAC y el unique parcial `ccp_timbre_vigente_unico`
//     —que desde la 0227 cubre también el estado 'pendiente'— arbitra la
//     carrera. El perdedor rebota AHÍ y NI SIQUIERA LLAMA al PAC: la versión
//     anterior llamaba primero y persistía después, así que dos botones
//     concurrentes emitían DOS CFDIs reales y el del perdedor se descartaba
//     en silencio — un folio fiscal vivo ante el SAT que nadie iba a
//     cancelar. Idempotencia por BASE, y ahora sobre el INTENTO, no sobre el
//     hecho consumado (estándar §7).
//   · Coherencia de ambiente: el `modo` del perfil (sandbox/produccion) debe
//     COINCIDIR con el ambiente del PAC configurado en el entorno. Un timbre
//     "de producción" contra el sandbox sería un papel que no ampara nada
//     con cara de fiscal; el cruce se rechaza con la verdad, en ambos
//     sentidos.
//   · 'red' (sin respuesta del PAC) NO reintenta: el timbre pudo emitirse del
//     otro lado — se dice "verifica en el panel del PAC" (la lección c5-3) y
//     la RESERVA SE QUEDA PUESTA a propósito, bloqueando por constraint el
//     segundo intento a ciegas que duplicaría el CFDI. Un rechazo del PAC sí
//     la suelta: ahí no hay timbre y el humano corrige y vuelve.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { alertarOperador } from '@/lib/observability/alerta';
import { getBorradorViaje } from './carta_porte_datos';
import { generarIdCcp } from './carta_porte';
import { armarCfdiTimbrable, type EmisorFiscal, type ReceptorFiscal, type ParametrosEmision } from './carta_porte_cfdi';
import { resolverPac, estadoPac } from './pac';

export interface TimbreVigente {
  uuidFiscal: string;
  fechaTimbrado: string;
  modo: 'sandbox' | 'produccion';
  proveedor: string;
  selloSat: string | null;
}

/**
 * Una RESERVA viva (0227): alguien está timbrando este viaje ahora mismo, o
 * un intento anterior quedó con resultado ambiguo y nadie lo resolvió.
 * `uuidFiscal` no-nulo es el caso grave: el PAC SÍ timbró y la consolidación
 * no cerró — ese folio existe ante el SAT y hay que registrarlo a mano.
 */
export interface ReservaTimbre {
  reservadoEn: string | null;
  uuidFiscal: string | null;
}

export interface ContextoTimbre {
  emisor: EmisorFiscal;
  receptor: ReceptorFiscal;
  clienteId: string | null;
  ingresoFlete: number | null;
  timbreVigente: TimbreVigente | null;
  /** null = no hay intento en curso. Ver `ReservaTimbre`. */
  reservaPendiente: ReservaTimbre | null;
  pac: ReturnType<typeof estadoPac>;
}

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Todo lo que la pantalla y el botón necesitan, en una pasada. Lanza si la
 *  base no contesta (error boundary); null = el viaje no es de esta flota. */
export async function leerContextoTimbre(tenantId: string, viajeId: string): Promise<ContextoTimbre | null> {
  const admin = supabaseAdmin();

  const [viaje, perfil, timbre] = await Promise.all([
    acotada(admin.from('viaje')
      .select('id, ingreso_flete, cliente_id, cliente:cliente_id (id, rfc, razon_social, regimen_fiscal, uso_cfdi, cp_fiscal)')
      .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'timbre.viaje'),
    acotada(admin.from('flota_fiscal')
      .select('rfc, razon_social, regimen_fiscal, lugar_expedicion, serie, modo')
      .eq('tenant_id', tenantId).maybeSingle(), 'timbre.perfil'),
    // El unique parcial garantiza UNA fila viva por viaje (reserva O timbre),
    // así que `maybeSingle` sigue siendo correcto — y leer las dos en la misma
    // pasada evita que la pantalla enseñe "sin timbre" durante una reserva.
    acotada(admin.from('ccp_timbre')
      .select('uuid_fiscal, fecha_timbrado, modo, proveedor, sello_sat, estado, reservado_en')
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId)
      .in('estado', ['vigente', 'pendiente']).maybeSingle(), 'timbre.vigente'),
  ]);
  if (viaje.error) throw new Error(`leerContextoTimbre/viaje: ${viaje.error.message}`);
  if (perfil.error) throw new Error(`leerContextoTimbre/perfil: ${perfil.error.message}`);
  if (timbre.error) throw new Error(`leerContextoTimbre/timbre: ${timbre.error.message}`);
  if (viaje.data === null) return null;

  const p = (perfil.data ?? null) as Record<string, unknown> | null;
  const c = ((viaje.data as Record<string, unknown>).cliente ?? null) as Record<string, unknown> | null;
  const fila = (timbre.data ?? null) as Record<string, unknown> | null;
  // Una reserva NO es un timbre: no tiene uuid que enseñar ni ampara nada.
  const t = fila !== null && fila.estado === 'vigente' ? fila : null;
  const reserva = fila !== null && fila.estado === 'pendiente' ? fila : null;

  return {
    emisor: {
      rfc: txt(p?.rfc), razonSocial: txt(p?.razon_social), regimenFiscal: txt(p?.regimen_fiscal),
      lugarExpedicion: txt(p?.lugar_expedicion), serie: txt(p?.serie),
      modo: p?.modo === 'produccion' ? 'produccion' : 'sandbox',
    },
    receptor: {
      rfc: txt(c?.rfc), razonSocial: txt(c?.razon_social), regimenFiscal: txt(c?.regimen_fiscal),
      usoCfdi: txt(c?.uso_cfdi), cpFiscal: txt(c?.cp_fiscal),
    },
    clienteId: txt(c?.id),
    ingresoFlete: num((viaje.data as Record<string, unknown>).ingreso_flete),
    timbreVigente: t === null ? null : {
      uuidFiscal: String(t.uuid_fiscal),
      fechaTimbrado: String(t.fecha_timbrado),
      modo: t.modo === 'produccion' ? 'produccion' : 'sandbox',
      proveedor: String(t.proveedor),
      selloSat: txt(t.sello_sat),
    },
    reservaPendiente: reserva === null ? null : {
      reservadoEn: txt(reserva.reservado_en),
      uuidFiscal: txt(reserva.uuid_fiscal),
    },
    pac: estadoPac(),
  };
}

/** El perfil del emisor. Enviar es declarar: cada campo es lo que la
 *  constancia fiscal de la flota dice, no una sugerencia. */
export async function guardarPerfilFiscal(
  tenantId: string,
  campos: { rfc: string | null; razonSocial: string | null; regimenFiscal: string | null; lugarExpedicion: string | null; serie: string | null; modo: 'sandbox' | 'produccion' },
  actor: { id?: string; email?: string },
): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await acotada(admin.from('flota_fiscal').upsert({
    tenant_id: tenantId,
    rfc: campos.rfc, razon_social: campos.razonSocial, regimen_fiscal: campos.regimenFiscal,
    lugar_expedicion: campos.lugarExpedicion, serie: campos.serie, modo: campos.modo,
    actualizado_en: new Date().toISOString(),
    actualizado_por: actor.id ?? null,
  }, { onConflict: 'tenant_id' }), 'timbre.guardarPerfil');
  if (error) {
    // Los CHECK de forma (RFC, régimen, CP) hablan por PostgREST; se traduce
    // al idioma del contador sin perder el original en el log.
    logger.warn('timbre.perfil_rechazado', { error: error.message });
    throw new DatoInvalido('Revisa el formato: RFC de 12-13, régimen de 3 dígitos, CP de 5 dígitos.');
  }
  await anotarBitacora(
    { tenantId, actor, accion: 'timbre.perfil_guardado', entidad: 'tenant', entidadId: tenantId,
      detalle: { rfc: campos.rfc, modo: campos.modo } },
    { evento: 'timbre.bitacora_no_escribio' },
  );
}

/** Los datos fiscales del receptor, sobre el cliente del viaje. */
export async function guardarReceptorFiscal(
  tenantId: string,
  clienteId: string,
  campos: { razonSocial: string | null; regimenFiscal: string | null; usoCfdi: string | null; cpFiscal: string | null },
  actor: { id?: string; email?: string },
): Promise<void> {
  const admin = supabaseAdmin();
  const { data, error } = await acotada(admin.from('cliente').update({
    razon_social: campos.razonSocial, regimen_fiscal: campos.regimenFiscal,
    uso_cfdi: campos.usoCfdi, cp_fiscal: campos.cpFiscal,
  }).eq('tenant_id', tenantId).eq('id', clienteId).select('id'), 'timbre.guardarReceptor');
  if (error) {
    logger.warn('timbre.receptor_rechazado', { error: error.message });
    throw new DatoInvalido('Revisa el formato: régimen de 3 dígitos, uso CFDI tipo G03/S01, CP de 5 dígitos.');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese cliente no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  }
  await anotarBitacora(
    { tenantId, actor, accion: 'timbre.receptor_guardado', entidad: 'cliente', entidadId: clienteId,
      detalle: { usoCfdi: campos.usoCfdi } },
    { evento: 'timbre.bitacora_no_escribio' },
  );
}

export type ResultadoTimbrado =
  | { ok: true; uuid: string; fechaTimbrado: string; modo: 'sandbox' | 'produccion'; yaExistia: boolean }
  | { ok: false; motivo: string; faltantes?: string[] };

/** ¿Este error de PostgREST es el unique hablando? El `code` viaja en el
 *  error real; el tope de `acotada` sintetiza uno SIN código, así que el
 *  mensaje también se mira — confundir "se agotó el tiempo" con "otro ganó"
 *  mandaría a un segundo timbrado justo cuando menos se debe. */
function esChoqueDeUnique(error: { message: string; code?: string } | null): boolean {
  if (error === null) return false;
  if (error.code === '23505') return true;
  return error.message.includes('duplicate key')
    || error.message.includes('ccp_timbre_vigente_unico');
}

/**
 * La fecha de timbrado que el SAT selló, leída del TimbreFiscalDigital del
 * XML timbrado (c6-7). PURA. `null` = el XML no la trae en forma legible, y
 * entonces el llamador cae —DECLARÁNDOLO— a la del PAC o a su propio reloj.
 *
 * Se busca el atributo y se comprueba hacia atrás que la etiqueta que lo
 * contiene sea el TimbreFiscalDigital: buscar primero el nombre del elemento
 * encontraría antes la declaración `xmlns:tfd="…/TimbreFiscalDigital"` del
 * nodo raíz, que no tiene fecha ninguna.
 */
export function fechaTimbradoDeTfd(xml: string): string | null {
  // Sin cuantificadores anidados ni `\s*` alrededor del `=`: el atributo del
  // TFD se emite pegado, y una alternativa "tolerante" solo agrega superficie
  // de retroceso sobre un XML que llega de fuera.
  const m = /FechaTimbrado="([^"]{1,64})"/.exec(xml);
  if (m === null) return null;
  const abre = xml.lastIndexOf('<', m.index);
  if (abre === -1 || !xml.slice(abre, m.index).includes('TimbreFiscalDigital')) return null;
  const v = m[1].trim();
  // El SAT la emite SIN zona: 'AAAA-MM-DDTHH:MM:SS'. Se exige la forma antes
  // de creerle — una cadena rara guardada como timestamptz rebotaría en medio
  // de la consolidación, que es el peor sitio posible para descubrirlo.
  // La fracción de segundo se separa ANTES de comparar, en vez de meterla al
  // patrón como grupo opcional: dos expresiones sin una sola alternativa ni
  // cuantificador anidado no tienen retroceso que explotar, y el detector de
  // ReDoS no tiene que creerse nada.
  const partes = v.split('.');
  if (partes.length > 2) return null;
  if (partes.length === 2 && !/^\d{1,9}$/.test(partes[1])) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(partes[0]) ? v : null;
}

export type OrigenFechaTimbrado = 'tfd' | 'pac' | 'servidor';

/**
 * EL BOTÓN. Lee todo de nuevo (el estado de la pantalla pudo envejecer),
 * arma, RESERVA, llama al PAC y consolida — en ese orden, con la ambigüedad
 * dicha. El orden es el arreglo: ver la cabecera del archivo (c6-1).
 */
export async function timbrarViaje(
  tenantId: string,
  viajeId: string,
  emision: ParametrosEmision,
  actor: { id?: string; email?: string },
): Promise<ResultadoTimbrado> {
  const ctx = await leerContextoTimbre(tenantId, viajeId);
  if (ctx === null) return { ok: false, motivo: 'Ese viaje no está en tu flota.' };

  // Idempotencia de primera puerta (la de segunda es el unique de la base).
  if (ctx.timbreVigente !== null) {
    return { ok: true, uuid: ctx.timbreVigente.uuidFiscal, fechaTimbrado: ctx.timbreVigente.fechaTimbrado, modo: ctx.timbreVigente.modo, yaExistia: true };
  }
  // Reserva viva: otro intento va en camino, o uno anterior quedó ambiguo. En
  // los dos casos volver a llamar al PAC podría emitir un segundo CFDI.
  if (ctx.reservaPendiente !== null) {
    return { ok: false, motivo: motivoDeReservaViva(ctx.reservaPendiente) };
  }

  const pac = resolverPac();
  if (pac === null || !ctx.pac.configurado) {
    return { ok: false, motivo: 'No hay PAC configurado (variables LIKIDA_PAC_*). Sin PAC no se timbra — y jamás se simula un timbre.' };
  }
  // Coherencia de ambiente, en ambos sentidos: papel de mentira, no.
  if (ctx.emisor.modo === 'produccion' && ctx.pac.pareceSandbox === true) {
    return { ok: false, motivo: 'Tu perfil de timbrado dice PRODUCCIÓN pero el PAC configurado es el ambiente de pruebas. Ese timbre no ampararía nada — corrige la configuración antes.' };
  }
  if (ctx.emisor.modo === 'sandbox' && ctx.pac.pareceSandbox === false) {
    return { ok: false, motivo: 'Tu perfil de timbrado dice SANDBOX pero el PAC configurado es el de PRODUCCIÓN. Timbrar de verdad exige cambiar el modo del perfil a producción — un timbre real no se dispara por accidente.' };
  }

  const v = await getBorradorViaje(tenantId, viajeId);
  if (v === null) return { ok: false, motivo: 'Ese viaje no está en tu flota.' };

  const idCcp = generarIdCcp();
  const cfdi = armarCfdiTimbrable(v, idCcp, ctx.emisor, ctx.receptor, ctx.ingresoFlete, emision);
  if (!cfdi.ok) return { ok: false, motivo: 'Faltan datos para armar el CFDI timbrable.', faltantes: cfdi.faltantes };

  const admin = supabaseAdmin();

  // ── EL CLAIM (c6-1): la reserva ANTES del PAC ────────────────────────────
  // Va después de armar el CFDI a propósito: un viaje al que le faltan datos
  // no deja una reserva bloqueando el viaje por nada.
  const reserva = await acotada(admin.from('ccp_timbre').insert({
    tenant_id: tenantId, viaje_id: viajeId,
    estado: 'pendiente', proveedor: pac.nombre, modo: ctx.emisor.modo,
    reservado_en: new Date().toISOString(), timbrado_por: actor.id ?? null,
  }).select('id').single(), 'timbre.reservar');

  if (reserva.error) {
    if (!esChoqueDeUnique(reserva.error)) {
      // No se pudo reservar y NO fue la carrera: sin claim no se llama al
      // PAC. Fail-closed — timbrar sin poder registrar es cómo se pierde un
      // folio fiscal.
      logger.error('timbre.reserva_fallo', { viajeId, error: reserva.error.message });
      return { ok: false, motivo: `No se pudo apartar el timbrado de este viaje: ${reserva.error.message}. No se llamó al PAC. Reintenta en un momento.` };
    }
    // EL PERDEDOR DE LA CARRERA. No llama al PAC: por eso no hay segundo
    // CFDI que descartar. Lee y dice lo que hay.
    const otra = await leerContextoTimbre(tenantId, viajeId);
    if (otra?.timbreVigente != null) {
      logger.info('timbre.carrera_perdida', { viajeId, uuid: otra.timbreVigente.uuidFiscal });
      return { ok: true, uuid: otra.timbreVigente.uuidFiscal, fechaTimbrado: otra.timbreVigente.fechaTimbrado, modo: otra.timbreVigente.modo, yaExistia: true };
    }
    if (otra?.reservaPendiente != null) {
      // Caso residual: el ganador ya tiene uuid y no consolidó. Ese folio
      // existe ante el SAT y nadie lo está mirando — se grita SIEMPRE, por
      // el log y por el canal del operador; jamás queda solo en un warn.
      if (otra.reservaPendiente.uuidFiscal !== null) {
        logger.error('timbre.uuid_huerfano', { viajeId, uuid: otra.reservaPendiente.uuidFiscal });
        await alertarOperador('timbre.uuid_huerfano', {
          error: `Viaje ${viajeId}: el PAC timbró el uuid ${otra.reservaPendiente.uuidFiscal} y la consolidación no cerró. Ese folio fiscal existe ante el SAT y hay que registrarlo o cancelarlo a mano.`,
          codigo: 'timbre_uuid_huerfano',
        });
      }
      return { ok: false, motivo: motivoDeReservaViva(otra.reservaPendiente) };
    }
    // El unique habló y ya no hay nada vivo: alguien canceló entre medias.
    // Decirlo y dejar que el humano vuelva a apretar es más honesto que
    // reintentar solo contra un PAC de verdad.
    logger.warn('timbre.carrera_sin_rastro', { viajeId });
    return { ok: false, motivo: 'Otro intento de timbrado ocupó este viaje y ya no está. Recarga la pantalla y vuelve a intentar.' };
  }

  const reservaId = String((reserva.data as { id: unknown }).id);

  /** Suelta la reserva. Solo cuando se sabe que NO hay timbre del otro lado. */
  const soltarReserva = async (porque: string): Promise<void> => {
    // Con el `id` bastaría; el `tenant_id` va igual porque estas tres
    // escrituras corren con service-role (sin RLS) y el filtro por flota es
    // la única red que queda — el mismo criterio de todo el archivo.
    const { error } = await acotada(admin.from('ccp_timbre')
      .delete().eq('tenant_id', tenantId).eq('id', reservaId).eq('estado', 'pendiente'), 'timbre.soltar_reserva');
    if (error) {
      // Una reserva atorada bloquea el viaje para siempre: se grita.
      logger.error('timbre.reserva_atorada', { viajeId, reservaId, porque, error: error.message });
      await alertarOperador('timbre.reserva_atorada', {
        error: `Viaje ${viajeId}: no se pudo soltar la reserva de timbrado (${porque}). El viaje queda bloqueado hasta que alguien borre la fila ccp_timbre ${reservaId}.`,
        codigo: 'timbre_reserva_atorada',
      });
    }
  };

  const r = await pac.timbrar(cfdi.xml);
  if (!r.ok) {
    if (r.clase === 'red') {
      // AMBIGUO: la reserva SE QUEDA. Es el bloqueo por constraint del
      // segundo intento a ciegas, no un descuido.
      logger.error('timbre.ambiguo', { viajeId, proveedor: pac.nombre, reservaId });
      await alertarOperador('timbre.ambiguo', {
        error: `Viaje ${viajeId}: el PAC ${pac.nombre} no contestó al timbrar. El CFDI PUDO emitirse. La reserva ${reservaId} queda puesta y bloquea reintentos hasta que alguien verifique en el panel del PAC. Detalle: ${r.mensaje}`,
        codigo: 'timbre_ambiguo',
      });
      return { ok: false, motivo: `SIN RESPUESTA DEL PAC — el timbre PUDO haberse emitido. Este viaje queda BLOQUEADO a propósito: verifica en el panel del PAC si el CFDI existe; si existe, avisa a soporte para registrarlo; si no, soporte libera el bloqueo y se reintenta. Detalle: ${r.mensaje}` };
    }
    // Rechazo/auth: el PAC contestó que NO, así que no hay timbre — la
    // reserva se suelta y el humano corrige y vuelve. El mensaje del PAC tal
    // cual, que es lo accionable.
    await soltarReserva(`el PAC contestó ${r.clase}`);
    return { ok: false, motivo: r.mensaje, faltantes: r.codigo === null ? undefined : [`Código del PAC: ${r.codigo}`] };
  }

  // ── EL UUID, PRIMERO Y SOLO ─────────────────────────────────────────────
  // Dos escrituras y no una, a propósito: el uuid es el dato que no se puede
  // perder (ese CFDI ya existe ante el SAT), y el XML timbrado es el campo
  // que puede hacer fallar la consolidación por tamaño o por red. Escribirlo
  // aparte deja el folio persistido en la reserva ANTES de arriesgar el resto.
  const puso = await acotada(admin.from('ccp_timbre')
    .update({ uuid_fiscal: r.uuid })
    .eq('tenant_id', tenantId).eq('id', reservaId).eq('estado', 'pendiente'), 'timbre.sellar_uuid');
  if (puso.error) {
    logger.error('timbre.uuid_no_persistido', { viajeId, uuid: r.uuid, error: puso.error.message });
    await alertarOperador('timbre.uuid_huerfano', {
      error: `Viaje ${viajeId}: el PAC timbró el uuid ${r.uuid} y ni siquiera se pudo guardar el folio en la reserva (${puso.error.message}).`,
      codigo: 'timbre_uuid_huerfano',
    });
  }

  // ── LA CONSOLIDACIÓN ────────────────────────────────────────────────────
  // La fecha que vale es la del TimbreFiscalDigital: es la que el SAT selló.
  // Si el XML no la trae, se cae a la del PAC y, en último caso, al reloj de
  // Likida — pero DECLARANDO cuál se usó (c6-7): una hora de servidor con
  // cara de dato del SAT es exactamente lo que no puede pasar.
  const delTfd = fechaTimbradoDeTfd(r.xmlTimbrado);
  const origen: OrigenFechaTimbrado = delTfd !== null ? 'tfd' : r.fechaTimbrado !== '' ? 'pac' : 'servidor';
  const fecha = delTfd ?? (r.fechaTimbrado !== '' ? r.fechaTimbrado : new Date().toISOString());
  if (origen !== 'tfd') {
    logger.warn('timbre.fecha_sin_tfd', { viajeId, uuid: r.uuid, origen });
  }

  const { error } = await acotada(admin.from('ccp_timbre').update({
    estado: 'vigente',
    fecha_timbrado: fecha, fecha_timbrado_origen: origen,
    sello_sat: r.selloSat, no_certificado_sat: r.noCertificadoSat,
    xml: r.xmlTimbrado,
  }).eq('tenant_id', tenantId).eq('id', reservaId).eq('estado', 'pendiente'), 'timbre.persistir');

  if (error) {
    // Timbre emitido y NO consolidado: la peor combinación. El uuid YA está
    // en la reserva (arriba), así que el folio no se pierde — pero se grita
    // igual, por log y por el canal del operador.
    logger.error('timbre.emitido_sin_persistir', { viajeId, uuid: r.uuid, reservaId, error: error.message });
    await alertarOperador('timbre.emitido_sin_persistir', {
      error: `Viaje ${viajeId}: el PAC timbró el uuid ${r.uuid} y la consolidación falló (${error.message}). El folio quedó guardado en la reserva ${reservaId}; falta el XML y el sello.`,
      codigo: 'timbre_emitido_sin_persistir',
    });
    return { ok: false, motivo: `El PAC SÍ timbró (uuid ${r.uuid}) pero el registro en Likida quedó a medias: ${error.message}. El folio quedó guardado y este viaje está bloqueado — avisa a soporte y NO vuelvas a timbrarlo.` };
  }

  await anotarBitacora(
    { tenantId, actor, accion: 'ccp.timbrado', entidad: 'viaje', entidadId: viajeId,
      detalle: { uuid: r.uuid, proveedor: pac.nombre, modo: ctx.emisor.modo, total: cfdi.total, fechaOrigen: origen } },
    { evento: 'timbre.bitacora_no_escribio' },
  );
  logger.info('timbre.ok', { viajeId, uuid: r.uuid, modo: ctx.emisor.modo, fechaOrigen: origen });
  return { ok: true, uuid: r.uuid, fechaTimbrado: fecha, modo: ctx.emisor.modo, yaExistia: false };
}

/** Lo que la pantalla lee cuando hay una reserva viva. Dos verdades muy
 *  distintas: un timbrado en curso se espera; uno que ya tiene folio y no
 *  cerró es un asunto de soporte. */
export function motivoDeReservaViva(reserva: ReservaTimbre): string {
  if (reserva.uuidFiscal !== null) {
    return `Este viaje YA TIENE un folio fiscal emitido (${reserva.uuidFiscal}) cuyo registro en Likida quedó a medias. NO lo vuelvas a timbrar: ese CFDI existe ante el SAT. Avisa a soporte con ese folio.`;
  }
  return 'Otro timbrado de este viaje está en curso (o quedó sin respuesta del PAC). No se llamó al PAC otra vez a propósito: dos llamadas serían dos CFDIs. Espera y recarga; si lleva así mucho rato, verifica en el panel del PAC y avisa a soporte.';
}

/** Un renglón de la cola de timbrado del contador. `timbre` null = todavía no
 *  se ha intentado; 'pendiente' = hay una reserva viva (0227). */
export interface RenglonTimbrado {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  xmlGeneradoEn: string | null;
  timbre: { estado: 'vigente' | 'pendiente'; uuidFiscal: string | null; modo: string; fechaTimbrado: string | null } | null;
}

/**
 * LA COLA DEL CONTADOR (0227 — c6-3): por dónde llega al flujo de timbre
 * desde SU panel, sin pasar por una pantalla de operación.
 *
 * QUÉ LISTA, dicho sin adornos porque la pantalla lo cita: los viajes cuyo
 * XML de Carta Porte ya se generó al menos una vez (`ccp_xml_generado_en` —
 * la señal de que alguien trabajó ese borrador) MÁS los que ya tienen timbre
 * o reserva. NO es "todos los viajes que necesitan complemento": eso lo
 * decide el borrador viaje por viaje, y afirmarlo aquí sería inventar una
 * lista que nadie midió.
 */
export async function listarTimbrado(tenantId: string, limite = 25): Promise<RenglonTimbrado[]> {
  const admin = supabaseAdmin();

  const [conXml, timbres] = await Promise.all([
    acotada(admin.from('viaje')
      .select('id, folio, origen, destino, ccp_xml_generado_en')
      .eq('tenant_id', tenantId)
      .not('ccp_xml_generado_en', 'is', null)
      .order('ccp_xml_generado_en', { ascending: false })
      .limit(limite), 'timbre.cola.viajes'),
    acotada(admin.from('ccp_timbre')
      .select('viaje_id, uuid_fiscal, estado, modo, fecha_timbrado')
      .eq('tenant_id', tenantId)
      .in('estado', ['vigente', 'pendiente'])
      .order('creado_en', { ascending: false })
      .limit(limite), 'timbre.cola.timbres'),
  ]);
  if (conXml.error) throw new Error(`listarTimbrado/viajes: ${conXml.error.message}`);
  if (timbres.error) throw new Error(`listarTimbrado/timbres: ${timbres.error.message}`);

  const porViaje = new Map<string, RenglonTimbrado['timbre']>();
  for (const f of (timbres.data ?? []) as Array<Record<string, unknown>>) {
    porViaje.set(String(f.viaje_id), {
      estado: f.estado === 'vigente' ? 'vigente' : 'pendiente',
      uuidFiscal: txt(f.uuid_fiscal),
      modo: String(f.modo),
      fechaTimbrado: txt(f.fecha_timbrado),
    });
  }

  const filas = new Map<string, RenglonTimbrado>();
  for (const f of (conXml.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(f.id);
    filas.set(id, {
      viajeId: id, folio: txt(f.folio), origen: txt(f.origen), destino: txt(f.destino),
      xmlGeneradoEn: txt(f.ccp_xml_generado_en), timbre: porViaje.get(id) ?? null,
    });
  }

  // Un viaje timbrado cuyo XML nunca se descargó no puede faltar de SU
  // PROPIA cola: se completan sus datos en una segunda pasada, acotada al
  // tenant como todo lo de este archivo.
  const faltan = [...porViaje.keys()].filter((id) => !filas.has(id));
  if (faltan.length > 0) {
    const { data, error } = await acotada(admin.from('viaje')
      .select('id, folio, origen, destino, ccp_xml_generado_en')
      .eq('tenant_id', tenantId).in('id', faltan.slice(0, limite)), 'timbre.cola.viajes_timbrados');
    if (error) throw new Error(`listarTimbrado/viajes_timbrados: ${error.message}`);
    for (const f of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(f.id);
      filas.set(id, {
        viajeId: id, folio: txt(f.folio), origen: txt(f.origen), destino: txt(f.destino),
        xmlGeneradoEn: txt(f.ccp_xml_generado_en), timbre: porViaje.get(id) ?? null,
      });
    }
  }

  // Primero lo que pide acción (sin timbre, luego reserva viva), después lo ya
  // hecho: la cola es para trabajar, no para archivar.
  const orden = (r: RenglonTimbrado): number => (r.timbre === null ? 0 : r.timbre.estado === 'pendiente' ? 1 : 2);
  return [...filas.values()].sort((a, b) => orden(a) - orden(b) || (b.xmlGeneradoEn ?? '').localeCompare(a.xmlGeneradoEn ?? ''));
}

/**
 * El sello de que un XML es de PRUEBA (c6-10), dentro del propio archivo.
 * PURA. Un timbre sandbox descargado y reenviado por correo llega sin
 * contexto: fuera de la pantalla que lo rotula, es indistinguible de uno
 * real. El comentario va DESPUÉS de la declaración `<?xml …?>` porque un
 * comentario antes de ella hace inválido el documento.
 */
export const AVISO_SANDBOX_XML = '<!-- TIMBRE DE PRUEBA — NO AMPARA ningún traslado ni efecto fiscal. Emitido contra el ambiente de PRUEBAS del PAC. -->';

export function marcarXmlSandbox(xml: string): string {
  const cierre = xml.startsWith('<?xml') ? xml.indexOf('?>') : -1;
  if (cierre === -1) return `${AVISO_SANDBOX_XML}\n${xml}`;
  const corte = cierre + 2;
  return `${xml.slice(0, corte)}\n${AVISO_SANDBOX_XML}${xml.slice(corte)}`;
}

/** El XML timbrado para descarga. Null = no hay timbre vigente. El `modo`
 *  viaja con él: quien lo entrega tiene que poder rotular la prueba. */
export async function leerXmlTimbrado(
  tenantId: string, viajeId: string,
): Promise<{ xml: string; uuid: string; modo: 'sandbox' | 'produccion' } | null> {
  const admin = supabaseAdmin();
  const { data, error } = await acotada(admin.from('ccp_timbre')
    .select('xml, uuid_fiscal, modo')
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente').maybeSingle(), 'timbre.xml');
  if (error) throw new Error(`leerXmlTimbrado: ${error.message}`);
  if (data === null) return null;
  const f = data as Record<string, unknown>;
  const modo = f.modo === 'produccion' ? 'produccion' : 'sandbox';
  const xml = String(f.xml);
  return { xml: modo === 'sandbox' ? marcarXmlSandbox(xml) : xml, uuid: String(f.uuid_fiscal), modo };
}
