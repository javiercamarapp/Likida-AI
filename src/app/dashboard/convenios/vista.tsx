import Link from 'next/link';
import { fechaMx, mxn, numero } from '@/lib/formato';
import { ETIQUETA_CATEGORIA } from '@/lib/likida/convenios/tipos';
import { textoParaSistemaDeLaFlota } from '@/lib/likida/convenios/importador';
import type { ConvenioFila, ViajeConvenioFila } from '@/lib/likida/convenios/repo';
import { FormaConvenio, FormaCorregirConvenio, FormaImportarConvenios, type AccionConvenio, type CatalogosFormaConvenio } from './formas';
import { MarcoPagina, Aviso, AvisoCompacto, Boton, Disclosure, EstadoVacio, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import './convenios.css';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { FileText } from 'lucide-react';

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
  /** Alta y edición en pantalla (P7). Sin catálogos o sin acción, la pantalla se queda como estaba (solo importar). */
  catalogos?: CatalogosFormaConvenio | null;
  accionGuardar?: AccionConvenio;
  /**
   * A37-S17-04: el id del convenio que se está editando (`?editar=`). El formulario de edición (con TODOS los sitios en dos
   * selects) se monta SOLO para ese; los demás tienen un enlace. Con 300 convenios × 1,000 sitios, montar uno por convenio eran
   * ~600k `<option>`.
   */
  editarId?: string | null;
  /** Página de la lista (1-based, `?pag=`). */
  pagina?: number;
}

/** Cuántos convenios se pintan por página. */
export const CONVENIOS_POR_PAGINA = 50;


const vigencia = (c: ConvenioFila): string => {
  if (!c.vigenteDesde && !c.vigenteHasta) return 'sin vencimiento';
  return `${c.vigenteDesde ? `desde ${fechaMx(c.vigenteDesde)}` : ''}${c.vigenteDesde && c.vigenteHasta ? ' ' : ''}${c.vigenteHasta ? `hasta ${fechaMx(c.vigenteHasta)}` : ''}`;
};

