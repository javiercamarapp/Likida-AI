'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Guardando…' : 'Guardar declaración'}
    </button>
  );
}

function Aviso({ estado }: { estado: ResultadoForma }) {
  if (!estado) return null;
  return estado.ok ? (
    <div className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
      {estado.mensaje}
    </div>
  ) : (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.error}
    </div>
  );
}

/**
 * La declaración que decide el complemento, POR VIAJE. Dos campos y los dos
 * pueden quedarse vacíos: un vacío es "no declarado" y el clasificador
 * responde "falta declarar" — nunca decide por ti. La regla exige "plena
 * certeza", y la certeza es de quien conoce la ruta, no del software.
 */
export function FormaDeclaracion({ accion, viajeId, inicial }: {
  accion: AccionForma;
  viajeId: string;
  inicial: { pisaFederal: boolean | null; radioKm: number | null };
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccp-${viajeId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={campo('federal')} className={ETIQUETA}>¿La ruta pisa carretera federal?</label>
          <select id={campo('federal')} name="pisaFederal"
            defaultValue={inicial.pisaFederal === null ? '' : inicial.pisaFederal ? 'si' : 'no'}
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Sin declarar</option>
            <option value="si">Sí, pisa tramo federal</option>
            <option value="no">No — plena certeza de ruta local</option>
          </select>
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            «No» exige plena certeza: si por cualquier causa se pisa federal, la obligación revive
            completa (regla 2.7.7.2.1). La declaración queda registrada con quién la hizo.
          </p>
        </div>
        <div>
          <label htmlFor={campo('radio')} className={ETIQUETA}>Radio del tramo federal (km)</label>
          <input id={campo('radio')} name="radioKm" type="text" inputMode="decimal"
            defaultValue={inicial.radioKm ?? ''} placeholder="Solo si pisa federal y la unidad es hasta C2"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Es un RADIO entre origen inicial y destino final (con puntos intermedios), no kilómetros
            de odómetro. Con unidad hasta C2 y radio ≤ 30 km, el viaje se considera sin tramo federal
            (regla 2.7.7.2.8).
          </p>
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton />
    </form>
  );
}

function BotonTexto({ rotulo, pendiente }: { rotulo: string; pendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />
      {pending ? pendiente : rotulo}
    </button>
  );
}

/**
 * Los datos del CLIENTE que viven una vez por viaje (Fase C, hueco H2): CPs y
 * estados de origen/destino, RFC del destinatario y si el transporte es
 * internacional. Todo puede quedarse vacío — vacío es "el cliente no lo ha
 * dado", y el checklist lo reporta como hueco SUYO (2.7.7.1.1).
 */
export function FormaDatosCliente({ accion, viajeId, inicial }: {
  accion: AccionForma;
  viajeId: string;
  inicial: {
    origenCp: string | null; destinoCp: string | null;
    origenEstado: string | null; destinoEstado: string | null;
    rfcDestinatario: string | null; transpInternac: boolean | null;
  };
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccpdc-${viajeId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={campo('ocp')} className={ETIQUETA}>CP de origen</label>
          <input id={campo('ocp')} name="origenCp" type="text" inputMode="numeric" maxLength={5}
            defaultValue={inicial.origenCp ?? ''} placeholder="5 dígitos"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('oedo')} className={ETIQUETA}>Estado de origen</label>
          <input id={campo('oedo')} name="origenEstado" type="text" maxLength={60}
            defaultValue={inicial.origenEstado ?? ''} placeholder="p. ej. Nuevo León"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('internac')} className={ETIQUETA}>¿Transporte internacional?</label>
          <select id={campo('internac')} name="transpInternac"
            defaultValue={inicial.transpInternac === null ? '' : inicial.transpInternac ? 'si' : 'no'}
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Sin declarar</option>
            <option value="no">No — nacional</option>
            <option value="si">Sí — cruza frontera</option>
          </select>
        </div>
        <div>
          <label htmlFor={campo('dcp')} className={ETIQUETA}>CP de destino</label>
          <input id={campo('dcp')} name="destinoCp" type="text" inputMode="numeric" maxLength={5}
            defaultValue={inicial.destinoCp ?? ''} placeholder="5 dígitos"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('dedo')} className={ETIQUETA}>Estado de destino</label>
          <input id={campo('dedo')} name="destinoEstado" type="text" maxLength={60}
            defaultValue={inicial.destinoEstado ?? ''} placeholder="p. ej. Jalisco"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('rfc')} className={ETIQUETA}>RFC del destinatario</label>
          <input id={campo('rfc')} name="rfcDestinatario" type="text" maxLength={13}
            defaultValue={inicial.rfcDestinatario ?? ''} placeholder="12-13 caracteres"
            className={`${CAMPO} cifra-mono uppercase`} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <p className={AYUDA} style={{ color: 'var(--faint)' }}>
        El país no se captura: se llena MEX-MEX solo cuando declaras «No — nacional». Un dato que tu
        cliente no ha dado se queda vacío — ante el SAT, sus datos son responsabilidad suya (2.7.7.1.1).
      </p>
      <Aviso estado={estado} />
      <BotonTexto rotulo="Guardar datos del cliente" pendiente="Guardando…" />
    </form>
  );
}

