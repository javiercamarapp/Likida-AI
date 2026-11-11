import type { ReglasFlota } from '@/lib/likida/peajes/reglas_cobro_config';
import { Tarjeta, Boton } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface ClasesCobroVista {
  /** `null` = no se pudo leer. */
  reglas: ReglasFlota | null;
  puedeEditar: boolean;
  acciones: { guardarReglasFlota: Accion };
}


/**
 * CLASES DEL COBRO POR FLOTA: (1) qué clases son normales para una unidad UTILITARIO (camioneta) y (2) qué se hace con la clase 1.
 * Defaults seguros: sin clases de utilitario declaradas NO se les evalúa la clase (no se inventa una tarifa de coche); la clase 1 se toma
 * como tarifa por pasada en todas las casetas (lo que indicó el cliente), para no llenar el reporte de falsos candidatos.
 */
export function SeccionClasesCobro({ datos, tr = TR_ES }: { datos: ClasesCobroVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { reglas, puedeEditar, acciones } = datos;
  return (
    <div id="clases-cobro">
    <Tarjeta titulo={tx('rest.clases_del_cobro_utilitarios_y_clase')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.la_revision_espera_clase_3_y'), { b: (c) => <b>{c}</b> })}</p>
      {reglas === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_esta_configuracion')}</p>
      ) : !puedeEditar ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.utilitarios_y_clase_1', { utilitarios: reglas.clasesUtilitario.length > 0 ? tx('rest.clases_lista', { lista: reglas.clasesUtilitario.join(', ') }) : tx('rest.sin_clases_declaradas_no_se_les'), clase1: reglas.clase1 === 'todas' ? tx('rest.tarifa_por_pasada_en_todas_las') : tx('rest.solo_normal_en_las_casetas_declaradas') })}
        </p>
      ) : (
        <form action={acciones.guardarReglasFlota} className="space-y-3">
          <label className="block">{ricoT(tx('rest.e0_clases_validas_del_utilitario_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input name="clases_utilitario" defaultValue={reglas.clasesUtilitario.join(', ')} maxLength={60} placeholder={tx('rest.vacio_no_se_evalua')}
              aria-label={tx('rest.clases_de_cobro_validas_para_unidades')}
              className="w-[220px] mt-0.5 rv-ctl" />
            <span className="block text-[11px] mt-1 rv-pj-c-faint">{ricoT(tx('rest.por_ejemplo_e0_1_2_e0'), { e0: (c) => <span className="rv-ag-num">{c}</span> })}</span>
          </label>
          <fieldset className="space-y-1.5">
            <legend className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{tx('rest.clase_1_2')}</legend>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="radio" name="clase_uno" value="todas" defaultChecked={reglas.clase1 === 'todas'} className="mt-0.5" />
              <span>{ricoT(tx('rest.e0_tarifa_por_pasada_en_todas'), { e0: (c) => <span className="font-medium">{c}</span> })}</span>
            </label>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="radio" name="clase_uno" value="declaradas" defaultChecked={reglas.clase1 === 'declaradas'} className="mt-0.5" />
              <span>{ricoT(tx('rest.e0_solo_en_las_casetas_declaradas'), { e0: (c) => <span className="font-medium">{c}</span> })}</span>
            </label>
          </fieldset>
          <Boton type="submit" variante="primary" tamano="sm">{tx('rest.guardar_clases')}</Boton>
        </form>
      )}
    </Tarjeta>
    </div>
  );
}
