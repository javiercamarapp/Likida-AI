import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import {
  FILAS_BITACORA, leerPaginaAccesos, leerPaginaBitacora, normalizarFiltroBitacora, opcionesBitacora,
  type AccesoSuperadmin, type EntradaBitacora, type FiltroBitacora, type PaginaAccesos, type PaginaBitacora,
} from '@/lib/admin/bitacora';
import { fechaHoraMx } from '@/lib/formato';
import {
  Aviso, BarraFiltros, BotonEnlace, EstadoError, FiltroBusqueda, FiltroFecha, FiltroOpciones, MarcoPagina, StatusChip, hrefConParams,
  type OpcionFiltro,
} from '@/app/ui-v2/componentes';
import { SelloDato, TablaLista, type ColumnaTabla } from '@/app/ui-v2/datos';
import { ahoraMs } from '@/lib/saludo';
import { PiePaginas } from '../pie-paginas';
import { etiquetaAccion, etiquetaEntidad, ROTULO_TIPO_ACCESO } from './etiquetas';
import '../sistema.css';

export const dynamic = 'force-dynamic';

type SP = { accion?: string; persona?: string; flota?: string; desde?: string; hasta?: string; p?: string; vista?: string };

/** Quién, sin correos: un nombre, «Sistema» (una tarea programada o un escritor viejo sin firma) o «Persona sin nombre». */
export function quienDe(actor: string | null): string {
  if (actor === null || actor.trim() === '') return 'Sistema';
  return actor.includes('@') ? 'Persona sin nombre' : actor;
}

function columnasAcciones(): ColumnaTabla<EntradaBitacora>[] {
  return [
    { id: 'cuando', titulo: 'Cuándo', corta: true, celda: (e) => fechaHoraMx(e.ocurrioEn) },
    { id: 'que', titulo: 'Qué se hizo', principal: true, celda: (e) => etiquetaAccion(e.accion) },
    { id: 'quien', titulo: 'Quién', celda: (e) => quienDe(e.actor) },
    { id: 'flota', titulo: 'Flota', celda: (e) => e.tenantNombre ?? (e.tenantId === null ? 'Plataforma' : '—') },
    { id: 'sobre', titulo: 'Sobre qué', celda: (e) => etiquetaEntidad(e.entidad) },
  ];
}

