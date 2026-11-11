import type { ConfigConductor } from '@/lib/likida/conductor/config';
import type { ContactoTrafico } from '@/lib/likida/conductor/escalamiento';
import type { ResultadoPreflight } from '@/lib/likida/conductor/preflight_piloto';
import { PanelPreflight } from './preflight';
import { FormaImportarRutas } from './forma_rutas';
import { PendientesRutas, type FilaPendienteRuta } from './pendientes_rutas';
import { DocumentosCliente } from './documentos_cliente';
import type { DocumentoCliente } from '@/lib/likida/conductor/documentos_cliente';
import type { AccionSitio } from '../sitios/formas';
import { FormaConfigConductor, SeccionVoluntarios, type AccionConfig, type AccionVoluntario, type DatosVoluntarios } from './forma';
import '../conductores.css';
import { AvisoCompacto, BotonEnlace, EstadoError, Tarjeta } from '@/app/ui-v2/componentes';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { MarcoConfigAgente } from '@/app/dashboard/agentes/marco-config';

export function VistaConfigConductor({ sufijo, config, valores, contactos, patios, puedeEditar, accionGuardar, voluntarios, accionAlta, accionBaja, preflight, puedeForzarPreflight, accionImportarRutas, rutasPendientes, totalRutas = 0, diasRevisionRutas = 90, accionRutaRevisada, documentosCliente, clientes, accionAltaDocumento, accionBajaDocumento, tr = TR_ES }: {
  sufijo: string;
  /** `null` = no se pudo leer: se dice, no se enseña un formulario con los defaults como si fueran lo guardado. */
  config: ConfigConductor | null;
  valores: Record<string, string> | null;
  contactos: ContactoTrafico[] | null;
  patios: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  accionGuardar: AccionConfig;
  /** «Operadores del piloto» (0800). `undefined` = la pantalla no la trae; `null` = no se pudo leer. */
  voluntarios?: DatosVoluntarios | null;
  accionAlta?: AccionVoluntario;
  accionBaja?: AccionVoluntario;
  /** T-A5-25: «¿está lista la flota?». `undefined` = la pantalla no la trae (no se pinta); `null` = no se pudo leer. */
  preflight?: ResultadoPreflight | null;
  /** Solo el soporte de Likida (QA): casilla para encender la señal de vida saltando el preflight. */
  puedeForzarPreflight?: boolean;
  /** T-A5-48: importar rutas autorizadas de Google Maps (CSV). `undefined` = no se ofrece (sin permiso de asignar). */
  accionImportarRutas?: AccionSitio;
  /** T-A5-50: rutas sin revisar por antigüedad. `null`/`undefined` = no se pudo leer o no se ofrece: no se pinta la lista. */
  rutasPendientes?: FilaPendienteRuta[] | null;
  totalRutas?: number;
  diasRevisionRutas?: number;
  accionRutaRevisada?: AccionSitio;
  /** T-A5-52: documentos que pide cada cliente. `undefined` = la pantalla no lo trae (sin permiso de asignar); `null` = no se pudo leer. */
  documentosCliente?: DocumentoCliente[] | null;
  /** Clientes activos de la flota (para elegir de cuál es el documento). */
  clientes?: Array<{ id: string; nombre: string }>;
  accionAltaDocumento?: AccionSitio;
  accionBajaDocumento?: AccionSitio; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const legible = config !== null && valores !== null && contactos !== null;
  return (
    <MarcoConfigAgente titulo={tx('conductores.forma.configuracion_del_agente_conductor')} apoyo={tx('rest.cuando_y_cuanto_insiste_el_agente')} acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/conductores${sufijo}`}>{tx('rest.volver_al_tablero')}</BotonEnlace>}>
      <AvisoCompacto tono="info" resumen={tx('rest.lo_que_guardes_aplica_desde_la')} />
      {preflight !== undefined && <PanelPreflight tr={tr} preflight={preflight} sufijo={sufijo} />}
      {legible ? (
        <FormaConfigConductor accion={accionGuardar} config={config} valores={valores} contactos={contactos} patios={patios} puedeEditar={puedeEditar} puedeForzarPreflight={puedeForzarPreflight} />
      ) : (
        <EstadoError compacto>{tx('rest.no_se_pudo_leer_la_configuracion_4')}</EstadoError>
      )}
      {voluntarios === null && (
        <EstadoError compacto>{tx('rest.no_se_pudo_leer_la_lista')}</EstadoError>
      )}
      {voluntarios && accionAlta && accionBaja && (
        <SeccionVoluntarios datos={voluntarios} puedeEditar={puedeEditar} accionAlta={accionAlta} accionBaja={accionBaja}
          parametros={[...new URLSearchParams(sufijo.replace(/^\?/, '')).entries()].filter(([k]) => k !== 'q')} />
      )}
      {accionImportarRutas && (
        <Tarjeta titulo={tx('rest.rutas_autorizadas_de_google_maps')} info="conductores_config.rutas">
          <div className="rv-cd__pila">
            <p className="rv-cd__nota">{tx('rest.la_base_de_rutas_hechas_con')}</p>
            <FormaImportarRutas accion={accionImportarRutas} />
            {rutasPendientes && (
              <div className="rv-cd__pila">
                <p className="rv-cd__rotulo">{tx('rest.rutas_por_revisar')}</p>
                <PendientesRutas pendientes={rutasPendientes} totalRutas={totalRutas} dias={diasRevisionRutas} accionRevisada={accionRutaRevisada} />
              </div>
            )}
          </div>
        </Tarjeta>
      )}
      {documentosCliente !== undefined && (
        <Tarjeta titulo={tx('rest.documentos_que_pide_cada_cliente')} info="conductores_config.documentos_cliente">
          <div className="rv-cd__pila">
            <p className="rv-cd__nota">{tx('rest.cada_cliente_pide_papeles_distintos_al')}</p>
            <DocumentosCliente clientes={clientes ?? []} documentos={documentosCliente} accionAlta={accionAltaDocumento} accionBaja={accionBajaDocumento} />
          </div>
        </Tarjeta>
      )}
    </MarcoConfigAgente>
  );
}
