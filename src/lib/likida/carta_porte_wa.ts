import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido } from './errores';
import { telefonoJefeDe } from './contactos';
import type { RolOficina } from './contactos';
import { sendText, sendButtons } from '@/lib/meta/client';
import { puedeAsignar } from '@/lib/auth/permisos';
import { getPerfilCrudo } from './repo';
import { transporteDedicadoDeclarado } from './perfil/preguntas';
import { registrarCorrida } from './agentes/corridas';
import { getBorradorViaje, declararCcp, validarDeclaracion, type ViajeCcp } from './carta_porte_datos';

// ═══════════════════════════════════════════════════════════════════════════
// CARTA PORTE POR WHATSAPP (Fase B del blueprint 20-Agente-Carta-Porte) — el
// hueco H1: el clasificador legal existía desde la 0099 y NADIE lo corría al
// despachar. El viaje salía y la pregunta fiscal («¿este viaje necesita el
// complemento?») se contestaba tarde o nunca.
//
// El circuito: al CREAR el viaje se evalúa `necesitaCartaPorte` con lo que
// haya declarado la flota, y el JEFE recibe por WhatsApp exactamente lo que
// falta para decidir — la pregunta del tramo federal con botones, o la del
// radio de 30 km si la unidad cabe en la excepción. Si ya se puede decidir,
// recibe el veredicto CON fundamento y el checklist recortado.
//
// ── LOS TRES CANDADOS (no negociables, del blueprint) ──────────────────────
//  1. El agente JAMÁS afirma "no necesitas Carta Porte" por su cuenta: el
//     «no» siempre viene de la DECLARACIÓN de la flota (botón `ccp_no`), que
//     queda firmada en el viaje con bitácora — recomendación registrada,
//     decisión del cliente encima (P38).
//  2. JAMÁS inventa un dato del complemento: faltante = faltante.
//  3. JAMÁS timbra (0049) — aquí ni siquiera hay con qué.
//
// ── POR QUÉ EL BOTÓN ESCRIBE LA DECLARACIÓN ────────────────────────────────
// El botón `ccp_si`/`ccp_no` es la MISMA declaración que la forma del panel
// escribe en `viaje.ccp_pisa_federal` (0099): quién conoce la ruta declara,
// con rol re-gateado (`puedeAsignar`) y tenant del LOOKUP, jamás del texto —
// el mismo contrato que talacha_wa. El radio llega por texto («radio F-123
// 25») porque un número no cabe en un botón.
// ═══════════════════════════════════════════════════════════════════════════

const rotuloViaje = (v: ViajeCcp): string => v.folio ?? v.viajeId.slice(0, 8);

/** La advertencia del transporte DEDICADO (H5): se AVISA la inversión de
 *  roles de la 2.7.7.1.3, sin veredicto duro — la P40 del fiscalista sigue
 *  abierta y este agente no la cierra por su cuenta. */
const AVISO_DEDICADO =
  '\n\n⚠️ Tu flota declaró transporte DEDICADO: en ese esquema la regla 2.7.7.1.3 invierte los roles ' +
  'y el complemento puede tocarle emitirlo a tu cliente con CFDI de traslado. Confírmalo con tu contador antes de emitir.';

/** El checklist recortado para WhatsApp: los conteos y los primeros faltantes
 *  del transportista — el detalle completo vive en el panel. */
function resumenChecklist(v: ViajeCcp): string {
  const c = v.checklist;
  const faltanT = c.campos.filter((x) => x.responsable === 'transportista' && x.presente !== true);
  const lineas: string[] = [];
  if (c.transportistaListo) {
    lineas.push('Los 18 datos del transportista están completos ✅.');
  } else {
    const primeros = faltanT.slice(0, 3).map((x) => x.rotulo).join(', ');
    lineas.push(`Del transportista faltan ${c.faltanTransportista} de 18: ${primeros}${faltanT.length > 3 ? '…' : ''}.`);
  }
  lineas.push(
    c.faltanCliente > 0
      ? `Del cliente faltan ${c.faltanCliente} de 19 — pídeselos ANTES del viaje; ante el SAT esos datos son responsabilidad suya (2.7.7.1.1).`
      : 'Los 19 datos del cliente están completos ✅.',
  );
  lineas.push('El detalle campo por campo está en el panel → Carta Porte.');
  return lineas.join('\n');
}

