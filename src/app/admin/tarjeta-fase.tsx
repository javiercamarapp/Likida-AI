import './tarjeta-fase.css';
import type { ReactNode } from 'react';
import { usd, numero } from '@/lib/formato';
import { Tarjeta } from '@/app/ui-v2/componentes';
import { BarList } from '@/app/ui-v2/graficas';

/**
 * LA FICHA DE UNA FASE DEL PIPELINE DEL VIAJE (OCR, Cuadre, WhatsApp). La comparten los paneles de cada agente y Modelos: una sola
 * forma de decir «qué hace, cuánto costó, con qué modelos». Un cero aquí es MEDIDO (cero filas en `llm_costo` para la fase = cero
 * gasto real); `datos: null` es «sin llamadas registradas», nunca una cifra inventada. El costo por modelo sale de `llm_costo`.
 */
export interface DatosFase { costoUsd: number; n: number }
export interface ModeloFase { modelo: string; n: number; costoUsd: number }

export function TarjetaFase({ titulo, queHace, datos, modelos, acciones, children }: {
  titulo: string;
  queHace: string;
  datos: DatosFase | null | undefined;
  modelos: readonly ModeloFase[];
  acciones?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Tarjeta titulo={titulo} acciones={acciones}>
      <p className="rv-fase__texto">{queHace}</p>
      <p className="rv-fase__linea">
        {datos
          ? <><strong>{usd(datos.costoUsd)}</strong> · {numero(datos.n)} llamadas</>
          : 'Sin llamadas registradas para esta fase todavía.'}
      </p>
      {modelos.length > 0 ? (
        <BarList
          etiqueta={`Costo por modelo, ${titulo}`}
          items={modelos.map((m) => ({ clave: m.modelo, etiqueta: m.modelo, valor: m.costoUsd, texto: `${usd(m.costoUsd)} · ${numero(m.n)} llamadas` }))}
        />
      ) : datos ? (
        <p className="rv-fase__linea">El desglose por modelo de esta fase no se puede aislar con los datos de hoy.</p>
      ) : null}
      {children}
    </Tarjeta>
  );
}
