'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Save, Trash2 } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, Icono, clasesBoton, useNotificarResultado } from '@/app/ui-v2/componentes';
import './patios.css';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, datos: FormData) => Promise<ResultadoForma>;

function Enviar({ etiqueta, enviando, icono }: { etiqueta: string; enviando: string; icono: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={icono} className="rv-pt__enviar">
      {pending ? enviando : etiqueta}
    </Boton>
  );
}

/** Crear un patio: nombre y ciudad, nada más. */
export function FormaNuevoPatio({ accion }: { accion: AccionForma }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-forma">
      <div className="rv-forma__rejilla">
        <CampoTexto id="patio-nuevo-nombre" name="nombre" etiqueta="Nombre del patio" obligatorio minLength={2} maxLength={80}
          placeholder="Patio Norte" autoComplete="off"
          ayuda="Tal como lo escribirás en las plantillas de carga. «Patio Norte» y «patio norte» son el mismo patio." />
        <CampoTexto id="patio-nuevo-ciudad" name="ciudad" etiqueta="Ciudad (opcional)" maxLength={80} placeholder="Monterrey, N.L." autoComplete="off" />
      </div>
      <AvisoResultado estado={estado} />
      <Enviar etiqueta="Crear patio" enviando="Creando…" icono={<Icono icono={Plus} />} />
    </form>
  );
}

/** Editar un patio y, aparte, borrarlo (con diálogo que dice a cuántos afecta). */
export function FormaEditarPatio({ accionEditar, accionEliminar, patio }: {
  accionEditar: AccionForma;
  accionEliminar: AccionForma;
  patio: { id: string; nombre: string; ciudad: string | null; operadores: number; unidades: number; jefes: number };
}) {
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
          <CampoTexto id={`${id}-nombre`} name="nombre" etiqueta="Nombre" obligatorio minLength={2} maxLength={80} defaultValue={patio.nombre} />
          <CampoTexto id={`${id}-ciudad`} name="ciudad" etiqueta="Ciudad (opcional)" maxLength={80} defaultValue={patio.ciudad ?? ''} />
        </div>
        <AvisoResultado estado={estado} />
        <Enviar etiqueta="Guardar" enviando="Guardando…" icono={<Icono icono={Save} />} />
      </form>

      <form action={borrar}>
        <input type="hidden" name="terminalId" value={patio.id} />
        <BotonConfirmar
          etiqueta="Borrar patio" tono="peligro" icono={<Icono icono={Trash2} />}
          titulo={`Borrar «${patio.nombre}»`}
          descripcion={
            patio.jefes > 0
              ? <>Este patio tiene {patio.jefes} {patio.jefes === 1 ? 'jefe de tráfico asignado' : 'jefes de tráfico asignados'}. Asígnales otro patio (o «toda la flota») antes de borrarlo: si no, pasarían a ver y corregir toda la flota sin que nadie lo decidiera.</>
              : <>Los {patio.operadores} operadores y las {patio.unidades} unidades que tiene quedarán <strong>sin patio</strong>; no se borra ninguno. Los viajes conservan su historial.</>
          }
          etiquetaConfirmar="Sí, borrar el patio"
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
  const [estado, despachar] = useActionState(accion, null);
  useNotificarResultado(estado);
  const id = `jefe-${jefe.userId}`;
  return (
    <form action={despachar} className="rv-forma__fila">
      <input type="hidden" name="userId" value={jefe.userId} />
      <CampoSelect id={id} name="terminalId" etiqueta={jefe.etiqueta} defaultValue={jefe.terminalId} className="rv-pt__selector">
        <option value="">Toda la flota (sin patio)</option>
        {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </CampoSelect>
      <Enviar etiqueta="Asignar" enviando="Guardando…" icono={<Icono icono={Save} />} />
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
  const [estado, despachar] = useActionState(accion, null);
  useNotificarResultado(estado);
  const sustantivo = tabla === 'operador' ? 'operadores' : 'unidades';
  const id = `sinpatio-${tabla}`;
  if (cuantos === 0) return null;
  return (
    <form action={despachar} className="rv-forma__fila">
      <input type="hidden" name="tabla" value={tabla} />
      <CampoSelect id={id} name="terminalId" obligatorio defaultValue="" etiqueta={`${cuantos} ${sustantivo} activos sin patio`} className="rv-pt__selector">
        <option value="" disabled>Elige el patio…</option>
        {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </CampoSelect>
      <BotonConfirmar
        etiqueta="Asignarlos a este patio" tono="normal"
        titulo={`Asignar ${cuantos} ${sustantivo} a un patio`}
        descripcion={<>Los {cuantos} {sustantivo} activos que hoy no tienen patio pasarán al patio que elegiste. Los que ya tienen patio no se tocan.</>}
        etiquetaConfirmar="Sí, asignarlos"
        className={clasesBoton('secondary')}
      />
    </form>
  );
}
