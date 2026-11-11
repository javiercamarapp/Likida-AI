'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink } from 'lucide-react';
import './facturas.css';
import { Boton, CampoTexto, clasesBoton, Icono, StatusChip } from '@/app/ui-v2/componentes';
import { mxn, fechaCorta } from '@/lib/formato';
import { PillPlazo } from './pills';
import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';

/** Una fila de la cola del jefe, ya SERIALIZADA por el server (la vista no
 *  manda el ticket entero al cliente — solo lo que esta cola pinta y usa). */
export interface FilaJefe {
  gastoId: string;
  fecha: string | null;
  comercio: string;
  portal: string;
  /** Liga directa leída del ticket/QR, o null (se cae al portal). */
  urlTicket: string | null;
  concepto: string;
  monto: number;
  caducidad: TicketPorFacturar['caducidad'];
  motivo: 'requiere_cuenta' | 'bloqueado' | 'sin_robot';
  detalle?: string;
  /** Los campos que el portal va a pedir, con su etiqueta LITERAL. */
  campos: Array<{ etiqueta: string; valor: string | null; requerido: boolean }>;
}

export type AccionMarcarFacturada = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

/**
 * La cola interactiva del jefe (13-ago: "quiero que todas las
 * funcionalidades ya estén configuradas"). Cada fila se expande a su mesa
 * de trabajo: los campos que el portal pide con copiar por campo, abrir el
 * portal, y "ya quedó" con el folio fiscal — que ESCRIBE el CFDI en la base
 * y saca el ticket de la cola de verdad. La acción vive en el servidor y
 * re-verifica sesión, rol y tenant; aquí solo se pinta.
 */
