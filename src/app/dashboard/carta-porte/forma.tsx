'use client';

import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
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
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccp-${viajeId}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="rv-ccp__rejilla">
        <CampoSelect id={campo('federal')} name="pisaFederal" etiqueta={tr('cartaPorte.forma.laRutaPisaCarretera')}
          defaultValue={inicial.pisaFederal === null ? '' : inicial.pisaFederal ? 'si' : 'no'}
          ayuda={tr('cartaPorte.forma.noExigePlenaCerteza')}>
          <option value="">{tr('cartaPorte.forma.sinDeclarar')}</option>
          <option value="si">{tr('cartaPorte.forma.siPisaTramoFederal')}</option>
          <option value="no">{tr('cartaPorte.forma.noPlenaCertezaDe')}</option>
        </CampoSelect>
        <CampoTexto id={campo('radio')} name="radioKm" etiqueta={tr('cartaPorte.forma.radioDelTramoFederal')} inputMode="decimal"
          defaultValue={inicial.radioKm ?? ''} placeholder={tr('cartaPorte.forma.soloSiPisaFederal')}
          ayuda={tr('cartaPorte.forma.esUnRadioEntre')} />
      </div>
      <Aviso estado={estado} />
      <BotonGuardar rotulo={tr('cartaPorte.forma.guardarDeclaracion')} pendiente="Guardando…" />
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
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccpdc-${viajeId}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="rv-ccp__rejilla">
        <CampoTexto id={campo('ocp')} name="origenCp" etiqueta={tr('cartaPorte.forma.cpDeOrigen')} inputMode="numeric" maxLength={5}
          defaultValue={inicial.origenCp ?? ''} placeholder={tr('cartaPorte.forma.5Digitos')} />
        <CampoTexto id={campo('oedo')} name="origenEstado" etiqueta={tr('cartaPorte.forma.estadoDeOrigen')} maxLength={60}
          defaultValue={inicial.origenEstado ?? ''} placeholder={tr('cartaPorte.forma.pEjNuevoLeon')} />
        <CampoSelect id={campo('internac')} name="transpInternac" etiqueta={tr('cartaPorte.forma.transporteInternacional')}
          defaultValue={inicial.transpInternac === null ? '' : inicial.transpInternac ? 'si' : 'no'}>
          <option value="">{tr('cartaPorte.forma.sinDeclarar')}</option>
          <option value="no">{tr('cartaPorte.forma.noNacional')}</option>
          <option value="si">{tr('cartaPorte.forma.siCruzaFrontera')}</option>
        </CampoSelect>
        <CampoTexto id={campo('dcp')} name="destinoCp" etiqueta={tr('cartaPorte.forma.cpDeDestino')} inputMode="numeric" maxLength={5}
          defaultValue={inicial.destinoCp ?? ''} placeholder={tr('cartaPorte.forma.5Digitos')} />
        <CampoTexto id={campo('dedo')} name="destinoEstado" etiqueta={tr('cartaPorte.forma.estadoDeDestino')} maxLength={60}
          defaultValue={inicial.destinoEstado ?? ''} placeholder={tr('cartaPorte.forma.pEjJalisco')} />
        <CampoTexto id={campo('rfc')} name="rfcDestinatario" etiqueta={tr('cartaPorte.forma.rfcDelDestinatario')} maxLength={13}
          defaultValue={inicial.rfcDestinatario ?? ''} placeholder={tr('cartaPorte.forma.1213Caracteres')} />
      </div>
      <p className="rv-ccp__tenue">
        {tr('cartaPorte.forma.elPaisNoSe')}
      </p>
      <Aviso estado={estado} />
      <BotonGuardar rotulo={tr('cartaPorte.forma.guardarDatosDelCliente')} pendiente="Guardando…" />
    </form>
  );
}

/**
 * Un renglón nuevo de mercancía. La clave c_ClaveProdServCP se valida por
 * FORMATO (8 dígitos) y puede quedarse vacía: el catálogo es del SAT y la
 * clave la confirma tu cliente — Likida no propone claves de memoria.
 */
export function FormaMercancia({ accion, viajeId }: { accion: AccionForma; viajeId: string }) {
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccpm-${viajeId}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="rv-ccp__rejilla">
        <CampoTexto id={campo('desc')} name="descripcion" etiqueta={tr('cartaPorte.forma.descripcionDeLaMercancia')} maxLength={500}
          placeholder={tr('cartaPorte.forma.pEjCajasDe')} />
        <CampoTexto id={campo('clave')} name="bienesTransp" etiqueta={tr('cartaPorte.forma.claveSatCClaveprodservcp')} inputMode="numeric" maxLength={8}
          placeholder={tr('cartaPorte.forma.8DigitosLaDa')} />
        <CampoTexto id={campo('cant')} name="cantidad" etiqueta={tr('cartaPorte.forma.cantidad')} inputMode="decimal" placeholder="p. ej. 120" />
        <CampoTexto id={campo('unidad')} name="claveUnidad" etiqueta={tr('cartaPorte.forma.claveDeUnidad')} maxLength={3} placeholder={tr('cartaPorte.forma.kgmH87Xbx')} />
        <CampoTexto id={campo('peso')} name="pesoKg" etiqueta={tr('cartaPorte.forma.pesoEnKgDel')} inputMode="decimal" placeholder="p. ej. 1200" />
        <CampoSelect id={campo('peligroso')} name="materialPeligroso" etiqueta={tr('cartaPorte.forma.materialPeligroso')} defaultValue="">
          <option value="">{tr('cartaPorte.forma.sinDeclarar')}</option>
          <option value="no">{tr('cartaPorte.forma.no')}</option>
          <option value="si">{tr('cartaPorte.forma.si')}</option>
        </CampoSelect>
      </div>
      <p className="rv-ccp__tenue">
        {tr('cartaPorte.forma.laClaveDe8')}
      </p>
      <Aviso estado={estado} />
      <BotonGuardar rotulo={tr('cartaPorte.forma.agregarMercancia')} pendiente="Agregando…" />
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
