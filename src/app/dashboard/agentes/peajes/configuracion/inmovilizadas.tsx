import { Upload, Trash2 } from 'lucide-react';
import { numero } from '@/lib/formato';
// SOLO tipos: el módulo de datos importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { InmovilizadaVista } from '@/lib/likida/peajes/datos';
import { Tarjeta, Icono, Boton, CampoArchivo } from '@/app/ui-v2/componentes';
import { ZonaSoltar } from '@/app/dashboard/agentes/zona-soltar';
import '../peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface InmovilizadasConfigVista {
  /** `null` = no se pudo leer. */
  ventanas: InmovilizadaVista[] | null;
  puedeEditar: boolean;
  acciones: { cargarInmovilizadas: Accion; quitarInmovilizada: Accion };
}


const MAX_VISIBLES = 60;
const ROTULO_MOTIVO: Record<string, string> = { taller: 'en taller', siniestro: 'siniestrada', baja: 'de baja' };

/**
 * UNIDADES INMOVILIZADAS: la lista de unidades en taller, siniestradas o de baja con sus fechas. Un cruce de un TAG de una
 * unidad inmovilizada es un candidato crítico (puede ser un TAG usado sin la tarjeta). NADA viene precargado. Las unidades se
 * resuelven contra las de la flota (número económico o placas): una unidad que no existe, o que casa con varias, se rechaza con su fila.
 */
export function SeccionInmovilizadas({ datos, tr = TR_ES }: { datos: InmovilizadasConfigVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { ventanas, puedeEditar, acciones } = datos;
  return (
    <div id="unidades-inmovilizadas">
    <Tarjeta titulo={tx('rest.unidades_inmovilizadas')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{tx('rest.unidades_en_taller_siniestradas_o_de')}</p>
      {ventanas === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_la_lista_3')}</p>
      ) : ventanas.length === 0 ? (
        <p className="text-[12px] mb-2 rv-pj-c-muted">{tx('rest.ninguna_unidad_inmovilizada_declarada_la_regla')}</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          <p className="text-[11px] rv-pj-c-faint">{numero(ventanas.length)}{' '}{tx('rest.ventana_s_declarada_s')}{ventanas.length > MAX_VISIBLES ? tx('rest.se_muestran_las_mas_recientes', { maxVisibles: MAX_VISIBLES }) : ''}.</p>
          {ventanas.slice(0, MAX_VISIBLES).map((v) => (
            <div key={v.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium rv-ag-num">{v.unidadEconomico ?? tx('rest.unidad_sin_numero')}</span>
              <span>{ROTULO_MOTIVO[v.motivo] ?? v.motivo}{' '}{tx('rest.desde_el')}{' '}{v.desde}{v.hasta ? ` hasta el ${v.hasta}` : ' (sigue inmovilizada)'}</span>
              {v.nota && <span className="rv-pj-c-muted">· {v.nota}</span>}
              {puedeEditar && (
                <form action={acciones.quitarInmovilizada} className="ml-auto">
                  <input type="hidden" name="ventana" value={v.id} />
                  <Boton type="submit" aria-label={tx('rest.quitar_la_ventana_de_desde_el', { v: v.unidadEconomico ?? 'la unidad', desde: v.desde })} variante="secondary" tamano="sm">
                    <Icono icono={Trash2} />
                  </Boton>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
      {puedeEditar && (
        <form action={acciones.cargarInmovilizadas} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
          <ZonaSoltar><CampoArchivo etiqueta={tx('rest.archivo_de_unidades_inmovilizadas')} etiquetaOculta name="archivo" accept=".csv,.tsv,.xlsx,.xls" required /></ZonaSoltar>
          <Boton type="submit" variante="primary" tamano="sm"><Icono icono={Upload} />{' '}{tx('rest.cargar_unidades_inmovilizadas')}</Boton>
          <span className="text-[11px] rv-pj-c-faint">{ricoT(tx('rest.csv_o_excel_con_e0_unidad'), { e0: (c) => <span className="rv-ag-num">{c}</span>, e1: (c) => <span className="rv-ag-num">{c}</span>, e2: (c) => <span className="rv-ag-num">{c}</span>, e3: (c) => <span className="rv-ag-num">{c}</span>, e4: (c) => <span className="rv-ag-num">{c}</span> })}</span>
        </form>
      )}
    </Tarjeta>
    </div>
  );
}
