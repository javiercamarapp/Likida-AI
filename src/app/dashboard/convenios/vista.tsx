import Link from 'next/link';
import { Handshake } from 'lucide-react';
import { BarraPagina } from '../resumen-visual';
import { fechaMx, mxn } from '@/lib/formato';
import { ETIQUETA_CATEGORIA } from '@/lib/likida/convenios/tipos';
import { textoParaSistemaDeLaFlota } from '@/lib/likida/convenios/importador';
import type { ConvenioFila, ViajeConvenioFila } from '@/lib/likida/convenios/repo';
import { FormaCorregirConvenio, FormaImportarConvenios, type AccionConvenio } from './formas';

// SOLO tipos del repositorio: la vista no arrastra al bundle el acceso a datos.

const MOMENTO_TEXTO = { despacho: 'al despachar', acercamiento: 'al acercarse', ambos: 'al despachar y al acercarse' } as const;
const LUGAR_TEXTO = { origen: 'planta de carga', destino: 'planta de descarga', ambos: 'las dos plantas' } as const;
const MODO_TEXTO = { por_viaje: 'por viaje', por_km: 'por km', por_tonelada: 'por tonelada' } as const;

export interface PropsVistaConvenios {
  sufijo: string;
  /** `null` = no se pudo leer; la razón va en `estado`. */
  convenios: ConvenioFila[] | null;
  estado: 'ok' | 'no_disponible' | 'error';
  puedeEditar: boolean;
  /** ¿Ve el área de dinero? Solo entonces se muestran tarifa y requisitos de cobro. */
  verDinero: boolean;
  puedeExportar: boolean;
  accionImportar: AccionConvenio;
  accionEstado: (fd: FormData) => Promise<void>;
  /** Los viajes abiertos con su convenio ligado. `null` = no se pudieron leer (o no se pidieron: la sección no se pinta). */
  viajes?: ViajeConvenioFila[] | null;
  accionCorregir?: AccionConvenio;
}

const vigencia = (c: ConvenioFila): string => {
  if (!c.vigenteDesde && !c.vigenteHasta) return 'sin vencimiento';
  return `${c.vigenteDesde ? `desde ${fechaMx(c.vigenteDesde)}` : ''}${c.vigenteDesde && c.vigenteHasta ? ' ' : ''}${c.vigenteHasta ? `hasta ${fechaMx(c.vigenteHasta)}` : ''}`;
};

