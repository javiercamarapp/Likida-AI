import { cifrasUniformes } from '../formato';
import Link from 'next/link';
import { fechaMx, mxn, numero } from '@/lib/formato';
import { ETIQUETA_CATEGORIA } from '@/lib/likida/convenios/tipos';
import { textoParaSistemaDeLaFlota } from '@/lib/likida/convenios/importador';
import type { ConvenioFila, ViajeConvenioFila } from '@/lib/likida/convenios/repo';
import { FormaConvenio, FormaCorregirConvenio, FormaImportarConvenios, type AccionConvenio, type CatalogosFormaConvenio } from './formas';
import { Aviso, AvisoCompacto, Boton, BotonEnlace, Disclosure, EstadoVacio, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import './convenios.css';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { FileText } from 'lucide-react';
import { CajonAlta } from '../cajon-alta';
import '../estados.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// SOLO tipos del repositorio: la vista no arrastra al bundle el acceso a datos.

const momentoTexto = (t: TResto = T_RESTO_ES) => ({ despacho: 'al despachar', acercamiento: 'al acercarse', ambos: t('op.al_despachar_y_al_acercarse_2') } as const);
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
  /** Traductor del namespace resto (por omisión, español). */
  t?: TResto;
}

/** Cuántos convenios se pintan por página. */
export const CONVENIOS_POR_PAGINA = 50;


const vigencia = (c: ConvenioFila): string => {
  if (!c.vigenteDesde && !c.vigenteHasta) return 'sin vencimiento';
  return `${c.vigenteDesde ? `desde ${fechaMx(c.vigenteDesde)}` : ''}${c.vigenteDesde && c.vigenteHasta ? ' ' : ''}${c.vigenteHasta ? `hasta ${fechaMx(c.vigenteHasta)}` : ''}`;
};

