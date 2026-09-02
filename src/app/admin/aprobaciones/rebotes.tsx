import { MailWarning } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
// SOLO TIPOS de `cola.ts`: ese módulo importa `supabaseAdmin`, y esta vista
// tiene que poder renderizarse en una prueba sin base — mismo criterio que
// `unidades/forma.tsx` con `operacion.ts`.
import type { PiezaEnCola, CorreoSuprimido } from '@/lib/likida/agentes/cola';
import { TituloSeccion } from '../../dashboard/resumen-visual';
import { StatusPill } from '../ui/kit';

/**
 * REBOTES Y BAJAS — lo que Resend ya sabía y nadie enseñaba.
 *
 * Dos listas juntas porque cuentan la misma historia en dos tiempos: la pieza
 * que rebotó (el hecho) y la dirección que por eso quedó suprimida (la
 * consecuencia). Cada una cae por su lado; `null` se pinta como «no se pudo
 * leer», jamás como «no hay».
 *
 * Exportada para poder probar el render sin Next (patrón
 * `seccion-credenciales.test.tsx`).
 */
export function RebotesYBajas({ rebotes, suprimidos }: {
  rebotes: PiezaEnCola[] | null;
  suprimidos: CorreoSuprimido[] | null;
}) {
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <MailWarning width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />
        <TituloSeccion>Rebotes, quejas y bajas</TituloSeccion>
        {rebotes !== null && (
          <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
            {rebotes.length}
          </span>
        )}
      </div>
      <p className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>
        Lo que el proveedor reportó DESPUÉS de aceptar el envío. Un rebote no es un correo
        perdido: es reputación del dominio, y es lo que decide si llegan los siguientes.
      </p>

      {rebotes === null ? (
        <p className="text-[12.5px] mt-2" style={{ color: 'var(--bad)' }}>
          No se pudieron leer los rebotes ahora mismo — eso NO significa que no haya.
        </p>
      ) : rebotes.length === 0 ? (
        <p className="text-[12.5px] mt-2" style={{ color: 'var(--muted)' }}>
          Ninguna pieza enviada ha rebotado ni recibido queja. Con envíos recientes, así debe
          verse; sin envíos, esto no dice nada todavía.
        </p>
      ) : (
        <div className="mt-2.5 space-y-1.5">
          {rebotes.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 text-[12.5px] flex-wrap">
              {/* Queja de spam y rebote NO son lo mismo y no se funden: el
                  rebote suele ser una dirección muerta; la queja es una
                  persona que marcó el correo, y esa pesa mucho más. */}
              <StatusPill estado="bad">{p.entregaEstado === 'queja' ? 'Queja de spam' : 'Rebotó'}</StatusPill>
              <span className="truncate">{p.prospectoCorreo ?? p.titulo}</span>
              {p.prospectoEmpresa && (
                <span className="shrink-0" style={{ color: 'var(--faint)' }}>{p.prospectoEmpresa}</span>
              )}
              {p.entregaEventoEn && (
                <span className="shrink-0" style={{ color: 'var(--faint)' }}>{fechaHoraMx(p.entregaEventoEn)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
        <p className="text-[12px] font-medium">Lista de bajas — a estas direcciones ya no se escribe</p>
        {suprimidos === null ? (
          <p className="text-[12.5px] mt-1" style={{ color: 'var(--bad)' }}>
            No se pudo leer la lista de bajas. El enviador la consulta aparte y falla cerrado, así
            que un fallo aquí NO significa que alguien vaya a recibir correo de más.
          </p>
        ) : suprimidos.length === 0 ? (
          <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>
            Nadie en la lista de bajas todavía.
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            {suprimidos.map((s) => (
              <div key={s.correo} className="flex items-center gap-2.5 text-[12px] flex-wrap">
                <span className="cifra-mono truncate">{s.correo}</span>
                <span className="shrink-0" style={{ color: 'var(--muted)' }}>{s.motivo}</span>
                <span className="shrink-0" style={{ color: 'var(--faint)' }}>{fechaHoraMx(s.creadoEn)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
          Aquí no hay botón para reactivar a nadie: suprimir es para siempre y quitar una fila es
          una decisión manual sobre la base (0217).
        </p>
      </div>
    </section>
  );
}

/**
 * /admin/aprobaciones — la cola de aprobación genérica (0117 + 0120). DOS
 * bandejas con CONSULTA PROPIA cada una (auditoría externa: la urgente tiene
 * SLA en minutos y no puede depender de la salud de la normal), la cola de
 * salida (aprobadas → envío REAL por Resend, con claim anti-doble-click), y
 * las tres acciones por pieza — ni una más.
 */