/** La pregunta del radio, cuando pisa federal y la unidad puede caber en la
 *  excepción del C2. El número no cabe en un botón: se pide por texto. */
function preguntaRadio(v: ViajeCcp): string {
  const pendientes = v.decision.pendientes.map((p) => `• ${p}`).join('\n');
  return (
    `El viaje ${rotuloViaje(v)} pisa carretera federal, pero la unidad podría caber en la excepción del radio de 30 km (regla 2.7.7.2.8). Falta:\n` +
    `${pendientes}\n\n` +
    `Si ya mediste el radio, contéstame:\n*radio ${rotuloViaje(v)} <km>*\n(p. ej. «radio ${rotuloViaje(v)} 25»). ` +
    'Ojo: es el RADIO entre origen y destino final, no los kilómetros del odómetro. Mientras no se declare, lo seguro es tratar el viaje CON complemento.'
  );
}

/** El texto según el veredicto ya decidible. Para `falta_declarar` con el
 *  tramo federal aún sin declarar, quien llama manda los BOTONES, no esto. */
function textoVeredicto(v: ViajeCcp, dedicado: boolean): string {
  const d = v.decision;
  if (d.necesita === 'si') {
    return (
      `📋 El viaje ${rotuloViaje(v)} NECESITA complemento Carta Porte.\n${d.motivo}\n(${d.fundamento})\n\n` +
      resumenChecklist(v) +
      (dedicado ? AVISO_DEDICADO : '')
    );
  }
  // 'no': la línea con fundamento Y rastro — la decisión quedó declarada en el
  // viaje (bitácora `ccp.declarado`), y eso se le dice al jefe tal cual.
  return (
    `El viaje ${rotuloViaje(v)} sale SIN complemento según lo declarado.\n${d.motivo}\n(${d.fundamento})\n\n` +
    'La declaración quedó firmada en el viaje — es tu rastro ante una revisión. Si la ruta cambia y pisa federal, la obligación revive: decláralo en el panel o mándame «sí pisa».' +
    (dedicado ? AVISO_DEDICADO : '')
  );
}

/**
 * EL DISPARO (H1): se corre al crear el viaje, best-effort desde `crearViaje`
 * — el viaje ya existe y esa es la operación pedida; si WhatsApp está caído,
 * el semáforo del panel sigue diciendo la verdad.
 *
 * Deja rastro SIEMPRE (`ccp.evaluado` en bitácora, con el veredicto y su
 * fundamento), aunque el aviso no salga.
 */
