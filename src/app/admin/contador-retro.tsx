'use client';

import { ConteoKpi } from '../ui-v2/graficas/conteo-kpi';
import './ui/kit.css';

/**
 * Contador de una cifra real (antes tablero Solari) — reutilizable
 * en cualquier página donde haya un total real que valga la pena revelar
 * así: MRR en Inicio, facturas históricas en Agente OCR, flotas dadas de
 * alta en Flotas. "Animado" es honesto: al montar cuenta desde 0 hasta
 * `valor` con la misma hoja plegable — una revelación de un número real,
 * nunca un tic inventado.
 */
export default function ContadorRetro({
  valor, prefijo, etiqueta, tamaño = 'md', sinDato = 'sin medir',
}: {
  /**
   * `null` = NO MEDIBLE (ADM-5, auditoría 24): se pinta "—" y `sinDato`, nunca un cero que nadie midió.
   */
  valor: number | null;
  /** Sin efecto desde R8 (ya no hay dígitos de tablero con ceros a la izquierda); se conserva para no romper llamadores. */
  digitos?: number;
  prefijo?: string;
  etiqueta: string;
  tamaño?: 'md' | 'lg';
  /** El pie cuando `valor` es `null`: por qué no hay cifra. */
  sinDato?: string;
}) {
  // R8 (7-nov-2026): la cifra deja de ser un tablero de dígitos negros y pasa a ser una cifra del sistema (Hanken, tabular, tinta),
  // con el conteo corto de `ConteoKpi` (arranca en el valor real; no pasa por 0; respeta reduced-motion).
  return (
    <div className="kit-contador" data-tam={tamaño}>
      {valor === null ? (
        <>
          <span className="kit-contador__valor" data-vacio>—</span>
          <span className="kit-contador__etq">{etiqueta}</span>
          <span className="kit-contador__nota">{sinDato}</span>
        </>
      ) : (
        <>
          <span className="kit-contador__valor">{prefijo}<ConteoKpi valor={valor} /></span>
          <span className="kit-contador__etq">{etiqueta}</span>
        </>
      )}
    </div>
  );
}
