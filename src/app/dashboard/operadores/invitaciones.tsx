'use client';

import { useActionState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { numero } from '@/lib/formato';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';
import { useNotificarResultado } from '../../admin/ui/notificaciones';

// ═══════════════════════════════════════════════════════════════════════════
// LA INVITACIÓN DEL OPERADOR POR WHATSAPP (W2): masiva y por renglón.
//
// Cada invitación es un mensaje de WhatsApp —plantilla aprobada, con el costo de
// Meta— a una persona que tiene que haber aceptado recibirlo. Por eso NUNCA sale
// sola: siempre pasa por un diálogo que dice a cuántos y recuerda eso.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoInvitar =
  | null
  | { ok: true; mensaje: string; fallidas: Array<{ nombre: string; motivo: string }> }
  | { ok: false; error: string };
export type AccionInvitar = (previo: ResultadoInvitar, datos: FormData) => Promise<ResultadoInvitar>;

const CONFIRMACION =
  'Cada invitación es un mensaje de WhatsApp (plantilla aprobada, con el costo de Meta). Confírmalo solo si son tus choferes y aceptaron recibir mensajes de la empresa.';

function Fallidas({ estado }: { estado: ResultadoInvitar }) {
  if (!estado || !estado.ok || estado.fallidas.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[12px]" style={{ color: 'var(--warn)' }}>
      {estado.fallidas.slice(0, 10).map((f) => <li key={f.nombre + f.motivo}>{f.nombre}: {f.motivo}</li>)}
      {estado.fallidas.length > 10 && <li>y {numero(estado.fallidas.length - 10)} más.</li>}
    </ul>
  );
}

/** La tarjeta de arriba del registro: cuántos esperan invitación y los botones. */
export function InvitarPendientes({ pendientes, conFallo, accion, hrefGuia }: {
  pendientes: number;
  conFallo: number;
  accion: AccionInvitar;
  /** A la guía del arranque del chofer (número de Likida, QR). */
  hrefGuia: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  if (pendientes === 0 && conFallo === 0 && !estado) return null;
  return (
    <section aria-labelledby="titulo-invitar" className="card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          <MessageCircle aria-hidden width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 id="titulo-invitar" className="font-display text-[15px] font-semibold">Invitar a los operadores por WhatsApp</h2>
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            {pendientes > 0
              ? <><strong style={{ color: 'var(--ink)' }}>{numero(pendientes)}</strong> {pendientes === 1 ? 'operador activo espera' : 'operadores activos esperan'} su invitación. </>
              : 'Todos los operadores activos ya fueron invitados. '}
            Les llega un mensaje para que le escriban a Likida con su número; hasta que lo hagan, el bot no los conoce en conversación.{' '}
            <a href={hrefGuia} className="underline">Ver el número y el flujo de arranque del chofer</a>.
          </p>
          {conFallo > 0 && (
            <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
              {numero(conFallo)} {conFallo === 1 ? 'invitación falló' : 'invitaciones fallaron'} (número sin WhatsApp o inválido): corrige el teléfono en su ficha y reintenta.
            </p>
          )}
          <form action={despachar} className="flex flex-wrap items-center gap-2">
            {pendientes > 0 && (
              <BotonConfirmar
                etiqueta={`Enviar invitaciones pendientes (${numero(pendientes)})`} tono="normal"
                nombreConfirmar="modo" valorConfirmar="pendientes"
                titulo={`Invitar a ${numero(Math.min(pendientes, 40))} operadores`}
                descripcion={<>{CONFIRMACION} Salen hasta 40 por vez{pendientes > 40 ? `; quedarán ${numero(pendientes - 40)} pendientes y repites el envío` : ''}.</>}
                etiquetaConfirmar="Sí, enviar invitaciones"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-opacity hover:opacity-85"
                style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}
                icono={<Send aria-hidden width={13} height={13} strokeWidth={2} />}
              />
            )}
            {conFallo > 0 && (
              <BotonConfirmar
                etiqueta={`Reintentar las que fallaron (${numero(conFallo)})`} tono="normal"
                nombreConfirmar="modo" valorConfirmar="fallidas"
                titulo={`Reintentar ${numero(Math.min(conFallo, 40))} invitaciones`}
                descripcion={CONFIRMACION}
                etiquetaConfirmar="Sí, reintentar"
                className="hairline inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]"
              />
            )}
          </form>
          <AvisoResultado estado={estado} />
          <Fallidas estado={estado} />
        </div>
      </div>
    </section>
  );
}

/** «Invitar» en el renglón de UN operador (con diálogo). */
export function InvitarUno({ operadorId, nombre, reintento, accion }: {
  operadorId: string;
  nombre: string;
  /** Ya falló antes: el botón dice «Reintentar». */
  reintento: boolean;
  accion: AccionInvitar;
}) {
  const [estado, despachar] = useActionState(accion, null);
  useNotificarResultado(estado);
  return (
    <form action={despachar} className="inline">
      <input type="hidden" name="modo" value="uno" />
      <input type="hidden" name="operadorId" value={operadorId} />
      <BotonConfirmar
        etiqueta={reintento ? 'Reintentar invitación' : 'Invitar por WhatsApp'} tono="normal"
        titulo={`Invitar a ${nombre}`}
        descripcion={<>Se le manda un mensaje de WhatsApp para que le escriba a Likida. {CONFIRMACION}</>}
        etiquetaConfirmar="Sí, invitar"
        className="text-[12px] underline hover:opacity-70 transition-opacity"
        style={{ color: 'var(--muted)' }}
      />
    </form>
  );
}
