import { numero } from '@/lib/formato';
import type { EstadoFila, FilaFaltante, ResultadoDatosFaltantes } from '@/lib/likida/peajes/datos_faltantes';
import { AvisoCompacto, StatusChip, TablaBase, Tarjeta } from '@/app/ui-v2/componentes';
import type { TonoEstado } from '@/app/ui-v2/componentes/status-chip';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import './peajes.css';

// ═══════════════════════════════════════════════════════════════════════════
// «Datos que faltan»: qué impide conciliar o reclamar, y por qué. Todo sale de
// `leerDatosFaltantes` (lib/likida/peajes/datos_faltantes.ts): aquí no se calcula
// ni se redacta nada, solo se pinta. Una fila sin medir NUNCA lleva un número:
// dice «aún no medible: falta <fuente>» o «sin datos», y un cero solo aparece
// cuando se midió y no faltó nada (estado «Nada falta»).
// ═══════════════════════════════════════════════════════════════════════════

const TONO: Record<EstadoFila, TonoEstado> = { completo: 'ok', faltan: 'warn', sin_datos: 'muted', no_medible: 'muted' };

export function DatosFaltantes({ datos, tr = TR_ES }: { datos: ResultadoDatosFaltantes | null; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const titulo = tx('peajes.faltantes.titulo');
  const etiquetaEstado: Record<EstadoFila, string> = {
    completo: tx('peajes.faltantes.estado_completo'),
    faltan: tx('peajes.faltantes.estado_faltan'),
    sin_datos: tx('peajes.faltantes.estado_sin_datos'),
    no_medible: tx('peajes.faltantes.estado_no_medible'),
  };
  return (
    <div role="region" aria-label={titulo}>
      <Tarjeta titulo={titulo}>
        {datos === null ? (
          <AvisoCompacto tono="warn" resumen={tx('peajes.faltantes.error')} />
        ) : (
          <>
            <p className="rv-pj-nota">{datos.archivos === 0 ? tx('peajes.faltantes.sub_sin_archivos') : tx('peajes.faltantes.sub', { n: numero(datos.archivos) })}</p>
            <TablaBase<FilaFaltante>
              etiqueta={tx('peajes.faltantes.tabla')}
              filas={datos.filas}
              idFila={(f) => f.id}
              densa
              altoMaximo={false}
              tarjetaMovil
              columnas={[
                {
                  id: 'falta', titulo: tx('peajes.faltantes.col_falta'), principal: true,
                  celda: (f) => (
                    <div>
                      <div>{f.etiqueta}</div>
                      {f.detalle !== null && <div className="rv-pj-nota">{f.detalle}</div>}
                    </div>
                  ),
                },
                { id: 'estado', titulo: tx('peajes.faltantes.col_estado'), celda: (f) => <StatusChip tono={TONO[f.estado]}>{etiquetaEstado[f.estado]}</StatusChip> },
                { id: 'casos', titulo: tx('peajes.faltantes.col_casos'), alinear: 'der', celda: (f) => <span className="rv-ag-num">{f.casos === null ? '—' : numero(f.casos)}</span> },
                { id: 'ejemplo', titulo: tx('peajes.faltantes.col_ejemplo'), celda: (f) => <span className="rv-ag-num rv-pj-nowrap">{f.ejemplo ?? '—'}</span> },
                { id: 'resolver', titulo: tx('peajes.faltantes.col_resolver'), celda: (f) => <QueHaceFalta f={f} tr={tr} /> },
              ]}
            />
          </>
        )}
      </Tarjeta>
    </div>
  );
}

function QueHaceFalta({ f, tr }: { f: FilaFaltante; tr: TrAgentes }) {
  const { t: tx } = tr;
  if (f.estado === 'completo') return <span>—</span>;
  const fuente = f.falta ?? '';
  return (
    <div>
      {f.estado === 'no_medible' && <div className="rv-pj-nota">{tx('peajes.faltantes.falta_fuente', { fuente })}</div>}
      {f.estado === 'sin_datos' && <div className="rv-pj-nota">{tx('peajes.faltantes.sin_fuente', { fuente })}</div>}
      <div>{f.resolver}</div>
    </div>
  );
}
