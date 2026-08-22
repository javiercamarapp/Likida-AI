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
import {
  necesitaCartaPorte, checklistCcp,
  type DecisionCcp, type ChecklistCcp, type DatosChecklist,
} from './carta_porte';

/** Cuántos viajes en curso se evalúan por corrida de pantalla. El total real
 *  viaja aparte: la lista se recorta, el conteo no. */
export const LIMITE_CCP = 50;

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
}

export interface EstadoCartaPorte {
  viajes: ViajeCcp[];
  total: number;
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
export async function getEstadoCartaPorte(tenantId: string): Promise<EstadoCartaPorte> {
  const { data, error, count } = await acotada(
    supabaseAdmin().from('viaje')
      .select('id, folio, origen, destino, estatus, fecha_inicio, km_recorridos, ccp_pisa_federal, ccp_radio_federal_km, ' +
        'unidad:unidad_id (numero_economico, placas, anio, config_vehicular, peso_bruto_ton, aseguradora_rc, poliza_rc_numero, permiso_sict_tipo, permiso_sict_numero), ' +
        'operador:operador_id (nombre, rfc, licencia), ' +
        'cliente:cliente_id (nombre, rfc)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .order('fecha_inicio', { ascending: true, nullsFirst: false })
      .limit(LIMITE_CCP),
    'getEstadoCartaPorte',
  );
  if (error) throw new Error(`getEstadoCartaPorte: ${error.message}`);

  const viajes: ViajeCcp[] = (data ?? []).map((f) => {
    const v = f as unknown as Record<string, unknown>;
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
      materiaExcluida: false, // supuesto declarado: carga general (ver arriba)
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
    };
  });

  return { viajes, total: count ?? viajes.length };
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
