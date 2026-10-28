import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { appUrl } from '@/lib/env';
import { hoyMx, OFFSET_MX } from '@/lib/formato';
import { avisarPlazosReclamo, type DepsAvisoPlazo, type ResumenAvisoPlazo } from './aviso_plazo';
import { recordarArchivoDecenal, type DepsRecordatorio, type DesgloseCobertura, type EstadoRecordatorio } from './recordatorio_archivo';
import { candidatosDePlazo } from './candidatos_plazo';
import { esCategoriaInterna } from './reglas_cobro';
import { sumarMeses } from './periodo';
import { enviarPorCanales, canalWhatsAppPeajes, type CanalAvisoPeajes } from './aviso_canal';
import type { FlotaConAvisos, DesgloseParaAvisos, TipoAvisoPeajes } from './repo';
import type { CandidatoPlazo } from './plazo_reclamo';

// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO DE AVISOS PROACTIVOS DEL CRON DE PEAJES (A2 ola 1, T-A2-16 / T-A2-30).
//
// `aviso_plazo.ts` y `recordatorio_archivo.ts` existían con su lógica y sus pruebas pero SIN llamador en el
// cron: la pantalla decía «NO conectado». Aquí se conectan. Para cada flota que encendió el interruptor
// (apagados de origen), el cron:
//   · `aviso_plazo`: arma los cobros SIN reclamar de sus archivos recientes (la misma definición que la tarjeta
//     «Plazo» de la pantalla: `candidatos_plazo.ts`, sin lo interno de la flota) y avisa los que están por vencer,
//     una vez por (archivo, umbral);
//   · `recordatorio_archivo`: si pasaron los días de gracia desde el cierre de una decena y ningún archivo la cubre,
//     avisa UNA vez por decena.
// Sin destinatario no se manda nada (y no cuenta como fallo). El canal es un punto de extensión: `aviso_canal.ts`.
//
// Todo lo externo entra por `DepsBarrido` para probarlo sin base ni red. NUNCA lanza.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántos archivos recientes de una flota se revisan por corrida para el aviso de plazo (cada uno es una revisión completa). */
export const MAX_DESGLOSES_PLAZO_POR_FLOTA = 6;
/** Cuántas flotas se atienden por corrida del cron. */
export const MAX_FLOTAS_POR_CORRIDA = 5;

export interface DepsBarrido {
  flotas: () => Promise<FlotaConAvisos[]>;
  desgloses: (tenantId: string, desdeIso: string) => Promise<DesgloseParaAvisos[]>;
  /** Los cobros sin reclamar de UN archivo (ya filtrados a lo reclamable al proveedor). */
  candidatosDeDesglose: (tenantId: string, desgloseId: string) => Promise<CandidatoPlazo[]>;
  reservar: (tenantId: string, tipo: TipoAvisoPeajes, clave: string) => Promise<boolean>;
  liberar: (tenantId: string, tipo: TipoAvisoPeajes, clave: string) => Promise<void>;
  canales: readonly CanalAvisoPeajes[];
  liga: () => string;
  ahora: () => Date;
}

export interface ResumenBarridoAvisos {
  flotas: number;
  plazo: ResumenAvisoPlazo;
  recordatorios: { enviados: number; sinDestinatario: number; fallidos: number; yaRecordados: number };
  /** Flotas que no se pudieron evaluar (lectura fallida). Vuelve «parcial» el latido. */
  fallidas: number;
}

const vacioPlazo = (): ResumenAvisoPlazo => ({ enviados: 0, yaAvisados: 0, sinDestinatario: 0, fallidos: 0, vencidosCruces: 0, vencidosMonto: 0 });

/** Lo mínimo de `candidatosDePlazo` que necesita el barrido, sin lo interno de la flota (no se reclama al proveedor). */
export function soloReclamablesAlProveedor<T extends { categoria: string }>(candidatos: readonly T[]): T[] {
  return candidatos.filter((c) => !esCategoriaInterna(c.categoria));
}

