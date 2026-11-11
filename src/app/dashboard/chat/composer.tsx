'use client';

import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import MenuAdjuntar from '../menu-adjuntar';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

/** El tope de una pregunta (el servidor recorta cada turno a 2,000 unidades). */
export const MAX_PREGUNTA = 2000;
const ALTO_MAX_PX = 144;

/** Los tres selectores de archivo del clip (tomar foto / subir imágenes / adjuntar archivos) y su menú. Los tres terminan en el mismo
 *  OCR real; `capture` abre la cámara del teléfono y en escritorio cae al selector. */
export function Adjuntar({ ocupado, onArchivo, anclaRef }: { ocupado: boolean; onArchivo: (f: File, limpiar: () => void) => void; anclaRef: RefObject<HTMLButtonElement | null> }) {
  const { t } = useT('resto', restoEs);
  const [menu, setMenu] = useState(false);
  const camara = useRef<HTMLInputElement>(null);
  const imagen = useRef<HTMLInputElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const input = e.target;
    if (f) onArchivo(f, () => { input.value = ''; });
  };
  return (
    <>
      <MenuAdjuntar abierto={menu} onCerrar={() => setMenu(false)} ancla={anclaRef}
        onCamara={() => camara.current?.click()} onImagen={() => imagen.current?.click()} onArchivo={() => archivo.current?.click()} />
      <input ref={camara} type="file" accept="image/*" capture="environment" className="rv-sr" tabIndex={-1} aria-hidden="true" onChange={alElegir} />
      <input ref={imagen} type="file" accept="image/*" className="rv-sr" tabIndex={-1} aria-hidden="true" onChange={alElegir} />
      <input ref={archivo} type="file" accept="image/*,.pdf,.xlsx,.xls,.csv,.tsv,.ods,.xml,.txt,.json,.md" className="rv-sr" tabIndex={-1} aria-hidden="true" onChange={alElegir} />
      <button ref={anclaRef} type="button" className="rv-btn rv-btn--secondary rv-chat__redondo rv-chat__clip" aria-label={t('op.adjuntar_comprobante')} title={t('op.adjuntar_comprobante')}
        aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} disabled={ocupado}>
        <Paperclip aria-hidden="true" />
      </button>
    </>
  );
}

/** El recuadro de escribir (736 × 58 en escritorio): adjuntar a la izquierda, campo que crece hasta 144 px y enviar a la derecha.
 *  Enter envía, Shift+Enter agrega una línea y Esc detiene la generación en curso; mientras se genera, «enviar» pasa a «Detener». */
export default function Composer({ valor, onCambio, onEnviar, onDetener, generando, ocupado, documento, onQuitarDocumento, onArchivo, adjuntos = true, placeholder, etiquetaFormulario, etiquetaCampo }: {
  valor: string;
  onCambio: (v: string) => void;
  onEnviar: () => void;
  onDetener: () => void;
  generando: boolean;
  ocupado: boolean;
  documento: { nombre: string } | null;
  onQuitarDocumento: () => void;
  onArchivo: (f: File, limpiar: () => void) => void;
  /** Sin adjuntos (modo superadmin) el clip no se pinta y el campo ocupa su lugar. */
  adjuntos?: boolean;
  placeholder?: string;
  etiquetaFormulario?: string;
  etiquetaCampo?: string;
}) {
  const { t } = useT('resto', restoEs);
  const campo = useRef<HTMLTextAreaElement>(null);
  const clip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTO_MAX_PX)}px`;
  }, [valor]);
  const vacio = valor.trim().length === 0;
  const enviar = (e: FormEvent) => { e.preventDefault(); if (!ocupado && !vacio) onEnviar(); };
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!ocupado && !vacio) onEnviar(); }
    else if (e.key === 'Escape' && generando) { e.preventDefault(); onDetener(); }
  };
  return (
    <form className="rv-chat__composer" data-documento={documento ? '' : undefined} data-sin-clip={adjuntos ? undefined : ''} onSubmit={enviar} aria-label={etiquetaFormulario ?? t('ch.preguntar_a_tus_datos')}>
      {documento && (
        <span className="rv-chat__documento">
          <FileText width={13} height={13} strokeWidth={1.75} aria-hidden="true" />
          <span className="rv-chat__documento-nombre">{documento.nombre}</span>
          <button type="button" aria-label={t('op.quitar_archivo')} onClick={onQuitarDocumento}><X width={12} height={12} strokeWidth={2} aria-hidden="true" /></button>
        </span>
      )}
      <label htmlFor="chat-pregunta" className="rv-sr">{etiquetaCampo ?? t('op.pregunta_sobre_tu_operacion_2')}</label>
      <textarea id="chat-pregunta" ref={campo} rows={1} className="bg-transparent border-0" value={valor} maxLength={MAX_PREGUNTA} onChange={(e) => onCambio(e.target.value)} onKeyDown={tecla}
        placeholder={documento ? t('op.pregunta_sobre_o_tu_operacion', { nombre: documento.nombre }) : (placeholder ?? t('op.pregunta_sobre_tu_operacion'))} data-anillo="envolvente" />
      {adjuntos && <Adjuntar ocupado={ocupado} onArchivo={onArchivo} anclaRef={clip} />}
      {valor.length >= Math.floor(MAX_PREGUNTA * 0.8) && <span className="rv-chat__cuenta" aria-live="polite">{valor.length}/{MAX_PREGUNTA}</span>}
      {generando
        ? <button type="button" className="rv-btn rv-btn--primary rv-chat__redondo rv-chat__enviar" aria-label={t('ch.detener_la_generacion')} onClick={onDetener}><Square aria-hidden="true" /></button>
        : <button type="submit" className="rv-btn rv-btn--primary rv-chat__redondo rv-chat__enviar" aria-label={t('op.enviar')} disabled={vacio || ocupado}><ArrowUp aria-hidden="true" /></button>}
    </form>
  );
}
