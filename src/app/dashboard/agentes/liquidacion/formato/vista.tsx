import { ArrowLeft, Trash2, Save } from 'lucide-react';

// SOLO tipos: el repo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ConfigFormatoFlota, TelefonosFlota } from '@/lib/likida/liquidacion_externa/repo';
import { ETIQUETA_CAMPO_RENGLON, ETIQUETA_CAMPO_ENCABEZADO } from '@/lib/likida/liquidacion_externa/formato_flota';
import {
  AvisoCompacto, Boton, BotonEnlace, Casilla, CampoSelect, CampoTexto, CampoTextarea, Icono, Tarjeta,
} from '@/app/ui-v2/componentes';
import '../liquidacion.css';
import { VacioAgente } from '../../vacio-agente';
import { FormaSubirMuestra } from './forma-muestra';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { MarcoConfigAgente } from '@/app/dashboard/agentes/marco-config';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesFormato { subirMuestra: Accion; guardarAjustes: Accion; quitar: Accion; guardarTelefonos?: Accion }

/** Los dos grupos de teléfonos (copia al jefe de flota y aviso de discrepancia): los mismos con o sin formato de Excel. */
function CamposTelefonos({ copia, discrepancia, deshabilitado, tr = TR_ES }: { copia: string[]; discrepancia: string[]; deshabilitado: boolean; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <div className="rv-liq-dos">
      <CampoTextarea etiqueta={tx('rest.copia_al_jefe_de_flota_whatsapp')} name="copia" rows={2} defaultValue={copia.join('\n')} placeholder="5512345678" disabled={deshabilitado}
        ayuda={tx('rest.reciben_el_resumen_y_la_liga')} />
      <CampoTextarea etiqueta={tx('rest.aviso_cuando_un_operador_responde_no')} name="discrepancia" rows={2} defaultValue={discrepancia.join('\n')} placeholder="5512345678" disabled={deshabilitado}
        ayuda={tx('rest.la_persona_responsable_de_revisar_discrepancias')} />
    </div>
  );
}

