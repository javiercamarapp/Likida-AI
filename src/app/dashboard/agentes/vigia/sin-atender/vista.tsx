import { fechaHoraMx, numero } from '@/lib/formato';
import type { ResultadoSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import type { DestinatarioResumen } from '@/lib/likida/vigia/sin_atender_aviso/destinatarios';
import '../vigia.css';
import { Aviso, BotonEnlace, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import type { ConfigGuardadaSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import { FormaRevision, type AccionEnviar, type AccionRevisar } from './formas';
import { FormaConfiguracion, type AccionGuardarConfig } from './configuracion';
import { CajonConfiguracionSinAtender } from './cajon-config';
import { textoHorario } from './texto_horario';
import { TablaSinAtender, duracion } from './tabla';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

function Seccion({ titulo, info, children }: { id?: string; titulo: string; info: InfoClave; children: React.ReactNode }) {
  return (
    <Tarjeta titulo={titulo} info={info}>
      <div className="rv-vg__pila">{children}</div>
    </Tarjeta>
  );
}

const origenTr = (tx: TAgentes = TR_ES.t) => ({ servicio: tx('vigia.vista.servicio_al_cliente'), nivel1: 'Nivel 1', nivel2: tx('rest.nivel_2_solo_si_hay_una') } as const);

export function VistaSinAtender({ sufijo, error, resultado, gruposRevisados, gruposOmitidos, destinatarios, correoEncendido, puedeEnviar, flota, guardada, configLeida, acciones, tr = TR_ES }: {
  sufijo: string;
  /** Si no se pudo leer, el motivo en palabras llanas: no se enseña un vacío que parezca «todo atendido». */
  error: string | null;
  resultado: ResultadoSinAtender | null;
  gruposRevisados: number;
  gruposOmitidos: number;
  destinatarios: readonly DestinatarioResumen[];
  correoEncendido: boolean;
  puedeEnviar: boolean;
  flota?: string;
  /** Lo que la flota dejó guardado (todo apagado si no hay nada). */
  guardada: ConfigGuardadaSinAtender;
  /** false = no se pudo leer lo guardado. */
  configLeida: boolean;
  acciones: { revisar: AccionRevisar; enviar: AccionEnviar; guardar: AccionGuardarConfig }; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const r = resultado?.resumen;
  const horario = textoHorario(guardada.horarioAtencion);
  return (
    <EsqueletoTablaMaestra
      titulo={tx('rest.conversaciones_sin_atender')}
      apoyo={tx('rest.vigia_por_exportacion_de_chats_sin')}
      acciones={(
        <>
          {puedeEnviar && error === null && (
            <CajonConfiguracionSinAtender disparador={tx('f26d8.sin_atender.configuracion')} titulo={tx('rest.configuracion_de_tu_flota')}>
              <FormaConfiguracion guardar={acciones.guardar} flota={flota} guardada={guardada} configLeida={configLeida} />
            </CajonConfiguracionSinAtender>
          )}
          <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/agentes/vigia${sufijo}`}>{tx('rest.volver_al_tablero')}</BotonEnlace>
        </>
      )}
      avisos={(
        <>
          <Aviso tono="info">{ricoT(tx('rest.esta_lista_sale_de_los_chats'), { e0: (c) => <a className="rv-vg__enlace" href={`/dashboard/agentes/vigia/historial${sufijo}`}>{c}</a> })}</Aviso>
          {error !== null ? <Aviso tono="error">{error}</Aviso> : null}
        </>
      )}
      // Tira de cifras (Rovaq «Acciones»): solo con lectura real; sin ella no se pinta ninguna (nunca un cero que parezca «todo atendido»).
      cifras={error === null && r ? [
        { etiqueta: tx('rest.sin_atender'), valor: numero(r.alertas), tono: r.alertas > 0 ? 'warn' : undefined },
        { etiqueta: tx('f26d.sin_atender.prioridad_alta'), valor: numero(r.altas), tono: r.altas > 0 ? 'bad' : undefined },
        { etiqueta: tx('f26d.sin_atender.mas_antigua'), valor: r.masAntiguaMin !== null ? duracion(r.masAntiguaMin) : null },
        { etiqueta: tx('f26d.sin_atender.grupos_revisados'), valor: numero(gruposRevisados), nota: gruposOmitidos > 0 ? tx('rest.quedaron_fuera_grupos_por_el_tope', { numero: numero(gruposOmitidos) }) : undefined },
      ] : undefined}
      etiquetaCifras={tx('rest.sin_atender')}
    >
      <span className="rv-ag-sin-filete-marca" hidden aria-hidden="true" />
      {error === null && (
        <>
          <Seccion id="sin-atender-lista" titulo={tx('rest.sin_atender')} info="vigia_sin_atender.lista">
            {r && (
              <p className="rv-vg__nota">{tx('rest.grupos_revisados_conversaciones_sin_atender_de', { numero: numero(gruposRevisados), numero2: numero(r.alertas), numero3: numero(r.altas) })}{r.masAntiguaMin !== null ? tx('rest.la_mas_antigua_lleva', { duracion: duracion(r.masAntiguaMin) }) : ''}{tx('rest.revision_de', { fechaHoraMx: fechaHoraMx(resultado?.ahoraEn) })}{gruposOmitidos > 0 ? tx('rest.quedaron_fuera_grupos_por_el_tope', { numero: numero(gruposOmitidos) }) : ''}
              </p>
            )}
            {(r?.chatsSinEquipo ?? 0) > 0 && (
              <p className="rv-vg__nota" role="note">
                {numero(r?.chatsSinEquipo ?? 0)} {r?.chatsSinEquipo === 1 ? tx('rest.grupo_no_tiene') : tx('rest.grupos_no_tienen')}{' '}{tx('rest.a_nadie_de_tu_equipo_identificado')}</p>
            )}
            <p className="rv-vg__nota">
              {horario !== null
                ? tx('rest.horario_de_atencion_activo_la_espera', { horario })
                : tx('rest.sin_horario_de_atencion_guardado_el')}
            </p>
            <p className="rv-vg__nota">{tx('rest.los_mensajes_que_solo_traen_una')}</p>
            <FormaRevision revisar={acciones.revisar} enviar={acciones.enviar} flota={flota} puedeEnviar={puedeEnviar} inicial={<TablaSinAtender tr={tr} alertas={resultado?.alertas ?? []} />} />
          </Seccion>

          <Seccion id="sin-atender-correo" titulo={tx('rest.resumen_por_correo')} info="vigia_sin_atender.correo">
            <p className="rv-vg__nota">
              {!correoEncendido
                ? tx('rest.el_envio_por_correo_esta_apagado')
                : guardada.resumenCorreoHabilitado
                  ? tx('rest.el_envio_por_correo_esta_encendido')
                  : tx('rest.el_resumen_por_correo_esta_apagado')}
            </p>
            {destinatarios.length === 0 ? (
              <p className="rv-vg__nota">{ricoT(tx('rest.hoy_nadie_recibiria_el_resumen_agrega'), { e0: (c) => <a className="rv-vg__enlace" href={`/dashboard/agentes/vigia${sufijo}`}>{c}</a> })}</p>
            ) : (
              <ul className="rv-vg__bullets" aria-label={tx('rest.quien_recibiria_el_resumen_ahora')}>
                {destinatarios.map((d) => <li key={d.correo}>{d.nombre} · {origenTr(tx)[d.origen]}</li>)}
              </ul>
            )}
            <p className="rv-vg__micro" data-tono="muted">{tx('rest.el_correo_lleva_el_grupo_la')}</p>
            {!puedeEnviar && <p className="rv-vg__micro" data-tono="muted">{tx('rest.solo_quien_administra_la_flota_puede_4')}</p>}
          </Seccion>
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}
