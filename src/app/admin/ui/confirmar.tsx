'use client';

import { useEffect, useId, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// EL DIÁLOGO DE CONFIRMACIÓN — UNO (W2 «producto», 1-oct-2026).
//
// El panel confirmaba lo destructivo de cuatro maneras distintas: botones
// «¿Seguro? Sí / No» en línea (usuarios, llaves, reglas, credenciales, sesiones
// MCP), un `confirm()` del navegador (que bloquea el headless y los modales) o
// nada. Aquí vive el modal, sobre el `<dialog>` NATIVO: `showModal()` da gratis
// el foco atrapado, el fondo inerte, Esc para cancelar y la devolución del foco
// al botón que lo abrió — lo que un div con z-index no da sin 150 líneas.
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
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idDescripcion = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      d.showModal();
      // `autoFocus` de React llama a focus() al montar (con el diálogo cerrado,
      // sin efecto) y no emite el atributo nativo: el foco inicial se pone aquí.
      d.querySelector<HTMLElement>('[data-foco-inicial]')?.focus();
    }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  const peligro = tono === 'peligro';
  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo} aria-describedby={idDescripcion}
      onCancel={(e) => { e.preventDefault(); onCancelar(); }}
      // Clic en el fondo (el propio <dialog>, no su contenido) = cancelar.
      onClick={(e) => { if (e.target === ref.current) onCancelar(); }}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl p-0 backdrop:bg-black/40"
      style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-pop)' }}
    >
      <div className="space-y-2 p-5">
        <h2 id={idTitulo} className="font-display text-[16px] font-semibold">{titulo}</h2>
        <div id={idDescripcion} className="text-[13px]" style={{ color: 'var(--muted)' }}>{descripcion}</div>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <button type="button" onClick={onCancelar} data-foco-inicial={peligro ? '' : undefined}
          className="hairline h-9 rounded-lg px-4 text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]">
          {etiquetaCancelar}
        </button>
        <button type={tipoConfirmar} name={nombreConfirmar} value={valorConfirmar} disabled={pendiente} data-foco-inicial={peligro ? undefined : ''}
          onClick={onConfirmar}
          className="h-9 rounded-lg px-4 text-[13px] font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
          style={peligro
            ? { background: 'var(--badbg)', color: 'var(--bad)', border: '1px solid var(--bad)' }
            : { background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          {pendiente ? 'Un momento…' : etiquetaConfirmar}
        </button>
      </div>
    </dialog>
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
