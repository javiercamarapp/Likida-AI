import { Map, MapPinOff } from 'lucide-react';
import { numero } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import { MapaVivo, type ViajeEnMapa } from './mapa-vivo';

export interface SinUbicar {
  id: string;
  folio: string;
  operadorNombre: string | null;
  /** Con las palabras exactas de qué faltó — nunca se omite en silencio. */
  motivo: string;
}

/**
 * El marco del mapa (F3): KPIs medidos arriba, el mapa vivo al centro, y la
 * lista honesta de lo que NO se pudo ubicar abajo. La leyenda del trayecto
 * ilustrativo vive junto al mapa, no en un tooltip escondido.
 */
export function VistaMapa({ ubicados, sinUbicar, totalVivos, tope }: {
  ubicados: ViajeEnMapa[];
  sinUbicar: SinUbicar[];
  /** Cuántos viajes EN CURSO tiene la flota (`count exact` en la base, FE-5).
   *  `null` = no se pudo contar, y entonces no se afirma ningún total. */
  totalVivos: number | null;
  /** Cuántos cabe dibujar. Lo que pase de aquí se declara, no se esconde. */
  tope: number;
}) {
  const escalados = ubicados.filter((v) => v.escalado).length;
  const dibujados = ubicados.length + sinUbicar.length;
  const recortado = totalVivos !== null && totalVivos > dibujados;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Map width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Mapa de la operación"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {/* FE-5: este KPI contaba los vivos ENTRE las 100 filas más
                  recientes — ~90 minutos de operación a 50k viajes/mes. Ahora
                  es el conteo real de la flota; lo acotado es el DIBUJO. */}
              <Kpi titulo="Viajes en curso" valor={totalVivos === null ? '—' : numero(totalVivos)}
                nota={totalVivos === null ? 'no se pudo contar' : 'abiertos o en cuadre'} />
              <Kpi titulo="En el mapa" valor={numero(ubicados.length)} />
              <Kpi titulo="Sin ubicar" valor={numero(sinUbicar.length)}
                nota={sinUbicar.length > 0 ? 'listados abajo, no omitidos' : undefined}
                tono={sinUbicar.length > 0 ? 'warn' : undefined} />
              <Kpi titulo="Escalados" valor={numero(escalados)} tono={escalados > 0 ? 'bad' : undefined} />
            </div>
            {/* El tope se declara. Antes decía "los N viajes más recientes"
                mezclando liquidados y vivos; ahora la base ya filtró por
                estatus y lo único que se recorta es cuántos caben dibujados. */}
            <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
              {recortado
                ? `Se dibujan los ${numero(tope)} viajes en curso más recientes de ${numero(totalVivos!)} — el resto está en el registro.`
                : 'Se dibujan todos los viajes en curso de la flota. El trayecto es ilustrativo: es la línea origen→destino, no la posición del camión.'}
            </p>
          </div>

          <MapaVivo viajes={ubicados} />

          {sinUbicar.length > 0 && (
            <section className="card p-4">
              <h2 className="font-display text-[15px] font-semibold mb-1">Sin ubicar en el mapa</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Viajes vivos cuya ciudad no está en la tabla del mapa — existen igual, solo no se dibujan
              </p>
              <div className="space-y-2">
                {sinUbicar.map((v) => (
                  <div key={v.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <MapPinOff width={13} height={13} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--warn)' }} />
                    <span className="font-medium">{v.folio}</span>
                    {v.operadorNombre && <span style={{ color: 'var(--muted)' }}>{v.operadorNombre}</span>}
                    <span className="ml-auto text-right" style={{ color: 'var(--faint)' }}>{v.motivo}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}