export function ColaJefe({ filas, marcarFacturada, maxFilas, totalFilas }: {
  filas: FilaJefe[];
  marcarFacturada: AccionMarcarFacturada;
  maxFilas: number;
  totalFilas: number;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  return (
    <>
      <div className="rv-fact__cola">
        {filas.map((f) => (
          <div key={f.gastoId} className="rv-fact__item" data-abierta={abierta === f.gastoId || undefined}>
            <button type="button" onClick={() => setAbierta((v) => (v === f.gastoId ? null : f.gastoId))} aria-expanded={abierta === f.gastoId}
              className="rv-fact__cab">
              <span className="rv-fact__tenue">{fechaCorta(f.fecha)}</span>
              <span className="rv-fact__dos">
                <strong>{f.comercio}</strong>
                <span className="rv-fact__sub">{f.portal}</span>
              </span>
              <span className="rv-fact__corta">{f.concepto}</span>
              <span className="cifra-mono rv-fact__der">{mxn(f.monto)}</span>
              <PillPlazo c={f.caducidad} />
              {f.motivo === 'requiere_cuenta' ? (
                <StatusChip tono="muted">Tu cuenta</StatusChip>
              ) : f.motivo === 'sin_robot' ? (
                // NO va en rojo de alerta: no está roto ni bloqueado, y el
                // encargado no hizo nada mal. Falta que ESCRIBAMOS el portal, y
                // mientras tanto el ticket se factura igual — a mano, con la
                // liga y los campos que ya trae esta misma fila.
                <StatusChip tono="muted" title="Todavía no sabemos llenar ese portal solos">A mano</StatusChip>
              ) : (
                <StatusChip tono="warn" title={f.detalle}>Bloqueado</StatusChip>
              )}
              <Icono icono={abierta === f.gastoId ? ChevronUp : ChevronDown} tam={16} />
            </button>

            {abierta === f.gastoId && <MesaDeTrabajo fila={f} marcarFacturada={marcarFacturada} />}
          </div>
        ))}
      </div>
      {totalFilas > maxFilas && (
        <p className="rv-fact__nota" data-tono="faint">
          Se muestran los {maxFilas} que vencen primero — hay {totalFilas - maxFilas} más
          (el encabezado los suma todos).
        </p>
      )}
    </>
  );
}

/**
 * A dónde manda el botón "Abrir el portal".
 *
 * `urlTicket` YA llegó depurada del servidor (`armar()` en
 * `lib/likida/facturacion/pendientes.ts`): ahí se descarta si su dominio no
 * pertenece al comercio que se identificó, antes de que exista como prop de
 * este componente — el QR de un ticket lo fotografía cualquiera que le mande
 * una foto al número de intake, nunca pasó por una persona de la oficina. Si
 * no llegó (o se descartó allá), se usa `fila.portal`: la URL fija y
 * verificada del catálogo.
 *
 * `fila.portal` YA ES una URL completa (`https://…`, viene de
 * `Comercio.portal`) — nunca un hostname pelón. Prefijarle `https://` de
 * nuevo (como hacía esta línea) produce `https://https://dominio…`, un enlace
 * roto: exactamente el camino que toma TODO ticket sin `urlTicket`, así que el
 * bug no era cosmético.
 */
export function ligaDelPortal(fila: Pick<FilaJefe, 'urlTicket' | 'portal'>): string {
  return fila.urlTicket ?? fila.portal;
}

/** El detalle expandido: exactamente lo que el jefe necesita para capturar
 *  en el portal, y la salida de la cola cuando ya quedó. */
function MesaDeTrabajo({ fila, marcarFacturada }: { fila: FilaJefe; marcarFacturada: AccionMarcarFacturada }) {
  const [estado, accion] = useActionState(marcarFacturada, null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const liga = ligaDelPortal(fila);

  function copiar(clave: string, texto: string) {
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(clave);
      setTimeout(() => setCopiado((v) => (v === clave ? null : v)), 1500);
    });
  }

  const conValor = fila.campos.filter((c) => c.valor);

  return (
    <div className="rv-fact__mesa">
      {fila.motivo === 'bloqueado' && fila.detalle && (
        <p className="rv-fact__nota" data-tono="warn">
          La máquina se rindió a propósito: {fila.detalle}. Te dejó todo listo para que lo
          termines tú.
        </p>
      )}

      {conValor.length > 0 ? (
        <div className="rv-fact__campos">
          <p className="rv-fact__rotulo">Lo que el portal te va a pedir, tal cual</p>
          {conValor.map((c) => (
            <div key={c.etiqueta} className="rv-fact__campo">
              <span className="rv-fact__tenue">{c.etiqueta}</span>
              <span className="rv-fact__valor">
                <span className="cifra-mono rv-fact__corta">{c.valor}</span>
                <Boton variante="ghost" tamano="sm" aria-label={`Copiar ${c.etiqueta}`} onClick={() => copiar(c.etiqueta, c.valor as string)} data-copiado={copiado === c.etiqueta || undefined}>
                  <Icono icono={copiado === c.etiqueta ? Check : Copy} tam={14} />
                </Boton>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rv-fact__nota" data-tono="faint">
          Este portal se captura con tu sesión — no pide más datos que los de tu cuenta.
        </p>
      )}

      <div className="rv-fact__linea">
        <a href={liga} target="_blank" rel="noopener noreferrer" className={clasesBoton('secondary', 'sm')}>
          <Icono icono={ExternalLink} tam={14} /> Abrir el portal
        </a>
        {conValor.length > 0 && (
          <Boton tamano="sm" onClick={() => copiar('__todo__', conValor.map((c) => `${c.etiqueta}: ${c.valor}`).join('\n'))} data-copiado={copiado === '__todo__' || undefined}
            icono={<Icono icono={copiado === '__todo__' ? Check : Copy} tam={14} />}>
            Copiar todo
          </Boton>
        )}
      </div>

      {/* Ya quedó: el folio fiscal que imprimió el portal saca el ticket de
          la cola DE VERDAD (escribe el CFDI en la base, anclado al tenant). */}
      <form action={accion} className="rv-fact__linea">
        <input type="hidden" name="gastoId" value={fila.gastoId} />
        <CampoTexto etiqueta="Folio fiscal del CFDI" etiquetaOculta name="uuid" placeholder="Folio fiscal (UUID) del CFDI que te dio el portal" claseControl="cifra-mono" />
        <BotonGuardar />
      </form>
      {estado?.error && <p role="alert" className="rv-fact__nota" data-tono="bad">{estado.error}</p>}
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return <Boton type="submit" variante="primary" loading={pending}>{pending ? 'Guardando…' : 'Ya quedó'}</Boton>;
}