function columnasAccesos(): ColumnaTabla<AccesoSuperadmin>[] {
  return [
    { id: 'cuando', titulo: 'Cuándo', corta: true, celda: (a) => fechaHoraMx(a.creadoEn) },
    { id: 'quien', titulo: 'Quién', principal: true, celda: (a) => quienDe(a.actor) },
    { id: 'tipo', titulo: 'Qué hizo', celda: (a) => <StatusChip tono={a.tipo === 'descarga' ? 'warn' : 'neutral'}>{ROTULO_TIPO_ACCESO[a.tipo]}</StatusChip> },
    { id: 'flota', titulo: 'Flota', celda: (a) => a.tenantNombre ?? '—' },
    { id: 'ruta', titulo: 'Pantalla', celda: (a) => <span className="adm-sis-dato">{a.ruta}</span> },
  ];
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
    { valor: '', rotulo: 'Todas las flotas' }, { valor: 'plataforma', rotulo: 'Plataforma (sin flota)' },
    ...opciones.flotas.map((f) => ({ valor: f.id, rotulo: f.nombre })),
  ];
  const opcionesPersona: OpcionFiltro[] | null = opciones.personas === null ? null : [
    { valor: '', rotulo: 'Cualquier persona' }, ...opciones.personas.map((u) => ({ valor: u.id, rotulo: u.nombre })),
  ];
  const lecturaActual = vista === 'acciones' ? lectura : accesos;

  return (
    <MarcoPagina titulo="Bitácora" apoyo="Lo que se hizo en la consola, por quién y en qué flota. Solo lectura.">
      {hayAccesos ? (
        <div className="adm-sis-acciones" role="group" aria-label="Qué registro ver">
          <BotonEnlace href={hrefConParams('/admin/bitacora', params, { vista: null, p: null })} variante={vista === 'acciones' ? 'primary' : 'secondary'} tamano="sm" aria-current={vista === 'acciones' ? 'true' : undefined}>Acciones</BotonEnlace>
          <BotonEnlace href={hrefConParams('/admin/bitacora', params, { vista: 'accesos', p: null })} variante={vista === 'accesos' ? 'primary' : 'secondary'} tamano="sm" aria-current={vista === 'accesos' ? 'true' : undefined}>Accesos del equipo</BotonEnlace>
        </div>
      ) : null}

      <BarraFiltros accion="/admin/bitacora" enLinea buscar etiqueta="Filtrar la bitácora" nActivos={nFiltros} limpiarHref={vista === 'accesos' ? '/admin/bitacora?vista=accesos' : '/admin/bitacora'}
        ocultos={vista === 'accesos' ? { vista: 'accesos' } : {}}>
        {vista === 'acciones' ? <FiltroBusqueda nombre="accion" valor={filtro.accion ?? ''} etiqueta="Acción" placeholder="Acción (flota, usuario…)" /> : null}
        {opcionesFlota ? <FiltroOpciones etiqueta="Flota" nombre="flota" valor={filtro.tenantId ?? ''} opciones={opcionesFlota} /> : null}
        {opcionesPersona ? <FiltroOpciones etiqueta="Persona" nombre="persona" valor={filtro.actorId ?? ''} opciones={opcionesPersona} /> : null}
        <FiltroFecha nombre="desde" etiqueta="Desde" valor={filtro.desde} />
        <FiltroFecha nombre="hasta" etiqueta="Hasta" valor={filtro.hasta} />
      </BarraFiltros>

      {opciones.flotas === null || opciones.personas === null ? (
        <Aviso tono="warn" titulo="Falta una lista de filtros">
          No se pudo leer {opciones.flotas === null && opciones.personas === null ? 'la lista de flotas ni la de personas' : opciones.flotas === null ? 'la lista de flotas' : 'la lista de personas'}: ese filtro no está disponible ahora. La bitácora no depende de él.
        </Aviso>
      ) : null}
      {alReves ? <Aviso tono="warn" titulo="El rango está al revés">La fecha «desde» es posterior a «hasta», así que no puede haber entradas. Corrige las fechas.</Aviso> : null}
      {vista === 'accesos' && accesos !== null && !accesos.existe ? (
        <Aviso tono="info" titulo="Este registro todavía no existe en esta base">Los accesos del equipo se empiezan a guardar cuando se activa ese registro.</Aviso>
      ) : null}

      {alReves ? null : lecturaActual === null ? (
        <EstadoError reintentar>No se pudo leer la bitácora. Esto NO quiere decir que nadie haya tocado nada: quiere decir que no se sabe.</EstadoError>
      ) : vista === 'acciones' && lectura ? (
        <>
          <TablaLista<EntradaBitacora>
            etiqueta="Acciones registradas" columnas={columnasAcciones()} filas={lectura.filas} idFila={(e) => String(e.id)} base="/admin/bitacora" params={params}
            vacio={nFiltros > 0
              ? { titulo: 'Ninguna entrada con ese filtro', texto: 'Quita un filtro o amplía el rango de fechas.' }
              : { titulo: 'La bitácora está vacía', texto: 'Aún no se ha registrado ninguna acción administrativa.' }}
          />
          <PiePaginas base="/admin/bitacora" params={params} pagina={lectura.pagina} paginas={lectura.paginas} total={lectura.total} tamano={FILAS_BITACORA} unidad="entradas" />
        </>
      ) : accesos && accesos.existe ? (
        <>
          <TablaLista<AccesoSuperadmin>
            etiqueta="Accesos del equipo" columnas={columnasAccesos()} filas={accesos.filas} idFila={(a) => String(a.id)} base="/admin/bitacora" params={params}
            vacio={{ titulo: 'Ningún acceso con ese filtro', texto: 'Quita un filtro o amplía el rango de fechas.' }}
          />
          <PiePaginas base="/admin/bitacora" params={params} pagina={accesos.pagina} paginas={accesos.paginas} total={accesos.total} tamano={FILAS_BITACORA} unidad="accesos" />
        </>
      ) : null}

      <p className="adm-sis-nota">
        El orden es del más reciente al más antiguo. De cada acción se guarda un detalle (motivo, valores anteriores) que aquí no se muestra: puede traer datos de terceros y la pantalla es solo para ver qué pasó, quién y dónde.
      </p>
      <div>
        <SelloDato tipo="observado" fuente="Bitácora de auditoría" leidoEn={ahoraMs()} edad={false} />
      </div>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Bitácora' };
