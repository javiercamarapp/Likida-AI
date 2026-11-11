'use client';

import { useActionState, useCallback } from 'react';
import { Send } from 'lucide-react';
import { numero } from '@/lib/formato';
import { AvisoResultado, BotonConfirmar, Icono, Tarjeta, clasesBoton, leerResultado, useNotificar } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';
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

function Fallidas({ estado }: { estado: ResultadoInvitar }) {
  const { t, idioma } = useT('operacion', operacionEs);
  const fallidas = estado?.fallidas ?? [];
  if (fallidas.length === 0) return null;
  return (
    <ul className="rv-eq__lista">
      {fallidas.slice(0, 10).map((f) => <li key={f.nombre + f.motivo}>{f.nombre}: {f.motivo}</li>)}
      {fallidas.length > 10 && <li>{t('comun.mas', { n: numero(fallidas.length - 10, idioma) })}</li>}
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
  const { t, tp, idioma } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  if (pendientes === 0 && conFallo === 0 && !estado) return null;
  return (
    <Tarjeta titulo={t('op.inv.titulo')} info="whatsapp.avance">
      <div className="rv-eq__bloque">
        <p className="rv-eq__texto">
          {pendientes > 0
            ? <strong>{tp('op.inv.esperan', pendientes, { n: numero(pendientes, idioma) })}</strong>
            : t('op.inv.todos')}
          {t('op.inv.llega')}{' '}
          <a href={hrefGuia} className="rv-eq__enlace">{t('op.inv.guia')}</a>.
        </p>
        {conFallo > 0 && (
          <p className="rv-eq__texto" data-tono="warn">
            {tp('op.inv.fallo', conFallo, { n: numero(conFallo, idioma) })}
          </p>
        )}
        <form action={despachar} className="rv-eq__fila">
          {pendientes > 0 && (
            <BotonConfirmar
              etiqueta={t('op.inv.enviar', { n: numero(pendientes, idioma) })} tono="normal"
              nombreConfirmar="modo" valorConfirmar="pendientes"
              titulo={t('op.inv.enviar.titulo', { n: numero(Math.min(pendientes, 40), idioma) })}
              descripcion={pendientes > 40 ? t('op.inv.enviar.resto', { conf: t('op.inv.confirmacion'), n: numero(pendientes - 40, idioma) }) : t('op.inv.enviar.tope', { conf: t('op.inv.confirmacion') })}
              etiquetaConfirmar={t('op.inv.enviar.si')}
              className={clasesBoton('primary')}
              icono={<Icono icono={Send} />}
            />
          )}
          {conFallo > 0 && (
            <BotonConfirmar
              etiqueta={t('op.inv.reintentar', { n: numero(conFallo, idioma) })} tono="normal"
              nombreConfirmar="modo" valorConfirmar="fallidas"
              titulo={t('op.inv.reintentar.titulo', { n: numero(Math.min(conFallo, 40), idioma) })}
              descripcion={t('op.inv.confirmacion')}
              etiquetaConfirmar={t('op.inv.reintentar.si')}
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
  const { t } = useT('operacion', operacionEs);
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
        etiqueta={reintento ? t('op.inv.uno.reintentar') : t('op.inv.uno.invitar')} tono="normal"
        titulo={t('op.inv.uno.titulo', { nombre })}
        descripcion={t('op.inv.uno.cuerpo', { conf: t('op.inv.confirmacion') })}
        etiquetaConfirmar={t('op.inv.uno.si')}
        className={clasesBoton('ghost', 'sm')}
      />
    </form>
  );
}
