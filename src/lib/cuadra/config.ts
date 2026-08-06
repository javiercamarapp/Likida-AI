// ═══════════════════════════════════════════════════════════════════════════
// CONFIG PARAMETRIZABLE POR TENANT — nada hardcodeado a un cliente.
//
// Todo lo configurable (política, tabulador, rendimiento por unidad, catálogo
// de cuentas, formato de salida, RFC de la empresa) vive aquí con DEFAULTS DE
// DEMO realistas. El día del demo se captura la config real del cliente en la
// sala y se guarda como override del tenant (DB `tenant.config` jsonb). Si no
// hay override, se usa DEMO_CONFIG. Cero código nuevo para un cliente nuevo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { ConsultaFallida } from './conv';
import { esRfcValido, rfcChecksumOk } from './intake/cfdi';
import { CLAVES_PEAJE } from './intake/concepto';
import type { PoliticaGasto } from './cuadre/engine';
import { acotada } from './presupuesto';

export interface UnidadConfig {
  rendimientoBase: number;   // km/L en vacío
  capacidadTanque: number;   // litros
}

export interface CuadraConfig {
  empresa: { rfc: string; rfcsAdicionales?: string[] };
  politica: PoliticaGasto[];
  tabulador: {
    rendimientoPorDefecto: number;        // km/L si la placa no está en catálogo
    factorCarga: number;                  // 0-1: consumo cargado vs vacío (~0.78)
    precioDieselPorDefecto: number;       // MXN/L
    umbralDesviacion: number;             // % de alerta (0.15 = 15%)
  };
  unidades: Record<string, UnidadConfig>; // placa → params
  catalogoCuentas: Record<string, string>;// concepto → cuenta contable
  salida: 'csv' | 'contpaqi_txt' | 'aspel_xls';
  // Complemento de hidrocarburos (Bloque 1): claves de producto de combustible,
  // unidad esperada y fecha de entrada en vigor de la obligación.
  hidrocarburos: {
    claves: string[];       // c_ClaveProdServ de combustible (15101505/14/15) — lo ÚNICO que la regla 2.7.1.48 exige
    unidad: string;         // c_ClaveUnidad esperada (LTR) — consistencia, NO requisito legal
    vigenteDesde: string;   // ISO: obligación aplica a CFDI con Fecha >= este día (24-abr-2026)
  };
  // Estímulos fiscales y topes de deducibilidad (LIF 2026 Art. 20 / LISR).
  estimulos: {
    peajeFactor: number;              // 0.5 = 50% del gasto de peaje (LIF 2026 Art. 20-A)
    viaticosTopeFiscalDiarioMxn: number; // $750/día alimentación nacional (LISR 28-V)
    efectivoTopeMxn: number;          // $2,000 (LISR 27-III) para gasto no-combustible en efectivo
    clavesDieselIeps: string[];       // el estímulo de IEPS (LIF Art. 20-A fr. IV) es SOLO diésel
    clavesPeaje: string[];            // c_ClaveProdServ de peaje → estímulo del 50% (LIF 2026 Art. 20-A)
  };
  // Validaciones de cordura.
  validacion: {
    fechaToleranciaDiasAntes: number; // la fecha del gasto no puede ser anterior a (inicio del viaje − N días)
  };
  /** RFA 2026 regla 2.9 — la facilidad del 15% de combustible en efectivo.
   *  Lo DECLARA el dueño/jefe de flota al registrar la flota (administracion.ts
   *  crearFlota). `undefined`/campos sin llenar = NO DECLARADA: el motor no
   *  puede abrir la válvula y el efectivo en combustible sale a revisar.
   *  Ambas condiciones vienen del DOF (normas/rfa-2026-2.9.yaml). */
  facilidadCombustibleEfectivo?: {
    /** ¿Dedicados EXCLUSIVAMENTE al autotransporte terrestre de carga federal? */
    dedicacionExclusivaCarga?: boolean;
    /** ¿Tributa en Título II Cap. VII (coordinados) o Título IV Cap. II Secc. I
     *  (personas físicas con actividad empresarial)? */
    regimenElegible?: boolean;
  };
}

