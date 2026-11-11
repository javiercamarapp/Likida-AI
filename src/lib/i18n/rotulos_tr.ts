import { nombreDeRol } from '@/lib/auth/roles';
import { NOMBRE_NIVEL, type Nivel } from '@/lib/likida/agentes/autonomia';
import { ROTULO_ESTADO_REAL, type EstadoReal } from '@/lib/likida/agentes/estado-real';
import { NOMBRE_FUENTE, type FuenteEscalacion } from '@/lib/admin/escalaciones';
import { COLOR_EMBUDO, NOMBRE_GIRO, CRITERIO_SCORES, type Giro } from '@/lib/admin/prospectos-mapa-client';
import { T_SISTEMA_ES, type TSistema } from './sistema_tr';

// ═══════════════════════════════════════════════════════════════════════════
// RÓTULOS QUE LLEGAN DE LIB, POR CLAVE. `lib/` guarda los nombres en español (los usan pruebas, correos y logs) y no importa
// diccionarios: la pantalla pasa el `t` del namespace «admin_sistema» y estas funciones eligen la clave. Un valor fuera del catálogo se
// enseña tal cual viene (visible, no roto), igual que lo hacían los mapas originales.
// ═══════════════════════════════════════════════════════════════════════════

type Dic = Record<string, string>;
const buscar = (t: TSistema, prefijo: string, clave: string, original: string | undefined): string => {
  // Solo las claves que existen en el diccionario: una clave ausente devolvería la clave misma, no el texto original.
  const k = `${prefijo}.${clave}` as Parameters<TSistema>[0];
  const texto = t(k);
  return texto === k || original === undefined ? (original ?? clave) : texto;
};

/** `L0`…`L4`: el nombre del nivel de autonomía de un agente. */
export const nombreNivelTr = (nivel: Nivel, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.nivel', nivel, NOMBRE_NIVEL[nivel]);
/** El estado real de un agente. */
export const rotuloEstadoRealTr = (estado: EstadoReal, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.estado_real', estado, ROTULO_ESTADO_REAL[estado]);
/** Las fuentes de la bandeja de escalaciones. */
export const nombreFuenteTr = (fuente: FuenteEscalacion, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.fuente', fuente, NOMBRE_FUENTE[fuente]);
/** El nombre de un rol de cuenta (`flota_admin`, `contador`…). */
export const nombreDeRolTr = (rol: string, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.rol', rol, nombreDeRol(rol) === rol ? undefined : nombreDeRol(rol));
/** La etapa del embudo de ventas de un prospecto. */
export const nombreEtapaTr = (estado: string, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.etapa', estado, COLOR_EMBUDO[estado]?.nombre);
/** El estado de un prospecto en el tablero de vendedores (catálogo `ESTADOS_PROSPECTO`). */
export const estadoProspectoTr = (valor: string, t: TSistema = T_SISTEMA_ES, original?: string): string => buscar(t, 'rotulos.estado_prospecto', valor, original);
/** El giro de un prospecto. */
export const nombreGiroTr = (giro: Giro, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.giro', giro, NOMBRE_GIRO[giro]);
/** Cómo se calcula cada puntaje del Cerebro de ventas. */
export const criterioScoreTr = (clave: keyof typeof CRITERIO_SCORES, t: TSistema = T_SISTEMA_ES): string => buscar(t, 'rotulos.criterio', clave, CRITERIO_SCORES[clave]);

export type { Dic };
