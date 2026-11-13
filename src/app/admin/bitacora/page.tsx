import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import {
  FILAS_BITACORA, leerPaginaAccesos, leerPaginaBitacora, normalizarFiltroBitacora, opcionesBitacora,
  type AccesoSuperadmin, type EntradaBitacora, type FiltroBitacora, type PaginaAccesos, type PaginaBitacora,
} from '@/lib/admin/bitacora';
import { fechaHoraMx, numero } from '@/lib/formato';
import {
  Aviso, BarraFiltros, BotonEnlace, EstadoError, FiltroBusqueda, FiltroOpciones, StatusChip, hrefConParams,
  type OpcionFiltro,
} from '@/app/ui-v2/componentes';
import { SelloDato, TablaLista, type ColumnaTabla } from '@/app/ui-v2/datos';
import { ahoraMs } from '@/lib/saludo';
import { PiePaginas } from '../pie-paginas';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { quienDe } from './quien';
import { FiltroFechaIso } from './filtro-fecha-iso';
import { etiquetaAccion, etiquetaEntidad, rotuloTipoAcceso } from './etiquetas';
import '../sistema.css';
import { ChipCopiable } from './chip-copiable';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';
export const dynamic = 'force-dynamic';

type SP = { accion?: string; persona?: string; flota?: string; desde?: string; hasta?: string; p?: string; vista?: string };

