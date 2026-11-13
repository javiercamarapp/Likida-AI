import { cifrasUniformes } from '../formato';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import type { Conector } from '@/lib/likida/conexiones';
import { Tarjeta } from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import './conexiones.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { ConectoresDetalle } from './conectores-detalle';
import { estadoConector } from './estado-conector';
import { ConfigurarSincronizacion } from './configurar';

/**
 * La pantalla de Conexiones (F7): cada renglón es un estado MEDIDO con su
 * fuente en el detalle — nunca un semáforo decorativo. Lo que falta se dice
 * en palabras de persona; las decisiones de negocio (el candado del
 * timbrado) se declaran como decisiones, no como fallas.
 */
export function VistaConexiones({ conectores, estado, credenciales, integraciones, gps, t = T_RESTO_ES }: {
  conectores: Conector[];
  /** La sección «Estado» por fuente de datos (F19, `SeccionEstado`), ya armada en el servidor. Va primero: lo que está atrasado se ve antes que el catálogo. */
  estado?: React.ReactNode;
  /** La sección "Credenciales de tus sistemas", ya armada en el servidor
   *  (`SeccionCredenciales` + acciones). Entra como ReactNode y no como
   *  datos: esta vista no debe importar el motor, que trae `supabaseAdmin`
   *  (mismo patrón que `notificaciones` en el Agente de Proveedores). */
  credenciales?: React.ReactNode;
  /** La sección "Con qué sistemas conecta Likida", que era la pantalla gemela
   *  `/dashboard/integraciones` hasta la fusión de agosto-2026. Mismo criterio
   *  de ReactNode que la de credenciales. */
  integraciones?: React.ReactNode;
  /** La sección «GPS»: salud por integración, push propio, huérfanos y mapeo (W3). */
  gps?: React.ReactNode; t?: TResto;
}) {
  // Conteos por estado MEDIDO del conector (cada uno sale de la lectura; «no se pudo medir» tiene su propia celda, nunca se suma a «sin conectar»).
  const n = (e: Conector['estado']) => conectores.filter((c) => c.estado === e).length;
  const rotulos = estadoConector(t);
  // Tira de 4 (Rovaq): «sin medir» y «en ensayo» comparten celda y la nota dice cuántas son de cada una (la suma sigue cuadrando con «Todas»).
  const sinMedir = n('no_medible'), ensayo = n('ensayo');
  const cifras: PropsCifra[] = [
    { etiqueta: rotulos.listo.rotulo, valor: n('listo') },
    { etiqueta: rotulos.incompleto.rotulo, valor: n('incompleto'), tono: n('incompleto') > 0 ? 'warn' : undefined },
    { etiqueta: rotulos.sin_configurar.rotulo, valor: n('sin_configurar') },
    { etiqueta: t('cfg.sin_medir_o_en_ensayo'), valor: sinMedir + ensayo, tono: sinMedir > 0 ? 'warn' : undefined,
      nota: t('cfg.sin_medir_o_en_ensayo.nota', { sinMedir, ensayo }) },
  ];
  return (
    <EsqueletoTablaMaestra titulo={t('cfg.conexiones')} apoyo={t('cfg.lo_que_tu_flota_tiene_conectado')} cifras={cifrasUniformes(cifras)} selloCifras={selloHoy(t('cfg.estado_de_las_conexiones'))}>
      <div data-tour="conexiones.estado">
        <Tarjeta titulo={t('cfg.estado_de_las_conexiones')}>
          <ConectoresDetalle conectores={conectores} />
        </Tarjeta>
      </div>

      {/* UNA zona «Configurar sincronización» (Rovaq): fuentes, catálogo de sistemas, GPS y credenciales como secciones de un segmentado, no siete tarjetas apiladas. */}
      <ConfigurarSincronizacion secciones={[
        { id: 'estado', nodo: estado }, { id: 'sistemas', nodo: integraciones }, { id: 'gps', nodo: gps }, { id: 'credenciales', nodo: credenciales },
      ]} />
    </EsqueletoTablaMaestra>
  );
}
