// ═══════════════════════════════════════════════════════════════════════════
// CARTA PORTE — el puente entre las reglas puras y los datos reales.
//
// `carta_porte.ts` decide; este archivo junta lo que hay en la base para que
// decida, y escribe las DOS declaraciones por viaje (¿pisa federal?, radio)
// que la 0099 creó. Mismo contrato que el resto del repo: errores POR VALOR
// comprobados, fallar cerrado (un error de lectura NUNCA se pinta como "no
// hay viajes"), y el tenant por argumento desde la sesión.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';
import { acotada } from './presupuesto';
import { getPerfilCrudo } from './repo';
import { hazmatDeclarado, transporteDedicadoDeclarado } from './perfil/preguntas';
import {
  necesitaCartaPorte, checklistCcp, armarBorrador,
  type DecisionCcp, type ChecklistCcp, type DatosChecklist,
  type MercanciaCapturada, type ResultadoBorrador,
} from './carta_porte';

/** Cuántos viajes en curso se evalúan por corrida de pantalla. El total real
 *  viaja aparte: la lista se recorta, el conteo no. */
export const LIMITE_CCP = 50;

/** Un renglón de `viaje_mercancia` con su id, para poder borrarlo. */
export interface MercanciaFila extends MercanciaCapturada {
  id: string;
}

export interface DatosClienteCcp {
  origenCp: string | null;
  destinoCp: string | null;
  origenEstado: string | null;
  destinoEstado: string | null;
  rfcDestinatario: string | null;
  transpInternac: boolean | null;
}

export interface ViajeCcp {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  estatus: string;
  unidadEconomico: string | null;
  operadorNombre: string | null;
  clienteNombre: string | null;
  declarado: { pisaFederal: boolean | null; radioKm: number | null };
  decision: DecisionCcp;
  checklist: ChecklistCcp;
  datosCliente: DatosClienteCcp;
  mercancias: MercanciaFila[];
  borrador: ResultadoBorrador;
  /** Lo capturado tal cual (unidad, operador, CCP del viaje) — la fuente del
   *  checklist Y del XML exportable (Fase D): el generador necesita los datos
   *  crudos (permiso SICT, póliza RC, año del vehículo…) que el
   *  `ComplementoBorrador` no acarrea porque el validador no los juzga. */
  datos: DatosChecklist;
}