function columnasAcciones(t: TrDe<'admin_inicio'>, ts: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaTabla<EntradaBitacora>[] {
  return [
    { id: 'cuando', titulo: t('bitacora.cuando'), corta: true, celda: (e) => fechaHoraMx(e.ocurrioEn, idioma) },
    { id: 'que', titulo: t('bitacora.que_se_hizo'), principal: true, celda: (e) => etiquetaAccion(e.accion, ts) },
    { id: 'quien', titulo: t('bitacora.quien'), celda: (e) => <ChipCopiable texto={quienDe(e.actor)} mono={false} copiar={ts('bitacora.copiar')} copiado={ts('bitacora.copiado')} /> },
    { id: 'registro', titulo: ts('bitacora.col_registro'), corta: true, celda: (e) => <ChipCopiable texto={`#${e.id}`} copiar={ts('bitacora.copiar')} copiado={ts('bitacora.copiado')} /> },
    { id: 'flota', titulo: t('bitacora.flota'), celda: (e) => e.tenantNombre ?? (e.tenantId === null ? ts('bitacora_etiquetas.plataforma') : '—') },
    { id: 'sobre', titulo: t('bitacora.sobre_que'), celda: (e) => etiquetaEntidad(e.entidad, ts) },
  ];
}

function columnasAccesos(t: TrDe<'admin_inicio'>, ts: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaTabla<AccesoSuperadmin>[] {
  return [
    { id: 'cuando', titulo: t('bitacora.cuando'), corta: true, celda: (a) => fechaHoraMx(a.creadoEn, idioma) },
    { id: 'quien', titulo: t('bitacora.quien'), principal: true, celda: (a) => <ChipCopiable texto={quienDe(a.actor)} mono={false} copiar={ts('bitacora.copiar')} copiado={ts('bitacora.copiado')} /> },
    { id: 'tipo', titulo: t('bitacora.que_hizo'), celda: (a) => <StatusChip tono={a.tipo === 'descarga' ? 'warn' : 'neutral'}>{rotuloTipoAcceso(ts)[a.tipo]}</StatusChip> },
    { id: 'flota', titulo: t('bitacora.flota'), celda: (a) => a.tenantNombre ?? '—' },
    { id: 'ruta', titulo: t('bitacora.pantalla'), celda: (a) => <span className="adm-sis-dato">{a.ruta}</span> },
  ];
}

/** El panel de Rovaq (P7): «N REGISTROS» en versalitas, el título y el sello de solo lectura arriba; la tabla y su pie dentro del mismo marco.
 *  Sin identificador de la persona que mira: esta pantalla no muestra ids ni correos (ver la nota de BitacoraPage). */
function PanelRegistros({ total, titulo, rotulo, solo, children }: { total: number; titulo: string; rotulo: string; solo: string; children: React.ReactNode }) {
  return (
    <section className="adm-bit-panel" aria-label={titulo}>
      <header className="adm-bit-panel__cab">
        <div className="adm-bit-panel__tit">
          <span className="adm-bit-panel__kicker">{numero(total)} {rotulo}</span>
          <h2 className="adm-bit-panel__h">{titulo}</h2>
        </div>
        <span className="adm-bit-panel__id">{solo}</span>
      </header>
      {children}
    </section>
  );
}

/**
 * BITÁCORA — qué se hizo en la consola, por quién y en qué flota. SOLO LECTURA: filtros por acción, persona, flota y fechas, con
 * páginas y total real. Une `bitacora_auditoria` con los accesos del superadmin (`superadmin_acceso`) cuando esa tabla ya tiene filas.
 *
 * Sin datos personales en pantalla: no se muestra el detalle de cada acción (puede traer referencias a terceros), ni correos, ni
 * identificadores. Una lectura caída se dice («no es que nadie haya tocado nada»): una bitácora vacía sobre una base caída
 * afirmaría justo lo contrario de lo que existe para demostrar.
 */
export default async function BitacoraPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { t } = await getT('admin_inicio');
  const { t: ts, idioma } = await getT('admin_sistema');
  await requireSuperadmin();
  const sp = await searchParams;
  const filtro: FiltroBitacora = normalizarFiltroBitacora({ accion: sp.accion, actorId: sp.persona, tenantId: sp.flota, desde: sp.desde, hasta: sp.hasta });
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1);
  const alReves = filtro.desde !== undefined && filtro.hasta !== undefined && filtro.desde > filtro.hasta;
  const nFiltros = Object.keys(filtro).length;

  // Los accesos del superadmin: la pestaña solo existe si la tabla ya tiene filas (una tabla vacía no es una vista).
  const sondeoAccesos: PaginaAccesos | null = await leerPaginaAccesos({}, 1, 1).catch((e: unknown) => {
    logger.error('admin.bitacora.accesos_sondeo', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });
  const hayAccesos = (sondeoAccesos?.total ?? 0) > 0;
  const vista: 'acciones' | 'accesos' = sp.vista === 'accesos' && hayAccesos ? 'accesos' : 'acciones';

  const opciones = await opcionesBitacora();

  let lectura: PaginaBitacora | null = null;
  let accesos: PaginaAccesos | null = null;
  if (!alReves) {
    try {
      if (vista === 'acciones') lectura = await leerPaginaBitacora(filtro, pagina);
      else accesos = await leerPaginaAccesos(filtro, pagina);
    } catch (e) {
      logger.error('admin.bitacora', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  const params = { accion: filtro.accion, persona: filtro.actorId, flota: filtro.tenantId, desde: filtro.desde, hasta: filtro.hasta, vista: vista === 'accesos' ? 'accesos' : undefined };
  const opcionesFlota: OpcionFiltro[] | null = opciones.flotas === null ? null : [
    { valor: '', rotulo: t('bitacora.todas_las_flotas') }, { valor: 'plataforma', rotulo: t('bitacora.plataforma_sin_flota') },
    ...opciones.flotas.map((f) => ({ valor: f.id, rotulo: f.nombre })),
  ];
  const opcionesPersona: OpcionFiltro[] | null = opciones.personas === null ? null : [
    { valor: '', rotulo: t('bitacora.cualquier_persona') }, ...opciones.personas.map((u) => ({ valor: u.id, rotulo: u.nombre })),
  ];
  const lecturaActual = vista === 'acciones' ? lectura : accesos;

  return (
    <EsqueletoTablaMaestra
      titulo={t('bitacora.bitacora')}
      apoyo={t('bitacora.lo_que_se_hizo')}
      acciones={<BotonEnlace href="/admin/copiloto" variante="secondary" tamano="sm">Copiloto</BotonEnlace>}
      filtros={<>
      {hayAccesos ? (
        <div className="adm-sis-acciones" role="group" aria-label={t('bitacora.que_registro_ver')}>
          <BotonEnlace href={hrefConParams('/admin/bitacora', params, { vista: null, p: null })} variante={vista === 'acciones' ? 'primary' : 'secondary'} tamano="sm" aria-current={vista === 'acciones' ? 'true' : undefined}>Acciones</BotonEnlace>
          <BotonEnlace href={hrefConParams('/admin/bitacora', params, { vista: 'accesos', p: null })} variante={vista === 'accesos' ? 'primary' : 'secondary'} tamano="sm" aria-current={vista === 'accesos' ? 'true' : undefined}>{t('bitacora.accesos_del_equipo')}</BotonEnlace>
        </div>
      ) : null}

      <BarraFiltros accion="/admin/bitacora" enLinea buscar etiqueta={t('bitacora.filtrar_la_bitacora')} nActivos={nFiltros} limpiarHref={vista === 'accesos' ? '/admin/bitacora?vista=accesos' : '/admin/bitacora'}
        ocultos={vista === 'accesos' ? { vista: 'accesos' } : {}}>
        {vista === 'acciones' ? <FiltroBusqueda nombre="accion" valor={filtro.accion ?? ''} etiqueta={t('bitacora.accion')} placeholder={t('bitacora.accion_flota_usuario')} /> : null}
        {opcionesFlota ? <FiltroOpciones etiqueta={t('bitacora.flota')} nombre="flota" valor={filtro.tenantId ?? ''} opciones={opcionesFlota} /> : null}
        {opcionesPersona ? <FiltroOpciones etiqueta={t('bitacora.persona')} nombre="persona" valor={filtro.actorId ?? ''} opciones={opcionesPersona} /> : null}
        <FiltroFechaIso nombre="desde" etiqueta={t('bitacora.desde')} valor={filtro.desde} plantilla={ts('bitacora.plantilla_fecha')} />
        <FiltroFechaIso nombre="hasta" etiqueta={t('bitacora.hasta')} valor={filtro.hasta} plantilla={ts('bitacora.plantilla_fecha')} />
      </BarraFiltros>
      </>}
      avisos={(opciones.flotas === null || opciones.personas === null || alReves || (vista === 'accesos' && accesos !== null && !accesos.existe)) ? <>
      {opciones.flotas === null || opciones.personas === null ? (
        <Aviso tono="warn" titulo={t('bitacora.falta_una_lista_de')}>
          
          {t('bitacora.no_se_pudo_leer')} {opciones.flotas === null && opciones.personas === null ? t('bitacora.la_lista_de_flotas') : opciones.flotas === null ? t('bitacora.la_lista_de_flotas_2') : t('bitacora.la_lista_de_personas')}{t('bitacora.ese_filtro_no_esta')}
        </Aviso>
      ) : null}
      {alReves ? <Aviso tono="warn" titulo={t('bitacora.el_rango_esta_al')}>{t('bitacora.la_fecha_desde_es')}</Aviso> : null}
      {vista === 'accesos' && accesos !== null && !accesos.existe ? (
        <Aviso tono="info" titulo={t('bitacora.este_registro_todavia_no')}>{t('bitacora.los_accesos_del_equipo')}</Aviso>
      ) : null}
      </> : null}
    >
      {alReves ? null : lecturaActual === null ? (
        <EstadoError reintentar>{t('bitacora.no_se_pudo_leer_2')}</EstadoError>
      ) : vista === 'acciones' && lectura ? (
        <PanelRegistros total={lectura.total} titulo={ts('bitacora.panel_acciones')} rotulo={ts(lectura.total === 1 ? 'bitacora.registro_uno' : 'bitacora.registros_otros')} solo={ts('bitacora.solo_lectura')}>
          <TablaLista<EntradaBitacora>
            etiqueta={t('bitacora.acciones_registradas')} columnas={columnasAcciones(t, ts, idioma)} filas={lectura.filas} idFila={(e) => String(e.id)} base="/admin/bitacora" params={params}
            vacio={nFiltros > 0
              ? { titulo: t('bitacora.ninguna_entrada_con_ese'), texto: t('bitacora.quita_un_filtro_o') }
              : { titulo: t('bitacora.la_bitacora_esta_vacia'), texto: t('bitacora.aun_no_se_ha') }}
          />
          <PiePaginas base="/admin/bitacora" params={params} pagina={lectura.pagina} paginas={lectura.paginas} total={lectura.total} tamano={FILAS_BITACORA} unidad="entradas" />
        </PanelRegistros>
      ) : accesos && accesos.existe ? (
        <PanelRegistros total={accesos.total} titulo={ts('bitacora.panel_accesos')} rotulo={ts(accesos.total === 1 ? 'bitacora.registro_uno' : 'bitacora.registros_otros')} solo={ts('bitacora.solo_lectura')}>
          <TablaLista<AccesoSuperadmin>
            etiqueta={t('bitacora.accesos_del_equipo')} columnas={columnasAccesos(t, ts, idioma)} filas={accesos.filas} idFila={(a) => String(a.id)} base="/admin/bitacora" params={params}
            vacio={{ titulo: t('bitacora.ningun_acceso_con_ese'), texto: t('bitacora.quita_un_filtro_o') }}
          />
          <PiePaginas base="/admin/bitacora" params={params} pagina={accesos.pagina} paginas={accesos.paginas} total={accesos.total} tamano={FILAS_BITACORA} unidad="accesos" />
        </PanelRegistros>
      ) : null}

      <p className="adm-sis-nota">
        
        {t('bitacora.el_orden_es_del')}
      </p>
      <div>
        <SelloDato tipo="observado" fuente="Bitácora de auditoría" leidoEn={ahoraMs()} edad={false} />
      </div>
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_inicio');
  return { title: t('bitacora.bitacora') };
}
