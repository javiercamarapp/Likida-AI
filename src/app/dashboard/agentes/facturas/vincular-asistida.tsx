'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, MonitorSmartphone, X } from 'lucide-react';
import './facturas.css';
import { Boton, Icono, useNotificar } from '@/app/ui-v2/componentes';
import {
  accionIniciarVinculacion, accionCancelarVinculacion, accionEstadoVinculacion,
  type ResultadoVincular, type EstadoVinculacionPantalla,
} from './acciones-vinculacion';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { horaMx } from '@/lib/formato';

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

export function VincularAsistida({ clave, nombre, flota = null }: { clave: string; nombre: string; flota?: string | null }) {
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
      const e = await accionEstadoVinculacion(clave, flota);
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
  }, [hayCodigo, clave, nombre, flota, notificar, router]);

  if (!hayCodigo) {
    return (
      <form action={(fd) => { setCerrado(false); setEstado(null); iniciar(fd); }} className="rv-fact__pila">
        <input type="hidden" name="comercio" value={clave} />
        {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
        <div>
          <Boton type="submit" variante="ghost" tamano="sm" loading={iniciando} icono={<Icono icono={MonitorSmartphone} tam={14} />}>
            {iniciando ? 'Generando…' : 'Vincular con código'}
          </Boton>
        </div>
        {res && !res.ok && <span role="alert" className="rv-fact__nota" data-tono="bad">{res.error}</span>}
      </form>
    );
  }

  const vivo = estado?.ok ? estado.estado : 'pendiente';
  return (
    <div className="rv-fact__relogin" role="region" aria-label={`Vincular ${nombre}`}>
      <div className="rv-fact__pila">
        <p className="rv-fact__titulo">Vincular {nombre}</p>
        <ol className="rv-fact__pasos">
          <li>En una computadora <strong>con pantalla</strong> (la tuya), en la carpeta de Likida, corre:</li>
        </ol>
        <div className="rv-fact__linea">
          <code className="rv-fact__codigo" data-testid="comando-vinculacion">{res.comando}</code>
          <Boton variante="ghost" tamano="sm" aria-label="Copiar comando"
            onClick={() => { void navigator.clipboard?.writeText(res.comando); notificar({ tono: 'info', mensaje: 'Comando copiado.' }); }}>
            <Icono icono={Copy} tam={14} />
          </Boton>
        </div>
        <ol start={2} className="rv-fact__pasos">
          <li>Se abre el portal. <strong>Entra tú</strong> con tu cuenta y resuelve el CAPTCHA o el código de dos pasos. Likida no teclea nada ni resuelve retos.</li>
          <li>Cuando estés dentro, la ventana se cierra sola y aquí aparece «vinculado».</li>
        </ol>
        <p className="rv-fact__nota" data-tono="warn">
          El código se muestra solo ahora, sirve una vez y caduca a las {horaMx(res.expiraEn)}. No lo compartas.
        </p>
        <p className="rv-fact__nota" role="status">{ROTULO[vivo] ?? ''}</p>
        <div>
          <Boton variante="ghost" tamano="sm" loading={cancelando} icono={<Icono icono={X} tam={14} />}
            onClick={() => empezarCancelar(async () => {
              const fd = new FormData(); fd.set('comercio', clave); if (flota) fd.set(CAMPO_FLOTA_PINTADA, flota);
              const r = await accionCancelarVinculacion(null, fd);
              notificar(r.error ? { tono: 'error', mensaje: r.error } : { tono: 'info', mensaje: r.ok ?? 'Cancelada.' });
              setCerrado(true); router.refresh();
            })}>
            Cancelar y anular el código
          </Boton>
        </div>
      </div>
    </div>
  );
}
