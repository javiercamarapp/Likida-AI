'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import '../conductores.css';
import { Boton, Casilla, CampoSelect, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from '../sitios/formas';
import { catalogoDeCliente, type DocumentoCliente } from '@/lib/likida/conductor/documentos_cliente';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOCUMENTOS QUE PIDE CADA CLIENTE (T-A5-52, R24, 0809): ver, agregar y quitar, en lenguaje llano.
// Herramienta NEUTRAL: no trae ningún catálogo, lo llena la flota. Un cliente sin documentos aquí sigue como hoy: solo el comprobante
// de entrega (POD). Solo muestra y edita el catálogo: no envía mensajes ni pide nada al chofer (eso es la solicitud al cierre, T-A5-53).
// ═══════════════════════════════════════════════════════════════════════════

function BotonAgregar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Plus} tam={14} />}>
      {pending ? 'Guardando…' : tx('rest.agregar_documento')}
    </Boton>
  );
}

function BotonQuitar({ nombre }: { nombre: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return <Boton type="submit" tamano="sm" loading={pending} aria-label={`Quitar ${nombre}`}>{pending ? 'Quitando…' : tx('rest.quitar')}</Boton>;
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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__pila" aria-label={tx('rest.agregar_documento_de_un_cliente')}>
      <div className="rv-cd__cuad">
        <CampoSelect etiqueta={tx('vigia.vista.cliente')} name="clienteId" required defaultValue="">
          <option value="" disabled>{tx('rest.elige_un_cliente')}</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta={tx('rest.documento')} name="nombre" required maxLength={80} placeholder={tx('rest.ej_carta_porte_ticket_de_bascula')} />
        <CampoSelect etiqueta={tx('rest.es_indispensable')} name="tipo" defaultValue="basico">
          <option value="basico">{tx('rest.basico_sin_el_no_se_cierra')}</option>
          <option value="complementario">{tx('rest.complementario_se_pide_pero_no_frena')}</option>
        </CampoSelect>
        <div className="rv-cd__linea">
          <Casilla name="requiereFirma" etiqueta={tx('rest.debe_venir_firmado')} />
          <Casilla name="requiereSello" etiqueta={tx('rest.debe_venir_sellado')} />
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
  const { t: tx } = useT('agentes', agentesEs);
  if (documentos === null) {
    return (
      <p role="alert" className="rv-cd__nota" data-tono="bad">{tx('rest.no_se_pudo_leer_el_catalogo_2')}</p>
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
        : <p role="status" className="rv-cd__nota">{tx('rest.todavia_no_hay_clientes_dados_de')}</p>)}
      {conCatalogo.length === 0 ? (
        <p role="status" className="rv-cd__nota">{tx('rest.ningun_cliente_tiene_documentos_propios_todavia')}</p>
      ) : (
        <div className="rv-cd__pila">
          {conCatalogo.map((c) => {
            const cat = catalogoDeCliente(documentos, c.id);
            return (
              <section key={c.id} aria-label={`Documentos de ${c.nombre}`} className="rv-cd__pila--s">
                <p className="rv-cd__medio">{c.nombre}</p>
                {cat.basicos.length > 0 && (
                  <div>
                    <p className="rv-cd__nota">{tx('rest.basicos_sin_ellos_no_se_cierra')}</p>
                    <ul className="rv-cd__lista" aria-label={tx('rest.documentos_basicos_de', { nombre: c.nombre })}>{cat.basicos.map((d) => <FilaDocumento key={d.id} d={d} accion={accionBaja} />)}</ul>
                  </div>
                )}
                {cat.complementarios.length > 0 && (
                  <div>
                    <p className="rv-cd__nota">{tx('rest.complementarios_se_piden_pero_no_frenan')}</p>
                    <ul className="rv-cd__lista" aria-label={`Documentos complementarios de ${c.nombre}`}>{cat.complementarios.map((d) => <FilaDocumento key={d.id} d={d} accion={accionBaja} />)}</ul>
                  </div>
                )}
              </section>
            );
          })}
          {sinCatalogo > 0 && (
            <p className="rv-cd__nota">
              {tx(sinCatalogo === 1 ? 'rest.n_cliente_sin_documentos_propios.uno' : 'rest.n_cliente_sin_documentos_propios.otros', { n: sinCatalogo })}</p>
          )}
        </div>
      )}
    </div>
  );
}