export interface EstadoCartaPorte {
  viajes: ViajeCcp[];
  total: number;
  /** Declaraciones del PERFIL de la flota (nunca inferidas): hazmat vuelve la
   *  carga materia excluida (complemento SIEMPRE); dedicado invierte los roles
   *  del complemento (2.7.7.1.3) y se ADVIERTE sin veredicto. */
  hazmatDeclarado: boolean | null;
  dedicadoDeclarado: boolean | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Los viajes SIN CERRAR (abierto/en_cuadre) con su semáforo de Carta Porte.
 *
 * Sin cerrar y no liquidados a propósito: el complemento se resuelve ANTES de
 * que la unidad salga — un viaje liquidado con la Carta Porte mal ya viajó, y
 * eso no se arregla desde una pantalla.
 *
 * SUPUESTO DECLARADO (y la pantalla lo repite): se evalúa como CARGA GENERAL.
 * Likida no captura todavía la materia de la carga, y las materias excluidas
 * (hidrocarburos, medicamentos, despacho aduanero) vuelven el complemento
 * obligatorio SIEMPRE — quien las mueva no debe fiarse del "no necesita".
 */
/** Las columnas y embeds que necesita el mapeo de un viaje a su semáforo. */
const SELECT_CCP =
  'id, folio, origen, destino, estatus, fecha_inicio, km_recorridos, ccp_pisa_federal, ccp_radio_federal_km, ' +
  'ccp_origen_cp, ccp_destino_cp, ccp_origen_estado, ccp_destino_estado, ccp_rfc_destinatario, ccp_transp_internac, ' +
  'unidad:unidad_id (numero_economico, placas, anio, config_vehicular, peso_bruto_ton, aseguradora_rc, poliza_rc_numero, permiso_sict_tipo, permiso_sict_numero), ' +
  'operador:operador_id (nombre, rfc, licencia), ' +
  'cliente:cliente_id (nombre, rfc), ' +
  'mercancias:viaje_mercancia (id, descripcion, bienes_transp, cantidad, clave_unidad, peso_kg, material_peligroso)';

function filaAViajeCcp(f: unknown, materiaExcluida: boolean): ViajeCcp {
  const v = f as Record<string, unknown>;
  // PostgREST devuelve el embed como objeto (FK simple) — y como con todo
  // lo demás, ausencia es null, jamás un objeto vacío que finja datos.
  const u = (v.unidad ?? null) as Record<string, unknown> | null;
  const o = (v.operador ?? null) as Record<string, unknown> | null;
  const c = (v.cliente ?? null) as Record<string, unknown> | null;

  const declarado = {
    pisaFederal: typeof v.ccp_pisa_federal === 'boolean' ? v.ccp_pisa_federal : null,
    radioKm: num(v.ccp_radio_federal_km),
  };

  const decision = necesitaCartaPorte({
    pisaTramoFederal: declarado.pisaFederal,
    configVehicular: txt(u?.config_vehicular ?? null),
    radioFederalKm: declarado.radioKm,
    materiaExcluida,
  });

  const datosCliente: DatosClienteCcp = {
    origenCp: txt(v.ccp_origen_cp), destinoCp: txt(v.ccp_destino_cp),
    origenEstado: txt(v.ccp_origen_estado), destinoEstado: txt(v.ccp_destino_estado),
    rfcDestinatario: txt(v.ccp_rfc_destinatario),
    transpInternac: typeof v.ccp_transp_internac === 'boolean' ? v.ccp_transp_internac : null,
  };

  const mercancias: MercanciaFila[] = (Array.isArray(v.mercancias) ? v.mercancias : []).map((fila) => {
    const m = fila as Record<string, unknown>;
    return {
      id: String(m.id),
      descripcion: String(m.descripcion ?? ''),
      bienesTransp: txt(m.bienes_transp),
      cantidad: num(m.cantidad) ?? 0,
      claveUnidad: txt(m.clave_unidad),
      pesoKg: num(m.peso_kg),
      materialPeligroso: typeof m.material_peligroso === 'boolean' ? m.material_peligroso : null,
    };
  });

  const datos: DatosChecklist = {
    viaje: {
      origen: txt(v.origen), destino: txt(v.destino),
      fechaInicio: txt(v.fecha_inicio), kmRecorridos: num(v.km_recorridos),
    },
    clienteRfc: txt(c?.rfc ?? null),
    unidad: u === null ? null : {
      placas: txt(u.placas), anio: num(u.anio),
      configVehicular: txt(u.config_vehicular), pesoBrutoTon: num(u.peso_bruto_ton),
      aseguradoraRc: txt(u.aseguradora_rc), polizaRcNumero: txt(u.poliza_rc_numero),
      permisoSictTipo: txt(u.permiso_sict_tipo), permisoSictNumero: txt(u.permiso_sict_numero),
    },
    operador: o === null ? null : {
      nombre: txt(o.nombre), rfc: txt(o.rfc), licencia: txt(o.licencia),
    },
    ccpViaje: datosCliente,
    mercancias,
  };

  return {
    viajeId: String(v.id),
    folio: txt(v.folio),
    origen: txt(v.origen),
    destino: txt(v.destino),
    estatus: String(v.estatus),
    unidadEconomico: txt(u?.numero_economico ?? null),
    operadorNombre: txt(o?.nombre ?? null),
    clienteNombre: txt(c?.nombre ?? null),
    declarado,
    decision,
    checklist: checklistCcp(datos),
    datosCliente,
    mercancias,
    borrador: armarBorrador(datos),
    datos,
  };
}

export async function getEstadoCartaPorte(tenantId: string): Promise<EstadoCartaPorte> {
  const [{ data, error, count }, perfil] = await Promise.all([
    acotada(
      supabaseAdmin().from('viaje')
        .select(SELECT_CCP, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .in('estatus', ['abierto', 'en_cuadre'])
        .order('fecha_inicio', { ascending: true, nullsFirst: false })
        .limit(LIMITE_CCP),
      'getEstadoCartaPorte',
    ),
    getPerfilCrudo(tenantId),
  ]);
  if (error) throw new Error(`getEstadoCartaPorte: ${error.message}`);

  // Hazmat DECLARADO en el perfil = materia excluida: el complemento es
  // obligatorio siempre y ninguna facilidad aplica (2.7.7.2.1 cuarto párrafo).
  // Null (sin declarar) NO excluye — el supuesto de carga general sigue en
  // pie y la pantalla lo repite.
  const hazmat = hazmatDeclarado(perfil);
  const dedicado = transporteDedicadoDeclarado(perfil);

  const viajes: ViajeCcp[] = (data ?? []).map((f) => filaAViajeCcp(f, hazmat === true));

  return { viajes, total: count ?? viajes.length, hazmatDeclarado: hazmat, dedicadoDeclarado: dedicado };
}

/**
 * Un solo viaje con su borrador armado y validado — la página imprimible.
 * `null` = ese viaje no está en la flota pedida (o no existe); un error de
 * lectura LANZA, no se disfraza de "no encontrado".
 */
export async function getBorradorViaje(tenantId: string, viajeId: string): Promise<ViajeCcp | null> {
  if (!esUuidValido(viajeId)) return null;
  const [{ data, error }, perfil] = await Promise.all([
    acotada(
      supabaseAdmin().from('viaje')
        .select(SELECT_CCP)
        .eq('tenant_id', tenantId)
        .eq('id', viajeId)
        .maybeSingle(),
      'getBorradorViaje',
    ),
    getPerfilCrudo(tenantId),
  ]);
  if (error) throw new Error(`getBorradorViaje: ${error.message}`);
  if (!data) return null;
  return filaAViajeCcp(data, hazmatDeclarado(perfil) === true);
}

// ── La declaración por viaje ───────────────────────────────────────────────

export interface DeclaracionCcp {
  pisaFederal: boolean | null;
  radioKm: number | null;
}

/** Valida lo tecleado. `''` en el radio es "no medido" (null), jamás 0. */
export function validarDeclaracion(crudo: { pisaFederal: string; radioKm: string }): DeclaracionCcp {
  let pisaFederal: boolean | null;
  if (crudo.pisaFederal === 'si') pisaFederal = true;
  else if (crudo.pisaFederal === 'no') pisaFederal = false;
  else if (crudo.pisaFederal === '') pisaFederal = null;
  else throw new DatoInvalido('La declaración de tramo federal solo puede ser sí, no, o quedar sin declarar.');

  let radioKm: number | null = null;
  const t = crudo.radioKm.trim();
  if (t !== '') {
    const limpio = t.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(limpio)) throw new DatoInvalido('El radio tiene que ser un número de kilómetros.');
    radioKm = Number(limpio);
    if (!Number.isFinite(radioKm) || radioKm < 0 || radioKm >= 5000) {
      throw new DatoInvalido('El radio tiene que estar entre 0 y 5,000 km. Recuerda: es el RADIO entre origen y destino final, no el odómetro.');
    }
    radioKm = Math.round(radioKm * 10) / 10;
  }

  // Un radio con "no pisa federal" declarado es una contradicción que después
  // nadie sabe leer: ¿midió y no pisa, o pisa y esto es el radio?
  if (pisaFederal === false && radioKm !== null) {
    throw new DatoInvalido('Si la ruta no pisa tramo federal, no hay radio federal que declarar. Deja el radio vacío, o declara que sí pisa.');
  }

  return { pisaFederal, radioKm };
}

/**
 * Escribe la declaración en el viaje. Queda EN LA FILA a propósito: es el
 * rastro de quién decidió que este viaje salía sin complemento, que es lo
 * primero que pregunta la autoridad (regla 2.7.7.2.1: "plena certeza").
 */
export async function declararCcp(
  tenantId: string,
  viajeId: string,
  d: DeclaracionCcp,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(viajeId)) throw new DatoInvalido('No se reconoce ese viaje. Recarga la pantalla.');

