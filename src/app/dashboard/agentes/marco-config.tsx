import type { ReactNode } from 'react';
import { MarcoPagina } from '@/app/ui-v2/componentes';
import { BloqueAvisos } from '@/app/ui-v2/esqueletos';

/** Marco de las pantallas de CONFIGURACIÓN de los agentes (esqueleto F26 `EsqueletoConfiguracion`, Rovaq `/setup` y Equipo): cabecera sin
 *  eyebrow → aviso gris de contexto → avisos (≤2) → UNA columna de ≤780 px con las secciones (tarjetas con filas rótulo-control) a 12 px.
 *  Existe porque las formas de estos agentes envuelven VARIAS tarjetas en un solo `<form action>` y `EsqueletoConfiguracion` arma sus
 *  secciones por su cuenta (no deja que un formulario las abarque): reusa sus mismas clases (`rv-esq*`), no una disposición propia.
 *  Pedido compartido: que `EsqueletoConfiguracion` acepte un envoltorio de forma y este marco desaparece. */
export function MarcoConfigAgente({ titulo, apoyo, acciones, contexto, avisos, children }: {
  titulo: string;
  apoyo?: string;
  acciones?: ReactNode;
  /** Aviso gris «Lo que guardes aplica desde …». */
  contexto?: ReactNode;
  avisos?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <MarcoPagina className="rv-esq rv-esq--config" ancho="lectura" titulo={titulo} apoyo={apoyo} acciones={acciones}>
      {contexto}
      <BloqueAvisos>{avisos}</BloqueAvisos>
      <div className="rv-esq__cfg">{children}</div>
    </MarcoPagina>
  );
}