export function VistaConvenios(p: PropsVistaConvenios) {
  const t = p.t ?? T_RESTO_ES;
  const lista = p.convenios ?? [];
  const paginas = Math.max(1, Math.ceil(lista.length / CONVENIOS_POR_PAGINA));
  const pagina = Math.min(Math.max(Math.trunc(p.pagina ?? 1) || 1, 1), paginas);
  const visibles = lista.slice((pagina - 1) * CONVENIOS_POR_PAGINA, pagina * CONVENIOS_POR_PAGINA);
  const href = (extra: Record<string, string | null>): string => {
    const q = new URLSearchParams(p.sufijo.startsWith('?') ? p.sufijo.slice(1) : '');
    for (const [k, v] of Object.entries(extra)) { if (v === null) q.delete(k); else q.set(k, v); }
    const qs = q.toString();
    return `/dashboard/convenios${qs ? `?${qs}` : ''}`;
  };
  const puedeEditarEnPantalla = p.estado === 'ok' && p.puedeEditar && !!p.accionGuardar && !!p.catalogos;
  // La base sin la 0656 no trae versiones: la edición se apaga y se dice (importar sigue funcionando).
  const edicionDisponible = puedeEditarEnPantalla && lista.every((c) => c.version !== null);
  const descarga = (tipo: string) => `/api/export/convenios?tipo=${tipo}${p.sufijo.startsWith('?') ? `&${p.sufijo.slice(1)}` : ''}`;
  const sinInstrucciones = lista.filter((c) => c.activo && c.instrucciones.length === 0).length;
  const cifras: PropsCifra[] | undefined = p.estado === 'ok' ? [
    { etiqueta: t('op.convenios_activos'), valor: numero(lista.filter((c) => c.activo).length), info: 'convenios.activos' },
    { etiqueta: t('op.sin_instrucciones'), valor: numero(sinInstrucciones), tono: sinInstrucciones > 0 ? 'warn' : undefined, info: 'convenios.sin_instrucciones' },
  ] : undefined;
  return (
    <EsqueletoTablaMaestra
      titulo={t('op.convenios_titulo')}
      apoyo={p.verDinero
        ? t('op.por_cliente_puntos_a_a_b')
        : t('op.por_cliente_puntos_a_a_b_2')}
      acciones={p.puedeEditar ? (
        <>
          <CajonAlta id="importar" titulo={t('op.importar_desde_csv_o_excel')} disparador={t('op.importar_un_archivo')} tamano="xl">
            <p className="rv-cv__nota">{rico(t('op.strong_una_fila_por_instruccion_strong'), { strong: (c) => <strong>{c}</strong>, code: (c) => <code>{c}</code> })}{p.verDinero ? <>{rico(t('op.con_permiso_de_finanzas_tambien_code'), { code: (c) => <code>{c}</code> })}</> : ''}{t('op.el_cliente_tiene_que_existir_en')}{' '}{p.puedeExportar && <a href={descarga('plantilla')} className="rv-cv__enlace">{t('op.descargar_la_plantilla')}</a>}
            </p>
            <FormaImportarConvenios accion={p.accionImportar} />
          </CajonAlta>
          {edicionDisponible ? (
            <CajonAlta id="alta" titulo={t('op.nuevo_convenio')} descripcion={t('op.da_de_alta_un_convenio_y')} disparador={t('op.capturar_un_convenio')} primario tamano="xl">
              <FormaConvenio accion={p.accionGuardar!} catalogos={p.catalogos!} />
            </CajonAlta>
          ) : null}
        </>
      ) : undefined}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy('Convenios')}
      avisos={(
        <>
          <AvisoCompacto tono="info"
            resumen={t('op.todo_nace_del_convenio_el_punto')}
            mas={(
              <p>{t('op.las_instrucciones_cubren_por_donde_entrar')}{p.verDinero ? t('op.mas_la_tarifa_y_los_requisitos') : ''}{t('op.al_acercarse_a_la_planta_se')}</p>
            )} />
          {p.estado === 'no_disponible' && (
            <Aviso tono="warn">{t('op.los_convenios_todavia_no_estan_disponibles')}</Aviso>
          )}
          {p.estado === 'error' && (
            <Aviso tono="error">{t('op.no_se_pudieron_leer_los_convenios')}</Aviso>
          )}
        </>
      )}
    >
      {p.estado === 'ok' && (
        <Tarjeta titulo={t('op.convenios_registrados')} info="convenios.registrados">
          {p.puedeExportar ? (
            <div className="rv-cv__descargas" role="group" aria-label={t('op.convenios_registrados')}>
              <BotonEnlace variante="secondary" tamano="sm" href={descarga('instrucciones')}>{t('op.descargar_instrucciones_csv')}</BotonEnlace>
              <BotonEnlace variante="secondary" tamano="sm" href={descarga('texto')}>{t('op.descargar_texto_para_tu_sistema')}</BotonEnlace>
              {p.verDinero ? <BotonEnlace variante="secondary" tamano="sm" href={descarga('completo')}>{t('op.descargar_completo_con_tarifa')}</BotonEnlace> : null}
            </div>
          ) : null}
          {lista.length === 0 ? (
            <EstadoVacio contenido icono={FileText} titulo={t('op.todavia_no_hay_convenios')}>{t('op.importa_tu_archivo_mas_abajo_hasta')}</EstadoVacio>
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
                    {c.origen ?? t('op.origen')} → {c.destino ?? t('op.destino')}
                    {(c.sitioOrigenNombre || c.sitioDestinoNombre) && <>{t('op.sitios')}{' '}{c.sitioOrigenNombre ?? '—'} → {c.sitioDestinoNombre ?? '—'}</>}
                    {' · '}{vigencia(c)}
                  </p>
                  {edicionDisponible && c.version !== null && (p.editarId === c.id ? (
                    <div className="rv-cv__editor">{rico(t('op.e0_cerrar_la_edicion_e0'), { e0: (c) => <Link href={href({ editar: null, pag: pagina > 1 ? String(pagina) : null })} className="rv-cv__enlace">{c}</Link> })}<div className="rv-cv__caja">
                        <FormaConvenio accion={p.accionGuardar!} catalogos={p.catalogos!} convenio={{ ...c, version: c.version }} />
                      </div>
                    </div>
                  ) : (
                    <Link href={href({ editar: c.id, pag: pagina > 1 ? String(pagina) : null })} className="rv-cv__enlace">{t('op.editar_convenio_e_instrucciones')}</Link>
                  ))}
                  {c.instrucciones.length === 0 ? (
                    <StatusChip tono="warn">{t('op.sin_instrucciones_de_operacion_el_operador')}</StatusChip>
                  ) : (
                    <Disclosure variante="linea" titulo={t(c.instrucciones.length === 1 ? 'op.n_instruccion.uno' : 'op.n_instruccion.otros', { n: c.instrucciones.length })}>
                      <ul className="rv-cv__instrucciones">
                        {c.instrucciones.map((i, n) => (
                          <li key={n}>
                            <span className="rv-cv__cliente">{ETIQUETA_CATEGORIA[i.categoria]}:</span> {i.texto}
                            <span className="rv-cv__tenue"> ({LUGAR_TEXTO[i.lugar]}, {momentoTexto(t)[i.momento]})</span>
                          </li>
                        ))}
                      </ul>
                      <Disclosure variante="linea" titulo={t('op.texto_para_pegar_en_tu_sistema')}>
                        <pre className="rv-cv__pre">{textoParaSistemaDeLaFlota(c)}</pre>
                      </Disclosure>
                    </Disclosure>
                  )}
                  {p.verDinero && c.comercial && (
                    <p className="rv-cv__nota">{t('op.tarifa')}{' '}{c.comercial.modo && c.comercial.precio !== null ? `${mxn(c.comercial.precio)} ${c.comercial.moneda} ${MODO_TEXTO[c.comercial.modo]}` : 'sin tarifa pactada'}
                      {c.comercial.requisitos.length > 0 && <>{t('op.para_cobrar')}{' '}{c.comercial.requisitos.join(', ')}</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {paginas > 1 && (
            <nav aria-label={t('op.paginas_de_convenios')} className="rv-cv__paginas">{rico(t('op.e0_convenios_de_e0', { numero: numero((pagina - 1) * CONVENIOS_POR_PAGINA + 1), numero2: numero(Math.min(pagina * CONVENIOS_POR_PAGINA, lista.length)), numero3: numero(lista.length) }), { e0: (c) => <span className="rv-cv__nota">{c}</span> })}{pagina > 1 && <Link href={href({ pag: pagina - 1 > 1 ? String(pagina - 1) : null, editar: null })} className="rv-cv__enlace">{t('op.anterior')}</Link>}
              {pagina < paginas && <Link href={href({ pag: String(pagina + 1), editar: null })} className="rv-cv__enlace">{t('op.siguiente')}</Link>}
            </nav>
          )}
        </Tarjeta>
      )}

      {p.estado === 'ok' && p.puedeEditar && p.accionCorregir && p.viajes && (
        <Tarjeta titulo={t('op.convenio_ligado_a_cada_viaje_en')} info="convenios.ligado_viaje">
          <p className="rv-cv__nota">{t('op.si_el_sistema_ligo_el_convenio')}</p>
          {p.viajes.length === 0 ? (
            <EstadoVacio contenido titulo={t('op.no_hay_viajes_abiertos_con_cliente')} />
          ) : (
            <ul className="rv-cv__lista">
              {p.viajes.map((v) => (
                <li key={v.viajeId} className="rv-cv__item">
                  <div className="rv-cv__cab">
                    <span className="rv-cv__cliente">{v.folio}</span>
                    <span>· {v.cliente ?? 'sin cliente'}</span>
                    <span className="rv-cv__nota">{v.origen ?? t('op.origen')} → {v.destino ?? t('op.destino')}{v.operador ? ` · ${v.operador}` : ''}</span>
                  </div>
                  <p className="rv-cv__nota" data-tono={v.convenioNombre || v.ligadoPor === null ? undefined : 'warn'}>
                    {v.ligadoPor === null
                      ? t('op.sin_convenio_ligado_todavia_nunca_se')
                      : v.convenioNombre
                        ? t('op.ligado_convenio', { convenio: v.convenioNombre, por: v.ligadoPor === 'manual' ? t('op.correccion_manual') : t('op.automatico'), instrucciones: t(v.instrucciones === 1 ? 'op.n_instruccion.uno' : 'op.n_instruccion.otros', { n: v.instrucciones }), enviadas: v.despachoEnviado ? t('op.ya_enviadas_al_operador') : '' })
                        : t('op.sin_convenio_decision_de_la_oficina')}
                  </p>
                  <FormaCorregirConvenio accion={p.accionCorregir!} viajeId={v.viajeId} folio={v.folio} actual={v.convenioId} opciones={v.opciones} />
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      )}

      {puedeEditarEnPantalla && !edicionDisponible ? (
        <Aviso tono="warn">{t('op.la_edicion_de_convenios_en_pantalla')}</Aviso>
      ) : null}
      {!p.puedeEditar ? <p className="rv-cv__pie">{t('op.solo_el_dueno_de_la_flota')}</p> : null}
      <p className="rv-cv__pie">{rico(t('op.las_instrucciones_que_ya_se_le'), { e0: (c) => <Link href={`/dashboard/agentes/conductores/sitios${p.sufijo}`} className="rv-cv__enlace">{c}</Link> })}</p>
    </EsqueletoTablaMaestra>
  );
}
