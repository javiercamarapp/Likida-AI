import { mxn, numero } from '@/lib/formato';
import { AreaMini } from '../../ui-v2/graficas/area-mini';
import { DonaMini } from '../../ui-v2/graficas/dona-mini';
import type { Visual } from './respuestas';

/**
 * Los bloques de una respuesta: cifra, tabla, dona y serie. Misma data que antes (los números ya vienen calculados del servidor);
 * lo que cambió es el kit: las gráficas son las del sistema v2 (`DonaMini`, `AreaMini`: colores de DATOS, leyenda con la cifra
 * impresa, tabla equivalente para lectores de pantalla) y cada bloque entra con su animación (trazo de línea 380 ms, dona 700 ms).
 * Nada se grafica sin dato real: con la flota en cero la respuesta trae solo su texto honesto.
 */
export default function BloqueRespuesta({ v, indice }: { v: Visual; indice: number }) {
  if (v.tipo === 'cifra') {
    return (
      <section className="card rv-chat__bloque rv-chat__bloque--cifra" data-i={Math.min(indice, 3)} data-tipo="cifra">
        <p className="rv-chat__kpi">{v.valor}</p>
        {v.nota && <p className="rv-chat__nota">{v.nota}</p>}
      </section>
    );
  }
  if (v.tipo === 'dona') {
    const total = v.segmentos.reduce((s, x) => s + x.valor, 0);
    return (
      <section className="card rv-chat__bloque" data-i={Math.min(indice, 3)} data-tipo="dona">
        <DonaMini matiz={1} gajos={v.segmentos} etiqueta="Gráfica de dona de la respuesta" centro={numero(total)} formato={numero} />
      </section>
    );
  }
  if (v.tipo === 'serie') {
    const formato = v.formato === 'mxn' ? mxn : numero;
    return (
      <section className="card rv-chat__bloque" data-i={Math.min(indice, 3)} data-tipo="serie">
        <AreaMini matiz={1} valores={v.puntos.map((p) => p.valor)} etiquetas={v.puntos.map((p) => p.dia)} etiqueta="Serie de la respuesta" formato={formato} />
      </section>
    );
  }
  return (
    // FE-19: la tabla que devuelve el asistente es de ancho DESCONOCIDO (la arma una consulta): scrollea dentro de la tarjeta.
    <section className="card rv-chat__bloque rv-chat__bloque--tabla" data-i={Math.min(indice, 3)} data-tipo="tabla">
      <div className="rv-chat__tabla" tabIndex={0} role="region" aria-label="Tabla de la respuesta">
        <table data-densa>
          <tbody>
            {v.filas.map(([k, val]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td className="num">{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
