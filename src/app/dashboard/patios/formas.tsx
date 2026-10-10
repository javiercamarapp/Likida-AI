'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Save, Trash2 } from 'lucide-react';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';
import { useNotificarResultado } from '../../admin/ui/notificaciones';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, datos: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';

function Enviar({ etiqueta, enviando, icono }: { etiqueta: string; enviando: string; icono: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {icono}
      {pending ? enviando : etiqueta}
    </button>
  );
}

/** Crear un patio: nombre y ciudad, nada más. */
export function FormaNuevoPatio({ accion }: { accion: AccionForma }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="patio-nuevo-nombre" className={ETIQUETA}>Nombre del patio</label>
          <input id="patio-nuevo-nombre" name="nombre" type="text" required minLength={2} maxLength={80}
            placeholder="Patio Norte" autoComplete="off" className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--faint)' }}>
            Tal como lo escribirás en las plantillas de carga. «Patio Norte» y «patio norte» son el mismo patio.
          </p>
        </div>
        <div>
          <label htmlFor="patio-nuevo-ciudad" className={ETIQUETA}>Ciudad (opcional)</label>
          <input id="patio-nuevo-ciudad" name="ciudad" type="text" maxLength={80}
            placeholder="Monterrey, N.L." autoComplete="off" className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <AvisoResultado estado={estado} />
      <Enviar etiqueta="Crear patio" enviando="Creando…" icono={<Plus aria-hidden width={14} height={14} strokeWidth={2} />} />
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
    <div className="space-y-3">
      <form action={despachar} className="space-y-3">
        <input type="hidden" name="terminalId" value={patio.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-nombre`} className={ETIQUETA}>Nombre</label>
            <input id={`${id}-nombre`} name="nombre" type="text" required minLength={2} maxLength={80}
              defaultValue={patio.nombre} className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label htmlFor={`${id}-ciudad`} className={ETIQUETA}>Ciudad (opcional)</label>
            <input id={`${id}-ciudad`} name="ciudad" type="text" maxLength={80}
              defaultValue={patio.ciudad ?? ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
        </div>
        <AvisoResultado estado={estado} />
        <Enviar etiqueta="Guardar" enviando="Guardando…" icono={<Save aria-hidden width={14} height={14} strokeWidth={1.75} />} />
      </form>

      <form action={borrar}>
        <input type="hidden" name="terminalId" value={patio.id} />
        <BotonConfirmar
          etiqueta="Borrar patio" tono="peligro" icono={<Trash2 aria-hidden width={13} height={13} strokeWidth={1.75} />}
          titulo={`Borrar «${patio.nombre}»`}
          descripcion={
            patio.jefes > 0
              ? <>Este patio tiene {patio.jefes} {patio.jefes === 1 ? 'jefe de tráfico asignado' : 'jefes de tráfico asignados'}. Asígnales otro patio (o «toda la flota») antes de borrarlo: si no, pasarían a ver y corregir toda la flota sin que nadie lo decidiera.</>
              : <>Los {patio.operadores} operadores y las {patio.unidades} unidades que tiene quedarán <strong>sin patio</strong>; no se borra ninguno. Los viajes conservan su historial.</>
          }
          etiquetaConfirmar="Sí, borrar el patio"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors hover:bg-[var(--badbg)]"
          style={{ color: 'var(--bad)', border: '1px solid var(--line)' }}
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
    <form action={despachar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={jefe.userId} />
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[12.5px] font-medium">{jefe.etiqueta}</label>
        <select id={id} name="terminalId" defaultValue={jefe.terminalId} className={`${CAMPO} mt-1 w-56`} style={{ background: 'var(--surface)' }}>
          <option value="">Toda la flota (sin patio)</option>
          {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <Enviar etiqueta="Asignar" enviando="Guardando…" icono={<Save aria-hidden width={14} height={14} strokeWidth={1.75} />} />
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
    <form action={despachar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tabla" value={tabla} />
      <div>
        <label htmlFor={id} className="block text-[12.5px] font-medium">
          {cuantos} {sustantivo} activos sin patio
        </label>
        <select id={id} name="terminalId" required defaultValue="" className={`${CAMPO} mt-1 w-56`} style={{ background: 'var(--surface)' }}>
          <option value="" disabled>Elige el patio…</option>
          {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <BotonConfirmar
        etiqueta="Asignarlos a este patio" tono="normal"
        titulo={`Asignar ${cuantos} ${sustantivo} a un patio`}
        descripcion={<>Los {cuantos} {sustantivo} activos que hoy no tienen patio pasarán al patio que elegiste. Los que ya tienen patio no se tocan.</>}
        etiquetaConfirmar="Sí, asignarlos"
        className="hairline inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]"
      />
    </form>
  );
}