export async function barrerAvisosPeajes(deps: DepsBarrido, opciones: { limiteFlotas?: number; venceEn?: number } = {}): Promise<ResumenBarridoAvisos> {
  const r: ResumenBarridoAvisos = { flotas: 0, plazo: vacioPlazo(), recordatorios: { enviados: 0, sinDestinatario: 0, fallidos: 0, yaRecordados: 0 }, fallidas: 0 };
  let flotas: FlotaConAvisos[];
  try { flotas = await deps.flotas(); } catch (e) {
    r.fallidas++;
    logger.error('cron.peajes.avisos_barrido_fallo', { paso: 'flotas', codigo: codigoDeError(e) });
    return r;
  }
  const hoyFecha = hoyMx(deps.ahora());
  for (const f of flotas.slice(0, opciones.limiteFlotas ?? MAX_FLOTAS_POR_CORRIDA)) {
    if (opciones.venceEn !== undefined && Date.now() >= opciones.venceEn) break;
    r.flotas++;
    const destinatario = async (tenantId: string): Promise<string | null> => {
      for (const c of deps.canales) { const d = await c.destinatario(tenantId); if (d) return d; }
      return null;
    };
    try {
      // Hasta dónde mirar: el plazo (en meses) más una decena de holgura; el recordatorio solo necesita ~2 meses.
      const meses = Math.max(f.avisos.plazo.meses, 2);
      const desdeIso = `${sumarMeses(hoyFecha, -meses)}T00:00:00${OFFSET_MX}`;
      const desgloses = await deps.desgloses(f.tenantId, desdeIso);

      if (f.avisos.interruptores.recordatorio_archivo) {
        const cobertura: DesgloseCobertura[] = desgloses.map((d) => ({ periodoDesde: d.periodoDesde, periodoHasta: d.periodoHasta }));
        const depsR: DepsRecordatorio = {
          reservar: (t, decena) => deps.reservar(t, 'recordatorio_archivo', decena),
          liberar: (t, decena) => deps.liberar(t, 'recordatorio_archivo', decena),
          telefono: destinatario,
          enviar: async (_tel, texto) => (await enviarPorCanales(deps.canales, {
            tenantId: f.tenantId, tipo: 'recordatorio_archivo', texto, resumen: 'falta el archivo de cobros de la decena', liga: deps.liga(),
          })) === 'enviado',
          liga: deps.liga,
        };
        const res = await recordarArchivoDecenal(f.tenantId, deps.ahora(), cobertura, { activo: true, diasGracia: f.avisos.recordatorio.diasGracia }, depsR);
        contarRecordatorio(r, res.estado);
      }

      if (f.avisos.interruptores.aviso_plazo && desgloses.length > 0) {
        const candidatos: CandidatoPlazo[] = [];
        for (const d of desgloses.slice(0, MAX_DESGLOSES_PLAZO_POR_FLOTA)) {
          candidatos.push(...await deps.candidatosDeDesglose(f.tenantId, d.id));
        }
        const depsP: DepsAvisoPlazo = {
          reservar: (t, desgloseId, umbral) => deps.reservar(t, 'plazo', `${desgloseId}:${umbral}`),
          liberar: (t, desgloseId, umbral) => deps.liberar(t, 'plazo', `${desgloseId}:${umbral}`),
          telefono: destinatario,
          enviar: async (_tel, texto) => (await enviarPorCanales(deps.canales, {
            tenantId: f.tenantId, tipo: 'plazo', texto, resumen: 'cobros sin reclamar por vencer su plazo', liga: deps.liga(),
          })) === 'enviado',
          liga: deps.liga,
        };
        const p = await avisarPlazosReclamo(f.tenantId, candidatos, deps.ahora(), depsP, { meses: f.avisos.plazo.meses, avisoDias: f.avisos.plazo.avisoDias });
        r.plazo.enviados += p.enviados; r.plazo.yaAvisados += p.yaAvisados; r.plazo.sinDestinatario += p.sinDestinatario; r.plazo.fallidos += p.fallidos;
        r.plazo.vencidosCruces += p.vencidosCruces; r.plazo.vencidosMonto += p.vencidosMonto;
      }
    } catch (e) {
      r.fallidas++;
      logger.error('cron.peajes.avisos_barrido_fallo', { tenant: f.tenantId, paso: 'flota', codigo: codigoDeError(e) });
    }
  }
  return r;
}

function contarRecordatorio(r: ResumenBarridoAvisos, estado: EstadoRecordatorio): void {
  if (estado === 'enviado') r.recordatorios.enviados++;
  else if (estado === 'sin_destinatario') r.recordatorios.sinDestinatario++;
  else if (estado === 'fallido') r.recordatorios.fallidos++;
  else if (estado === 'ya_recordado') r.recordatorios.yaRecordados++;
}

/** El cableado de producción: lee de la base, manda por WhatsApp. (Importa el repo de forma diferida: el módulo de arriba es puro.) */
export async function depsBarridoReales(): Promise<DepsBarrido> {
  const repo = await import('./repo');
  const { listarReclamos, listarDecisionesCandidatos, revisionDeDesglose, leerConfigPeajes } = repo;
  const telefonoPorFlota = async (tenantId: string) => (await leerConfigPeajes(tenantId)).telefono;
  // Los reclamos son de TODA la flota: se leen una vez por flota y corrida, no una por archivo.
  const reclamosPorFlota = new Map<string, Awaited<ReturnType<typeof listarReclamos>>['reclamos']>();
  const reclamosDe = async (tenantId: string) => {
    const previos = reclamosPorFlota.get(tenantId);
    if (previos) return previos;
    const { reclamos } = await listarReclamos(tenantId, hoyMx());
    reclamosPorFlota.set(tenantId, reclamos);
    return reclamos;
  };
  return {
    flotas: repo.listarFlotasConAvisos,
    desgloses: repo.desglosesRecientesParaAvisos,
    candidatosDeDesglose: async (tenantId, desgloseId) => {
      const reporte = await revisionDeDesglose(tenantId, desgloseId);
      if (!reporte) return [];
      const reclamos = (await reclamosDe(tenantId)).filter((x) => x.desgloseId === desgloseId && x.desgloseAnulado !== true);
      const decisiones = await listarDecisionesCandidatos(tenantId, desgloseId);
      return candidatosDePlazo({
        desgloseId, candidatos: soloReclamablesAlProveedor(reporte.revision.candidatos),
        reclamosDelArchivo: reclamos, decisiones,
      });
    },
    reservar: repo.reservarAvisoPeajes,
    liberar: repo.liberarAvisoPeajes,
    canales: [canalWhatsAppPeajes(telefonoPorFlota)],
    liga: () => `${appUrl()}/dashboard/agentes/peajes`,
    ahora: () => new Date(),
  };
}