  const { data, error } = await acotada(supabaseAdmin().from('viaje').update({
    ccp_pisa_federal: d.pisaFederal,
    ccp_radio_federal_km: d.radioKm,
  }).eq('id', viajeId).eq('tenant_id', tenantId).select('id'), 'declararCcp');

  if (error) throw new Error(`declararCcp: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese viaje no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  }

  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion: 'ccp.declarado', entidad: 'viaje', entidadId: viajeId,
      detalle: { pisaFederal: d.pisaFederal, radioKm: d.radioKm } },
    { evento: 'carta_porte.bitacora_no_escribio' },
  );
}

// ── La mercancía del viaje (Fase C, hueco H2) ──────────────────────────────

export interface MercanciaNueva {
  descripcion: string;
  bienesTransp: string | null;
  cantidad: number;
  claveUnidad: string | null;
  pesoKg: number | null;
  materialPeligroso: boolean | null;
}

const CLAVE_PROD_RE = /^[0-9]{8}$/;
const CLAVE_UNIDAD_RE = /^[A-Z0-9]{2,3}$/i;

/** Un número positivo con hasta 3 decimales, en DOS regex planos: el linter
 *  de seguridad marca cualquier cuantificador anidado (`(\.\d+)?`) como
 *  backtracking potencial, y separar entero/decimal lo evita sin cambiar
 *  qué entra. El tope de 9 enteros es el mismo `< 1e9` de siempre. */
const ENTERO_RE = /^\d{1,9}$/;
const DECIMAL_RE = /^\d{1,9}\.\d{1,3}$/;
const esNumeroCapturable = (t: string): boolean => ENTERO_RE.test(t) || DECIMAL_RE.test(t);

/**
 * Valida lo tecleado en la forma de mercancía. Regla de la casa: `''` es
 * "sin dato" (null), jamás un default. La clave c_ClaveProdServCP se valida
 * por FORMATO — el catálogo es del SAT y lo confirma tu cliente; una clave
 * inventada por el software sería un dato falso en el complemento.
 */
export function validarMercancia(crudo: {
  descripcion: string; bienesTransp: string; cantidad: string;
  claveUnidad: string; pesoKg: string; materialPeligroso: string;
}): MercanciaNueva {
  const descripcion = crudo.descripcion.trim();
  if (descripcion === '') throw new DatoInvalido('La descripción de la mercancía es obligatoria — es lo mínimo que tu cliente te dio.');
  if (descripcion.length > 500) throw new DatoInvalido('La descripción no puede pasar de 500 caracteres.');

  const claveT = crudo.bienesTransp.trim();
  if (claveT !== '' && !CLAVE_PROD_RE.test(claveT)) {
    throw new DatoInvalido('La clave de bienes transportados son 8 dígitos del catálogo c_ClaveProdServCP del SAT (p. ej. 10101500). Si tu cliente no te la ha dado, déjala vacía — no se inventa.');
  }

  const cantT = crudo.cantidad.trim().replace(',', '.');
  if (!esNumeroCapturable(cantT)) throw new DatoInvalido('La cantidad tiene que ser un número mayor que cero.');
  const cantidad = Number(cantT);
  if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad >= 1e9) throw new DatoInvalido('La cantidad tiene que ser un número mayor que cero.');

  const unidadT = crudo.claveUnidad.trim().toUpperCase();
  if (unidadT !== '' && !CLAVE_UNIDAD_RE.test(unidadT)) {
    throw new DatoInvalido('La clave de unidad son 2 o 3 caracteres del catálogo c_ClaveUnidad (p. ej. KGM kilogramo, H87 pieza, XBX caja).');
  }

  let pesoKg: number | null = null;
  const pesoT = crudo.pesoKg.trim().replace(',', '.');
  if (pesoT !== '') {
    if (!esNumeroCapturable(pesoT)) throw new DatoInvalido('El peso tiene que ser un número de kilogramos mayor que cero.');
    pesoKg = Number(pesoT);
    if (!Number.isFinite(pesoKg) || pesoKg <= 0 || pesoKg >= 1e9) throw new DatoInvalido('El peso tiene que ser un número de kilogramos mayor que cero.');
    pesoKg = Math.round(pesoKg * 1000) / 1000;
  }

  let materialPeligroso: boolean | null;
  if (crudo.materialPeligroso === 'si') materialPeligroso = true;
  else if (crudo.materialPeligroso === 'no') materialPeligroso = false;
  else if (crudo.materialPeligroso === '') materialPeligroso = null;
  else throw new DatoInvalido('Material peligroso solo puede ser sí, no, o quedar sin declarar.');

  return {
    descripcion,
    bienesTransp: claveT === '' ? null : claveT,
    cantidad,
    claveUnidad: unidadT === '' ? null : unidadT,
    pesoKg,
    materialPeligroso,
  };
}

export async function guardarMercancia(
  tenantId: string,
  viajeId: string,
  m: MercanciaNueva,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(viajeId)) throw new DatoInvalido('No se reconoce ese viaje. Recarga la pantalla.');

  // El insert con tenant explícito: la FK compuesta (0204) rebota el cruce
  // de flotas aunque alguien mande un viaje_id ajeno.
  const { data, error } = await acotada(supabaseAdmin().from('viaje_mercancia').insert({
    tenant_id: tenantId,
    viaje_id: viajeId,
    descripcion: m.descripcion,
    bienes_transp: m.bienesTransp,
    cantidad: m.cantidad,
    clave_unidad: m.claveUnidad,
    peso_kg: m.pesoKg,
    material_peligroso: m.materialPeligroso,
  }).select('id'), 'guardarMercancia');

  if (error) {
    if (error.code === '23503') throw new DatoInvalido('Ese viaje no está en tu flota, o alguien lo borró. Recarga la pantalla.');
    throw new Error(`guardarMercancia: ${error.message}`);
  }
  const filaId = Array.isArray(data) && data.length > 0 ? String((data[0] as { id: unknown }).id) : null;

  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion: 'ccp.mercancia_agregada', entidad: 'viaje', entidadId: viajeId,
      detalle: { mercanciaId: filaId, descripcion: m.descripcion, bienesTransp: m.bienesTransp, cantidad: m.cantidad, pesoKg: m.pesoKg, materialPeligroso: m.materialPeligroso } },
    { evento: 'carta_porte.bitacora_no_escribio' },
  );
}

export async function borrarMercancia(
  tenantId: string,
  mercanciaId: string,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(mercanciaId)) throw new DatoInvalido('No se reconoce ese renglón. Recarga la pantalla.');

  const { data, error } = await acotada(supabaseAdmin().from('viaje_mercancia')
    .delete().eq('id', mercanciaId).eq('tenant_id', tenantId)
    .select('viaje_id, descripcion'), 'borrarMercancia');
  if (error) throw new Error(`borrarMercancia: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese renglón no está en tu flota, o alguien ya lo borró. Recarga la pantalla.');
  }
  const fila = data[0] as { viaje_id: unknown; descripcion: unknown };

  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion: 'ccp.mercancia_borrada', entidad: 'viaje', entidadId: String(fila.viaje_id),
      detalle: { mercanciaId, descripcion: String(fila.descripcion ?? '') } },
    { evento: 'carta_porte.bitacora_no_escribio' },
  );
}

