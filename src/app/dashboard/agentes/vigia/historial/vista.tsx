import Link from 'next/link';

import { numero, fechaHoraMx } from '@/lib/formato';
import type { GrupoVigia } from '@/lib/likida/vigia/historial/repo';
import type { ReporteHistorial } from '@/lib/likida/vigia/historial/analisis';
import type { ResultadoPendientes } from '@/lib/likida/vigia/historial/pendientes';
import type { RespuestaRapidaFila } from '@/lib/likida/vigia/historial/repo';
import { FilaBorrar, FilaCritico, FilaRetirarRapida, FormaAltaGrupo, FormaAprobarRapida, FormaImportar, type AccionGrupos, type AccionLote } from './formas';
import '../vigia.css';
import { Aviso, BotonEnlace, StatusChip, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { BarList } from '@/app/ui-v2/graficas';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';

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

export function VistaHistorialVigia({ sufijo, grupos, clientes, reporte, pendientes, grupoElegido, truncado, umbralMin, puedeEditar, puedeAprobar, rapidas, acciones, standby = false }: {
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
  acciones: AccionesGrupos;
}) {
  // La exportación respeta el mismo recorte del reporte que se ve (grupo elegido o todos).
  const qExport = `${grupoElegido ? `grupo=${grupoElegido}&` : ''}`;
  const aprobadas = new Set((rapidas ?? []).map((r) => r.pregunta.trim().toLowerCase()));
  const columnasGrupos: readonly ColumnaBase<GrupoVigia>[] = [
    { id: 'cliente', titulo: 'Cliente', principal: true, celda: (g) => g.clienteNombre ?? '—' },
    { id: 'grupo', titulo: 'Grupo', celda: (g) => <Link href={`/dashboard/agentes/vigia/historial?grupo=${g.id}${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="rv-vg__enlace">{g.nombre}</Link> },
    { id: 'critico', titulo: 'Crítico', celda: (g) => (g.critico ? <StatusChip tono="warn">Sí</StatusChip> : 'No') },
    { id: 'historico', titulo: 'Histórico', celda: (g) => (g.importaciones === 0 ? 'Sin subir' : `${numero(g.mensajes)} mensajes · ${g.ultimaImportacion ? fechaHoraMx(g.ultimaImportacion) : ''}`) },
    {
      id: 'acciones', titulo: 'Acciones', tituloOculto: true, alinear: 'der',
      celda: (g) => (puedeEditar ? <span className="rv-vg__linea"><FilaCritico accion={acciones.critico} grupoId={g.id} critico={g.critico} /><FilaBorrar accion={acciones.borrar} grupoId={g.id} /></span> : null),
    },
  ] as unknown as readonly ColumnaBase<GrupoVigia>[];
  const columnasTemas: readonly ColumnaBase<ReporteHistorial['tendencias'][number]>[] = [
    { id: 'tema', titulo: 'Tema', principal: true, celda: (t) => t.etiqueta },
    { id: 'total', titulo: 'Mensajes', alinear: 'der', celda: (t) => numero(t.total) },
    { id: 'u4', titulo: 'Últimas 4 semanas', alinear: 'der', celda: (t) => numero(t.ultimas4Semanas) },
    { id: 'p4', titulo: '4 anteriores', alinear: 'der', celda: (t) => numero(t.previas4Semanas) },
    { id: 'delta', titulo: 'Cambio', alinear: 'der', celda: (t) => (t.delta === null ? 'Histórico corto' : `${t.delta > 0 ? '+' : ''}${numero(t.delta)}`) },
  ];
  return (
    <MarcoPagina titulo="Grupos de clientes e histórico" apoyo="Marca los grupos de WhatsApp de tus clientes críticos y sube el chat exportado para ver qué preguntan más." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/vigia${sufijo}`}>Volver al tablero</BotonEnlace>}>
      <Aviso tono="info">
        Sube el chat exportado para ver cómo cambian los temas y cuánto tarda tu equipo en contestar. El Vigía todavía no lee los grupos en vivo: hoy se alimentan con el histórico que tú subes.
      </Aviso>

      {grupos === null ? (
        <Aviso tono="error">Los grupos de clientes todavía no están disponibles en tu cuenta, por eso aquí no hay nada que mostrar. Avísale a Likida.</Aviso>
      ) : (
        <>
          <Seccion id="grupos" titulo="Grupos" info="vigia_historial.grupos">
            {grupos.length === 0 ? (
              <p className="rv-vg__nota">Aún no hay grupos. Agrega el primero abajo.</p>
            ) : (
              <TablaBase etiqueta="Grupos del Vigía" columnas={columnasGrupos} filas={grupos} idFila={(g) => g.id} densa tarjetaMovil />
            )}
          </Seccion>

          {puedeEditar ? (
            <>
              <Seccion id="alta" titulo="Agregar un grupo" info="vigia_historial.alta"><FormaAltaGrupo accion={acciones.alta} clientes={clientes} /></Seccion>
              {grupos.length > 0 && (
                <Seccion id="importar" titulo="Subir el chat exportado" info="vigia_historial.importar">
                  <FormaImportar accion={acciones.importar} grupos={grupos.map((g) => ({ id: g.id, nombre: g.nombre, cliente: g.clienteNombre }))} clientes={clientes} sufijo={sufijo} />
                  <p className="rv-vg__nota"><Link href={`/dashboard/agentes/vigia/sin-atender${sufijo}`} className="rv-vg__enlace">Después de subir un chat, revisa las conversaciones sin atender</Link>.</p>
                </Seccion>
              )}
            </>
          ) : (
            <p className="rv-vg__nota" data-tono="faint">Solo el dueño de la flota agrega grupos y sube histórico.</p>
          )}

          {!standby && <Seccion id="rapidas" titulo="Respuestas rápidas aprobadas" info="vigia_historial.rapidas">
            {rapidas === null ? (
              <Aviso tono="error">Las respuestas rápidas todavía no están disponibles en tu cuenta. Mientras tanto el Vigía contesta como siempre.</Aviso>
            ) : (
              <>
                <p className="rv-vg__nota">
                  Cuando un cliente escribe algo que el Vigía no entiende y se parece a una de estas preguntas, el borrador sale con la respuesta que aprobaste. Siempre te llega para aprobar antes de enviarse. Apruébalas desde las preguntas frecuentes del reporte de abajo.
                </p>
                {rapidas.length === 0 ? (
                  <p className="rv-vg__nota">Aún no hay respuestas rápidas aprobadas.</p>
                ) : (
                  <ul className="rv-vg__lista">
                    {rapidas.map((r) => (
                      <li key={r.id} className="rv-vg__linea rv-vg__nota">
                        <div>
                          <div><strong>{r.pregunta}</strong> <span className="rv-vg__faint">· {numero(r.usos)} {r.usos === 1 ? 'uso' : 'usos'}{r.ultimoUsoEn ? ` · último ${fechaHoraMx(r.ultimoUsoEn)}` : ''}</span></div>
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

          <Seccion id="reporte" titulo={grupoElegido ? 'Reporte del grupo elegido' : 'Reporte de todos los grupos'} info="vigia_historial.reporte">
            {reporte === null || reporte.mensajes === 0 ? (
              <p className="rv-vg__nota">Todavía no hay histórico subido: sube el chat de un grupo y aquí aparecen sus preguntas frecuentes, sus temas y los tiempos de respuesta.</p>
            ) : (
              <div className="rv-vg__pila">
                <p className="rv-vg__linea rv-vg__nota">
                  <span>Descargar el reporte de preguntas frecuentes y tendencias:</span>
                  <a href={`/api/export/vigia-faqs?${qExport}formato=xlsx${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="rv-vg__enlace">Excel</a>
                  <a href={`/api/export/vigia-faqs?${qExport}formato=pdf${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="rv-vg__enlace">PDF</a>
                </p>
                {truncado && <Aviso tono="error">El histórico es más grande de lo que se analiza de una vez: el reporte usa solo los 50,000 mensajes más recientes.</Aviso>}
                <p className="rv-vg__nota">
                  {numero(reporte.mensajes)} mensajes ({numero(reporte.mensajesCliente)} de clientes, {numero(reporte.mensajesEquipo)} de tu equipo)
                  {reporte.desde && reporte.hasta ? ` del ${fechaHoraMx(reporte.desde)} al ${fechaHoraMx(reporte.hasta)}` : ''}. Los temas se detectan por palabras clave, sin modelo: lo que no encaja queda en «Otros».
                </p>

                {pendientes && (
                  <Tarjeta titulo="Pendientes de contestar en el chat subido" info="vigia_historial.pendientes">
                    <div className="rv-vg__pila">
                      <p className="rv-vg__micro">
                        Foto del momento de la exportación{pendientes.fotoEn ? ` (${fechaHoraMx(pendientes.fotoEn)})` : ''}, no en vivo: el Vigía no lee los grupos al instante. Se ocultan los «gracias», los avisos de monitoreo y lo que el equipo ya contestó.
                      </p>
                      {pendientes.pendientes.length === 0 ? (
                        <p className="rv-vg__nota">No quedó ningún mensaje de cliente sin contestar en este chat.</p>
                      ) : (
                        <ul className="rv-vg__lista">
                          {pendientes.pendientes.map((p) => (
                            <li key={`${p.enviadoEn}|${p.texto}`} className="rv-vg__nota">
                              <div>
                                <StatusChip tono={p.nivel === 2 ? 'bad' : 'neutral'}>{p.nivel === 2 ? 'Alta' : 'Normal'}</StatusChip>{' '}
                                <span className="rv-vg__faint">· {p.grupo ? `${p.grupo} · ` : ''}esperando {duracion(p.antiguedadMin)} · {fechaHoraMx(p.enviadoEn)}</span>
                              </div>
                              <div>«{p.texto}»</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Tarjeta>
                )}

                <Tarjeta titulo="Tiempo de respuesta del equipo" info="vigia_historial.tiempos">
                  <p className="rv-vg__nota">
                    Mediana {duracion(reporte.tiempos.medianaMin)} · 9 de cada 10 respuestas en {duracion(reporte.tiempos.p90Min)} ·{' '}
                    <strong>{numero(reporte.tiempos.sobreUmbral)}</strong> esperas pasaron de {numero(umbralMin)} min (incluye {numero(reporte.tiempos.sinRespuesta)} mensajes que nadie contestó).
                  </p>
                </Tarjeta>

                <Tarjeta titulo="Preguntas frecuentes" info="vigia_historial.faqs" estado={reporte.faqs.length === 0 ? 'vacio' : 'ok'}
                  mensaje="Sin preguntas frecuentes" detalle="No hay preguntas que se repitan lo suficiente (al menos 2 veces) para llamarlas frecuentes.">
                  <div className="rv-vg__pila">
                    <BarList etiqueta="Veces que se repite cada pregunta" formato={numero}
                      items={reporte.faqs.slice(0, 8).map((f) => ({ clave: f.pregunta, etiqueta: f.pregunta, valor: f.veces, texto: `${numero(f.veces)} veces`, nota: `en ${numero(f.dias)} días` }))} />
                    <ul className="rv-vg__lista">
                      {reporte.faqs.map((f) => (
                        <li key={f.pregunta} className="rv-vg__nota">
                          <div><strong>{f.pregunta}</strong> <span className="rv-vg__faint">· {numero(f.veces)} veces en {numero(f.dias)} días</span></div>
                          <div>{f.respuestaTipica ? <>Lo que suele contestar tu equipo: «{f.respuestaTipica}»</> : 'Sin una respuesta del equipo en la hora siguiente.'}</div>
                          {!standby && puedeAprobar && rapidas !== null && (aprobadas.has(f.pregunta.trim().toLowerCase())
                            ? <div className="rv-vg__micro" data-tono="ok">Ya es una respuesta rápida aprobada.</div>
                            : <FormaAprobarRapida accion={acciones.aprobarRapida} tema={f.tema} pregunta={f.pregunta} textoInicial={f.respuestaTipica ?? ''} />)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Tarjeta>

                <Tarjeta titulo="Temas y tendencia" info="vigia_historial.temas">
                  <div className="rv-vg__pila">
                    <TablaBase etiqueta="Temas y tendencia" columnas={columnasTemas} filas={reporte.tendencias} idFila={(t) => t.tema} densa tarjetaMovil />
                    <p className="rv-vg__micro">«Histórico corto»: se necesitan al menos 8 semanas de chat para comparar.</p>
                  </div>
                </Tarjeta>
              </div>
            )}
          </Seccion>
        </>
      )}
    </MarcoPagina>
  );
}
