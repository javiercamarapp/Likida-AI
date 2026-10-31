'use client';

import { useId, useState } from 'react';
import { Boton } from '../../ui-v2/componentes/boton';
import { Modal } from '../../ui-v2/componentes/overlay';

// ═══════════════════════════════════════════════════════════════════════════
// EL DIÁLOGO DE CONFIRMACIÓN — UNO (W2 «producto», 1-oct-2026).
//
// El panel confirmaba lo destructivo de cuatro maneras distintas: botones
// «¿Seguro? Sí / No» en línea (usuarios, llaves, reglas, credenciales, sesiones
// MCP), un `confirm()` del navegador (que bloquea el headless y los modales) o
// nada. Aquí vive el modal, y es el `Modal alerta` del motor ÚNICO de overlays
// (`ui-v2/componentes/overlay.tsx`, L3): foco atrapado, fondo inerte, Esc,
// scroll lock y retorno del foco al botón que lo abrió, con las medidas del
// resto de pop-ups (440, radio 12, pie 12×16). Misma API de siempre.
//
// REGLAS DE USO:
//  · lo irreversible o lo que corta el acceso de una persona (baja de chofer,
//    borrar un patio, revocar una llave) va con `tono="peligro"`: el foco inicial
//    cae en CANCELAR, no en el botón rojo;
//  · el diálogo DICE lo que va a pasar y a cuántos afecta; «¿Estás seguro?» a
//    secas no es una confirmación;
//  · el botón de confirmar es un `type="submit"` DENTRO del formulario: el server
//    action corre con los mismos datos de siempre, sin estado paralelo.
// ═══════════════════════════════════════════════════════════════════════════

export interface PropsDialogo {
  abierto: boolean;
  titulo: string;
  /** Qué va a pasar y a cuántos afecta. */
  descripcion: React.ReactNode;
  etiquetaConfirmar: string;
  etiquetaCancelar?: string;
  tono?: 'peligro' | 'normal';
  /** Con `tipoConfirmar="submit"` el submit ya envía el formulario; aquí solo se
   *  cierra el diálogo (el clic no se cancela: el envío ocurre igual). */
  onConfirmar?: () => void;
  onCancelar: () => void;
  /** `true` mientras el server action corre: se deshabilita confirmar. */
  pendiente?: boolean;
  /** `submit` (dentro de un `<form>`) o `button` con `onConfirmar`. */
  tipoConfirmar?: 'submit' | 'button';
  /** `name`/`value` del botón que confirma: un formulario con DOS salidas (revisar
   *  y confirmar) dice cuál se eligió con `paso=confirmar`. */
  nombreConfirmar?: string;
  valorConfirmar?: string;
}

export function DialogoConfirmar({
  abierto, titulo, descripcion, etiquetaConfirmar, etiquetaCancelar = 'Cancelar',
  tono = 'peligro', onConfirmar, onCancelar, pendiente = false, tipoConfirmar = 'button',
  nombreConfirmar, valorConfirmar,
}: PropsDialogo) {
  const peligro = tono === 'peligro';
  const idTexto = useId();
  // Una confirmación destructiva es una ALERTA (role="alertdialog"); Esc, el clic al fondo y Cancelar cancelan.
  // El foco inicial cae en CANCELAR cuando es peligro, en confirmar si no.
  return (
    <Modal
      alerta={peligro} abierto={abierto} onCerrar={onCancelar} titulo={titulo} describedBy={idTexto}
      pie={(
        <>
          <Boton variante="secondary" tamano="sm" onClick={onCancelar} data-autofocus={peligro ? '' : undefined}>
            {etiquetaCancelar}
          </Boton>
          <Boton variante={peligro ? 'danger-soft' : 'primary'} tamano="sm" type={tipoConfirmar} name={nombreConfirmar} value={valorConfirmar}
            disabled={pendiente} onClick={onConfirmar} data-autofocus={peligro ? undefined : ''}>
            {pendiente ? 'Un momento…' : etiquetaConfirmar}
          </Boton>
        </>
      )}
    >
      <div id={idTexto} className="rv-confirmar__texto">{descripcion}</div>
    </Modal>
  );
}

/**
 * Un botón de un formulario que pide confirmación ANTES de enviarlo. Va DENTRO
 * del `<form action={...}>`: el disparador es `type="button"` (abre el diálogo) y
 * el confirmar del diálogo es el `type="submit"` que envía el formulario.
 */
export function BotonConfirmar({
  etiqueta, titulo, descripcion, etiquetaConfirmar, tono = 'peligro', className, style, icono, deshabilitado = false,
  nombreConfirmar, valorConfirmar,
}: {
  etiqueta: string;
  titulo: string;
  descripcion: React.ReactNode;
  etiquetaConfirmar: string;
  tono?: 'peligro' | 'normal';
  className?: string;
  style?: React.CSSProperties;
  icono?: React.ReactNode;
  deshabilitado?: boolean;
  nombreConfirmar?: string;
  valorConfirmar?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" disabled={deshabilitado} onClick={() => setAbierto(true)} className={className} style={style}>
        {icono}{etiqueta}
      </button>
      <DialogoConfirmar
        abierto={abierto} titulo={titulo} descripcion={descripcion}
        etiquetaConfirmar={etiquetaConfirmar} tono={tono}
        tipoConfirmar="submit" nombreConfirmar={nombreConfirmar} valorConfirmar={valorConfirmar}
        onConfirmar={() => setAbierto(false)} onCancelar={() => setAbierto(false)}
      />
    </>
  );
}