// ── Los datos CCP del cliente en el viaje ──────────────────────────────────

const CP_RE = /^[0-9]{5}$/;
const RFC_RE = /^[A-ZÑ&0-9]{12,13}$/;

/** Valida la forma de datos del cliente. Vacío = sin dato (null); el país no
 *  se captura: se DERIVA solo cuando la flota declara "no internacional". */
export function validarDatosCliente(crudo: {
  origenCp: string; destinoCp: string; origenEstado: string; destinoEstado: string;
  rfcDestinatario: string; transpInternac: string;
}): DatosClienteCcp {
  const cp = (v: string, lado: string): string | null => {
    const t = v.trim();
    if (t === '') return null;
    if (!CP_RE.test(t)) throw new DatoInvalido(`El código postal de ${lado} son 5 dígitos.`);
    return t;
  };
  const estado = (v: string): string | null => {
    const t = v.trim();
    if (t === '') return null;
    if (t.length > 60) throw new DatoInvalido('El estado no puede pasar de 60 caracteres.');
    return t;
  };

  const rfcT = crudo.rfcDestinatario.trim().toUpperCase();
  if (rfcT !== '' && !RFC_RE.test(rfcT)) {
    throw new DatoInvalido('El RFC del destinatario son 12 o 13 caracteres (letras, números, Ñ y &), sin espacios ni guiones.');
  }

  let transpInternac: boolean | null;
  if (crudo.transpInternac === 'si') transpInternac = true;
  else if (crudo.transpInternac === 'no') transpInternac = false;
  else if (crudo.transpInternac === '') transpInternac = null;
  else throw new DatoInvalido('Transporte internacional solo puede ser sí, no, o quedar sin declarar.');

  return {
    origenCp: cp(crudo.origenCp, 'origen'),
    destinoCp: cp(crudo.destinoCp, 'destino'),
    origenEstado: estado(crudo.origenEstado),
    destinoEstado: estado(crudo.destinoEstado),
    rfcDestinatario: rfcT === '' ? null : rfcT,
    transpInternac,
  };
}

export async function guardarDatosCliente(
  tenantId: string,
  viajeId: string,
  d: DatosClienteCcp,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(viajeId)) throw new DatoInvalido('No se reconoce ese viaje. Recarga la pantalla.');

  const { data, error } = await acotada(supabaseAdmin().from('viaje').update({
    ccp_origen_cp: d.origenCp,
    ccp_destino_cp: d.destinoCp,
    ccp_origen_estado: d.origenEstado,
    ccp_destino_estado: d.destinoEstado,
    ccp_rfc_destinatario: d.rfcDestinatario,
    ccp_transp_internac: d.transpInternac,
  }).eq('id', viajeId).eq('tenant_id', tenantId).select('id'), 'guardarDatosCliente');

  if (error) throw new Error(`guardarDatosCliente: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese viaje no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  }

  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion: 'ccp.datos_cliente', entidad: 'viaje', entidadId: viajeId,
      detalle: { origenCp: d.origenCp, destinoCp: d.destinoCp, origenEstado: d.origenEstado, destinoEstado: d.destinoEstado, rfcDestinatario: d.rfcDestinatario, transpInternac: d.transpInternac } },
    { evento: 'carta_porte.bitacora_no_escribio' },
  );
}
