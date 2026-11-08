import { FileSpreadsheet, Plug } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { INTEGRACIONES, type IdIntegracion } from './marca-integracion.data';
import { cx } from './clases';

// ═══════════════════════════════════════════════════════════════════════════
// MARCAS DE INTEGRACIÓN (R8, estilo Rovaq `BrandMark`): logo de 16 px de la empresa o software de donde vienen los datos, a color de
// marca. Pieza PURA (sin estado ni 'use client'): sirve en servidor y en cliente. Los trazados viven en `marca-integracion.data.ts`
// (simple-icons, CC0); aquí no hay colores de marca. Un logo sin trazado verificable usa un icono genérico de lucide, nunca uno inventado.
// ═══════════════════════════════════════════════════════════════════════════

export type { IdIntegracion } from './marca-integracion.data';
/** Ids disponibles, en orden de definición. */
export const IDS_INTEGRACION = Object.keys(INTEGRACIONES) as IdIntegracion[];
/** ¿Hay marca (o icono genérico propio) para este id? */
export const esIntegracionConocida = (id: string): id is IdIntegracion => Object.prototype.hasOwnProperty.call(INTEGRACIONES, id);

/**
 * Logo de una integración: HubSpot, Zendesk, WhatsApp, Microsoft, Outlook, Excel, CSV, SAP, Google, Gmail o Resend.
 *
 * - `id`: clave del logo. Si no se conoce, pinta el icono genérico `Plug` (no inventa una marca).
 * - `tam`: lado en px (16 por omisión; viewBox 24).
 * - Accesibilidad: sin `etiqueta` es DECORATIVO (`aria-hidden`), para cuando el nombre va escrito al lado. Con `etiqueta` es `role="img"` con ese nombre.
 * - En tema oscuro, las marcas cuyo color no contrasta 3:1 con la superficie (Zendesk, Resend, Microsoft) pasan a la tinta del tema.
 */
export function MarcaIntegracion({ id, tam = 16, etiqueta, className }: { id: IdIntegracion | (string & {}); tam?: number; etiqueta?: string; className?: string }) {
  const def = esIntegracionConocida(id) ? INTEGRACIONES[id] : null;
  const acc = etiqueta ? { role: 'img' as const, 'aria-label': etiqueta } : { 'aria-hidden': true as const };
  if (def?.tipo === 'logo') {
    return (
      <svg
        className={cx('rv-marcaint', className)} data-marca={id} data-mono-oscuro={def.monoEnOscuro || undefined}
        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={tam} height={tam} focusable="false" {...acc}
      >
        <path fill={def.color} d={def.path} />
      </svg>
    );
  }
  const Generico = def?.icono === 'archivo' ? FileSpreadsheet : Plug;
  return <Generico className={cx('rv-marcaint', 'rv-marcaint--generico', className)} data-marca={def ? id : 'desconocida'} width={tam} height={tam} strokeWidth={1.75} focusable="false" {...acc} />;
}

type PropsChip = {
  /** Logo a la izquierda. Sin él, el chip es solo texto. */
  marca?: IdIntegracion | (string & {});
  /** Texto del chip (su nombre accesible; el logo es decorativo). */
  children: ReactNode;
  /** Estado activo (filtro puesto): fondo, texto y anillo con el azul de Rovaq (`--seg-activo-*`). Con `onClick` se expone como `aria-pressed`. */
  activo?: boolean;
  className?: string;
};

/**
 * Chip de fuente: píldora de 28 px (padding 0×10, radio 999, 12/500, borde 1 px, aire 6) con el logo de la integración y su nombre.
 * Sin `onClick` es un `<span>` informativo; con `onClick` es un `<button>` (alterna un filtro). OJO: `onClick` es una función, así que un
 * chip con `onClick` solo puede usarse desde un componente de CLIENTE; un componente de servidor no puede pasar funciones (caída de
 * producción del 7-nov, guarda `graficas/formato_frontera_guarda.test.ts`). Para un chip informativo no hace falta nada de eso.
 */
export function ChipFuente({ marca, children, activo, className, onClick, ...resto }: PropsChip & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  const interior = <>{marca ? <MarcaIntegracion id={marca} /> : null}<span className="rv-chipfuente__txt">{children}</span></>;
  const clases = cx('rv-chipfuente', className);
  if (!onClick) return <span className={clases} data-activo={activo || undefined}>{interior}</span>;
  return <button type="button" {...resto} className={clases} data-activo={activo || undefined} aria-pressed={activo ?? false} onClick={onClick}>{interior}</button>;
}