// ── DEFAULTS DE DEMO (🔴 genéricos, NO de un cliente — reemplazables en la sala) ─
export const DEMO_CONFIG: CuadraConfig = {
  empresa: { rfc: 'XAXX010101000' },      // 🔴 demo: RFC genérico
  politica: [
    { concepto: 'diesel', topeMonto: 4000 },
    { concepto: 'caseta', topeMonto: 1500 },
    { concepto: 'alimentacion', topeMonto: 800 },
    { concepto: 'hospedaje', topeMonto: 2500 },
    { concepto: 'transporte', topeMonto: 800 },
    // El flete NO lleva el tope del viático: es costo de operación, no gasto
    // personal del operador, y $800 lo levantaría en casi todo envío de carga.
    { concepto: 'flete' },
    { concepto: 'factura', requiereCfdi: true },
  ],
  tabulador: {
    rendimientoPorDefecto: 3.0,           // 🔴 demo: tractocamión ~3 km/L
    factorCarga: 0.78,
    precioDieselPorDefecto: 27.0,         // 🔴 demo: ~$27/L (Profeco jul-2026)
    umbralDesviacion: 0.15,
  },
  unidades: {},                            // 🔴 demo: sin catálogo → usa rendimientoPorDefecto
  catalogoCuentas: {
    diesel: '600-001', caseta: '600-002', viaticos: '600-003', factura: '600-004', otro: '600-099',
    // Los tres conceptos que sustituyen a 'viaticos'. Comparten la 600-003 por
    // ahora: la cuenta contable la define el contador de cada flota, no nosotros.
    alimentacion: '600-003', hospedaje: '600-003', transporte: '600-003',
    // Cuenta propia: el flete no es viático y el contador no lo quiere ahí.
    flete: '600-005',
  },
  salida: 'csv',
  hidrocarburos: {
    // Claves SAT confirmadas: 15101505 diésel, 15101514 magna, 15101515 premium.
    claves: ['15101505', '15101514', '15101515'],
    unidad: 'LTR',
    vigenteDesde: '2026-04-24', // vigencia del complemento v1.0 (DOF, RMF 2.7.1.8)
  },
  estimulos: {
    peajeFactor: 0.5,                 // LIF 2026 Art. 20-A (ingresos < $300M)
    viaticosTopeFiscalDiarioMxn: 750, // LISR 28-V, alimentación nacional
    efectivoTopeMxn: 2000,            // LISR 27-III
    clavesDieselIeps: ['15101505'],   // solo diésel (la gasolina 15101514/15 NO tiene el estímulo IEPS)
    // Importadas, no copiadas. Estaban escritas a mano AQUÍ y otra vez en
    // `intake/concepto.ts`, con este comentario diciendo "ver intake/concepto.ts"
    // — el mismo hecho fiscal en dos sitios y uno de los dos apuntando al otro.
    // La justificación de por qué 93151505 queda fuera vive allá, junto al valor.
    clavesPeaje: CLAVES_PEAJE,
  },
  validacion: { fechaToleranciaDiasAntes: 30 },
};

/**
 * Mezcla el override del tenant sobre la config base, RECURSIVAMENTE.
 *
 * `{ ...base, ...override }` era shallow, y eso borraba hermanos: un tenant que
 * guardaba `config: { estimulos: { efectivoTopeMxn: 3000 } }` se llevaba por
 * delante el tope de alimentación, el factor de peaje y las claves del IEPS de
 * diésel — todo el objeto `estimulos` se reemplazaba.
 *
 * Y no tronaba. El motor lee el tope con `if (topeAlimentacion != null)`, así
 * que al quedar undefined el bloque se SALTABA: el tope de $750/día de LISR 28-V
 * dejaba de aplicarse sin un error en el log, y la liquidación salía diciendo
 * que todo era deducible. Personalizar un tope tiraba los otros tres.
 *
 * Reglas:
 *  - objetos → se mezclan por llave, a cualquier profundidad;
 *  - arrays → REEMPLAZAN. Si la flota define su política de gastos quiere la
 *    suya; concatenarla con la de demo le dejaría topes que nadie autorizó, y un
 *    array vacío es una decisión, no un hueco;
 *  - primitivos y null → reemplazan.
 *
 * No muta nada: `DEMO_CONFIG` es un módulo compartido, y mutarlo le aplicaría el
 * override de un tenant al siguiente que pida config.
 */
export function fusionarConfig<T>(base: T, override: unknown): T {
  if (override == null) return base;
  if (Array.isArray(override) || Array.isArray(base)) return override as T;
  if (typeof override !== 'object' || typeof base !== 'object' || base === null) return override as T;

  const salida: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const previo = (base as Record<string, unknown>)[k];
    salida[k] =
      previo !== null && typeof previo === 'object' && !Array.isArray(previo) &&
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? fusionarConfig(previo, v)
        : v;
  }
  return salida as T;
}