export function VistaConvenios(p: PropsVistaConvenios) {
  const lista = p.convenios ?? [];
  const paginas = Math.max(1, Math.ceil(lista.length / CONVENIOS_POR_PAGINA));
  const pagina = Math.min(Math.max(Math.trunc(p.pagina ?? 1) || 1, 1), paginas);
  const visibles = lista.slice((pagina - 1) * CONVENIOS_POR_PAGINA, pagina * CONVENIOS_POR_PAGINA);
  const href = (extra: Record<string, string | null>): string => {
    const q = new URLSearchParams(p.sufijo.startsWith('?') ? p.sufijo.slice(1) : '');
    for (const [k, v] of Object.entries(extra)) { if (v === null) q.delete(k); else q.set(k, v); }
    const t = q.toString();
    return `/dashboard/convenios${t ? `?${t}` : ''}`;
  };
  const puedeEditarEnPantalla = p.estado === 'ok' && p.puedeEditar && !!p.accionGuardar && !!p.catalogos;
  // La base sin la 0656 no trae versiones: la edición se apaga y se dice (importar sigue funcionando).
  const edicionDisponible = puedeEditarEnPantalla && lista.every((c) => c.version !== null);
  const descarga = (tipo: string) => `/api/export/convenios?tipo=${tipo}${p.sufijo.startsWith('?') ? `&${p.sufijo.slice(1)}` : ''}`;
  return (
    <MarcoPagina titulo="Clientes" apoyo={p.verDinero
        ? 'Por cliente: puntos A a B, instrucciones de operación, tarifa y requisitos de cobro. El agente solo dice lo que el convenio dice.'
        : 'Por cliente: puntos A a B e instrucciones de operación. El agente solo dice lo que el convenio dice.'}>
      <AvisoCompacto tono="info"
        resumen="Todo nace del convenio: el punto A→B y las instrucciones de operación. Al despachar un viaje del cliente se ligan al viaje y le llegan al operador por WhatsApp. El agente solo dice lo que el convenio dice."
        mas={(
          <p>
            Las instrucciones cubren por dónde entrar, con quién reportarse, documentos y peculiaridades de la planta{p.verDinero ? ', más la tarifa y los requisitos de cobro' : ''}.
            Al acercarse a la planta se le recuerdan al operador, y puede preguntar «¿por dónde entro?». Sin instrucciones registradas, el agente lo dice y lo manda con el jefe de tráfico.
          </p>
        )} />

      {p.estado === 'ok' && (
        <TiraCifras sello={selloHoy('Convenios')}>
          <Cifra etiqueta="Convenios activos" valor={numero(lista.filter((c) => c.activo).length)} info="convenios.activos" />
          <Cifra etiqueta="Sin instrucciones" valor={numero(lista.filter((c) => c.activo && c.instrucciones.length === 0).length)}
            tono={lista.some((c) => c.activo && c.instrucciones.length === 0) ? 'warn' : undefined} info="convenios.sin_instrucciones" />
        </TiraCifras>
      )}

      {p.estado === 'no_disponible' && (
        <Aviso tono="warn">
          Los convenios todavía no están disponibles en tu cuenta; avísale a Likida y los habilita. Mientras tanto los viajes se despachan como siempre, sin instrucciones.
        </Aviso>
      )}
      {p.estado === 'error' && (
        <Aviso tono="error">No se pudieron leer los convenios ahora mismo. Intenta de nuevo en un momento.</Aviso>
      )}

      {p.estado === 'ok' && (
        <Tarjeta titulo="Convenios registrados" info="convenios.registrados"
          acciones={p.puedeExportar ? (
            <span className="rv-cv__descargas">
              <a href={descarga('instrucciones')} className="rv-cv__enlace">Descargar instrucciones (CSV, sin dinero)</a>
              <a href={descarga('texto')} className="rv-cv__enlace">Descargar texto para tu sistema</a>
              {p.verDinero && <a href={descarga('completo')} className="rv-cv__enlace">Descargar completo (con tarifa)</a>}
            </span>
          ) : undefined}>
          {lista.length === 0 ? (
            <EstadoVacio contenido icono={FileText} titulo="Todavía no hay convenios">
              Importa tu archivo más abajo: hasta entonces los viajes se despachan sin instrucciones.
            </EstadoVacio>
          ) : (
            <ul className="rv-cv__lista">
              {visibles.map((c) => (
                <li key={c.id} className="rv-cv__item" data-archivado={c.activo ? undefined : ''}>
                  <div className="rv-cv__cab">
                    <span className="rv-cv__cliente">{c.cliente}</span>
                    <span>· {c.nombre}</span>
                    {!c.activo && <span className="rv-cv__tenue">(archivado)</span>}
                    {p.puedeEditar && (
                      <form action={p.accionEstado} className="rv-cv__fin">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="activo" value={c.activo ? 'no' : 'si'} />
                        <Boton type="submit" variante="ghost" tamano="sm">{c.activo ? 'Archivar' : 'Reactivar'}</Boton>
                      </form>
                    )}
                  </div>
                  <p className="rv-cv__nota">
                    {c.origen ?? '¿origen?'} → {c.destino ?? '¿destino?'}
                    {(c.sitioOrigenNombre || c.sitioDestinoNombre) && <> · sitios: {c.sitioOrigenNombre ?? '—'} → {c.sitioDestinoNombre ?? '—'}</>}
                    {' · '}{vigencia(c)}
                  </p>
                  {edicionDisponible && c.version !== null && (p.editarId === c.id ? (
                    <div className="rv-cv__editor">
                      <Link href={href({ editar: null, pag: pagina > 1 ? String(pagina) : null })} className="rv-cv__enlace">Cerrar la edición</Link>
                      <div className="rv-cv__caja">
                        <FormaConvenio accion={p.accionGuardar!} catalogos={p.catalogos!} convenio={{ ...c, version: c.version }} />
                      </div>
                    </div>
                  ) : (
                    <Link href={href({ editar: c.id, pag: pagina > 1 ? String(pagina) : null })} className="rv-cv__enlace">Editar convenio e instrucciones</Link>
                  ))}
                  {c.instrucciones.length === 0 ? (
                    <StatusChip tono="warn">Sin instrucciones de operación: el operador no recibirá nada de este convenio.</StatusChip>
                  ) : (
                    <Disclosure variante="linea" titulo={`${c.instrucciones.length} instrucci${c.instrucciones.length === 1 ? 'ón' : 'ones'}`}>
                      <ul className="rv-cv__instrucciones">
                        {c.instrucciones.map((i, n) => (
                          <li key={n}>
                            <span className="rv-cv__cliente">{ETIQUETA_CATEGORIA[i.categoria]}:</span> {i.texto}
                            <span className="rv-cv__tenue"> ({LUGAR_TEXTO[i.lugar]}, {MOMENTO_TEXTO[i.momento]})</span>
                          </li>
                        ))}
                      </ul>
                      <Disclosure variante="linea" titulo="Texto para pegar en tu sistema">
                        <pre className="rv-cv__pre">{textoParaSistemaDeLaFlota(c)}</pre>
                      </Disclosure>
                    </Disclosure>
                  )}
                  {p.verDinero && c.comercial && (
                    <p className="rv-cv__nota">
                      Tarifa: {c.comercial.modo && c.comercial.precio !== null ? `${mxn(c.comercial.precio)} ${c.comercial.moneda} ${MODO_TEXTO[c.comercial.modo]}` : 'sin tarifa pactada'}
                      {c.comercial.requisitos.length > 0 && <> · Para cobrar: {c.comercial.requisitos.join(', ')}</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {paginas > 1 && (
            <nav aria-label="Páginas de convenios" className="rv-cv__paginas">
              <span className="rv-cv__nota">Convenios {numero((pagina - 1) * CONVENIOS_POR_PAGINA + 1)}–{numero(Math.min(pagina * CONVENIOS_POR_PAGINA, lista.length))} de {numero(lista.length)}</span>
              {pagina > 1 && <Link href={href({ pag: pagina - 1 > 1 ? String(pagina - 1) : null, editar: null })} className="rv-cv__enlace">Anterior</Link>}
              {pagina < paginas && <Link href={href({ pag: String(pagina + 1), editar: null })} className="rv-cv__enlace">Siguiente</Link>}
            </nav>
          )}
        </Tarjeta>
      )}

      {p.estado === 'ok' && p.puedeEditar && p.accionCorregir && p.viajes && (
        <Tarjeta titulo="Convenio ligado a cada viaje en curso" info="convenios.ligado_viaje">
          <p className="rv-cv__nota">
            Si el sistema ligó el convenio equivocado, o no pudo elegir porque varios empataban, corrígelo aquí: se vuelve a tomar la foto de
            instrucciones del convenio que elijas y queda como corrección manual (el despacho automático ya no lo cambia). Puedes mandarle de nuevo
            las instrucciones al operador.
          </p>
          {p.viajes.length === 0 ? (
            <p className="rv-cv__nota">No hay viajes abiertos con cliente.</p>
          ) : (
            <ul className="rv-cv__lista">
              {p.viajes.map((v) => (
                <li key={v.viajeId} className="rv-cv__item">
                  <div className="rv-cv__cab">
                    <span className="rv-cv__cliente">{v.folio}</span>
                    <span>· {v.cliente ?? 'sin cliente'}</span>
                    <span className="rv-cv__nota">{v.origen ?? '¿origen?'} → {v.destino ?? '¿destino?'}{v.operador ? ` · ${v.operador}` : ''}</span>
                  </div>
                  <p className="rv-cv__nota" data-tono={v.convenioNombre || v.ligadoPor === null ? undefined : 'warn'}>
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
        </Tarjeta>
      )}

      {puedeEditarEnPantalla && (edicionDisponible ? (
        <Tarjeta titulo="Nuevo convenio" info="convenios.nuevo">
          <Disclosure variante="linea" titulo="Capturar un convenio" abierto={lista.length === 0}>
            <p className="rv-cv__nota">
              Da de alta un convenio y su calle de instrucciones sin subir un archivo. El cliente tiene que existir en Clientes y los sitios salen del catálogo de sitios.
              La tarifa y los requisitos de cobro no se editan aquí: entran por la importación con permiso de finanzas.
            </p>
            <FormaConvenio accion={p.accionGuardar!} catalogos={p.catalogos!} />
          </Disclosure>
        </Tarjeta>
      ) : (
        <Aviso tono="warn">
          La edición de convenios en pantalla todavía no está disponible en tu cuenta; avísale a Likida y la habilita. Mientras tanto puedes importar el archivo.
        </Aviso>
      ))}

      {p.puedeEditar ? (
        <Tarjeta titulo="Importar desde CSV o Excel" info="convenios.importar">
          <Disclosure variante="linea" titulo="Importar un archivo" abierto={lista.length === 0}>
            <p className="rv-cv__nota">
              <strong>Una fila por instrucción.</strong> Columnas: <code>cliente, convenio</code> (obligatorias), <code>origen, destino, sitio_origen, sitio_destino, vigente_desde, vigente_hasta, notas</code>,
              y por instrucción <code>categoria</code> (puerta, reportarse, peculiaridad, documentos, horario, seguridad, otro), <code>instruccion</code>, <code>momento</code> (despacho, acercamiento, ambos)
              y <code>lugar</code> (origen, destino, ambos){p.verDinero ? <>; con permiso de finanzas también <code>tarifa_modo, tarifa_precio, moneda, requisitos_cobro</code></> : ''}.
              El cliente tiene que existir en Clientes y los sitios en el catálogo de sitios (por código o nombre): nada se inventa. Todo o nada: si una fila falla, no se importa ninguna y te decimos cuál corregir.
              Re-subir el mismo archivo actualiza por cliente + convenio; no duplica, y las instrucciones que ya no trae se quitan.{' '}
              {p.puedeExportar && <a href={descarga('plantilla')} className="rv-cv__enlace">Descargar la plantilla</a>}
            </p>
            <FormaImportarConvenios accion={p.accionImportar} />
          </Disclosure>
        </Tarjeta>
      ) : (
        <p className="rv-cv__pie">Solo el dueño de la flota o el jefe de tráfico editan los convenios.</p>
      )}
      <p className="rv-cv__pie">
        Las instrucciones que ya se le mandaron a un operador no cambian si editas el convenio después, salvo que marques «llevar este cambio a los viajes en curso»: cada viaje conserva las que se le dijeron.{' '}
        <Link href={`/dashboard/agentes/conductores/sitios${p.sufijo}`} className="rv-cv__enlace">Catálogo de sitios</Link>
      </p>
    </MarcoPagina>
  );
}
