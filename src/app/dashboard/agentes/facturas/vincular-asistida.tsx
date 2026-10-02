'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, MonitorSmartphone, X } from 'lucide-react';
import { useNotificar } from '../../../admin/ui/notificaciones';
import {
  accionIniciarVinculacion, accionCancelarVinculacion, accionEstadoVinculacion,
  type ResultadoVincular, type EstadoVinculacionPantalla,
} from './acciones-vinculacion';

// ════════════════════════════════════════════════════════════════════════════
// «VINCULAR» — el paso humano del CAPTCHA/MFA, con pantalla en el producto (0540).
//
// Un servidor no puede enseñarte un Chromium para que teclees en él. Esto es lo que SÍ se
// puede y es seguro: el panel te da un CÓDIGO DE UN SOLO USO (caduca en 15 min) y el comando
// que corres en TU computadora con pantalla; ahí se abre el portal, tú entras y resuelves el
// reto, y solo las cookies de ese portal llegan a Likida (cifradas). La contraseña nunca pasa
// por Likida. Esta pieza muestra el código UNA vez y sondea el estado hasta que termina.
// ════════════════════════════════════════════════════════════════════════════

const ROTULO: Record<string, string> = {
  pendiente: 'Esperando a que corras el comando…',
  reclamada: 'Código aceptado: entra al portal en la ventana que se abrió y resuelve el reto.',
};

export function VincularAsistida({ clave, nombre }: { clave: string; nombre: string }) {
  const router = useRouter();
  const { notificar } = useNotificar();
  const [res, iniciar, iniciando] = useActionState<ResultadoVincular | null, FormData>(accionIniciarVinculacion, null);
  const [estado, setEstado] = useState<EstadoVinculacionPantalla | null>(null);
  const [cancelando, empezarCancelar] = useTransition();
  const [cerrado, setCerrado] = useState(false);

  const hayCodigo = res?.ok === true && !cerrado;

  // Sondeo mientras haya un código vivo: cada 4 s. Al terminar, refresca el panel (el estado
  // «vinculado» sale de `portal_estado`) y avisa con el sistema único de toasts.
  useEffect(() => {
    if (!hayCodigo) return;
    let vivo = true;
    const t = setInterval(async () => {
      const e = await accionEstadoVinculacion(clave);
      if (!vivo) return;
      setEstado(e);
      if (!e.ok) return;
      if (e.estado === 'completada') {
        notificar({ tono: 'ok', mensaje: `${nombre} quedó vinculado. El agente ya puede entrar solo.` });
        setCerrado(true); router.refresh();
      } else if (e.estado === 'fallida' || e.estado === 'expirada' || e.estado === 'cancelada') {
        notificar({ tono: 'error', mensaje: `No se vinculó ${nombre}: ${e.motivo ?? (e.estado === 'expirada' ? 'el código venció' : 'se canceló')}. Pide otro código.` });
        setCerrado(true); router.refresh();
      }
    }, 4_000);
    return () => { vivo = false; clearInterval(t); };
  }, [hayCodigo, clave, nombre, notificar, router]);

  if (!hayCodigo) {
    return (
      <form action={(fd) => { setCerrado(false); setEstado(null); iniciar(fd); }} className="inline">
        <input type="hidden" name="comercio" value={clave} />
        <button type="submit" disabled={iniciando}
          className="inline-flex items-center gap-1 text-[11.5px] underline disabled:opacity-50" style={{ color: 'var(--muted)' }}>
          <MonitorSmartphone width={11} height={11} strokeWidth={2} />
          {iniciando ? 'Generando…' : 'Vincular con código'}
        </button>
        {res && !res.ok && <span role="alert" className="block text-[11px] mt-1" style={{ color: 'var(--bad)' }}>{res.error}</span>}
      </form>
    );
  }

  const vivo = estado?.ok ? estado.estado : 'pendiente';
  return (
    <div className="mt-2 rounded-lg p-3 w-full" style={{ background: 'var(--canvas)' }} role="region" aria-label={`Vincular ${nombre}`}>
      <p className="text-[12px] font-medium">Vincular {nombre}</p>
      <ol className="text-[11.5px] mt-1 space-y-1 list-decimal pl-4" style={{ color: 'var(--muted)' }}>
        <li>En una computadora <strong>con pantalla</strong> (la tuya), en la carpeta de Likida, corre:</li>
      </ol>
      <div className="flex items-center gap-2 mt-1.5">
        <code className="text-[11.5px] font-mono rounded px-2 py-1 break-all" style={{ background: 'var(--line2)' }} data-testid="comando-vinculacion">{res.comando}</code>
        <button type="button" aria-label="Copiar comando" className="shrink-0 p-1 rounded hover:bg-[var(--line2)]"
          onClick={() => { void navigator.clipboard?.writeText(res.comando); notificar({ tono: 'info', mensaje: 'Comando copiado.' }); }}>
          <Copy width={12} height={12} strokeWidth={2} />
        </button>
      </div>
      <ol start={2} className="text-[11.5px] mt-1.5 space-y-1 list-decimal pl-4" style={{ color: 'var(--muted)' }}>
        <li>Se abre el portal. <strong>Entra tú</strong> con tu cuenta y resuelve el CAPTCHA o el código de dos pasos. Likida no teclea nada ni resuelve retos.</li>
        <li>Cuando estés dentro, la ventana se cierra sola y aquí aparece «vinculado».</li>
      </ol>
      <p className="text-[11px] mt-2" style={{ color: 'var(--warn)' }}>
        El código se muestra solo ahora, sirve una vez y caduca a las {new Date(res.expiraEn).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}. No lo compartas.
      </p>
      <p className="text-[11.5px] mt-1" role="status" style={{ color: 'var(--muted)' }}>{ROTULO[vivo] ?? ''}</p>
      <div className="mt-2">
        <button type="button" disabled={cancelando}
          className="inline-flex items-center gap-1 text-[11.5px] underline disabled:opacity-50" style={{ color: 'var(--muted)' }}
          onClick={() => empezarCancelar(async () => {
            const fd = new FormData(); fd.set('comercio', clave);
            const r = await accionCancelarVinculacion(null, fd);
            notificar(r.error ? { tono: 'error', mensaje: r.error } : { tono: 'info', mensaje: r.ok ?? 'Cancelada.' });
            setCerrado(true); router.refresh();
          })}>
          <X width={11} height={11} strokeWidth={2} /> Cancelar y anular el código
        </button>
      </div>
    </div>
  );
}
