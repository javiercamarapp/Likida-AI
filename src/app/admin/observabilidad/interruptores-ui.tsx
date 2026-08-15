'use client';

import { useActionState } from 'react';
import { Power } from 'lucide-react';
import { StatusPill } from '../ui/kit';
import { Aviso, type ResultadoAccion, type AccionDeForma } from '../ui/forma';
import { fechaHoraMx } from '@/lib/formato';
import { etiquetaInterruptor } from './etiquetas';

// ═══════════════════════════════════════════════════════════════════════════
// LOS TOGGLES DEL KILL SWITCH — la parte de /admin/observabilidad que Javier
// va a tocar desde el teléfono en pleno incidente.
//
// UNA FILA, UN FORMULARIO, UN `useActionState`: el patrón de FormaConAviso
// (ui/forma.tsx) pero por renglón — apagar Cobranza no puede compartir estado
// de "guardando…" con Facturas, porque en un incidente se tocan dos palancas
// seguidas y un spinner compartido escondería cuál ya respondió.
//
// EL MOTIVO ES OBLIGATORIO AL APAGAR, desde el HTML (`required`) hasta el
// CHECK de la 0110: apagar sin decir por qué deja una bomba sin nota. El
// botón se deshabilita mientras corre — la palanca no es idempotente en su
// FIRMA (quién/cuándo), y el doble clic escribiría dos entradas de bitácora.
//
// ESTE COMPONENTE NO DECIDE PERMISOS: el server action que recibe re-gatea
// superadmin adentro (patrón de administracion.ts) — aquí solo se pinta.
// ═══════════════════════════════════════════════════════════════════════════

export interface InterruptorParaUi {
  id: string;
  apagado: boolean;
  motivo: string | null;
  cambiadoPorNombre: string | null;
  cambiadoEn: string | null;
}

export function SeccionInterruptores({
  interruptores,
  accion,
}: {
  interruptores: InterruptorParaUi[];
  accion: AccionDeForma;
}) {
  // 'global' primero y apagados arriba: en un incidente, lo tocado se busca
  // antes que lo intacto.
  const orden = [...interruptores].sort((a, b) =>
    Number(b.apagado) - Number(a.apagado) || Number(b.id === 'global') - Number(a.id === 'global'));

  return (
    <div className="space-y-1.5">
      {orden.map((i) => <FilaInterruptor key={i.id} interruptor={i} accion={accion} />)}
    </div>
  );
}

function FilaInterruptor({ interruptor: i, accion }: { interruptor: InterruptorParaUi; accion: AccionDeForma }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);

  return (
    <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
            <Power width={13} height={13} strokeWidth={1.75}
              style={{ color: i.apagado ? 'var(--bad)' : 'var(--muted)' }} />
            {etiquetaInterruptor(i.id)}
            <code className="font-mono text-[10px]" style={{ color: 'var(--muted)' }}>{i.id}</code>
          </div>
          {/* Quién y cuándo, VISIBLES: una palanca sin firma a la vista invita
              a preguntar en el chat "¿quién apagó esto?" en pleno incidente. */}
          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {i.apagado && i.motivo ? <>Motivo: {i.motivo} · </> : null}
            {i.cambiadoEn
              ? <>{i.apagado ? 'Apagado' : 'Último cambio'} por {i.cambiadoPorNombre ?? 'cuenta borrada'} · {fechaHoraMx(i.cambiadoEn)}</>
              : 'Nunca se ha tocado — encendido por default (sin fila = encendido).'}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusPill estado={i.apagado ? 'bad' : 'ok'}>{i.apagado ? 'APAGADO' : 'Encendido'}</StatusPill>
          <form action={enviar} className="flex items-center gap-2">
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="operacion" value={i.apagado ? 'encender' : 'apagar'} />
            {!i.apagado && (
              <input
                name="motivo"
                required
                placeholder="Motivo (obligatorio)"
                className="text-xs rounded-lg px-2.5 py-1.5 w-44 outline-none"
                style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}
              />
            )}
            <button
              type="submit"
              disabled={pendiente}
              className="text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              style={i.apagado
                ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
                : { background: 'var(--badbg)', color: 'var(--bad)', border: '1px solid var(--line)' }}
            >
              {pendiente ? 'Guardando…' : i.apagado ? 'Encender' : 'Apagar'}
            </button>
          </form>
        </div>
      </div>
      <Aviso estado={estado} />
    </div>
  );
}
