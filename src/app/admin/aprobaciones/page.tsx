import { revalidatePath } from 'next/cache';
import { ListChecks, Send, Zap } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  bandejaPendiente, aprobadasSinEnviar, ultimasResueltas,
  rebotesRecientes, correosSuprimidos,
  aprobarPieza, rechazarPieza, enviarPiezaPorCorreo,
  type PiezaEnCola,
} from '@/lib/likida/agentes/cola';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio, StatusPill } from '../ui/kit';
import { FormaPieza, FormaEnvio, type ResultadoPieza } from './forma-pieza';
import { RebotesYBajas } from './rebotes';

export const dynamic = 'force-dynamic';

export default async function PaginaAprobaciones() {
  await requireSuperadmin();

  // Cada lectura cae POR SU LADO: la urgente caída no esconde la normal ni
  // al revés, y "no se pudo leer" jamás se pinta como "no hay nada".
  const [urgente, normal, porEnviar, resueltas, rebotes, suprimidos] = await Promise.all([
    bandejaPendiente('urgente').then((p) => ({ ok: p as PiezaEnCola[] | null, error: null as string | null })).catch((e) => ({ ok: null, error: String(e instanceof Error ? e.message : e) })),
    bandejaPendiente('normal').then((p) => ({ ok: p as PiezaEnCola[] | null, error: null as string | null })).catch((e) => ({ ok: null, error: String(e instanceof Error ? e.message : e) })),
    aprobadasSinEnviar().catch(() => null),
    ultimasResueltas(8).catch(() => null),
    // `null` = no se pudo leer, y la sección lo DICE. Aplastarlo a lista
    // vacía diría «no hay rebotes», que es la conclusión tranquilizadora
    // que hace que nadie vuelva a mirar.
    rebotesRecientes(15).catch(() => null),
    correosSuprimidos(25).catch(() => null),
  ]);

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
        return { ok: edicion ? 'Aprobada con tu edición — esa versión es la que sale.' : 'Aprobada tal cual. El envío es el paso siguiente, abajo.' };
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

  async function accionEnviar(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const r = await enviarPiezaPorCorreo(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/aprobaciones');
      return { ok: `Enviada a ${r.destinatario} — Resend la aceptó (${r.providerId}) y el contacto quedó en el historial del prospecto.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'enviar la pieza') };
    }
  }

  function bandeja(titulo: string, r: { ok: PiezaEnCola[] | null; error: string | null }, urgenteBandeja: boolean) {
    return (
      <section className="card p-4" style={urgenteBandeja ? { borderColor: 'var(--warn)' } : undefined}>
        <div className="flex items-center gap-2">
          {urgenteBandeja && <Zap width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}
          <TituloSeccion>{titulo}</TituloSeccion>
          {r.ok !== null && (
            <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
              {r.ok.length}
            </span>
          )}
        </div>
        {r.error !== null ? (
          <p className="text-[12.5px] mt-2" style={{ color: 'var(--bad)' }}>
            No se pudo leer ESTA bandeja — no significa que esté vacía. La otra bandeja lee por su lado.
          </p>
        ) : r.ok !== null && r.ok.length === 0 ? (
          <p className="text-[12.5px] mt-2" style={{ color: 'var(--muted)' }}>
            {urgenteBandeja
              ? 'Nada urgente esperando — así debe verse casi siempre: lo urgente se resuelve en minutos.'
              : 'Nada pendiente. Las piezas llegan aquí cuando un agente redacta algo que necesita tu aprobación.'}
          </p>
        ) : r.ok !== null && (
          <div className="mt-3 space-y-2.5">
            {r.ok.map((p) => <FormaPieza key={p.id} pieza={p} accion={accionResolver} />)}
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
          {bandeja('Urgente — respuesta a ads y SLA en minutos', urgente, true)}
          {bandeja('Normal — prospección y contenido (20-40/día)', normal, false)}

          {/* ── LA COLA DE SALIDA: aprobada ≠ enviada ───────────────────────
              El envío es un click APARTE con claim anti-doble-click, y sale
              la versión final (la edición humana manda). Resend ACEPTA ≠ el
              prospecto RECIBIÓ — el id del proveedor es la prueba de salida;
              delivery/bounce es la capa siguiente, declarada. */}
          {porEnviar !== null && porEnviar.length > 0 && (
            <section className="card p-4">
              <div className="flex items-center gap-2">
                <Send width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                <TituloSeccion>Aprobadas por enviar</TituloSeccion>
                <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                  {porEnviar.length}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {porEnviar.map((p) => <FormaEnvio key={p.id} pieza={p} accion={accionEnviar} />)}
              </div>
            </section>
          )}

          {resueltas !== null && resueltas.length > 0 && (
            <section className="card p-4">
              <TituloSeccion>Últimas resueltas</TituloSeccion>
              <div className="mt-2 space-y-1.5">
                {resueltas.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 text-[12.5px] flex-wrap">
                    <StatusPill estado={p.estado === 'aprobado' ? 'ok' : 'bad'}>
                      {p.estado === 'aprobado' ? (p.cuerpoFinal ? 'Aprobada con edición' : 'Aprobada') : 'Rechazada'}
                    </StatusPill>
                    <span className="truncate">{p.titulo}</span>
                    <span className="shrink-0" style={{ color: 'var(--faint)' }}>{p.agente}</span>
                    {p.resueltoPorEmail && <span className="shrink-0" style={{ color: 'var(--faint)' }}>por {p.resueltoPorEmail}</span>}
                    {p.enviadoEn && (
                      p.providerMessageId
                        ? <span className="shrink-0" style={{ color: 'var(--ok)' }}>enviada {fechaHoraMx(p.enviadoEn)}</span>
                        // La inconsistencia VISIBLE: enviada estampada sin prueba
                        // del proveedor (el proceso murió entre envío y guardado).
                        : <span className="shrink-0" style={{ color: 'var(--warn)' }}>enviada SIN prueba del proveedor — revisar</span>
                    )}
                    {!p.enviadoEn && p.envioError && (
                      <span className="shrink-0" style={{ color: 'var(--bad)' }}>envío falló: reintentable</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── REBOTES Y QUEJAS (agosto-2026) ─────────────────────────────
              El webhook de Resend (0124) llevaba meses escribiendo
              `entrega_estado` y llenando `correo_suprimido` (0217), y NINGÚN
              `.tsx` lo pintaba. Se pone aquí y no en una pantalla nueva
              porque es la misma tabla, el mismo operador y la misma sesión de
              trabajo: quien aprueba lo que sale es quien tiene que ver qué no
              llegó. La sección no ofrece un botón de «reactivar»: suprimir es
              para siempre y quitar una fila es decisión manual (0217). */}
          <RebotesYBajas rebotes={rebotes} suprimidos={suprimidos} />

          <EstadoVacio>
            El candado es de base, no de esta pantalla: `cola_enviado_solo_aprobado` (0117) hace imposible
            que cualquier código envíe una pieza no aprobada, y la resolución exige actor con snapshot (0120).
            Rechazar exige motivo — un rechazo sin motivo es una pieza que se vuelve a proponer igual.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
