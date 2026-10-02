'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Upload, Trash2 } from 'lucide-react';
import { AvisoResultado, type ResultadoUI } from '../../../../admin/ui/aviso-resultado';

export type ResultadoGrupos = ResultadoUI;
export type AccionGrupos = (previo: ResultadoGrupos, fd: FormData) => Promise<ResultadoGrupos>;

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';
const AYUDA = 'text-[11px] mt-1';

function Enviar({ children, Icono, peligro }: { children: React.ReactNode; Icono: typeof Save; peligro?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="hairline rounded-lg px-3 h-9 text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60 hover:bg-[var(--canvas)]" style={peligro ? { color: 'var(--bad)' } : undefined}>
      <Icono width={14} height={14} strokeWidth={1.75} aria-hidden />{pending ? 'Un momento…' : children}
    </button>
  );
}

export function FormaAltaGrupo({ accion, clientes }: { accion: AccionGrupos; clientes: Array<{ id: string; nombre: string }> }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label>
          <span className={ETIQUETA}>Cliente</span>
          <select name="clienteId" required defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="" disabled>Elige un cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Nombre del grupo (como se ve en WhatsApp)</span>
          <input name="nombre" required maxLength={120} className={CAMPO} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" name="critico" className="mt-0.5" />
        <span><strong>Cliente crítico.</strong> Se le atiende con el plazo corto de respuesta de la configuración del Vigía.</span>
      </label>
      <Enviar Icono={Save}>Agregar grupo</Enviar>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaCritico({ accion, grupoId, critico }: { accion: AccionGrupos; grupoId: string; critico: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="inline-flex items-center gap-2">
      <input type="hidden" name="grupoId" value={grupoId} />
      <input type="hidden" name="critico" value={critico ? 'no' : 'si'} />
      <button type="submit" className="hairline rounded-md px-2 h-7 text-[11.5px] hover:bg-[var(--canvas)]">{critico ? 'Quitar crítico' : 'Marcar crítico'}</button>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaBorrar({ accion, grupoId }: { accion: AccionGrupos; grupoId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="inline-flex items-center gap-2">
      <input type="hidden" name="grupoId" value={grupoId} />
      <button type="submit" className="rounded-md px-2 h-7 text-[11.5px] inline-flex items-center gap-1 hover:bg-[var(--canvas)]" style={{ color: 'var(--bad)' }} aria-label="Borrar el grupo y todo su histórico">
        <Trash2 width={12} height={12} strokeWidth={1.75} aria-hidden />Borrar
      </button>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FormaImportar({ accion, grupos }: { accion: AccionGrupos; grupos: Array<{ id: string; nombre: string; cliente: string | null }> }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label>
          <span className={ETIQUETA}>Grupo</span>
          <select name="grupoId" required defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="" disabled>Elige un grupo…</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.cliente ? `${g.cliente} · ` : ''}{g.nombre}</option>)}
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Archivo del chat (.txt o .zip, hasta 9 MB)</span>
          <input type="file" name="archivo" required accept=".txt,.zip,text/plain,application/zip" className={`${CAMPO} pt-1.5`} />
          <span className={AYUDA} style={{ color: 'var(--faint)' }}>En WhatsApp: el grupo → Exportar chat → Sin multimedia.</span>
        </label>
      </div>
      <label className="block">
        <span className={ETIQUETA}>Nombres de TU equipo en ese chat (separados por coma)</span>
        <input name="equipo" required placeholder="Ana Servicio, Luis Tráfico" className={CAMPO} />
        <span className={AYUDA} style={{ color: 'var(--faint)' }}>Tal como salen en el chat. Todo otro nombre se cuenta como cliente. Los nombres no se guardan, solo un código que no se puede revertir; los teléfonos y correos escritos en los mensajes se tapan.</span>
      </label>
      <Enviar Icono={Upload}>Subir histórico</Enviar>
      <AvisoResultado estado={estado} />
    </form>
  );
}
