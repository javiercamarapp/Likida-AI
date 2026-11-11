import { VacioAgente } from '../../vacio-agente';
import Link from 'next/link';

import { numero, fechaHoraMx } from '@/lib/formato';
import type { GrupoVigia } from '@/lib/likida/vigia/historial/repo';
import type { ReporteHistorial } from '@/lib/likida/vigia/historial/analisis';
import type { ResultadoPendientes } from '@/lib/likida/vigia/historial/pendientes';
import type { RespuestaRapidaFila } from '@/lib/likida/vigia/historial/repo';
import { FilaBorrar, FilaCritico, FilaRetirarRapida, FormaAltaGrupo, FormaAprobarRapida, FormaImportar, type AccionGrupos, type AccionLote } from './formas';
import '../vigia.css';
import { Aviso, BotonEnlace, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { BarList } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

export interface AccionesGrupos { alta: AccionGrupos; critico: AccionGrupos; borrar: AccionGrupos; importar: AccionLote; aprobarRapida: AccionGrupos; retirarRapida: AccionGrupos }

function Seccion({ titulo, info, children }: { id?: string; titulo: string; info: InfoClave; children: React.ReactNode }) {
  return (
    <Tarjeta titulo={titulo} info={info}>
      <div className="rv-vg__pila">{children}</div>
    </Tarjeta>
  );
}

function duracion(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${numero(min)} min`;
  return `${numero(Math.floor(min / 60))} h ${numero(min % 60)} min`;
}

export function VistaHistorialVigia({ sufijo, grupos, clientes, reporte, pendientes, grupoElegido, truncado, umbralMin, puedeEditar, puedeAprobar, rapidas, acciones, standby = false, tr = TR_ES }: {
  /** T-A4-32: perfil cinco_agentes → las respuestas rápidas (stand-by) no se muestran ni se aprueban. */
  standby?: boolean;
  sufijo: string;
  /** `null` = la base aún no tiene la 0484: se dice, no se enseña «no hay grupos». */
  grupos: GrupoVigia[] | null;
  clientes: Array<{ id: string; nombre: string }>;
  /** `null` = no hay nada importado todavía (o no se pudo leer). */
  reporte: ReporteHistorial | null;
  /** Mensajes del cliente sin respuesta en la exportación (foto de ese momento); omitido o `null` = no se calculó. */
  pendientes?: ResultadoPendientes | null;
  grupoElegido: string | null;
  truncado: boolean;
  umbralMin: number;
  puedeEditar: boolean;
  /** Dueño o encargado: aprueban y retiran respuestas rápidas. */
  puedeAprobar: boolean;
  /** Respuestas rápidas aprobadas; `null` = la base aún no tiene la 0647. */
  rapidas: RespuestaRapidaFila[] | null;
  acciones: AccionesGrupos; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  // La exportación respeta el mismo recorte del reporte que se ve (grupo elegido o todos).
  const qExport = `${grupoElegido ? `grupo=${grupoElegido}&` : ''}`;
  const aprobadas = new Set((rapidas ?? []).map((r) => r.pregunta.trim().toLowerCase()));
  const columnasGrupos: readonly ColumnaBase<GrupoVigia>[] = [
    { id: 'cliente', titulo: tx('vigia.vista.cliente'), principal: true, celda: (g) => g.clienteNombre ?? '—' },
    { id: 'grupo', titulo: tx('cartaporte.vista.grupo'), celda: (g) => <Link href={`/dashboard/agentes/vigia/historial?grupo=${g.id}${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="rv-vg__enlace">{g.nombre}</Link> },
    { id: 'critico', titulo: tx('rest.critico'), celda: (g) => (g.critico ? <StatusChip tono="warn">{tx('rest.si')}</StatusChip> : 'No') },
    { id: 'historico', titulo: tx('rest.historico'), celda: (g) => (g.importaciones === 0 ? 'Sin subir' : `${numero(g.mensajes)} mensajes · ${g.ultimaImportacion ? fechaHoraMx(g.ultimaImportacion) : ''}`) },
    {
      id: 'acciones', titulo: tx('rest.acciones'), alinear: 'der',
      celda: (g) => (puedeEditar ? <span className="rv-vg__linea"><FilaCritico accion={acciones.critico} grupoId={g.id} critico={g.critico} /><FilaBorrar accion={acciones.borrar} grupoId={g.id} /></span> : null),
    },
  ];
  const columnasTemas: readonly ColumnaBase<ReporteHistorial['tendencias'][number]>[] = [
    { id: 'tema', titulo: tx('rest.tema'), principal: true, celda: (t) => t.etiqueta },
    { id: 'total', titulo: tx('rest.mensajes'), alinear: 'der', celda: (t) => numero(t.total) },
    { id: 'u4', titulo: tx('rest.ultimas_4_semanas'), alinear: 'der', celda: (t) => numero(t.ultimas4Semanas) },
    { id: 'p4', titulo: tx('rest.4_anteriores'), alinear: 'der', celda: (t) => numero(t.previas4Semanas) },
    { id: 'delta', titulo: tx('rest.cambio'), alinear: 'der', celda: (t) => (t.delta === null ? tx('rest.historico_corto') : `${t.delta > 0 ? '+' : ''}${numero(t.delta)}`) },
  ];
  return (
    <EsqueletoTablaMaestra
      titulo={tx('rest.grupos_de_clientes_e_historico')}
      apoyo={tx('rest.marca_los_grupos_de_whatsapp_de')}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/vigia${sufijo}`}>{tx('rest.volver_al_tablero')}</BotonEnlace>}
      avisos={(
        <>
          <Aviso tono="info">{tx('rest.sube_el_chat_exportado_para_ver')}</Aviso>
          {grupos === null ? <Aviso tono="error">{tx('rest.los_grupos_de_clientes_todavia_no')}</Aviso> : null}
        </>
      )}
      // Tira de cifras solo con histórico real subido: sin él no se pinta ninguna (nunca ceros que parezcan medición).
      cifras={grupos !== null && reporte !== null && reporte.mensajes > 0 ? [
        { etiqueta: tx('f26d.historial.mensajes'), valor: numero(reporte.mensajes) },
        { etiqueta: tx('f26d.historial.de_clientes'), valor: numero(reporte.mensajesCliente) },
        { etiqueta: tx('f26d.historial.del_equipo'), valor: numero(reporte.mensajesEquipo) },
        { etiqueta: tx('f26d.historial.mediana'), valor: duracion(reporte.tiempos.medianaMin) },
      ] : undefined}
      etiquetaCifras={tx('rest.grupos_de_clientes_e_historico')}
    >
      {grupos !== null && (
        <>
          <Seccion id="grupos" titulo={tx('rest.grupos')} info="vigia_historial.grupos">
            {grupos.length === 0 ? (
              <VacioAgente titulo={tx('rest.aun_no_hay_grupos_agrega_el')} />
            ) : (
              <TablaBase etiqueta={tx('rest.grupos_del_vigia')} columnas={columnasGrupos} filas={grupos} idFila={(g) => g.id} densa tarjetaMovil />
            )}
          </Seccion>

          {puedeEditar ? (
            <>
              <Seccion id="alta" titulo={tx('rest.agregar_un_grupo')} info="vigia_historial.alta"><FormaAltaGrupo accion={acciones.alta} clientes={clientes} /></Seccion>
              {grupos.length > 0 && (
                <Seccion id="importar" titulo={tx('rest.subir_el_chat_exportado')} info="vigia_historial.importar">
                  <FormaImportar accion={acciones.importar} grupos={grupos.map((g) => ({ id: g.id, nombre: g.nombre, cliente: g.clienteNombre }))} clientes={clientes} sufijo={sufijo} />
                  <p className="rv-vg__nota">{ricoT(tx('rest.e0_despues_de_subir_un_chat'), { e0: (c) => <Link href={`/dashboard/agentes/vigia/sin-atender${sufijo}`} className="rv-vg__enlace">{c}</Link> })}</p>
                </Seccion>
              )}
            </>
          ) : (
            <p className="rv-vg__nota" data-tono="faint">{tx('rest.solo_el_dueno_de_la_flota_14')}</p>
          )}

          {!standby && <Seccion id="rapidas" titulo={tx('rest.respuestas_rapidas_aprobadas')} info="vigia_historial.rapidas">
            {rapidas === null ? (
              <Aviso tono="error">{tx('rest.las_respuestas_rapidas_todavia_no_estan')}</Aviso>
            ) : (
              <>
                <p className="rv-vg__nota">{tx('rest.cuando_un_cliente_escribe_algo_que')}</p>
                {rapidas.length === 0 ? (
                  <VacioAgente titulo={tx('rest.aun_no_hay_respuestas_rapidas_aprobadas')} />
                ) : (
                  <ul className="rv-vg__lista">
                    {rapidas.map((r) => (
                      <li key={r.id} className="rv-vg__linea rv-vg__nota">
                        <div>
                          <div><strong>{r.pregunta}</strong> <span className="rv-vg__faint">· {numero(r.usos)} {r.usos === 1 ? 'uso' : 'usos'}{r.ultimoUsoEn ? tx('rest.ultimo', { fechaHoraMx: fechaHoraMx(r.ultimoUsoEn) }) : ''}</span></div>
                          <div>«{r.texto}»</div>
                        </div>
                        {puedeAprobar && <span className="rv-vg__fin"><FilaRetirarRapida accion={acciones.retirarRapida} respuestaId={r.id} /></span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Seccion>}

          <Seccion id="reporte" titulo={grupoElegido ? tx('rest.reporte_del_grupo_elegido') : tx('rest.reporte_de_todos_los_grupos')} info="vigia_historial.reporte">
            {reporte === null || reporte.mensajes === 0 ? (
              <VacioAgente titulo={tx('rest.todavia_no_hay_historico_subido_sube')} />
            ) : (
              <div className="rv-vg__pila">
                <p className="rv-vg__linea rv-vg__nota">{ricoT(tx('rest.e0_descargar_el_reporte_de_preguntas'), { e0: (c) => <span>{c}</span>, e1: (c) => <a href={`/api/export/vigia-faqs?${qExport}formato=xlsx${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="rv-vg__enlace">{c}</a>, e2: (c) => <a href={`/api/export/vigia-faqs?${qExport}formato=pdf${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="rv-vg__enlace">{c}</a> })}</p>
                {truncado && <Aviso tono="error">{tx('rest.el_historico_es_mas_grande_de')}</Aviso>}
                <p className="rv-vg__nota">{tx('rest.mensajes_de_clientes_de_tu_equipo', { numero: numero(reporte.mensajes), numero2: numero(reporte.mensajesCliente), numero3: numero(reporte.mensajesEquipo) })}{reporte.desde && reporte.hasta ? tx('rest.del_al_2', { fechaHoraMx: fechaHoraMx(reporte.desde), fechaHoraMx2: fechaHoraMx(reporte.hasta) }) : ''}{tx('rest.los_temas_se_detectan_por_palabras')}</p>

                {pendientes && (
                  <Tarjeta titulo={tx('rest.pendientes_de_contestar_en_el_chat')} info="vigia_historial.pendientes">
                    <div className="rv-vg__pila">
                      <p className="rv-vg__micro">{tx('rest.foto_del_momento_de_la_exportacion')}{pendientes.fotoEn ? ` (${fechaHoraMx(pendientes.fotoEn)})` : ''}{tx('rest.no_en_vivo_el_vigia_no')}</p>
                      {pendientes.pendientes.length === 0 ? (
                        <VacioAgente titulo={tx('rest.no_quedo_ningun_mensaje_de_cliente')} />
                      ) : (
                        <ul className="rv-vg__lista">
                          {pendientes.pendientes.map((p) => (
                            <li key={`${p.enviadoEn}|${p.texto}`} className="rv-vg__nota">
                              <div>
                                <StatusChip tono={p.nivel === 2 ? 'bad' : 'neutral'}>{p.nivel === 2 ? tx('rest.alta') : tx('rest.normal')}</StatusChip>{' '}
                                <span className="rv-vg__faint">· {p.grupo ? `${p.grupo} · ` : ''}{tx('rest.esperando', { duracion: duracion(p.antiguedadMin) })}{' '}{fechaHoraMx(p.enviadoEn)}</span>
                              </div>
                              <div>«{p.texto}»</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Tarjeta>
                )}

                <Tarjeta titulo={tx('rest.tiempo_de_respuesta_del_equipo')} info="vigia_historial.tiempos">
                  <p className="rv-vg__nota">{tx('rest.mediana_9_de_cada_10_respuestas', { duracion: duracion(reporte.tiempos.medianaMin), duracion2: duracion(reporte.tiempos.p90Min) })}{' '}<strong>{numero(reporte.tiempos.sobreUmbral)}</strong>{' '}{tx('rest.esperas_pasaron_de_min_incluye_mensajes', { numero: numero(umbralMin), numero2: numero(reporte.tiempos.sinRespuesta) })}</p>
                </Tarjeta>

                <Tarjeta titulo={tx('rest.preguntas_frecuentes')} info="vigia_historial.faqs" estado={reporte.faqs.length === 0 ? 'vacio' : 'ok'}
                  mensaje={tx('rest.sin_preguntas_frecuentes')} detalle={tx('rest.no_hay_preguntas_que_se_repitan')}>
                  <div className="rv-vg__pila">
                    <BarList etiqueta={tx('rest.veces_que_se_repite_cada_pregunta')} formato={numero}
                      items={reporte.faqs.slice(0, 8).map((f) => ({ clave: f.pregunta, etiqueta: f.pregunta, valor: f.veces, texto: `${numero(f.veces)} veces`, nota: tx('rest.en_dias', { numero: numero(f.dias) }) }))} />
                    <ul className="rv-vg__lista">
                      {reporte.faqs.map((f) => (
                        <li key={f.pregunta} className="rv-vg__nota">
                          <div><strong>{f.pregunta}</strong>{' '}{ricoT(tx('rest.e0_veces_en_dias_e0', { numero: numero(f.veces), numero2: numero(f.dias) }), { e0: (c) => <span className="rv-vg__faint">{c}</span> })}</div>
                          <div>{f.respuestaTipica ? <>{tx('rest.lo_que_suele_contestar_tu_equipo', { respuestaTipica: f.respuestaTipica })}</> : tx('rest.sin_una_respuesta_del_equipo_en')}</div>
                          {!standby && puedeAprobar && rapidas !== null && (aprobadas.has(f.pregunta.trim().toLowerCase())
                            ? <div className="rv-vg__micro" data-tono="ok">{tx('rest.ya_es_una_respuesta_rapida_aprobada')}</div>
                            : <FormaAprobarRapida accion={acciones.aprobarRapida} tema={f.tema} pregunta={f.pregunta} textoInicial={f.respuestaTipica ?? ''} />)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Tarjeta>

                <Tarjeta titulo={tx('rest.temas_y_tendencia')} info="vigia_historial.temas">
                  <div className="rv-vg__pila">
                    <TablaBase etiqueta={tx('rest.temas_y_tendencia')} columnas={columnasTemas} filas={reporte.tendencias} idFila={(t) => t.tema} densa tarjetaMovil />
                    <p className="rv-vg__micro">{tx('rest.historico_corto_se_necesitan_al_menos')}</p>
                  </div>
                </Tarjeta>
              </div>
            )}
          </Seccion>
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}
