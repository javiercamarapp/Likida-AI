import Link from 'next/link';
import { MessagesSquare, TriangleAlert } from 'lucide-react';
import { numero, fechaHoraMx } from '@/lib/formato';
import type { GrupoVigia } from '@/lib/likida/vigia/historial/repo';
import type { ReporteHistorial } from '@/lib/likida/vigia/historial/analisis';
import { BarraPagina } from '../../../resumen-visual';
import { FilaBorrar, FilaCritico, FormaAltaGrupo, FormaImportar, type AccionGrupos } from './formas';

export interface AccionesGrupos { alta: AccionGrupos; critico: AccionGrupos; borrar: AccionGrupos; importar: AccionGrupos }

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 space-y-3" aria-labelledby={id}>
      <h2 id={id} className="font-display text-[15px] font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{children}
    </p>
  );
}

function duracion(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${numero(min)} min`;
  return `${numero(Math.floor(min / 60))} h ${numero(min % 60)} min`;
}

export function VistaHistorialVigia({ sufijo, grupos, clientes, reporte, grupoElegido, truncado, umbralMin, puedeEditar, acciones }: {
  sufijo: string;
  /** `null` = la base aún no tiene la 0484: se dice, no se enseña «no hay grupos». */
  grupos: GrupoVigia[] | null;
  clientes: Array<{ id: string; nombre: string }>;
  /** `null` = no hay nada importado todavía (o no se pudo leer). */
  reporte: ReporteHistorial | null;
  grupoElegido: string | null;
  truncado: boolean;
  umbralMin: number;
  puedeEditar: boolean;
  acciones: AccionesGrupos;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<MessagesSquare width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Grupos de clientes e histórico del Vigía" />
        <div className="px-5 py-5 flex-1 space-y-4 max-w-[1040px]">
          <p className="text-[12.5px] max-w-[80ch]" style={{ color: 'var(--muted)' }}>
            Marca los grupos de WhatsApp de tus clientes críticos y sube el chat exportado para ver qué preguntan más, cómo cambian los temas y cuánto tarda tu equipo en contestar.
            El Vigía todavía no lee los grupos en vivo: hoy se alimentan con el histórico que tú subes. <Link href={`/dashboard/agentes/vigia${sufijo}`} className="underline">Volver al tablero</Link>
          </p>

          {grupos === null ? (
            <Aviso>La base de datos todavía no tiene las tablas de grupos (falta aplicar la migración 0484). Mientras tanto no hay nada que mostrar aquí.</Aviso>
          ) : (
            <>
              <Seccion id="grupos" titulo="Grupos">
                {grupos.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Aún no hay grupos. Agrega el primero abajo.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead><tr className="text-left text-[11px]" style={{ color: 'var(--faint)' }}><th className="py-1 pr-3">Cliente</th><th className="pr-3">Grupo</th><th className="pr-3">Crítico</th><th className="pr-3">Histórico</th><th /></tr></thead>
                      <tbody>
                        {grupos.map((g) => (
                          <tr key={g.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                            <td className="py-2 pr-3">{g.clienteNombre ?? '—'}</td>
                            <td className="pr-3"><Link href={`/dashboard/agentes/vigia/historial?grupo=${g.id}${sufijo ? `&${sufijo.slice(1)}` : ''}`} className="underline">{g.nombre}</Link></td>
                            <td className="pr-3">{g.critico ? 'Sí' : 'No'}</td>
                            <td className="pr-3">{g.importaciones === 0 ? 'Sin subir' : `${numero(g.mensajes)} mensajes · ${g.ultimaImportacion ? fechaHoraMx(g.ultimaImportacion) : ''}`}</td>
                            <td className="space-x-2 text-right">
                              {puedeEditar && <><FilaCritico accion={acciones.critico} grupoId={g.id} critico={g.critico} /><FilaBorrar accion={acciones.borrar} grupoId={g.id} /></>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Seccion>

              {puedeEditar ? (
                <>
                  <Seccion id="alta" titulo="Agregar un grupo"><FormaAltaGrupo accion={acciones.alta} clientes={clientes} /></Seccion>
                  {grupos.length > 0 && (
                    <Seccion id="importar" titulo="Subir el chat exportado">
                      <FormaImportar accion={acciones.importar} grupos={grupos.map((g) => ({ id: g.id, nombre: g.nombre, cliente: g.clienteNombre }))} />
                    </Seccion>
                  )}
                </>
              ) : (
                <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota agrega grupos y sube histórico.</p>
              )}

              <Seccion id="reporte" titulo={grupoElegido ? 'Reporte del grupo elegido' : 'Reporte de todos los grupos'}>
                {reporte === null || reporte.mensajes === 0 ? (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Todavía no hay histórico subido: sube el chat de un grupo y aquí aparecen sus preguntas frecuentes, sus temas y los tiempos de respuesta.</p>
                ) : (
                  <div className="space-y-5">
                    {truncado && <Aviso>El histórico es más grande de lo que se analiza de una vez: el reporte usa solo los primeros 50,000 mensajes.</Aviso>}
                    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                      {numero(reporte.mensajes)} mensajes ({numero(reporte.mensajesCliente)} de clientes, {numero(reporte.mensajesEquipo)} de tu equipo)
                      {reporte.desde && reporte.hasta ? ` del ${fechaHoraMx(reporte.desde)} al ${fechaHoraMx(reporte.hasta)}` : ''}. Los temas se detectan por palabras clave, sin modelo: lo que no encaja queda en «Otros».
                    </p>

                    <div>
                      <h3 className="text-[13px] font-semibold mb-1.5">Tiempo de respuesta del equipo</h3>
                      <p className="text-[12.5px]">
                        Mediana {duracion(reporte.tiempos.medianaMin)} · 9 de cada 10 respuestas en {duracion(reporte.tiempos.p90Min)} ·{' '}
                        <strong>{numero(reporte.tiempos.sobreUmbral)}</strong> esperas pasaron de {numero(umbralMin)} min (incluye {numero(reporte.tiempos.sinRespuesta)} mensajes que nadie contestó).
                      </p>
                    </div>

                    <div>
                      <h3 className="text-[13px] font-semibold mb-1.5">Preguntas frecuentes</h3>
                      {reporte.faqs.length === 0 ? (
                        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No hay preguntas que se repitan lo suficiente (al menos 2 veces) para llamarlas frecuentes.</p>
                      ) : (
                        <ul className="space-y-2.5">
                          {reporte.faqs.map((f) => (
                            <li key={f.pregunta} className="text-[12.5px]">
                              <div><strong>{f.pregunta}</strong> <span style={{ color: 'var(--faint)' }}>· {numero(f.veces)} veces en {numero(f.dias)} días</span></div>
                              <div style={{ color: 'var(--muted)' }}>{f.respuestaTipica ? <>Lo que suele contestar tu equipo: «{f.respuestaTipica}»</> : 'Sin una respuesta del equipo en la hora siguiente.'}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <h3 className="text-[13px] font-semibold mb-1.5">Temas y tendencia</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12.5px]">
                          <thead><tr className="text-left text-[11px]" style={{ color: 'var(--faint)' }}><th className="py-1 pr-3">Tema</th><th className="pr-3">Mensajes</th><th className="pr-3">Últimas 4 semanas</th><th className="pr-3">4 anteriores</th><th>Cambio</th></tr></thead>
                          <tbody>
                            {reporte.tendencias.map((t) => (
                              <tr key={t.tema} className="border-t" style={{ borderColor: 'var(--line)' }}>
                                <td className="py-1.5 pr-3">{t.etiqueta}</td><td className="pr-3">{numero(t.total)}</td><td className="pr-3">{numero(t.ultimas4Semanas)}</td><td className="pr-3">{numero(t.previas4Semanas)}</td>
                                <td>{t.delta === null ? 'Histórico corto' : `${t.delta > 0 ? '+' : ''}${numero(t.delta)}`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>«Histórico corto»: se necesitan al menos 8 semanas de chat para comparar.</p>
                    </div>
                  </div>
                )}
              </Seccion>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