export async function evaluarYAvisarCcpDespacho(tenantId: string, viajeId: string): Promise<void> {
  const inicio = new Date();
  const [v, perfil] = await Promise.all([
    getBorradorViaje(tenantId, viajeId),
    getPerfilCrudo(tenantId).catch(() => ({})),
  ]);
  if (!v) {
    logger.warn('ccp.disparo_sin_viaje', { tenant: tenantId, viaje: viajeId });
    return;
  }
  const dedicado = transporteDedicadoDeclarado(perfil) === true;

  await anotarBitacora(
    { tenantId, actor: {}, accion: 'ccp.evaluado', entidad: 'viaje', entidadId: viajeId,
      detalle: { necesita: v.decision.necesita, fundamento: v.decision.fundamento, pendientes: v.decision.pendientes } },
    { evento: 'carta_porte.bitacora_no_escribio' },
  );

  let telefono: string | null = null;
  try {
    telefono = await telefonoJefeDe(tenantId);
  } catch (e) {
    logger.error('ccp.jefe_ilegible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (!telefono) {
    logger.warn('ccp.sin_jefe', { tenant: tenantId, viaje: viajeId });
    return;
  }

  const d = v.decision;
  let enviado: unknown;
  if (d.necesita === 'falta_declarar' && v.declarado.pisaFederal === null) {
    // La primera entrada del árbol sin declarar: la pregunta con botones.
    enviado = await sendButtons(
      telefono,
      `📋 Despachaste el viaje ${rotuloViaje(v)}${v.origen && v.destino ? ` (${v.origen} → ${v.destino})` : ''}.\n\n` +
      '¿La ruta pisa algún tramo de carretera FEDERAL? La regla exige plena certeza para no emitir el complemento — no se adivina (RMF 2.7.7.2.1).' +
      (dedicado ? AVISO_DEDICADO : ''),
      [
        { id: `ccp_si:${v.viajeId}`, titulo: 'Sí pisa' },
        { id: `ccp_no:${v.viajeId}`, titulo: 'No pisa' },
      ],
    );
  } else if (d.necesita === 'falta_declarar') {
    // Pisa federal declarado; falta el radio (o confirmar la configuración).
    enviado = await sendText(telefono, `📋 ${preguntaRadio(v)}${dedicado ? AVISO_DEDICADO : ''}`);
  } else {
    enviado = await sendText(telefono, textoVeredicto(v, dedicado));
  }
  logger.info('ccp.disparo', { tenant: tenantId, viaje: viajeId, necesita: d.necesita, avisado: Boolean(enviado) });

  // La ficha de corridas (B3): la evaluación + el aviso son la tarea de esta
  // corrida. `registrarCorrida` jamás lanza — el aviso ya salió (o no, y el
  // estado lo dice).
  await registrarCorrida(tenantId, 'carta_porte', {
    inicio, fin: new Date(),
    estado: enviado ? 'ok' : 'parcial',
    disparo: 'whatsapp',
    tareasHechas: enviado ? 2 : 1,
    tareasTotal: 2,
    resumen: { viaje: viajeId, folio: v.folio, veredicto: d.necesita },
    error: enviado ? undefined : 'El viaje se evaluó pero el aviso por WhatsApp al jefe no salió.',
  });
}

// ── El lado del JEFE: botones y radio ──────────────────────────────────────

export interface CuentaCcp {
  /** `null` solo en superadmin sin flota. */
  tenantId: string | null;
  rol: RolOficina;
  /** El app_user que firma la declaración. */
  userId: string;
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** El botón del aviso: `ccp_si:<uuid>` / `ccp_no:<uuid>`. UUID estricto. */
function leerBotonCcp(texto: string): { pisa: boolean; viajeId: string } | null {
  const m = new RegExp(`^ccp_(si|no):(${UUID_RE})$`, 'i').exec(texto.trim());
  if (!m) return null;
  return { pisa: m[1].toLowerCase() === 'si', viajeId: m[2] };
}

/** El comando del radio: «radio F-123 25» (km opcionalmente con decimal y
 *  sufijo "km"). El identificador es el folio del viaje — o el prefijo del
 *  UUID cuando el viaje no tiene folio, que es lo que `rotuloViaje` dicta en
 *  el aviso (c2-5) — y se resuelve con LOOKUP acotado al tenant. */
function leerComandoRadio(texto: string): { folio: string; km: string } | null {
  // Por partes y con regex PLANOS (sin cuantificador anidado, que el linter
  // de seguridad marca como backtracking potencial): «radio <folio> <km>»,
  // con «km» pegado o suelto al final, opcional.
  const partes = texto.trim().split(/\s{1,10}/);
  if (partes.length < 3 || partes.length > 4 || !/^radio$/i.test(partes[0])) return null;
  const folio = partes[1];
  if (folio.length > 40) return null;
  let km = partes[2];
  if (partes.length === 4) {
    if (!/^km$/i.test(partes[3])) return null;
  } else if (/km$/i.test(km)) {
    km = km.slice(0, -2);
  }
  if (!/^\d{1,4}$/.test(km) && !/^\d{1,4}[.,]\d{1,2}$/.test(km)) return null;
  return { folio, km };
}

/** Re-lee el viaje y arma la respuesta al jefe tras escribir su declaración. */
async function responderTrasDeclarar(tenantId: string, viajeId: string): Promise<string> {
  const [v, perfil] = await Promise.all([
    getBorradorViaje(tenantId, viajeId),
    getPerfilCrudo(tenantId).catch(() => ({})),
  ]);
  if (!v) return 'Quedó declarado, pero no pude releer el viaje para darte el veredicto — revísalo en el panel → Carta Porte.';
  const dedicado = transporteDedicadoDeclarado(perfil) === true;
  if (v.decision.necesita === 'falta_declarar') return preguntaRadio(v) + (dedicado ? AVISO_DEDICADO : '');
  return textoVeredicto(v, dedicado);
}

/**
 * El turno de un mensaje de OFICINA que puede ser de este circuito. `null` =
 * no es nuestro y sigue su camino (despacho → asignación → informes → saludo).
 *
 * El botón siempre se atiende (un id crudo llegando al saludo se vería roto);
 * el comando «radio …» también es inconfundible. Todo lo demás pasa de largo.
 */
export async function atenderCcpOficina(cuenta: CuentaCcp, texto: string): Promise<string | null> {
  if (!texto?.trim()) return null;

  const boton = leerBotonCcp(texto);
  const radio = boton ? null : leerComandoRadio(texto);
  if (!boton && !radio) return null;

  if (!cuenta.tenantId) {
    // Superadmin sin flota: no hay viajes suyos que declarar.
    return 'Ese viaje no es de una flota tuya.';
  }

  // El candado de rol ANTES de tocar nada: declarar la ruta de un viaje es
  // firmar una decisión fiscal — le toca a quien despacha, no al contador.
  if (!puedeAsignar(cuenta.rol)) {
    return 'Tu rol no declara rutas de viajes — eso le toca al dueño o al jefe de tráfico.';
  }
  const tenantId = cuenta.tenantId;
  const actor = { id: cuenta.userId };

  if (boton) {
    // El radio ya declarado se PRESERVA en `ccp_si`: `declararCcp` pisa las
    // dos columnas, y borrar una medición real porque el jefe reapretó el
    // botón sería perder el dato bueno. En `ccp_no` el radio se limpia — la
    // pareja «no pisa + radio» es la contradicción que `validarDeclaracion`
    // rechaza, y aquí se resuelve a favor de la declaración nueva.
    let radioActual: number | null = null;
    if (boton.pisa) {
      const { data, error } = await acotada(supabaseAdmin().from('viaje')
        .select('ccp_radio_federal_km')
        .eq('id', boton.viajeId).eq('tenant_id', tenantId).maybeSingle(), 'ccp.leerRadio');
      if (error) {
        logger.error('ccp.radio_ilegible', { viaje: boton.viajeId, err: error.message });
        return 'No pude registrar tu declaración ahorita — inténtalo de nuevo en un momento.';
      }
      if (!data) return 'No encontré ese viaje en tu flota.';
      const r = data.ccp_radio_federal_km;
      radioActual = r == null ? null : Number(r);
    }
    try {
      await declararCcp(tenantId, boton.viajeId, { pisaFederal: boton.pisa, radioKm: boton.pisa ? radioActual : null }, actor);
    } catch (e) {
      if (e instanceof DatoInvalido) return e.message;
      logger.error('ccp.declarar_fallo', { viaje: boton.viajeId, err: e instanceof Error ? e.message : String(e) });
      return 'No pude registrar tu declaración ahorita — inténtalo de nuevo en un momento.';
    }
    logger.info('ccp.declarado_wa', { viaje: boton.viajeId, pisa: boton.pisa, por: cuenta.userId });
    return responderTrasDeclarar(tenantId, boton.viajeId);
  }

  // ── «radio F-123 25» ─────────────────────────────────────────────────────
  const cmd = radio!;
  // ilike SOLO para ignorar mayúsculas: los comodines del patrón se escapan —
  // un folio no es una expresión de búsqueda.
  const folioExacto = cmd.folio.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await acotada(supabaseAdmin().from('viaje')
    .select('id, folio, ccp_pisa_federal')
    .eq('tenant_id', tenantId)
    .ilike('folio', folioExacto)
    .in('estatus', ['abierto', 'en_cuadre'])
    .limit(2), 'ccp.buscarFolio');
  if (error) {
    logger.error('ccp.folio_ilegible', { err: error.message });
    return 'No pude buscar ese viaje ahorita — inténtalo de nuevo en un momento.';
  }
  let filas = data ?? [];
  // AUDITORÍA FABLE CICLO 2 (c2-5): para un viaje SIN folio, `rotuloViaje`
  // dicta el prefijo del UUID («radio 1a2b3c4d 25») — y este lookup lo
  // buscaba como folio, o sea que el comando que el propio bot dictó no podía
  // funcionar jamás. Si el folio no matcheó y el token parece prefijo de
  // UUID, se resuelve contra los ids de los viajes en curso (acotados al
  // tenant); la ambigüedad se dice, nunca se adivina.
  if (filas.length === 0 && /^[0-9a-f][0-9a-f-]{7,35}$/i.test(cmd.folio)) {
    const prefijo = cmd.folio.toLowerCase();
    const { data: porId, error: errId } = await acotada(supabaseAdmin().from('viaje')
      .select('id, folio, ccp_pisa_federal')
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .limit(500), 'ccp.buscarPorId');
    if (errId) {
      logger.error('ccp.buscarPorId_ilegible', { err: errId.message });
      return 'No pude buscar ese viaje ahorita — inténtalo de nuevo en un momento.';
    }
    filas = (porId ?? []).filter((f) => String(f.id).toLowerCase().startsWith(prefijo));
  }
  if (filas.length === 0) return `No encontré un viaje en curso con folio «${cmd.folio}» en tu flota.`;
  if (filas.length > 1) return `Hay más de un viaje en curso con folio «${cmd.folio}» — decláralo desde el panel → Carta Porte para no confundirlos.`;
  const fila = filas[0] as { id: string; ccp_pisa_federal: boolean | null };

  // El radio solo tiene sentido con «sí pisa» declarado: sin esa declaración
  // no se sabe qué mide, y con «no pisa» es la contradicción de siempre.
  if (fila.ccp_pisa_federal !== true) {
    return fila.ccp_pisa_federal === false
      ? `El viaje ${cmd.folio} está declarado como que NO pisa federal — ahí no hay radio que declarar. Si la ruta cambió, primero mándame «ccp_si» desde el aviso o decláralo en el panel.`
      : `Primero declara si el viaje ${cmd.folio} pisa carretera federal (los botones del aviso, o el panel) — el radio solo aplica cuando SÍ pisa.`;
  }

  let radioKm: number;
  try {
    const d = validarDeclaracion({ pisaFederal: 'si', radioKm: cmd.km });
    radioKm = d.radioKm as number;
  } catch (e) {
    if (e instanceof DatoInvalido) return e.message;
    throw e;
  }
  try {
    await declararCcp(tenantId, fila.id, { pisaFederal: true, radioKm }, actor);
  } catch (e) {
    if (e instanceof DatoInvalido) return e.message;
    logger.error('ccp.radio_fallo', { viaje: fila.id, err: e instanceof Error ? e.message : String(e) });
    return 'No pude registrar el radio ahorita — inténtalo de nuevo en un momento.';
  }
  logger.info('ccp.radio_wa', { viaje: fila.id, radioKm, por: cuenta.userId });
  return responderTrasDeclarar(tenantId, fila.id);
}