/**
 * Devuelve la config del tenant (override en DB) o los defaults de demo.
 *
 * ── EL QUINTO SITIO DEL MISMO PATRÓN, Y EL MÁS CARO ────────────────────────
 *
 * La auditoría 6 lo encontró aquí después de que la 5 lo encontrara cuatro
 * veces en un día: *un fallo de consulta disfrazado del valor que significa
 * "no hay"*. Dos puertas, y la primera ni siquiera necesitaba que se cayera la
 * red:
 *
 *   1. `const { data } = ...` DESCARTABA `error`. PostgREST devuelve los
 *      errores POR VALOR, no los lanza: un timeout o un fallo de permisos daba
 *      `data === null`, que aquí se leía como "este tenant no tiene override".
 *   2. El `catch` devolvía `DEMO_CONFIG` a secas.
 *
 * Por cualquiera de las dos, la liquidación salía con la POLÍTICA DE LA DEMO
 * —topes, tabulador, rendimiento— en vez de la del cliente. Y con algo peor:
 * `DEMO_CONFIG.empresa.rfc` es el GENÉRICO del SAT, y con el genérico el motor
 * apaga las DOS ramas de validación de receptor (`engine.ts`: `rfcsOk` queda
 * vacía y `rfcEmpresaInservible` exige `!== RFC_GENERICO`). Resultado medido:
 * un CFDI de $11,600 timbrado a un TERCERO sale "Deducible para ISR $11,600.00"
 * en verde, con $1,600 de IVA acreditable citando LIVA art. 5, y cero
 * diferencias. Es el mismo daño del crítico que se cerró ayer, entrando por la
 * otra puerta.
 *
 * Ahora falla ruidoso, igual que `resolveOperador` y `getOpenViaje`: liquidar
 * con la política equivocada es peor que no liquidar. `processInbound` ya
 * traduce `ConsultaFallida` a "no pude consultar tus datos, inténtalo en un
 * minuto" y libera el claim para que el reenvío se reprocese.
 */
export async function getConfig(tenantId: string): Promise<CuadraConfig> {
  try {
    const { data, error } = await acotada(supabaseAdmin().from('tenant').select('rfc, config').eq('id', tenantId).maybeSingle(), 'getConfig');
    if (error) {
      throw new ConsultaFallida(`config del tenant: ${error.message ?? String(error)}`);
    }
    const override = (data?.config as Partial<CuadraConfig> | null) ?? null;
    const cfg: CuadraConfig = fusionarConfig(DEMO_CONFIG, override);
    // El RFC de la empresa puede venir en la columna `tenant.rfc`.
    if (data?.rfc) {
      const rfc = String(data.rfc).toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
      // El motor ignora un RFC mal formado en vez de rechazar facturas contra él
      // (ver `rfcsOk` en engine.ts). Pero ignorarlo EN SILENCIO deja la
      // validación de receptor apagada sin que nadie se entere: la flota cree
      // que el sistema comprueba a nombre de quién vienen sus facturas, y no.
      if (!esRfcValido(rfc) || !rfcChecksumOk(rfc)) {
        logger.error('config.rfc_empresa_invalido', {
          tenantId,
          msg: `El RFC de la flota (${rfc}) no pasa el dígito verificador. La validación de receptor de CFDI queda APAGADA para este tenant: ninguna factura se rechazará por estar a nombre de otro. Corrige la columna tenant.rfc.`,
        });
      }
      // ── NO SE MUTA `cfg`, Y ES UNA FUGA ENTRE TENANTS, NO UN ESCRÚPULO ────
      //
      // `fusionarConfig` devuelve la MISMA referencia cuando no hay override
      // (`override == null → return base`), así que sin override `cfg` ES
      // `DEMO_CONFIG`, el objeto del módulo. La línea que había aquí,
      // `cfg.empresa = { ...cfg.empresa, rfc }`, le escribía encima:
      //
      //   tenant A (rfc propio) liquida  → DEMO_CONFIG.empresa.rfc = rfc de A
      //   tenant B (rfc todavía en null) → recibe el RFC DE OTRA FLOTA
      //
      // Y con él, todos los CFDI legítimos de B —timbrados a nombre de B—
      // fallan la validación de receptor. Persiste mientras viva la instancia,
      // que Fluid Compute reutiliza entre peticiones y entre tenants.
      //
      // El propio `fusionarConfig` advierte de esto en su comentario: "no muta
      // nada, mutarlo le aplicaría el override de un tenant al siguiente". La
      // función no mutaba; mutaba su llamador, una línea después.
      return { ...cfg, empresa: { ...cfg.empresa, rfc } };
    }
    return cfg;
  } catch (e) {
    // Un `ConsultaFallida` que ya viene formado sube tal cual: envolverlo otra
    // vez perdería el mensaje que dice QUÉ no se pudo consultar.
    if (e instanceof ConsultaFallida) throw e;
    throw new ConsultaFallida(`config del tenant: ${e instanceof Error ? e.message : String(e)}`);
  }
}
