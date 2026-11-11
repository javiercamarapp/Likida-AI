import { StatusChip, type TonoEstado } from '@/app/ui-v2/componentes';
import { PILL_ESTATUS } from '../resumen-visual';
import type { ViajeEnCursoRow } from '@/lib/likida/repo_paginado';
import type { Semaforo } from '@/lib/likida/conductor/tablero';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

// ═══════════════════════════════════════════════════════════════════════════
// LAS TRES PASTILLAS DE ESTADO DE LA OPERACIÓN DE VIAJES, en un solo archivo (`pill_estatus_unico.test.ts` lo vigila):
//   · estatus del viaje (abierto / en cuadre / liquidado)  → Registro de viajes
//   · estado del aviso al chofer (sin avisar → aceptó)      → Registro de viajes y Despacho
//   · semáforo del viaje (a tiempo / atrasado / sin reporte) → Viajes en vivo
// Todas pintan con `StatusChip` (punto + texto): el estado nunca depende solo del color. Un estatus que el mapa no conoce se pinta
// crudo en neutro — visible, no roto. Dos copias de este mapa se separan en el primer estatus nuevo.
// ═══════════════════════════════════════════════════════════════════════════

const CLAVE_ESTATUS = {
  liquidado: 'viajes.estatus.liquidado', en_cuadre: 'viajes.estatus.en_cuadre', abierto: 'viajes.estatus.abierto',
} as const;

/** `viaje.estatus`: la fuente es `PILL_ESTATUS` (resumen-visual); aquí solo se pinta. */
export function PillEstatusViaje({ estatus, tr = TR_OPERACION_ES }: { estatus: string; tr?: TrOperacion }) {
  const e = PILL_ESTATUS[estatus] ?? { etiqueta: estatus, estado: 'neutral' as TonoEstado };
  const clave = (CLAVE_ESTATUS as Record<string, (typeof CLAVE_ESTATUS)[keyof typeof CLAVE_ESTATUS]>)[estatus];
  return <StatusChip tono={e.estado}>{clave ? tr.t(clave) : e.etiqueta}</StatusChip>;
}

/** El estado del aviso, con las marcas reales de la confirmación (0058): sin avisar → avisado (con el conteo) → aceptó / escalado. */
export function PillAviso({ v, tr = TR_OPERACION_ES }: { v: Pick<ViajeEnCursoRow, 'aceptadoEn' | 'escaladoEn' | 'avisadoEn' | 'avisosEnviados'>; tr?: TrOperacion }) {
  const { t } = tr;
  if (v.aceptadoEn) return <StatusChip tono="ok">{t('viajes.aviso.acepto')}</StatusChip>;
  if (v.escaladoEn) return <StatusChip tono="bad">{t('viajes.aviso.escalado')}</StatusChip>;
  if (v.avisadoEn) return <StatusChip tono="warn">{v.avisosEnviados > 1 ? t('viajes.aviso.avisadoN', { n: v.avisosEnviados }) : t('viajes.aviso.avisado')}</StatusChip>;
  return <StatusChip tono="muted">{t('viajes.aviso.sinavisar')}</StatusChip>;
}

const SEMAFORO = {
  sin_reporte: { etiqueta: 'viajes.semaforo.sin_reporte', tono: 'bad' },
  atrasado: { etiqueta: 'viajes.semaforo.atrasado', tono: 'warn' },
  a_tiempo: { etiqueta: 'viajes.semaforo.a_tiempo', tono: 'ok' },
  sin_ancla: { etiqueta: 'viajes.semaforo.sin_ancla', tono: 'muted' },
  completo: { etiqueta: 'viajes.semaforo.completo', tono: 'muted' },
} as const satisfies Record<Semaforo, { etiqueta: string; tono: TonoEstado }>;

/** El semáforo del viaje en el tablero en vivo. */
export function PillSemaforo({ semaforo, tr = TR_OPERACION_ES }: { semaforo: Semaforo; tr?: TrOperacion }) {
  const s = SEMAFORO[semaforo];
  return <StatusChip tono={s.tono}>{tr.t(s.etiqueta)}</StatusChip>;
}