/**
 * Un renglón nuevo de mercancía. La clave c_ClaveProdServCP se valida por
 * FORMATO (8 dígitos) y puede quedarse vacía: el catálogo es del SAT y la
 * clave la confirma tu cliente — Likida no propone claves de memoria.
 */
export function FormaMercancia({ accion, viajeId }: { accion: AccionForma; viajeId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccpm-${viajeId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-3">
          <label htmlFor={campo('desc')} className={ETIQUETA}>Descripción de la mercancía</label>
          <input id={campo('desc')} name="descripcion" type="text" maxLength={500}
            placeholder="p. ej. Cajas de aguacate hass calibre 48"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('clave')} className={ETIQUETA}>Clave SAT (c_ClaveProdServCP)</label>
          <input id={campo('clave')} name="bienesTransp" type="text" inputMode="numeric" maxLength={8}
            placeholder="8 dígitos — la da tu cliente"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('cant')} className={ETIQUETA}>Cantidad</label>
          <input id={campo('cant')} name="cantidad" type="text" inputMode="decimal"
            placeholder="p. ej. 120"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('unidad')} className={ETIQUETA}>Clave de unidad</label>
          <input id={campo('unidad')} name="claveUnidad" type="text" maxLength={3}
            placeholder="KGM, H87, XBX…"
            className={`${CAMPO} cifra-mono uppercase`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('peso')} className={ETIQUETA}>Peso en kg (del renglón)</label>
          <input id={campo('peso')} name="pesoKg" type="text" inputMode="decimal"
            placeholder="p. ej. 1200"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('peligroso')} className={ETIQUETA}>¿Material peligroso?</label>
          <select id={campo('peligroso')} name="materialPeligroso" defaultValue=""
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Sin declarar</option>
            <option value="no">No</option>
            <option value="si">Sí</option>
          </select>
        </div>
      </div>
      <p className={AYUDA} style={{ color: 'var(--faint)' }}>
        La clave de 8 dígitos sale del catálogo c_ClaveProdServCP del SAT y te la confirma tu cliente
        — si no la tienes, deja el campo vacío: el borrador dirá que falta, nunca la inventa. Material
        peligroso sin declarar tampoco se supone «no»: decide quién conoce la carga.
      </p>
      <Aviso estado={estado} />
      <BotonTexto rotulo="Agregar mercancía" pendiente="Agregando…" />
    </form>
  );
}

function BotonQuitar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-[11px] underline decoration-dotted hover:opacity-75 disabled:opacity-50"
      style={{ color: 'var(--bad)' }}>
      {pending ? 'quitando…' : 'quitar'}
    </button>
  );
}

/** El tache de un renglón: forma mínima, misma acción firmada del servidor. */
export function BotonBorrarMercancia({ accion, mercanciaId }: { accion: AccionForma; mercanciaId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="inline-flex items-center gap-2">
      <input type="hidden" name="mercanciaId" value={mercanciaId} />
      <BotonQuitar />
      {estado && !estado.ok && <span className="text-[11px]" style={{ color: 'var(--bad)' }}>{estado.error}</span>}
    </form>
  );
}
