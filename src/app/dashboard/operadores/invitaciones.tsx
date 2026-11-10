'use client';

import { useActionState, useCallback } from 'react';
import { Send } from 'lucide-react';
import { numero } from '@/lib/formato';
import { AvisoResultado, BotonConfirmar, Icono, Tarjeta, clasesBoton, leerResultado, useNotificar } from '@/app/ui-v2/componentes';
import './operadores.css';

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
  | { ok: false; error: string; fallidas?: Array<{ nombre: string; motivo: string }> };
export type AccionInvitar = (previo: ResultadoInvitar, datos: FormData) => Promise<ResultadoInvitar>;

const CONFIRMACION =
  'Cada invitación es un mensaje de WhatsApp (plantilla aprobada, con el costo de Meta). Confírmalo solo si son tus choferes y aceptaron recibir mensajes de la empresa.';

function Fallidas({ estado }: { estado: ResultadoInvitar }) {
  const fallidas = estado?.fallidas ?? [];
  if (fallidas.length === 0) return null;
  return (
    <ul className="rv-eq__lista">
      {fallidas.slice(0, 10).map((f) => <li key={f.nombre + f.motivo}>{f.nombre}: {f.motivo}</li>)}
      {fallidas.length > 10 && <li>y {numero(fallidas.length - 10)} más.</li>}
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
    <Tarjeta titulo="Invitar a los operadores por WhatsApp" info="whatsapp.avance">
      <div className="rv-eq__bloque">
        <p className="rv-eq__texto">
          {pendientes > 0
            ? <><strong>{numero(pendientes)}</strong> {pendientes === 1 ? 'operador activo espera' : 'operadores activos esperan'} su invitación. </>
            : 'Todos los operadores activos ya fueron invitados. '}
          Les llega un mensaje para que le escriban a Likida con su número; hasta que lo hagan, el bot no los conoce en conversación.{' '}
          <a href={hrefGuia} className="rv-eq__enlace">Ver el número y el flujo de arranque del chofer</a>.
        </p>
        {conFallo > 0 && (
          <p className="rv-eq__texto" data-tono="warn">
            {numero(conFallo)} {conFallo === 1 ? 'invitación falló' : 'invitaciones fallaron'} (número sin WhatsApp o inválido): corrige el teléfono en su ficha y reintenta.
          </p>
        )}
        <form action={despachar} className="rv-eq__fila">
          {pendientes > 0 && (
            <BotonConfirmar
              etiqueta={`Enviar invitaciones pendientes (${numero(pendientes)})`} tono="normal"
              nombreConfirmar="modo" valorConfirmar="pendientes"
              titulo={`Invitar a ${numero(Math.min(pendientes, 40))} operadores`}
              descripcion={<>{CONFIRMACION} Salen hasta 40 por vez{pendientes > 40 ? `; quedarán ${numero(pendientes - 40)} pendientes y repites el envío` : ''}.</>}
              etiquetaConfirmar="Sí, enviar invitaciones"
              className={clasesBoton('primary')}
              icono={<Icono icono={Send} />}
            />
          )}
          {conFallo > 0 && (
            <BotonConfirmar
              etiqueta={`Reintentar las que fallaron (${numero(conFallo)})`} tono="normal"
              nombreConfirmar="modo" valorConfirmar="fallidas"
              titulo={`Reintentar ${numero(Math.min(conFallo, 40))} invitaciones`}
              descripcion={CONFIRMACION}
              etiquetaConfirmar="Sí, reintentar"
              className={clasesBoton('secondary')}
            />
          )}
        </form>
        <AvisoResultado estado={estado} />
        <Fallidas estado={estado} />
      </div>
    </Tarjeta>
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
  // El aviso sale DENTRO de la acción, no de un efecto de este componente: tras `revalidatePath` la fila pasa a «Invitación
  // enviada»/«falló», este botón se desmonta y un `useNotificarResultado` se perdía (el éxito y, peor, el error nunca se veían).
  const { notificar } = useNotificar();
  const conAviso = useCallback<AccionInvitar>(async (previo, datos) => {
    const resultado = await accion(previo, datos);
    const leido = leerResultado(resultado);
    if (leido) notificar({ tono: leido.tono === 'error' ? 'error' : 'ok', mensaje: leido.texto });
    return resultado;
  }, [accion, notificar]);
  const [, despachar] = useActionState(conAviso, null);
  return (
    <form action={despachar} className="rv-eq__en-linea">
      <input type="hidden" name="modo" value="uno" />
      <input type="hidden" name="operadorId" value={operadorId} />
      <BotonConfirmar
        etiqueta={reintento ? 'Reintentar invitación' : 'Invitar por WhatsApp'} tono="normal"
        titulo={`Invitar a ${nombre}`}
        descripcion={<>Se le manda un mensaje de WhatsApp para que le escriba a Likida. {CONFIRMACION}</>}
        etiquetaConfirmar="Sí, invitar"
        className={clasesBoton('ghost', 'sm')}
      />
    </form>
  );
}
