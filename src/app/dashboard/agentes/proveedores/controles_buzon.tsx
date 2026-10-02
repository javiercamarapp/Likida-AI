'use client';

import { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Send, X, RotateCcw, FileText, Trash2, Check } from 'lucide-react';
import type { AccionProveedores } from './controles';
import type { ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';

// Los controles de la ENTREGA AL CONTADOR y de la bandeja de recepción (Agente 9). Cada botón es un <form> con su
// server action: el gateo (sesión, rol, tenant) vive en la action, no aquí. Cada uno enseña su error y su aviso.

function Boton({ texto, pendiente, icono, destructivo, suave }: {
  texto: string; pendiente: string; icono?: React.ReactNode; destructivo?: boolean; suave?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50 ${suave ? 'hairline' : ''}`}
      style={destructivo ? { background: 'var(--badbg)', color: 'var(--bad)' }
        : suave ? { background: 'var(--surface)', color: 'var(--muted)' }
        : { background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {icono}{pending ? pendiente : texto}
    </button>
  );
}

function Mensaje({ estado }: { estado: { error?: string; aviso?: string } | null }) {
  if (!estado) return null;
  if (estado.error) return <p role="alert" className="text-[11.5px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>;
  if (estado.aviso) return <p role="status" className="text-[11.5px] mt-1" style={{ color: 'var(--muted)' }}>{estado.aviso}</p>;
  return null;
}

function useRefrescarAlAvisar(estado: { aviso?: string } | null) {
  const router = useRouter();
  useEffect(() => { if (estado?.aviso) router.refresh(); }, [estado, router]);
}

/** La configuración de la entrega: quién la recibe, en qué formato y si sale sola. */
export function FormaEntrega({ config, guardar }: { config: ConfigEntrega; guardar: AccionProveedores }) {
  const [estado, accion] = useActionState(guardar, null);
  const [activo, setActivo] = useState(config.activo);
  const [automatica, setAutomatica] = useState(config.automatica);
  useRefrescarAlAvisar(estado);
  return (
    <form action={accion} className="space-y-3 max-w-xl">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" name="activo" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="mt-0.5" />
        <span className="text-[13px]">
          <span className="font-medium">Entregar al contador las facturas aprobadas</span>
          <span className="block text-[11.5px]" style={{ color: 'var(--faint)' }}>
            Apagado (como nace), nada sale por correo: las aprobadas se descargan a mano en CSV. Solo viaja lo que una persona aprobó.
          </span>
        </span>
      </label>
      <label className="block text-[12.5px]">
        <span className="font-medium">Correo(s) del contador</span>
        <span className="block text-[11px] mb-1" style={{ color: 'var(--faint)' }}>Hasta 5, separados por coma o renglón.</span>
        <textarea name="destinatarios" defaultValue={config.destinatarios.join('\n')} rows={2} maxLength={600}
          aria-label="Correos del contador" placeholder="contador@tuempresa.mx"
          className="hairline w-full rounded-lg px-2.5 py-1.5 text-[12.5px]" style={{ background: 'var(--surface)' }} />
      </label>
      <div className="flex gap-4 flex-wrap items-end">
        <label className="text-[12.5px]">
          <span className="block font-medium mb-1">Formato del CSV</span>
          <select name="formato" defaultValue={config.formato} className="hairline rounded-lg px-2 py-1.5 text-[12.5px]" style={{ background: 'var(--surface)' }}>
            <option value="generico">Genérico (Excel)</option>
            <option value="sap_b1">SAP Business One</option>
            <option value="contpaqi">CONTPAQi</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" name="incluirZip" defaultChecked={config.incluirZip} /> Incluir ZIP con XML y PDF
        </label>
      </div>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" name="automatica" checked={automatica} onChange={(e) => setAutomatica(e.target.checked)} className="mt-0.5" />
        <span className="text-[13px]">
          <span className="font-medium">Enviar solo, una vez al día</span>
          <span className="block text-[11.5px]" style={{ color: 'var(--faint)' }}>Si no, el lote sale cuando pulsas «Enviar ahora».</span>
        </span>
      </label>
      {automatica && (
        <div className="flex gap-4 flex-wrap">
          <label className="text-[12.5px]">
            <span className="block font-medium mb-1">A partir de las (hora de México)</span>
            <input type="number" name="horaEnvio" min={0} max={23} defaultValue={config.horaEnvio} className="hairline rounded-lg px-2 py-1.5 w-20 text-[12.5px]" style={{ background: 'var(--surface)' }} />
          </label>
          <label className="text-[12.5px]">
            <span className="block font-medium mb-1">Mínimo de facturas</span>
            <input type="number" name="minFacturas" min={1} max={100} defaultValue={config.minFacturas} className="hairline rounded-lg px-2 py-1.5 w-20 text-[12.5px]" style={{ background: 'var(--surface)' }} />
          </label>
        </div>
      )}
      <div><Boton texto="Guardar" pendiente="Guardando…" icono={<Check width={13} height={13} strokeWidth={2} />} /></div>
      <Mensaje estado={estado} />
    </form>
  );
}

export function BotonEnviarAhora({ enviar, disponibles }: { enviar: AccionProveedores; disponibles: number }) {
  const [estado, accion] = useActionState(enviar, null);
  useRefrescarAlAvisar(estado);
  return (
    <form action={accion}>
      <Boton texto={`Enviar ahora (${disponibles})`} pendiente="Enviando…" icono={<Send width={13} height={13} strokeWidth={2} />} />
      <Mensaje estado={estado} />
    </form>
  );
}

/** Reintentar (lote fallido) y cancelar (lote que no salió): el id va en el formulario, el tenant en la sesión. */
export function BotonesLote({ id, puedeReintentar, puedeCancelar, reintentar, cancelar }: {
  id: string; puedeReintentar: boolean; puedeCancelar: boolean; reintentar: AccionProveedores; cancelar: AccionProveedores;
}) {
  const [eR, aR] = useActionState(reintentar, null);
  const [eC, aC] = useActionState(cancelar, null);
  useRefrescarAlAvisar(eR); useRefrescarAlAvisar(eC);
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex gap-1.5">
        {puedeReintentar && (
          <form action={aR}><input type="hidden" name="id" value={id} />
            <Boton texto="Reintentar" pendiente="…" suave icono={<RotateCcw width={11} height={11} strokeWidth={2} />} />
          </form>
        )}
        {puedeCancelar && (
          <form action={aC}><input type="hidden" name="id" value={id} />
            <Boton texto="Cancelar" pendiente="…" suave icono={<X width={11} height={11} strokeWidth={2} />} />
          </form>
        )}
      </div>
      <Mensaje estado={eR ?? eC} />
    </div>
  );
}

export function BotonDescartar({ id, descartar }: { id: string; descartar: AccionProveedores }) {
  const [estado, accion] = useActionState(descartar, null);
  useRefrescarAlAvisar(estado);
  return (
    <form action={accion} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <Boton texto="Descartar" pendiente="…" suave icono={<Trash2 width={11} height={11} strokeWidth={2} />} />
      <Mensaje estado={estado} />
    </form>
  );
}

/** «Ver PDF»: la action firma una URL de 5 minutos del bucket privado y redirige. `campo` dice qué id viaja. */
export function BotonVerPdf({ campo, id, ver }: { campo: 'facturaId' | 'recepcionId'; id: string; ver: AccionProveedores }) {
  const [estado, accion] = useActionState(ver, null);
  return (
    <form action={accion} className="inline-block">
      <input type="hidden" name={campo} value={id} />
      <Boton texto="Ver PDF" pendiente="…" suave icono={<FileText width={11} height={11} strokeWidth={2} />} />
      <Mensaje estado={estado} />
    </form>
  );
}