export function VistaFormatoLiquidacion({ sufijo, aviso, error, config, telefonos, puedeAdministrar, acciones, tr = TR_ES }: {
  sufijo: string; aviso: string | null; error: string | null;
  config: ConfigFormatoFlota | null;
  /** Los teléfonos guardados, con o sin formato (0645). Sin él (`undefined`) se toman del formato, si hay. */
  telefonos?: TelefonosFlota | null; puedeAdministrar: boolean; acciones: AccionesFormato; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const f = config?.formato ?? null;
  return (
    <MarcoConfigAgente titulo={tx('rest.formato_de_las_liquidaciones')} apoyo={tx('rest.tu_formato_de_liquidacion_likida_toma')} acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/liquidacion${sufijo}`} icono={<Icono icono={ArrowLeft} />}>{tx('rest.volver_al_agente')}</BotonEnlace>}>
      {aviso && <AvisoCompacto tono="info" resumen={aviso} />}
      {error && <AvisoCompacto tono="error" resumen={error} />}

      <Tarjeta titulo={tx('rest.1_tu_formato')} info="liquidacion_formato.formato">
        <p className="rv-liq-sub">{tx('rest.tu_calculas_la_liquidacion_en_tu')}</p>
        {puedeAdministrar ? (
          <FormaSubirMuestra accion={acciones.subirMuestra} etiqueta={tx('rest.excel_de_muestra_xlsx')} boton={f ? tx('rest.reemplazar_muestra') : tx('rest.subir_muestra')} />
        ) : (
          <p className="rv-liq-sub">{tx('rest.solo_el_dueno_de_la_flota_5')}</p>
        )}
        {/* Sin formato: una línea punteada dentro de la misma tarjeta, no otra tarjeta de 105 px. */}
        {!f && <VacioAgente titulo={tx('rest.sin_formato_todavia')}>{tx('rest.todavia_no_hay_formato_las_liquidaciones')}</VacioAgente>}
      </Tarjeta>

      {!f && acciones.guardarTelefonos && (
        <Tarjeta titulo={tx('rest.2_a_quien_se_le_avisa')} info="liquidacion_formato.avisos">
          <form action={acciones.guardarTelefonos} className="rv-liq-config">
            <CamposTelefonos tr={tr} copia={telefonos?.copia ?? []} discrepancia={telefonos?.discrepancia ?? []} deshabilitado={!puedeAdministrar} />
            {puedeAdministrar && (
              <div className="rv-liq-acciones">
                <Boton type="submit" variante="primary" icono={<Icono icono={Save} />}>{tx('rest.guardar_telefonos')}</Boton>
              </div>
            )}
          </form>
        </Tarjeta>
      )}

      {f && config && (
        <Tarjeta titulo={tx('rest.2_como_se_imprime')} info="liquidacion_formato.impresion">
          <p className="rv-liq-sub">{tx('rest.muestra')}{' '}{config.nombreMuestra ?? '—'}{tx('rest.cada_liquidacion_que_llega_genera_el')}</p>
          <form action={acciones.guardarAjustes} className="rv-liq-config">
            <div className="rv-liq-cuatro">
              <CampoTexto etiqueta={tx('rest.titulo_del_documento')} name="titulo" defaultValue={f.titulo ?? ''} maxLength={120} placeholder={tx('rest.el_nombre_de_tu_flota')} disabled={!puedeAdministrar} />
              <CampoSelect etiqueta={tx('rest.documento_que_viaja_por_whatsapp')} name="salida" defaultValue={f.salida} disabled={!puedeAdministrar}>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel</option>
              </CampoSelect>
              <CampoSelect etiqueta={tx('rest.fechas')} name="fechas" defaultValue={f.fechas} disabled={!puedeAdministrar}>
                <option value="dmy">DD/MM/AAAA</option>
                <option value="iso">AAAA-MM-DD</option>
              </CampoSelect>
              <div className="rv-liq-total">
                <Casilla etiqueta={tx('rest.mostrar_la_fila_de_total')} name="mostrarTotal" defaultChecked={f.total.mostrar} disabled={!puedeAdministrar} />
                <CampoTexto etiqueta={tx('rest.etiqueta_de_la_fila_de_total')} name="etiquetaTotal" defaultValue={f.total.etiqueta} maxLength={80} disabled={!puedeAdministrar} />
              </div>
            </div>

            <div>
              <p className="rv-liq-rotulo">{tx('rest.datos_de_arriba')}</p>
              {f.datos.length === 0 ? (
                <p className="rv-liq-sub">{tx('rest.la_muestra_no_traia_datos_sobre')}</p>
              ) : (
                <div className="rv-liq-cuatro">
                  {f.datos.map((d, i) => (
                    <CampoTexto key={`${d.campo}-${i}`} etiqueta={tx('rest.se_llena_con', { etiquetaCampoEncabezado: ETIQUETA_CAMPO_ENCABEZADO[d.campo] })} name={`dato_${i}`} defaultValue={d.etiqueta} maxLength={80} disabled={!puedeAdministrar} />
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="rv-liq-rotulo">{tx('rest.columnas_de_la_tabla_en_orden')}</p>
              <div className="rv-liq-cuatro">
                {f.columnas.map((c, i) => (
                  <CampoTexto key={`${c.campo}-${i}`} etiqueta={tx('rest.se_llena_con_2', { etiquetaCampoRenglon: ETIQUETA_CAMPO_RENGLON[c.campo] })} name={`col_${i}`} defaultValue={c.encabezado} maxLength={80} disabled={!puedeAdministrar} />
                ))}
              </div>
            </div>

            <CamposTelefonos tr={tr} copia={config.copiaTelefonos} discrepancia={config.discrepanciaTelefonos} deshabilitado={!puedeAdministrar} />

            {puedeAdministrar && (
              <div className="rv-liq-acciones">
                <Boton type="submit" variante="primary" icono={<Icono icono={Save} />}>{tx('rest.guardar_cambios')}</Boton>
                <Boton type="submit" formAction={acciones.quitar} variante="secondary" icono={<Icono icono={Trash2} />}>{tx('rest.quitar_el_formato')}</Boton>
              </div>
            )}
          </form>
        </Tarjeta>
      )}
    </MarcoConfigAgente>
  );
}
