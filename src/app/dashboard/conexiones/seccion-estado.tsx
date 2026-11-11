import { Tarjeta, ListaFuentes } from '@/app/ui-v2/componentes';
import { getT } from '@/lib/i18n/servidor';
import { evaluarFuentes, resumirFuentes, type EntradaFuente } from '@/lib/likida/fuentes/estado';
import type { ResultadoSilencio } from '@/lib/likida/fuentes/silencio';
import { filasDeEvaluaciones } from '@/lib/likida/fuentes/texto';

/**
 * Sección «Estado» de Conexiones (F19): una fila por fuente (TMS, GPS, peajes, correo, WhatsApp, SAT) con su estado de cuatro valores
 * y su cadencia a la vista. Los números del resumen salen de las evaluaciones, no de un contador escrito a mano. Una fuente que no se
 * pudo leer dice «Sin dato»; nunca se pinta como al día. Todo el copy sale del diccionario `fuentes` (es/en).
 */
export async function SeccionEstado({ entradas, silencio, ahoraMs }: {
  entradas: ReadonlyArray<EntradaFuente>;
  silencio: ResultadoSilencio | null;
  ahoraMs: number;
}) {
  const { t } = await getT('fuentes');
  const evals = evaluarFuentes(entradas, ahoraMs);
  const r = resumirFuentes(evals);
  const aviso = silencio?.hayAlerta ? t('conexiones.silencio', { horas: silencio.umbralHoras, viajes: silencio.viajesAbiertos ?? 0 }) : null;
  return (
    <div>
      <Tarjeta titulo={t('conexiones.titulo')}>
        <p className="rv-cx__apoyo">{t('conexiones.apoyo')}</p>
        <ListaFuentes
          etiqueta={t('conexiones.titulo')}
          aviso={aviso}
          resumen={[t('conexiones.resumen', { alDia: r.alDia, total: r.total }), t('conexiones.arranque', { conectadas: r.conectadas, total: r.total })]}
          filas={filasDeEvaluaciones(evals, t)}
        />
      </Tarjeta>
    </div>
  );
}
