'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import '../conductores.css';
import { Boton, Casilla, CampoSelect, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from '../sitios/formas';
import { catalogoDeCliente, type DocumentoCliente } from '@/lib/likida/conductor/documentos_cliente';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOCUMENTOS QUE PIDE CADA CLIENTE (T-A5-52, R24, 0809): ver, agregar y quitar, en lenguaje llano.
// Herramienta NEUTRAL: no trae ningún catálogo, lo llena la flota. Un cliente sin documentos aquí sigue como hoy: solo el comprobante
// de entrega (POD). Solo muestra y edita el catálogo: no envía mensajes ni pide nada al chofer (eso es la solicitud al cierre, T-A5-53).
// ═══════════════════════════════════════════════════════════════════════════

function BotonAgregar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Plus} tam={14} />}>
      {pending ? 'Guardando…' : 'Agregar documento'}
    </Boton>
  );
}

function BotonQuitar({ nombre }: { nombre: string }) {
  const { pending } = useFormStatus();
  return <Boton type="submit" tamano="sm" loading={pending} aria-label={`Quitar ${nombre}`}>{pending ? 'Quitando…' : 'Quitar'}</Boton>;
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
    <li className="rv-cd__item">
      <form action={enviar} className="rv-cd__linea" aria-label={`Quitar el documento ${d.nombre}`}>
        <input type="hidden" name="id" value={d.id} />
        <div>{d.nombre} <span className="rv-cd__muted">· {textoRequisitos(d)}</span></div>
        {accion && <span className="rv-cd__fin"><BotonQuitar nombre={d.nombre} /></span>}
      </form>
      <Aviso r={estado} />
    </li>
  );
}

function FormaAgregar({ clientes, accion }: { clientes: Array<{ id: string; nombre: string }>; accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__pila" aria-label="Agregar documento de un cliente">
      <div className="rv-cd__cuad">
        <CampoSelect etiqueta="Cliente" name="clienteId" required defaultValue="">
          <option value="" disabled>Elige un cliente</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta="Documento" name="nombre" required maxLength={80} placeholder="Ej.: carta porte, ticket de báscula cargado" />
        <CampoSelect etiqueta="¿Es indispensable?" name="tipo" defaultValue="basico">
          <option value="basico">Básico (sin él no se cierra el viaje)</option>
          <option value="complementario">Complementario (se pide, pero no frena el cierre)</option>
        </CampoSelect>
        <div className="rv-cd__linea">
          <Casilla name="requiereFirma" etiqueta="Debe venir firmado" />
          <Casilla name="requiereSello" etiqueta="Debe venir sellado" />
        </div>
      </div>
      <div className="rv-cd__linea"><BotonAgregar /></div>
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
      <p role="alert" className="rv-cd__nota" data-tono="bad">
        No se pudo leer el catálogo de documentos ahora mismo; intenta de nuevo en un momento. Si se repite, avísale a Likida.
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
    <div className="rv-cd__pila">
      {accionAlta && (clientes.length > 0
        ? <FormaAgregar clientes={clientes} accion={accionAlta} />
        : <p role="status" className="rv-cd__nota">Todavía no hay clientes dados de alta; cuando los haya, aquí eliges de cuál son los documentos.</p>)}
      {conCatalogo.length === 0 ? (
        <p role="status" className="rv-cd__nota">
          Ningún cliente tiene documentos propios todavía. A todos se les pide solo el comprobante de entrega de siempre.
        </p>
      ) : (
        <div className="rv-cd__pila">
          {conCatalogo.map((c) => {
            const cat = catalogoDeCliente(documentos, c.id);
            return (
              <section key={c.id} aria-label={`Documentos de ${c.nombre}`} className="rv-cd__pila--s">
                <p className="rv-cd__medio">{c.nombre}</p>
                {cat.basicos.length > 0 && (
                  <div>
                    <p className="rv-cd__nota">Básicos: sin ellos no se cierra el viaje</p>
                    <ul className="rv-cd__lista" aria-label={`Documentos básicos de ${c.nombre}`}>{cat.basicos.map((d) => <FilaDocumento key={d.id} d={d} accion={accionBaja} />)}</ul>
                  </div>
                )}
                {cat.complementarios.length > 0 && (
                  <div>
                    <p className="rv-cd__nota">Complementarios: se piden, pero no frenan el cierre</p>
                    <ul className="rv-cd__lista" aria-label={`Documentos complementarios de ${c.nombre}`}>{cat.complementarios.map((d) => <FilaDocumento key={d.id} d={d} accion={accionBaja} />)}</ul>
                  </div>
                )}
              </section>
            );
          })}
          {sinCatalogo > 0 && (
            <p className="rv-cd__nota">
              {sinCatalogo} cliente{sinCatalogo === 1 ? '' : 's'} sin documentos propios: a {sinCatalogo === 1 ? 'ese' : 'esos'} se les pide solo el comprobante de entrega de siempre.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
