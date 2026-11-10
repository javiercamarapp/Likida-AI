'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TabsLinea } from './tabs-linea';
import { cx } from './clases';

/**
 * LA barra de pestañas de contexto (Fase 0, K1): una sola por pantalla, bajo el encabezado, para las pantallas que son rutas
 * hermanas de un mismo grupo del menú. Sustituye a `PestanasAdmin` (barra suelta sobre el contenido).
 *
 * · `PestanasHub`: la barra en sí (presentacional). Menos de 2 pestañas no pinta nada. Con 6 pestañas a 360 px la fila desplaza en
 *   horizontal por dentro (`.rv-tabs` ya trae `overflow-x: auto`) y la página nunca scrollea de lado.
 * · `ProveedorPestanasHub`: lo monta el marco de cada área (admin) con las pestañas de la ruta abierta.
 * · `PestanasDelMarco`: lo pinta `MarcoPagina` bajo el encabezado y avisa al proveedor, para que el respaldo (pantallas todavía no
 *   migradas a `MarcoPagina`) no pinte una segunda barra.
 */
export interface PestanaHub {
  href: string;
  nombre: string;
  /** Número a la derecha; `null`/ausente = sin dato (nunca se pinta un 0 inventado). */
  conteo?: number | null;
  /** El conteo pide acción (solo si de verdad hay algo que atender). */
  atencion?: boolean;
}

export interface ValorPestanasHub {
  etiqueta: string;
  pestanas: readonly PestanaHub[];
  /** `href` de la pestaña de la pantalla abierta. */
  actual: string;
}

export function PestanasHub({ etiqueta, pestanas, actual, className }: ValorPestanasHub & { className?: string }) {
  if (pestanas.length < 2) return null;
  return (
    <TabsLinea
      className={className}
      etiqueta={etiqueta}
      actual={actual}
      pestanas={pestanas.map((p) => ({ clave: p.href, etiqueta: p.nombre, href: p.href, conteo: p.conteo, atencion: p.atencion }))}
    />
  );
}

const Valor = createContext<ValorPestanasHub | null>(null);
const AvisoMarco = createContext<((pinta: boolean) => void) | null>(null);

/** Ofrece las pestañas del contexto a `MarcoPagina` y pinta, como respaldo, la barra en las pantallas sin `MarcoPagina`. */
export function ProveedorPestanasHub({ valor, claseRespaldo, children }: { valor: ValorPestanasHub | null; claseRespaldo?: string; children: ReactNode }) {
  const [enMarco, setEnMarco] = useState(0);
  const avisar = useCallback((pinta: boolean) => setEnMarco((n) => Math.max(0, n + (pinta ? 1 : -1))), []);
  const v = useMemo(() => valor, [valor]);
  return (
    <Valor.Provider value={v}>
      <AvisoMarco.Provider value={avisar}>
        {v && enMarco === 0 ? <PestanasHub {...v} className={cx('rv-pestanas-respaldo', claseRespaldo)} /> : null}
        {children}
      </AvisoMarco.Provider>
    </Valor.Provider>
  );
}

export function usePestanasHub(): ValorPestanasHub | null {
  return useContext(Valor);
}

/** La barra dentro del marco de la pantalla (bajo el encabezado). Sin proveedor o sin pestañas no pinta nada. */
export function PestanasDelMarco() {
  const v = useContext(Valor);
  const avisar = useContext(AvisoMarco);
  const hay = !!v && v.pestanas.length >= 2;
  useEffect(() => {
    if (!hay || !avisar) return undefined;
    avisar(true);
    return () => avisar(false);
  }, [hay, avisar]);
  if (!v || !hay) return null;
  return <PestanasHub {...v} className="rv-marco__pestanas" />;
}
