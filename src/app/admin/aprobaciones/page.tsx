import { revalidatePath } from 'next/cache';
import { ListChecks, Zap } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  bandejasPendientes, ultimasResueltas, aprobarPieza, rechazarPieza,
  type PiezaEnCola,
} from '@/lib/likida/agentes/cola';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio, EstadoError, StatusPill } from '../ui/kit';
import { FormaPieza, type ResultadoPieza } from './forma-pieza';

export const dynamic = 'force-dynamic';

/**
 * /admin/aprobaciones — la cola de aprobación genérica (0117). DOS bandejas
 * y no una lista con etiqueta (panel-de-adquisicion §3): lo urgente
 * (respuesta a ads, SLA en minutos) arriba y aparte de lo normal (correo
 * frío, 20-40/día). Las TRES acciones por pieza: aprobar tal cual,
 * editar-y-aprobar, rechazar con motivo — y ni una más.
 */
export default async function PaginaAprobaciones() {
  await requireSuperadmin();

  let bandejas: { urgente: PiezaEnCola[]; normal: PiezaEnCola[] } | null = null;
  let errorBandejas: string | null = null;
  try {
    bandejas = await bandejasPendientes();
  } catch (e) {
    errorBandejas = e instanceof Error ? e.message : String(e);
  }
  const resueltas = await ultimasResueltas(8).catch(() => null);

  async function accionResolver(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
    const s = await requireSuperadmin();
    const id = String(fd.get('pieza') ?? '');
    const operacion = String(fd.get('operacion') ?? '');
    try {
      if (operacion === 'aprobar') {
        const edicion = String(fd.get('cuerpoEditado') ?? '').trim();
        await aprobarPieza(id, s.userId, edicion || undefined);
        revalidatePath('/admin/aprobaciones');
        return { ok: edicion ? 'Aprobada con tu edición — esa versión es la que sale.' : 'Aprobada tal cual.' };
      }
      if (operacion === 'rechazar') {
        await rechazarPieza(id, s.userId, String(fd.get('motivo') ?? ''));
        revalidatePath('/admin/aprobaciones');
        return { ok: 'Rechazada con motivo — quedó en la bitácora.' };
      }
      return { error: 'Esa operación no existe: aprobar o rechazar, ni una más.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, operacion === 'rechazar' ? 'rechazar la pieza' : 'aprobar la pieza') };
    }
  }

  function bandeja(titulo: string, piezas: PiezaEnCola[], urgente: boolean) {
    return (
      <section className="card p-4" style={urgente ? { borderColor: 'var(--warn)' } : undefined}>
        <div className="flex items-center gap-2">
          {urgente && <Zap width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}
          <TituloSeccion>{titulo}</TituloSeccion>
          <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
            {piezas.length}
          </span>
        </div>
        {piezas.length === 0 ? (
          <p className="text-[12.5px] mt-2" style={{ color: 'var(--muted)' }}>
            {urgente
              ? 'Nada urgente esperando — así debe verse casi siempre: lo urgente se resuelve en minutos.'
              : 'Nada pendiente. Las piezas llegan aquí cuando un agente redacta algo que necesita tu aprobación.'}
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {piezas.map((p) => <FormaPieza key={p.id} pieza={p} accion={accionResolver} />)}
          </div>
        )}
      </section>
    );
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ListChecks width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Aprobaciones"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          {errorBandejas !== null ? (
            <EstadoError mensaje="No se pudo leer la cola de aprobación — esto NO significa que no haya piezas esperando." />
          ) : bandejas && (
            <>
              {bandeja('Urgente — respuesta a ads y SLA en minutos', bandejas.urgente, true)}
              {bandeja('Normal — prospección y contenido (20-40/día)', bandejas.normal, false)}
            </>
          )}

          {resueltas !== null && resueltas.length > 0 && (
            <section className="card p-4">
              <TituloSeccion>Últimas resueltas</TituloSeccion>
              <div className="mt-2 space-y-1.5">
                {resueltas.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <StatusPill estado={p.estado === 'aprobado' ? 'ok' : 'bad'}>
                      {p.estado === 'aprobado' ? (p.cuerpoFinal ? 'Aprobada con edición' : 'Aprobada') : 'Rechazada'}
                    </StatusPill>
                    <span className="truncate">{p.titulo}</span>
                    <span className="shrink-0" style={{ color: 'var(--faint)' }}>{p.agente}</span>
                    {p.enviadoEn && <span className="shrink-0" style={{ color: 'var(--ok)' }}>enviada {fechaHoraMx(p.enviadoEn)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <EstadoVacio>
            El candado es de base, no de esta pantalla: `cola_enviado_solo_aprobado` (0117) hace imposible
            que cualquier código envíe una pieza no aprobada. Rechazar exige motivo — un rechazo sin motivo
            es una pieza que se vuelve a proponer igual.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
