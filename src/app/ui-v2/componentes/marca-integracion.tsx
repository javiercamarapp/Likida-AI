import { FileSpreadsheet, Plug } from 'lucide-react';
import { INTEGRACIONES, type IdIntegracion } from './marca-integracion.data';
import { cx } from './clases';

// ═══════════════════════════════════════════════════════════════════════════
// MARCAS DE INTEGRACIÓN (R8, estilo Rovaq `BrandMark`): logo de 16 px de la empresa o software de donde vienen los datos, a color de
// marca. Pieza PURA (sin estado ni 'use client'): sirve en servidor y en cliente. Los trazados viven en `marca-integracion.data.ts`
// (simple-icons, CC0); aquí no hay colores de marca. Un logo sin trazado verificable usa un icono genérico de lucide, nunca uno inventado.
// ═══════════════════════════════════════════════════════════════════════════

/** Id de marca del contrato compartido. `generico` = icono genérico (sin marca). Los ids son los del `.data.ts` más `generico`. */
export type MarcaId = 'hubspot' | 'zendesk' | 'whatsapp' | 'microsoft' | 'outlook' | 'excel' | 'csv' | 'sap' | 'google' | 'gmail' | 'resend' | 'supabase' | 'sentry' | 'vercel' | 'meta' | 'generico';
/** Ids con marca (o icono genérico propio) en el `.data.ts`; `generico` no está ahí a propósito. */
export const IDS_INTEGRACION = Object.keys(INTEGRACIONES) as IdIntegracion[];
/** ¿Hay marca (o icono genérico propio) para este id? */
export const esIntegracionConocida = (id: string): id is IdIntegracion => Object.prototype.hasOwnProperty.call(INTEGRACIONES, id);

/**
 * Logo de una integración: HubSpot, Zendesk, WhatsApp, Microsoft, Outlook, Excel, CSV, SAP, Google, Gmail, Resend, Sentry, Vercel o Meta (`MarcaId`).
 *
 * - `id`: clave del logo. `'generico'` (o cualquier id sin marca) pinta el icono genérico `Plug`; nunca inventa una marca.
 * - `tam`: lado en px (16 por omisión; viewBox 24).
 * - Siempre DECORATIVO (`aria-hidden`): el nombre va escrito al lado (`ChipFuente`, tabla, etc.).
 * - En tema oscuro, las marcas cuyo color no contrasta 3:1 con la superficie (Zendesk, Resend, Microsoft, Sentry, Vercel) pasan a la tinta del tema.
 * - Sin props de función: sirve igual desde un componente de servidor.
 */
export function MarcaIntegracion({ id, tam = 16, className }: { id: MarcaId; tam?: number; className?: string }) {
  const def = esIntegracionConocida(id) ? INTEGRACIONES[id] : null;
  if (def?.tipo === 'logo') {
    return (
      <svg
        className={cx('rv-marcaint', className)} data-marca={id} data-mono-oscuro={def.monoEnOscuro || undefined} aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={tam} height={tam} focusable="false"
      >
        <path fill={def.color} d={def.path} />
      </svg>
    );
  }
  const Generico = def?.icono === 'archivo' ? FileSpreadsheet : Plug;
  return <Generico className={cx('rv-marcaint', 'rv-marcaint--generico', className)} data-marca={def ? id : 'generico'} width={tam} height={tam} strokeWidth={1.75} focusable="false" aria-hidden="true" />;
}

/**
 * Chip de fuente: PÍLDORA TIPO CASILLA de 28 px (padding 0×10, radio 999, 12/500, borde 1 px, aire 6) con el logo de la integración y su nombre.
 * Renderiza `<label>` + `<input type="checkbox">`: dentro de un `<form method="get">` filtra SIN JavaScript y sin props de función
 * (el navegador manda `name=value` de los marcados). `activo` es el estado inicial (`defaultChecked`); marcado = azul de Rovaq (`--seg-activo-*`).
 * El input queda oculto a la vista pero enfocable por teclado; el foco se dibuja en la píldora.
 */
export function ChipFuente({ id, etiqueta, activo = false, deshabilitado = false, name, value, className }: {
  id: MarcaId; etiqueta: string; activo?: boolean; deshabilitado?: boolean; name?: string; value?: string; className?: string;
}) {
  return (
    <label className={cx('rv-chipfuente', className)} data-deshabilitado={deshabilitado || undefined}>
      <input type="checkbox" className="rv-chipfuente__in" name={name} value={value} defaultChecked={activo} disabled={deshabilitado} />
      <MarcaIntegracion id={id} />
      <span className="rv-chipfuente__txt">{etiqueta}</span>
    </label>
  );
}
