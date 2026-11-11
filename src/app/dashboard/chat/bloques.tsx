import { numero } from '@/lib/formato';
import { AreaMini } from '../../ui-v2/graficas/area-mini';
import { DonaMini } from '../../ui-v2/graficas/dona-mini';
import type { Visual } from './respuestas';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

/**
 * Los bloques de una respuesta: cifra, tabla, dona y serie. Misma data que antes (los números ya vienen calculados del servidor);
 * lo que cambió es el kit: las gráficas son las del sistema v2 (`DonaMini`, `AreaMini`: colores de DATOS, leyenda con la cifra
 * impresa, tabla equivalente para lectores de pantalla) y cada bloque entra con su animación (trazo de línea 380 ms, dona 700 ms).
 * Nada se grafica sin dato real: con la flota en cero la respuesta trae solo su texto honesto.
 */
export default function BloqueRespuesta({ v, indice, t = T_RESTO_ES }: { v: Visual; indice: number; t?: TResto }) {
  if (v.tipo === 'cifra') {
    return (
      <section className="rv-tarjeta rv-chat__bloque rv-chat__bloque--cifra" data-i={Math.min(indice, 3)} data-tipo="cifra">
        <p className="rv-chat__kpi">{v.valor}</p>
        {v.nota && <p className="rv-chat__nota">{v.nota}</p>}
      </section>
    );
  }
  if (v.tipo === 'dona') {
    const total = v.segmentos.reduce((s, x) => s + x.valor, 0);
    return (
      <section className="rv-tarjeta rv-chat__bloque" data-i={Math.min(indice, 3)} data-tipo="dona">
        <DonaMini matiz={5} gajos={v.segmentos} etiqueta={t('ch.grafica_de_dona_de_la_respuesta')} centro={numero(total)} formato="numero" />
      </section>
    );
  }
  if (v.tipo === 'serie') {
    return (
      <section className="rv-tarjeta rv-chat__bloque" data-i={Math.min(indice, 3)} data-tipo="serie">
        <AreaMini matiz={5} valores={v.puntos.map((p) => p.valor)} etiquetas={v.puntos.map((p) => p.dia)} etiqueta={t('ch.serie_de_la_respuesta')} formato={v.formato === 'mxn' ? 'mxn' : 'numero'} />
      </section>
    );
  }
  return (
    // FE-19: la tabla que devuelve el asistente es de ancho DESCONOCIDO (la arma una consulta): scrollea dentro de la tarjeta.
    // Son pares «dato — valor» sin encabezados: una lista de definiciones (dl), no una <table> a mano.
    <section className="rv-tarjeta rv-chat__bloque rv-chat__bloque--tabla" data-i={Math.min(indice, 3)} data-tipo="tabla">
      <div className="rv-chat__tabla" tabIndex={0} role="region" aria-label={t('ch.tabla_de_la_respuesta')}>
        <dl className="rv-chat__kv" aria-label={t('op.datos_de_la_respuesta_del_asistente')}>
          {v.filas.map(([k, val]) => (
            <div key={k} className="rv-chat__kv-fila">
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
