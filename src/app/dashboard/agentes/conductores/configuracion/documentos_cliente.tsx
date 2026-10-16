'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { Aviso, type AccionSitio } from '../sitios/formas';
import { catalogoDeCliente, type DocumentoCliente } from '@/lib/likida/conductor/documentos_cliente';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOCUMENTOS QUE PIDE CADA CLIENTE (T-A5-52, R24, 0809): ver, agregar y quitar, en lenguaje llano.
// Herramienta NEUTRAL: no trae ningún catálogo, lo llena la flota. Un cliente sin documentos aquí sigue como hoy: solo el comprobante
// de entrega (POD). Solo muestra y edita el catálogo: no envía mensajes ni pide nada al chofer (eso es la solicitud al cierre, T-A5-53).
// ═══════════════════════════════════════════════════════════════════════════

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function BotonAgregar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Plus width={14} height={14} strokeWidth={1.75} />{pending ? 'Guardando…' : 'Agregar documento'}
    </button>
  );
}

function BotonQuitar({ nombre }: { nombre: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-label={`Quitar ${nombre}`}
      className="h-8 px-3 rounded-lg text-[12.5px] font-medium hairline transition-opacity hover:opacity-85 disabled:opacity-50">
      {pending ? 'Quitando…' : 'Quitar'}
    </button>
  );
}

const textoRequisitos = (d: DocumentoCliente): string => {
  if (d.requiereFirma && d.requiereSello) return 'firmado y sellado';
  if (d.requiereFirma) return 'con firma';
  if (d.requiereSello) return 'con sello';
  return 'sin firma ni sello';
};

function FilaDocumento({ d, accion }: { d: DocumentoCliente; accion?: AccionSitio }) {
  const [estado, enviar] = useActionState(accion ?? (async () => null), null);
  return (
    <li className="py-2 space-y-1.5">
      <form action={enviar} className="flex items-center justify-between gap-3 flex-wrap" aria-label={`Quitar el documento ${d.nombre}`}>
        <input type="hidden" name="id" value={d.id} />
        <div className="text-[13px]">{d.nombre} <span style={{ color: 'var(--muted)' }}>· {textoRequisitos(d)}</span></div>
        {accion && <BotonQuitar nombre={d.nombre} />}
      </form>
      <Aviso r={estado} />
    </li>
  );
}

function FormaAgregar({ clientes, accion }: { clientes: Array<{ id: string; nombre: string }>; accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="space-y-3" aria-label="Agregar documento de un cliente">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={ETIQUETA}>Cliente</span>
          <select name="clienteId" required defaultValue="" className={CAMPO}>
            <option value="" disabled>Elige un cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="block"><span className={ETIQUETA}>Documento</span>
          <input name="nombre" required maxLength={80} className={CAMPO} placeholder="Ej.: carta porte, ticket de báscula cargado" />
        </label>
        <label className="block"><span className={ETIQUETA}>¿Es indispensable?</span>
          <select name="tipo" defaultValue="basico" className={CAMPO}>
            <option value="basico">Básico (sin él no se cierra el viaje)</option>
            <option value="complementario">Complementario (se pide, pero no frena el cierre)</option>
          </select>
        </label>
        <div className="flex items-end gap-4 text-[12.5px] pb-2">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="requiereFirma" /> Debe venir firmado</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="requiereSello" /> Debe venir sellado</label>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap"><BotonAgregar /></div>
      <Aviso r={estado} />
    </form>
  );
}

export function DocumentosCliente({ clientes, documentos, accionAlta, accionBaja }: {
  clientes: Array<{ id: string; nombre: string }>;
  /** `null` = no se pudo leer: se dice, no se muestra una lista vacía como si no hubiera catálogos. */
  documentos: DocumentoCliente[] | null;
  accionAlta?: AccionSitio;
  accionBaja?: AccionSitio;
}) {
  if (documentos === null) {
    return (
      <p role="alert" className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
        No se pudo leer el catálogo de documentos ahora mismo (o falta aplicar la migración 0809); intenta de nuevo en un momento.
      </p>
    );
  }
  const nombres = new Map(clientes.map((c) => [c.id, c.nombre]));
  // Primero los clientes activos (por nombre) y luego, si quedó algún documento de un cliente que ya no está activo, ese cliente.
  const conCatalogo = [...new Set(documentos.map((d) => d.clienteId))]
    .map((id) => ({ id, nombre: nombres.get(id) ?? 'Cliente dado de baja' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const sinCatalogo = clientes.filter((c) => !catalogoDeCliente(documentos, c.id).usaCatalogo).length;

  return (
    <div className="space-y-3">
      {accionAlta && (clientes.length > 0
        ? <FormaAgregar clientes={clientes} accion={accionAlta} />
        : <p role="status" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Todavía no hay clientes dados de alta; cuando los haya, aquí eliges de cuál son los documentos.</p>)}
      {conCatalogo.length === 0 ? (
        <p role="status" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Ningún cliente tiene documentos propios todavía. A todos se les pide solo el comprobante de entrega de siempre.
        </p>
      ) : (
        <div className="space-y-3">
          {conCatalogo.map((c) => {
            const cat = catalogoDeCliente(documentos, c.id);
            return (
              <section key={c.id} aria-label={`Documentos de ${c.nombre}`} className="space-y-1">
                <h3 className="text-[12.5px] font-medium">{c.nombre}</h3>
                {cat.basicos.length > 0 && (
                  <div>
                    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Básicos: sin ellos no se cierra el viaje</p>
                    <ul className="divide-y" aria-label={`Documentos básicos de ${c.nombre}`}>{cat.basicos.map((d) => <FilaDocumento key={d.id} d={d} accion={accionBaja} />)}</ul>
                  </div>
                )}
                {cat.complementarios.length > 0 && (
                  <div>
                    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Complementarios: se piden, pero no frenan el cierre</p>
                    <ul className="divide-y" aria-label={`Documentos complementarios de ${c.nombre}`}>{cat.complementarios.map((d) => <FilaDocumento key={d.id} d={d} accion={accionBaja} />)}</ul>
                  </div>
                )}
              </section>
            );
          })}
          {sinCatalogo > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {sinCatalogo} cliente{sinCatalogo === 1 ? '' : 's'} sin documentos propios: a {sinCatalogo === 1 ? 'ese' : 'esos'} se les pide solo el comprobante de entrega de siempre.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
