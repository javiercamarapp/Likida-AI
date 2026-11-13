'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Save, Trash2 } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, Icono, clasesBoton, useNotificarResultado } from '@/app/ui-v2/componentes';
import './patios.css';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, datos: FormData) => Promise<ResultadoForma>;

function Enviar({ etiqueta, enviando, icono, variante = 'primary' }: { etiqueta: string; enviando: string; icono: React.ReactNode; variante?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante={variante} tamano={variante === 'secondary' ? 'sm' : undefined} loading={pending} icono={icono} className="rv-pt__enviar">
      {pending ? enviando : etiqueta}
    </Boton>
  );
}

/** Crear un patio: nombre y ciudad, nada más. */
export function FormaNuevoPatio({ accion }: { accion: AccionForma }) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-forma">
      <div className="rv-forma__rejilla">
        <CampoTexto id="patio-nuevo-nombre" name="nombre" etiqueta={t('patios.f.nombre')} obligatorio minLength={2} maxLength={80}
          placeholder={t('patios.f.nombre.ph')} autoComplete="off"
          ayuda={t('patios.f.nombre.ayuda')} />
        <CampoTexto id="patio-nuevo-ciudad" name="ciudad" etiqueta={t('patios.f.ciudad')} maxLength={80} placeholder={t('patios.f.ciudad.ph')} autoComplete="off" />
      </div>
      <AvisoResultado estado={estado} />
      <div className="rv-pt__pie"><Enviar etiqueta={t('patios.f.crear')} enviando={t('patios.f.creando')} icono={<Icono icono={Plus} />} /></div>
    </form>
  );
}

/** Editar un patio y, aparte, borrarlo (con diálogo que dice a cuántos afecta). */
export function FormaEditarPatio({ accionEditar, accionEliminar, patio }: {
  accionEditar: AccionForma;
  accionEliminar: AccionForma;
  patio: { id: string; nombre: string; ciudad: string | null; operadores: number; unidades: number; jefes: number };
}) {
  const { t, tp } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accionEditar, null);
  const [estadoBorrar, borrar] = useActionState(accionEliminar, null);
  // El borrado es una acción de fila: su resultado va a un toast (el error no se va solo).
  useNotificarResultado(estadoBorrar);
  const id = `patio-${patio.id}`;
  return (
    <div className="rv-pt__editor">
      <form action={despachar} className="rv-forma">
        <input type="hidden" name="terminalId" value={patio.id} />
        <div className="rv-forma__rejilla">
          <CampoTexto id={`${id}-nombre`} name="nombre" etiqueta={t('patios.f.nombre.corto')} obligatorio minLength={2} maxLength={80} defaultValue={patio.nombre} />
          <CampoTexto id={`${id}-ciudad`} name="ciudad" etiqueta={t('patios.f.ciudad')} maxLength={80} defaultValue={patio.ciudad ?? ''} />
        </div>
        <AvisoResultado estado={estado} />
        <Enviar etiqueta={t('patios.f.guardar')} enviando={t('patios.f.guardando')} icono={<Icono icono={Save} />} />
      </form>

      <form action={borrar}>
        <input type="hidden" name="terminalId" value={patio.id} />
        <BotonConfirmar
          etiqueta={t('patios.f.borrar')} tono="peligro" icono={<Icono icono={Trash2} />}
          titulo={t('patios.f.borrar.titulo', { nombre: patio.nombre })}
          descripcion={
            patio.jefes > 0
              ? tp('patios.f.borrar.conjefes', patio.jefes)
              : t('patios.f.borrar.sinjefes', { operadores: patio.operadores, unidades: patio.unidades })
          }
          etiquetaConfirmar={t('patios.f.borrar.si')}
          className={clasesBoton('danger')}
        />
      </form>
    </div>
  );
}

/** Asignar un jefe de tráfico a un patio (o a «toda la flota»). */
export function FormaJefe({ accion, jefe, patios }: {
  accion: AccionForma;
  jefe: { userId: string; etiqueta: string; terminalId: string };
  patios: Array<{ id: string; nombre: string }>;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  useNotificarResultado(estado);
  const id = `jefe-${jefe.userId}`;
  return (
    <form action={despachar} className="rv-forma__fila">
      <input type="hidden" name="userId" value={jefe.userId} />
      <CampoSelect id={id} name="terminalId" etiqueta={jefe.etiqueta} defaultValue={jefe.terminalId} className="rv-pt__selector">
        <option value="">{t('patios.f.toda')}</option>
        {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </CampoSelect>
      <Enviar variante="secondary" etiqueta={t('patios.f.asignar.corto')} enviando={t('patios.f.guardando')} icono={<Icono icono={Save} />} />
    </form>
  );
}

/** «Poner en este patio a todos los que no tienen patio» — con diálogo y conteo. */
export function FormaSinPatio({ accion, tabla, cuantos, patios }: {
  accion: AccionForma;
  tabla: 'operador' | 'unidad';
  cuantos: number;
  patios: Array<{ id: string; nombre: string }>;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  useNotificarResultado(estado);
  const id = `sinpatio-${tabla}`;
  if (cuantos === 0) return null;
  return (
    <form action={despachar} className="rv-forma__fila">
      <input type="hidden" name="tabla" value={tabla} />
      <CampoSelect id={id} name="terminalId" obligatorio defaultValue="" etiqueta={t(`patios.f.sinpatio.${tabla}`, { n: cuantos })} className="rv-pt__selector">
        <option value="" disabled>{t('patios.f.elige')}</option>
        {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </CampoSelect>
      <BotonConfirmar
        etiqueta={t('patios.f.asignar')} tono="normal"
        titulo={t(`patios.f.asignar.titulo.${tabla}`, { n: cuantos })}
        descripcion={t(`patios.f.asignar.cuerpo.${tabla}`, { n: cuantos })}
        etiquetaConfirmar={t('patios.f.asignar.si')}
        className={clasesBoton('secondary')}
      />
    </form>
  );
}
