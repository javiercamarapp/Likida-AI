import { StatusChip, type TonoEstado } from './status-chip';
import './lista-fuentes.css';

/** Una fuente ya armada para pintar: todo el texto viene resuelto (diccionario `fuentes`), esta pieza no escribe copy. */
export interface FilaFuente {
  id: string;
  nombre: string;
  rotulo: string;
  tono: 'ok' | 'warn' | 'bad' | 'neutral';
  detalle: string;
  /** Línea chica opcional (cadencia esperada, reloj que la lee). */
  nota?: string;
}

const TONO: Record<FilaFuente['tono'], TonoEstado> = { ok: 'ok', warn: 'warn', bad: 'bad', neutral: 'muted' };

/**
 * La pieza ÚNICA de «estado por fuente» (F19): Conexiones del dashboard y la Salud del admin pintan esto. Resumen opcional
 * («n de m al día», «Arranque n de m») calculado por el llamador desde las evaluaciones, nunca escrito a mano.
 */
export function ListaFuentes({ filas, resumen, aviso, etiqueta }: {
  filas: ReadonlyArray<FilaFuente>;
  resumen?: ReadonlyArray<string>;
  /** Banner de la regla de silencio, si suena. */
  aviso?: string | null;
  etiqueta?: string;
}) {
  return (
    <div data-fuentes>
      {aviso ? <p className="rv-fuentes__aviso" role="status">{aviso}</p> : null}
      {resumen && resumen.length > 0 ? (
        <p className="rv-fuentes__resumen">{resumen.map((r) => <span key={r}>{r}</span>)}</p>
      ) : null}
      <ul className="rv-fuentes" aria-label={etiqueta}>
        {filas.map((f) => (
          <li key={f.id} className="rv-fuentes__fila" data-fuente={f.id} data-tono={f.tono}>
            <div className="rv-fuentes__cuerpo">
              <span className="rv-fuentes__nombre">{f.nombre}</span>
              <p className="rv-fuentes__detalle">{f.detalle}</p>
              {f.nota ? <p className="rv-fuentes__nota">{f.nota}</p> : null}
            </div>
            <StatusChip tono={TONO[f.tono]} className="rv-fuentes__estado">{f.rotulo}</StatusChip>
          </li>
        ))}
      </ul>
    </div>
  );
}
