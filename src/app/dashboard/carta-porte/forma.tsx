'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { AvisoResultado, Boton, CampoSelect, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import './carta-porte.css';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function BotonGuardar({ rotulo, pendiente }: { rotulo: string; pendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />}>
      {pending ? pendiente : rotulo}
    </Boton>
  );
}

/** El aviso del resultado: el UNICO del panel. El error del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

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
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="rv-ccp__rejilla">
        <CampoSelect id={campo('federal')} name="pisaFederal" etiqueta="¿La ruta pisa carretera federal?"
          defaultValue={inicial.pisaFederal === null ? '' : inicial.pisaFederal ? 'si' : 'no'}
          ayuda="«No» exige plena certeza: si por cualquier causa se pisa federal, la obligación revive completa (regla 2.7.7.2.1). La declaración queda registrada con quién la hizo.">
          <option value="">Sin declarar</option>
          <option value="si">Sí, pisa tramo federal</option>
          <option value="no">No — plena certeza de ruta local</option>
        </CampoSelect>
        <CampoTexto id={campo('radio')} name="radioKm" etiqueta="Radio del tramo federal (km)" inputMode="decimal"
          defaultValue={inicial.radioKm ?? ''} placeholder="Solo si pisa federal y la unidad es hasta C2"
          ayuda="Es un RADIO entre origen inicial y destino final (con puntos intermedios), no kilómetros de odómetro. Con unidad hasta C2 y radio ≤ 30 km, el viaje se considera sin tramo federal (regla 2.7.7.2.8)." />
      </div>
      <Aviso estado={estado} />
      <BotonGuardar rotulo="Guardar declaración" pendiente="Guardando…" />
    </form>
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
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="rv-ccp__rejilla">
        <CampoTexto id={campo('ocp')} name="origenCp" etiqueta="CP de origen" inputMode="numeric" maxLength={5}
          defaultValue={inicial.origenCp ?? ''} placeholder="5 dígitos" />
        <CampoTexto id={campo('oedo')} name="origenEstado" etiqueta="Estado de origen" maxLength={60}
          defaultValue={inicial.origenEstado ?? ''} placeholder="p. ej. Nuevo León" />
        <CampoSelect id={campo('internac')} name="transpInternac" etiqueta="¿Transporte internacional?"
          defaultValue={inicial.transpInternac === null ? '' : inicial.transpInternac ? 'si' : 'no'}>
          <option value="">Sin declarar</option>
          <option value="no">No — nacional</option>
          <option value="si">Sí — cruza frontera</option>
        </CampoSelect>
        <CampoTexto id={campo('dcp')} name="destinoCp" etiqueta="CP de destino" inputMode="numeric" maxLength={5}
          defaultValue={inicial.destinoCp ?? ''} placeholder="5 dígitos" />
        <CampoTexto id={campo('dedo')} name="destinoEstado" etiqueta="Estado de destino" maxLength={60}
          defaultValue={inicial.destinoEstado ?? ''} placeholder="p. ej. Jalisco" />
        <CampoTexto id={campo('rfc')} name="rfcDestinatario" etiqueta="RFC del destinatario" maxLength={13}
          defaultValue={inicial.rfcDestinatario ?? ''} placeholder="12-13 caracteres" />
      </div>
      <p className="rv-ccp__tenue">
        El país no se captura: se llena MEX-MEX solo cuando declaras «No — nacional». Un dato que tu
        cliente no ha dado se queda vacío — ante el SAT, sus datos son responsabilidad suya (2.7.7.1.1).
      </p>
      <Aviso estado={estado} />
      <BotonGuardar rotulo="Guardar datos del cliente" pendiente="Guardando…" />
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
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="rv-ccp__rejilla">
        <CampoTexto id={campo('desc')} name="descripcion" etiqueta="Descripción de la mercancía" maxLength={500}
          placeholder="p. ej. Cajas de aguacate hass calibre 48" />
        <CampoTexto id={campo('clave')} name="bienesTransp" etiqueta="Clave SAT (c_ClaveProdServCP)" inputMode="numeric" maxLength={8}
          placeholder="8 dígitos — la da tu cliente" />
        <CampoTexto id={campo('cant')} name="cantidad" etiqueta="Cantidad" inputMode="decimal" placeholder="p. ej. 120" />
        <CampoTexto id={campo('unidad')} name="claveUnidad" etiqueta="Clave de unidad" maxLength={3} placeholder="KGM, H87, XBX…" />
        <CampoTexto id={campo('peso')} name="pesoKg" etiqueta="Peso en kg (del renglón)" inputMode="decimal" placeholder="p. ej. 1200" />
        <CampoSelect id={campo('peligroso')} name="materialPeligroso" etiqueta="¿Material peligroso?" defaultValue="">
          <option value="">Sin declarar</option>
          <option value="no">No</option>
          <option value="si">Sí</option>
        </CampoSelect>
      </div>
      <p className="rv-ccp__tenue">
        La clave de 8 dígitos sale del catálogo c_ClaveProdServCP del SAT y te la confirma tu cliente
        — si no la tienes, deja el campo vacío: el borrador dirá que falta, nunca la inventa. Material
        peligroso sin declarar tampoco se supone «no»: decide quién conoce la carga.
      </p>
      <Aviso estado={estado} />
      <BotonGuardar rotulo="Agregar mercancía" pendiente="Agregando…" />
    </form>
  );
}

function BotonQuitar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="danger-soft" tamano="sm" disabled={pending}>
      {pending ? 'quitando…' : 'quitar'}
    </Boton>
  );
}

/** El tache de un renglón: forma mínima, misma acción firmada del servidor. */
export function BotonBorrarMercancia({ accion, mercanciaId }: { accion: AccionForma; mercanciaId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-ccp__acciones">
      <input type="hidden" name="mercanciaId" value={mercanciaId} />
      <BotonQuitar />
      {estado && !estado.ok && <span className="rv-ccp__falta" role="alert">{estado.error}</span>}
    </form>
  );
}
