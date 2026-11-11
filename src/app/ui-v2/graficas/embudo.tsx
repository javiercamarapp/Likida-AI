import type { Matiz } from '../metricas';
import { porcentaje } from '@/lib/formato';
import { TablaGrafica } from './partes';

export interface EtapaEmbudo {
  etiqueta: string;
  /** null ⇒ sin dato: la etapa sale con «—» y trama, jamás como cero ni como barra. */
  valor: number | null;
}

/** Embudo (Rovaq): etapas de mayor a menor, cada una con su cifra EXACTA impresa, su parte de la primera etapa medible y la conversión
 *  contra la etapa anterior. Una etapa sin dato no se compara (ni como origen ni como destino): no se inventa una tasa. El ancho es la
 *  parte del mayor; el color es un solo matiz y la cifra siempre va escrita (el color nunca es la única señal). Entra una vez (rv-crece). */
export function Embudo({ etapas, matiz = 8, etiqueta, formato = (v) => String(v) }: {
  etapas: readonly EtapaEmbudo[];
  matiz?: Matiz;
  etiqueta: string;
  formato?: (v: number) => string;
}) {
  const tope = Math.max(0, ...etapas.map((e) => e.valor ?? 0));
  const base = etapas.find((e) => e.valor !== null && e.valor > 0)?.valor ?? null;
  const filas = etapas.map((e, i) => {
    const previo = i > 0 ? etapas[i - 1].valor : null;
    const conversion = e.valor !== null && previo !== null && previo > 0 ? (e.valor / previo) * 100 : null;
    const parte = e.valor !== null && base !== null && base > 0 ? (e.valor / base) * 100 : null;
    return { ...e, conversion, parte };
  });
  if (tope <= 0) {
    return <figure className="rv-gr rv-embudo" data-matiz={matiz} data-vacio aria-label={etiqueta}><p className="rv-embudo__vacio">Sin datos en el periodo</p></figure>;
  }
  return (
    <figure className="rv-gr rv-embudo" data-matiz={matiz} aria-label={etiqueta}>
      <ol className="rv-embudo__lista">
        {filas.map((f, i) => (
          <li key={f.etiqueta} className="rv-embudo__fila">
            <div className="rv-embudo__cab">
              <span className="rv-embudo__etq">{f.etiqueta}</span>
              <span className="rv-embudo__val">{f.valor === null ? '—' : formato(f.valor)}</span>
            </div>
            <div className="rv-embudo__pista" data-desconocido={f.valor === null || undefined}>
              {f.valor !== null ? <span className="rv-embudo__barra" data-r={Math.min(i, 9)} style={{ width: `${Math.min(100, Math.max(0, (f.valor / tope) * 100)).toFixed(2)}%` }} /> : null}
            </div>
            <small className="rv-embudo__nota">
              {f.parte !== null && i > 0 ? `${porcentaje(f.parte, 1)} de «${filas[0].etiqueta}»` : null}
              {f.conversion !== null ? `${f.parte !== null && i > 0 ? ' · ' : ''}${porcentaje(f.conversion, 1)} de la etapa anterior` : null}
              {f.valor === null ? 'sin dato' : null}
            </small>
          </li>
        ))}
      </ol>
      <TablaGrafica titulo={etiqueta} primera="Etapa" encabezados={['Valor', 'De la anterior']}
        filas={filas.map((f) => ({ rotulo: f.etiqueta, celdas: [f.valor === null ? '—' : formato(f.valor), f.conversion === null ? '—' : porcentaje(f.conversion, 1)] }))} />
    </figure>
  );
}
