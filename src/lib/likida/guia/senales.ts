import type { SupabaseClient } from '@supabase/supabase-js';
import type { SenalesAsistente } from '../asistente/pasos_cinco_agentes';
import { existeFilaDeTenant } from './repo';
import { IDS_SENAL, type IdSenal, type PistaGuia, type ResultadoSenal } from './tipos';

// Registro de señales de la guía (SPEC 2.3). Una señal es una lectura ACOTADA POR TENANT de algo que la persona hizo; cada una cae a
// `sin_dato` por separado si falla (patrón de `asistente/senales.ts`). Las que ya mide el asistente se REUTILIZAN, no se duplican.
// Una señal que todavía no tiene lector se declara `por_conectar` y devuelve `sin_dato`: la guía lo muestra honestamente y deja
// que la persona lo confirme («confirmado por ti»); jamás inventa un «hecho».

type Origen = 'asistente' | 'tabla' | 'por_conectar';
interface Registro { origen: Origen; lectores: readonly PistaGuia[] }

const D5: PistaGuia = 'dueno_ca';
export const REGISTRO_SENALES: Readonly<Record<IdSenal, Registro>> = {
  coordinadores: { origen: 'asistente', lectores: [D5, 'dueno'] },
  archivos_recibidos: { origen: 'asistente', lectores: [D5, 'contador'] },
  tms_probada: { origen: 'asistente', lectores: [D5] },
  correo_desglose_activo: { origen: 'asistente', lectores: [D5, 'contador'] },
  correo_plataforma: { origen: 'asistente', lectores: [D5] },
  operadores_con_correo: { origen: 'asistente', lectores: [D5, 'encargado'] },
  unidades_activas: { origen: 'asistente', lectores: [D5, 'encargado'] },
  supervisores: { origen: 'asistente', lectores: [D5] },
  revisor_cp: { origen: 'asistente', lectores: [D5] },
  simulacro_muestra: { origen: 'por_conectar', lectores: [D5] },
  desglose_entregado_real: { origen: 'por_conectar', lectores: [D5] },
  peajes_archivo: { origen: 'por_conectar', lectores: [D5, 'contador'] },
  documento_aprobado: { origen: 'tabla', lectores: [D5, 'encargado'] },
  declaracion_cp: { origen: 'por_conectar', lectores: ['encargado'] },
  sitios: { origen: 'por_conectar', lectores: [D5] },
  programa_vigia: { origen: 'tabla', lectores: [D5] },
  llave_emitida: { origen: 'tabla', lectores: [D5] },
  mfa_activo: { origen: 'por_conectar', lectores: [D5, 'dueno', 'contador', 'encargado', 'nomina'] },
  legal_aceptado: { origen: 'por_conectar', lectores: [D5] },
  viaje_con_aviso: { origen: 'por_conectar', lectores: [D5, 'encargado'] },
  operador_alta_nuevo: { origen: 'por_conectar', lectores: ['encargado', 'dueno'] },
  prospecto_cambio_estado: { origen: 'por_conectar', lectores: ['vendedor'] },
};

export const MAX_SENALES_POR_LLAMADA = 10;
const SIN_DATO: ResultadoSenal = { estado: 'sin_dato' };
const SI_NO = (b: boolean | null | undefined, n?: number): ResultadoSenal => (b === null || b === undefined ? SIN_DATO : { estado: b ? 'si' : 'no', ...(n === undefined ? {} : { n }) });
const CONTEO = (n: number | null | undefined): ResultadoSenal => (n === null || n === undefined ? SIN_DATO : { estado: n > 0 ? 'si' : 'no', n });

/** ¿Esta pista puede leer esta señal? Una pista no lee lo que no es suyo (el dinero de otro rol, por ejemplo). */
export const puedeLeerSenal = (pista: PistaGuia, id: IdSenal): boolean => REGISTRO_SENALES[id].lectores.includes(pista);

