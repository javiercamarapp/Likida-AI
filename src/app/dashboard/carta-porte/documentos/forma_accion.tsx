'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso as AvisoSistema, Boton, BotonConfirmar, clasesBoton } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
import './documentos.css';

export type ResultadoAccion = { ok: true; mensaje: string; detalles?: string[] } | { ok: false; error: string } | null;
export type AccionDoc = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

/** El resultado de una acción, con el aviso ÚNICO del sistema (icono + texto; el error es `role="alert"`). */
export function Aviso({ estado }: { estado: ResultadoAccion }) {
  if (!estado) return null;
  return estado.ok ? (
    <AvisoSistema tono="ok">
      {estado.mensaje}
      {estado.detalles && estado.detalles.length > 0 && (
        <ul className="rv-doc__detalles">{estado.detalles.map((d) => <li key={d}>{d}</li>)}</ul>
      )}
    </AvisoSistema>
  ) : (
    <AvisoSistema tono="error">{estado.error}</AvisoSistema>
  );
}

/** Una forma con su resultado visible. Los campos van como hijos (los arma el servidor). */
export function FormaAccion({ accion, children, className = 'space-y-3', enctype }: { accion: AccionDoc; children: ReactNode; className?: string; enctype?: 'multipart/form-data' }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className={className} encType={enctype}>
      {children}
      <Aviso estado={estado} />
    </form>
  );
}

/** Un botón de envío; `intencion` viaja como `name="intencion"` para que UNA acción atienda varios botones. */
export function BotonEnvio({ etiqueta, pendiente, intencion, variante = 'primario', icono, confirmar }: {
  etiqueta: string; pendiente?: string; intencion?: string; variante?: 'primario' | 'secundario' | 'peligro'; icono?: ReactNode;
  /** A37-S16-04: para lo irreversible. El botón abre un diálogo con el alcance; el envío (con `intencion`) es el botón del diálogo. */
  confirmar?: { titulo: string; descripcion: ReactNode; etiquetaConfirmar: string };
}) {
  const { t: tr } = useT('dinero', dinero);
  const { pending } = useFormStatus();
  const textoPendiente = pendiente ?? tr('cartaPorte.documentos.forma.procesando');
  const sistema = variante === 'primario' ? 'primary' : variante === 'peligro' ? 'danger' : 'secondary';
  if (confirmar) {
    return (
      <BotonConfirmar
        etiqueta={pending ? textoPendiente : etiqueta} deshabilitado={pending} icono={icono}
        titulo={confirmar.titulo} descripcion={confirmar.descripcion} etiquetaConfirmar={confirmar.etiquetaConfirmar}
        nombreConfirmar={intencion ? 'intencion' : undefined} valorConfirmar={intencion}
        className={clasesBoton(sistema)}
      />
    );
  }
  return (
    <Boton type="submit" name={intencion ? 'intencion' : undefined} value={intencion} variante={sistema} loading={pending} icono={icono}>
      {pending ? textoPendiente : etiqueta}
    </Boton>
  );
}

export const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