export function VistaConvenios(p: PropsVistaConvenios) {
  const lista = p.convenios ?? [];
  const descarga = (tipo: string) => `/api/export/convenios?tipo=${tipo}${p.sufijo.startsWith('?') ? `&${p.sufijo.slice(1)}` : ''}`;
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Handshake width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Convenios de clientes" />
        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px] max-w-[80ch]" style={{ color: 'var(--muted)' }}>
            Todo nace del convenio: el punto A→B, las instrucciones de operación (por dónde entrar, con quién reportarse, documentos,
            peculiaridades de la planta){p.verDinero ? ', la tarifa y los requisitos de cobro' : ''}. Al despachar un viaje del cliente, esas instrucciones
            se ligan al viaje y le llegan al operador por WhatsApp; al acercarse a la planta se le recuerdan, y puede preguntar
            «¿por dónde entro?». <strong>El agente solo dice lo que el convenio dice</strong>: sin instrucciones registradas, lo dice y lo manda con el jefe de tráfico.
          </p>

          {p.estado === 'no_disponible' && (
            <p role="alert" className="text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
              Los convenios todavía no están disponibles en tu cuenta: falta aplicar la actualización de la base (0580). Mientras tanto los viajes se despachan como siempre, sin instrucciones.
            </p>
          )}
          {p.estado === 'error' && (
            <p role="alert" className="text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>No se pudieron leer los convenios ahora mismo. Intenta de nuevo en un momento.</p>
          )}

          {p.estado === 'ok' && (
            <section className="card p-4 space-y-3" aria-label="Convenios registrados">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display text-[15px] font-semibold">Convenios registrados</h2>
                {p.puedeExportar && (
                  <span className="ml-auto flex items-center gap-3 text-[12.5px]">
                    <a href={descarga('instrucciones')} className="underline" style={{ color: 'var(--muted)' }}>Descargar instrucciones (CSV, sin dinero)</a>
                    <a href={descarga('texto')} className="underline" style={{ color: 'var(--muted)' }}>Descargar texto para tu sistema</a>
                    {p.verDinero && <a href={descarga('completo')} className="underline" style={{ color: 'var(--muted)' }}>Descargar completo (con tarifa)</a>}
                  </span>
                )}
              </div>
              {lista.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Todavía no hay convenios. Importa tu archivo abajo: hasta entonces los viajes se despachan sin instrucciones.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                  {lista.map((c) => (
                    <li key={c.id} className="py-3 space-y-1.5" style={{ opacity: c.activo ? 1 : 0.55 }}>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium text-[13.5px]">{c.cliente}</span>
                        <span className="text-[13px]">· {c.nombre}</span>
                        {!c.activo && <span className="text-[10.5px]" style={{ color: 'var(--faint)' }}>(archivado)</span>}
                        {p.puedeEditar && (
                          <form action={p.accionEstado} className="ml-auto">
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="activo" value={c.activo ? 'no' : 'si'} />
                            <button type="submit" className="text-[12px] underline" style={{ color: 'var(--muted)' }}>{c.activo ? 'Archivar' : 'Reactivar'}</button>
                          </form>
                        )}
                      </div>
                      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                        {c.origen ?? '¿origen?'} → {c.destino ?? '¿destino?'}
                        {(c.sitioOrigenNombre || c.sitioDestinoNombre) && <> · sitios: {c.sitioOrigenNombre ?? '—'} → {c.sitioDestinoNombre ?? '—'}</>}
                        {' · '}{vigencia(c)}
                      </p>
                      {c.instrucciones.length === 0 ? (
                        <p className="text-[12px]" style={{ color: 'var(--warn)' }}>Sin instrucciones de operación: el operador no recibirá nada de este convenio.</p>
                      ) : (
                        <details className="text-[12.5px]">
                          <summary className="cursor-pointer underline" style={{ color: 'var(--muted)' }}>{c.instrucciones.length} instrucci{c.instrucciones.length === 1 ? 'ón' : 'ones'}</summary>
                          <ul className="mt-1.5 space-y-1">
                            {c.instrucciones.map((i, n) => (
                              <li key={n}>
                                <span className="font-medium">{ETIQUETA_CATEGORIA[i.categoria]}:</span> {i.texto}
                                <span className="ml-1.5 text-[11px]" style={{ color: 'var(--faint)' }}>({LUGAR_TEXTO[i.lugar]}, {MOMENTO_TEXTO[i.momento]})</span>
                              </li>
                            ))}
                          </ul>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[11.5px]" style={{ color: 'var(--faint)' }}>Texto para pegar en tu sistema</summary>
                            <pre className="mt-1 p-3 rounded-lg overflow-x-auto font-mono text-[11.5px] whitespace-pre-wrap" style={{ background: 'var(--canvas)' }}>{textoParaSistemaDeLaFlota(c)}</pre>
                          </details>
                        </details>
                      )}
                      {p.verDinero && c.comercial && (
                        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                          Tarifa: {c.comercial.modo && c.comercial.precio !== null ? `${mxn(c.comercial.precio)} ${c.comercial.moneda} ${MODO_TEXTO[c.comercial.modo]}` : 'sin tarifa pactada'}
                          {c.comercial.requisitos.length > 0 && <> · Para cobrar: {c.comercial.requisitos.join(', ')}</>}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {p.estado === 'ok' && p.puedeEditar && p.accionCorregir && p.viajes && (
            <section className="card p-4 space-y-3" aria-label="Convenio ligado a cada viaje">
              <h2 className="font-display text-[15px] font-semibold">Convenio ligado a cada viaje en curso</h2>
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                Si el sistema ligó el convenio equivocado, o no pudo elegir porque varios empataban, corrígelo aquí: se vuelve a tomar la foto de
                instrucciones del convenio que elijas y queda como corrección manual (el despacho automático ya no lo cambia). Puedes mandarle de nuevo
                las instrucciones al operador.
              </p>
              {p.viajes.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No hay viajes abiertos con cliente.</p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                  {p.viajes.map((v) => (
                    <li key={v.viajeId} className="py-3 space-y-1.5">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium text-[13.5px]">{v.folio}</span>
                        <span className="text-[13px]">· {v.cliente ?? 'sin cliente'}</span>
                        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{v.origen ?? '¿origen?'} → {v.destino ?? '¿destino?'}{v.operador ? ` · ${v.operador}` : ''}</span>
                      </div>
                      <p className="text-[12px]" style={{ color: v.convenioNombre || v.ligadoPor === null ? 'var(--muted)' : 'var(--warn)' }}>
                        {v.ligadoPor === null
                          ? 'Sin convenio ligado todavía (nunca se despachó con convenio, o varios empataron).'
                          : v.convenioNombre
                            ? `Ligado: «${v.convenioNombre}» (${v.ligadoPor === 'manual' ? 'corrección manual' : 'automático'}) · ${v.instrucciones} instrucci${v.instrucciones === 1 ? 'ón' : 'ones'}${v.despachoEnviado ? ' · ya enviadas al operador' : ''}`
                            : 'Sin convenio (decisión de la oficina o convenio borrado): no se le manda nada al operador.'}
                      </p>
                      <FormaCorregirConvenio accion={p.accionCorregir!} viajeId={v.viajeId} folio={v.folio} actual={v.convenioId} opciones={v.opciones} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {p.puedeEditar ? (
            <section className="card p-4 space-y-3" aria-label="Importar convenios">
              <h2 className="font-display text-[15px] font-semibold">Importar desde CSV o Excel</h2>
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                <strong>Una fila por instrucción.</strong> Columnas: <code>cliente, convenio</code> (obligatorias), <code>origen, destino, sitio_origen, sitio_destino, vigente_desde, vigente_hasta, notas</code>,
                y por instrucción <code>categoria</code> (puerta, reportarse, peculiaridad, documentos, horario, seguridad, otro), <code>instruccion</code>, <code>momento</code> (despacho, acercamiento, ambos)
                y <code>lugar</code> (origen, destino, ambos){p.verDinero ? <>; con permiso de finanzas también <code>tarifa_modo, tarifa_precio, moneda, requisitos_cobro</code></> : ''}.
                El cliente tiene que existir en Clientes y los sitios en el catálogo de sitios (por código o nombre): nada se inventa. Todo o nada: si una fila falla, no se importa ninguna y te decimos cuál corregir.
                Re-subir el mismo archivo actualiza por cliente + convenio; no duplica, y las instrucciones que ya no trae se quitan.{' '}
                {p.puedeExportar && <a href={descarga('plantilla')} className="underline">Descargar la plantilla</a>}
              </p>
              <FormaImportarConvenios accion={p.accionImportar} />
            </section>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota o el jefe de tráfico editan los convenios.</p>
          )}
          <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
            Las instrucciones que ya se le mandaron a un operador no cambian si editas el convenio después: cada viaje conserva las que se le dijeron.{' '}
            <Link href={`/dashboard/agentes/conductores/sitios${p.sufijo}`} className="underline">Catálogo de sitios</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