/** Las señales que ya mide el asistente, traducidas al contrato de la guía. Función pura. */
export function senalesDeAsistente(s: SenalesAsistente): Partial<Record<IdSenal, ResultadoSenal>> {
  return {
    coordinadores: CONTEO(s.coordinadores),
    archivos_recibidos: CONTEO(s.archivosRecibidos),
    tms_probada: s.tms === null ? SIN_DATO : s.tms === 'sin_credencial' ? { estado: 'no' } : SI_NO(Boolean(s.tms.probadaEn) && !s.tms.ultimoError),
    correo_desglose_activo: s.correoDesglose === null ? SIN_DATO : SI_NO(s.correoDesglose.activa && s.correoDesglose.usaCorreo),
    correo_plataforma: SI_NO(s.correoPlataforma),
    operadores_con_correo: s.operadores === null ? SIN_DATO : CONTEO(s.operadores.conCorreo),
    unidades_activas: CONTEO(s.unidadesActivas),
    supervisores: CONTEO(s.supervisores),
    revisor_cp: SI_NO(s.revisorCartaPorte),
  };
}

/** Tablas con una consulta EXISTS por tenant ya verificada contra las migraciones. Filtros extra: solo columnas que existen. */
const TABLAS: Partial<Record<IdSenal, { tabla: string; filtro?: Record<string, string>; vigente?: { nulas?: string[]; vence?: string } }>> = {
  documento_aprobado: { tabla: 'cp_documento', filtro: { estado: 'aprobado' } },
  programa_vigia: { tabla: 'programa_despacho_carga' },
  // Una llave revocada (`revocada_en`) o vencida (`expira_en`, 0294) ya no cuenta como «emitida».
  llave_emitida: { tabla: 'tenant_api_key', vigente: { nulas: ['revocada_en'], vence: 'expira_en' } },
};

async function existeFila(db: SupabaseClient, tenantId: string, id: IdSenal): Promise<ResultadoSenal> {
  const t = TABLAS[id];
  if (!t) return SIN_DATO;
  const r = await existeFilaDeTenant(db, t.tabla, tenantId, t.filtro, { nulas: t.vigente?.nulas, ...(t.vigente?.vence ? { noVencidaEn: { columna: t.vigente.vence, ahora: new Date().toISOString() } } : {}) });
  return r === null ? SIN_DATO : { estado: r ? 'si' : 'no' };
}

export interface DependenciasSenales {
  db: SupabaseClient;
  /** Lee las señales del asistente (una sola vez por llamada). Inyectable para probar. */
  leerAsistente: (tenantId: string) => Promise<SenalesAsistente>;
}

/** Lee hasta 10 señales de una flota para una pista. Una señal no permitida, desconocida o ilegible da `sin_dato`; nunca lanza ni escribe. */
export async function leerSenalesGuia(
  ids: readonly string[], tenantId: string, pista: PistaGuia, dep: DependenciasSenales,
): Promise<Record<string, ResultadoSenal>> {
  const pedidas = [...new Set(ids)].slice(0, MAX_SENALES_POR_LLAMADA);
  const salida: Record<string, ResultadoSenal> = {};
  const validas = pedidas.filter((i): i is IdSenal => (IDS_SENAL as readonly string[]).includes(i) && puedeLeerSenal(pista, i as IdSenal));
  for (const i of pedidas) if (!validas.includes(i as IdSenal)) salida[i] = SIN_DATO;

  let delAsistente: Partial<Record<IdSenal, ResultadoSenal>> = {};
  if (validas.some((i) => REGISTRO_SENALES[i].origen === 'asistente')) {
    try { delAsistente = senalesDeAsistente(await dep.leerAsistente(tenantId)); } catch { /* todas caen a sin_dato */ }
  }
  await Promise.all(validas.map(async (i) => {
    const o = REGISTRO_SENALES[i].origen;
    salida[i] = o === 'asistente' ? delAsistente[i] ?? SIN_DATO : o === 'tabla' ? await existeFila(dep.db, tenantId, i) : SIN_DATO;
  }));
  return salida;
}
