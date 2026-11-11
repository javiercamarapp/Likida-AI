import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Camera, ShieldCheck, TriangleAlert } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  listarMesaAsistencia, tomarControlMesa, resolverDesdeMesa, reescalarDesdeMesa,
  ROTULO_EVENTO, type IncidenciaMesa,
} from '@/lib/likida/mesa_control';
import { NIVEL_MAXIMO } from '@/lib/likida/asistencia_escalamiento';
import { fechaHoraMx, cifrasUniformes } from '../formato';
import { logger } from '@/lib/logger';
import { BotonAccionMesa } from './boton-accion';
import type { Metadata } from 'next';
import {
  BarraFiltros, BotonEnlace, CampoTexto, Chip, Disclosure, EstadoVacio, FiltroOpciones, FormaConAviso, Icono, StatusChip, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { TarjetaTabla } from '../bloque';
import './asistencia.css';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { TablaLista, type ColumnaTabla } from '@/app/ui-v2/datos';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { sufijoTenant } from '../sufijo';
import { numero } from '@/lib/formato';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('operacion');
  return { title: t('meta.asistencia') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/asistencia';

/** Cómo se llama cada clase de incidencia en palabras de la oficina (los valores crudos son del sistema). */
const ROTULO_TIPO: Record<string, 'asist.tipo.siniestro' | 'asist.tipo.robo' | 'asist.tipo.emergencia_medica' | 'asist.tipo.varado' | 'asist.tipo.bloqueo'> = {
  siniestro: 'asist.tipo.siniestro', robo: 'asist.tipo.robo', emergencia_medica: 'asist.tipo.emergencia_medica', varado: 'asist.tipo.varado',
  bloqueo: 'asist.tipo.bloqueo',
};
const ROTULO_PRIORIDAD: Record<string, 'asist.prio.critica' | 'asist.prio.alta'> = { critica: 'asist.prio.critica', alta: 'asist.prio.alta' };
/** Una clave que no está en el mapa sale legible (sin guiones bajos), no en crudo. */
const legible = (clave: string) => { const t = clave.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * La puerta compartida de las tres acciones: re-gatea ADENTRO (el rol del render no es el de la llamada). A nivel de módulo y SIN
 * 'use server' a propósito (A37-S16-07): declarada dentro del componente con 'use server' era un endpoint invocable por POST
 * directo que devolvía el tenantId y el userId de la sesión; así es solo una función interna de las acciones.
 */
async function gate(sp: { tenant?: string; rol?: string; vista?: string }, tenantId: string): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const { t } = await getT('operacion');
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA)) return { error: t('asist.a.rol') };
  return { tenantId: s.tenantId, userId: s.userId };
}

/**
 * MESA DE CONTROL (Capa F del agente de ayuda en ruta).
 *
 * El agente escribe el expediente y propone; aquí el humano DECIDE. La
 * pantalla enseña las incidencias de asistencia vivas — crítica arriba, la
 * más vieja primero — con el timeline completo de cada una (la bitácora
 * `incidencia_evento`: qué pasó, cuándo, por qué canal) y tres
 * intervenciones: tomar el control (detiene el escalamiento automático),
 * subir el nivel a mano, y cerrar con nota obligatoria.
 *
 * Lo que esta pantalla JAMÁS hace: marcar 911 o a la aseguradora (una llamada
 * abre un siniestro — dinero y acto jurídico del cliente), cerrar sin nota, o
 * pintar como "todo bien" lo que no se pudo leer.
 */
export default async function PaginaMesaControl({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string; ver?: string; f?: string }>;
}) {
  const { t, tp, idioma } = await getT('operacion');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // `leyoOk`: una mesa con datos a medias invita a decidir sobre lo que no se
  // ve. Con la lectura caída no hay botones — solo el aviso honesto.
  let incidencias: IncidenciaMesa[] = [];
  let leyoOk = true;
  try {
    incidencias = await listarMesaAsistencia(tenantId);
  } catch (e) {
    leyoOk = false;
    logger.warn('mesa.no_leida', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  // ── Server actions — re-gateo ADENTRO (el rol del render no es el de la
  //    llamada, y una action es alcanzable sin pasar por la página) ─────────

  async function tomarControl(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
    if ('error' in g) return { error: g.error };
    const r = await tomarControlMesa(g.tenantId, String(fd.get('id') ?? ''), g.userId);
    if ('error' in r) { logger.warn('mesa.tomar_control', { detalle: r.error }); return { error: r.error }; }
    revalidatePath(RUTA);
    return { ok: t('asist.a.tomado') };
  }

  async function reescalar(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
    if ('error' in g) return { error: g.error };
    const r = await reescalarDesdeMesa(
      g.tenantId, String(fd.get('id') ?? ''), g.userId, Number(fd.get('nivel')),
    );
    if ('error' in r) { logger.warn('mesa.reescalar', { detalle: r.error }); return { error: r.error }; }
    revalidatePath(RUTA);
    return { ok: t('asist.a.subido') };
  }

  async function resolver(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const g = await gate(sp, tenantId);
    if ('error' in g) return { error: g.error };
    const r = await resolverDesdeMesa(
      g.tenantId, String(fd.get('id') ?? ''), g.userId, String(fd.get('nota') ?? ''),
    );
    if ('error' in r) return { error: r.error };
    revalidatePath(RUTA);
    return { ok: r.ok };
  }

  const criticas = leyoOk ? incidencias.filter((i) => i.prioridad === 'critica').length : null;

  // Una línea (≈90 caracteres): cuántas incidencias vivas hay y cuántas son críticas.
  const apoyo = leyoOk
          ? `${tp('asist.apoyo.vivas', incidencias.length)}${criticas ? tp('asist.apoyo.criticas', criticas) : ''}${t('asist.apoyo.cola')}`
          : t('asist.sindatos');

  const hrefBase = `${RUTA}${sufijoTenant(sp)}`;
  const hrefVer = (id: string | null) => {
    const qs = new URLSearchParams(sufijoTenant(sp).replace(/^\?/, ''));
    if (id) qs.set('ver', id); else qs.delete('ver');
    const q = qs.toString();
    return `${RUTA}${q ? `?${q}` : ''}`;
  };
  const nombreTipo = (tipo: string) => (ROTULO_TIPO[tipo] ? t(ROTULO_TIPO[tipo]) : legible(tipo));
  const nombrePrio = (p: string) => (ROTULO_PRIORIDAD[p] ? t(ROTULO_PRIORIDAD[p]) : legible(p));

  // La mesa SOLO ofrece el cajón de una incidencia que la lectura del tenant trajo: un `?ver=` ajeno o inventado no abre nada.
  const verId = (sp.ver ?? '').trim().slice(0, 64);
  const seleccion = leyoOk && verId ? incidencias.findIndex((i) => i.id === verId) : -1;
  const sel = seleccion >= 0 ? incidencias[seleccion] : null;

  const cifras: PropsCifra[] | undefined = leyoOk ? [
    { etiqueta: t('asist.cifra.abiertas'), valor: numero(incidencias.length, idioma), info: 'asistencia.abiertas' },
    { etiqueta: t('asist.cifra.criticas'), valor: numero(criticas ?? 0, idioma), tono: criticas ? 'bad' : undefined, info: 'asistencia.criticas' },
    { etiqueta: t('asist.cifra.sintomar'), valor: numero(incidencias.filter((i) => !i.reconocidaEn).length, idioma),
      tono: incidencias.some((i) => !i.reconocidaEn) ? 'warn' : undefined, info: 'asistencia.sin_tomar' },
  ] : undefined;

  // Filtro de la mesa en memoria sobre las incidencias que la lectura del tenant YA trajo: todas · críticas · sin tomar.
  const filtro = sp.f === 'criticas' || sp.f === 'sin_tomar' ? sp.f : 'todas';
  const visibles = !leyoOk ? [] : filtro === 'criticas' ? incidencias.filter((i) => i.prioridad === 'critica') : filtro === 'sin_tomar' ? incidencias.filter((i) => !i.reconocidaEn) : incidencias;
  const hrefFiltro = (f: string) => {
    const qs = new URLSearchParams(sufijoTenant(sp).replace(/^\?/, ''));
    if (f !== 'todas') qs.set('f', f);
    const q = qs.toString();
    return `${RUTA}${q ? `?${q}` : ''}`;
  };

  const columnas: ColumnaTabla<IncidenciaMesa>[] = [
    {
      id: 'tipo', titulo: t('asist.col.tipo'), principal: true,
      celda: (i) => (
        <span className="rv-as__tipo">
          {nombreTipo(i.tipo)}
          {i.hayLesionados === true && <StatusChip tono="bad">{t('asist.lesionados')}</StatusChip>}
        </span>
      ),
    },
    { id: 'quien', titulo: t('asist.col.quien'), celda: (i) => i.operadorNombre ?? <span className="rv-tl__tenue">{i.unidadRotulo ? t('asist.sinchofer') : t('asist.sinchofer.sinunidad')}</span> },
    {
      id: 'ref', titulo: t('asist.col.referencia'),
      celda: (i) => (i.unidadRotulo || i.viajeFolio
        ? [i.unidadRotulo ? t('asist.unidad', { r: i.unidadRotulo }) : null, i.viajeFolio ? t('asist.viaje', { folio: i.viajeFolio }) : null].filter(Boolean).join(' · ')
        : <span className="rv-tl__tenue rv-tl__nada">—</span>),
    },
    { id: 'prioridad', titulo: t('asist.col.prioridad'), corta: true, celda: (i) => <StatusChip tono={i.prioridad === 'critica' ? 'bad' : 'warn'}>{nombrePrio(i.prioridad)}</StatusChip> },
    { id: 'nivel', titulo: t('asist.col.nivel'), corta: true, alinear: 'der', celda: (i) => `${i.nivelEscalado}/${NIVEL_MAXIMO}` },
    // NADIE la ha tomado se dice con palabras y tono de aviso: el escalamiento automático sigue corriendo.
    { id: 'atencion', titulo: t('asist.col.atencion'), corta: true, celda: (i) => <StatusChip tono={i.reconocidaEn ? 'ok' : 'warn'}>{i.reconocidaEn ? t('asist.atendida.corta') : t('asist.sintomar.corta')}</StatusChip> },
    { id: 'abierta', titulo: t('asist.col.abierta'), corta: true, celda: (i) => <span className="rv-tl__apagado">{fechaHoraMx(i.abiertaEn, idioma)}</span> },
    {
      id: 'accion', titulo: t('asist.col.estado'), alinear: 'der', tituloOculto: true,
      celda: (i) => <BotonEnlace variante="ghost" tamano="sm" href={hrefVer(i.id)} className="rv-tl__enlace">{t('asist.vr.ver')}</BotonEnlace>,
    },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('asist.titulo')}
      apoyo={apoyo}
      filtros={leyoOk ? (
        <BarraFiltros enLinea accion={RUTA} etiqueta={t('asist.filtros')} nActivos={filtro !== 'todas' ? 1 : 0} limpiarHref={hrefFiltro('todas')}
          ocultos={[...new URLSearchParams(sufijoTenant(sp).replace(/^\?/, '')).entries()]}>
          <FiltroOpciones etiqueta={t('asist.filtro.estado')} valor={filtro} porDefecto="todas"
            opciones={[
              { valor: 'todas', rotulo: t('asist.filtro.todas'), href: hrefFiltro('todas') },
              { valor: 'criticas', rotulo: t('asist.filtro.criticas'), href: hrefFiltro('criticas') },
              { valor: 'sin_tomar', rotulo: t('asist.filtro.sin_tomar'), href: hrefFiltro('sin_tomar') },
            ]} />
        </BarraFiltros>
      ) : undefined}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy('Mesa de control')}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={`${nombreTipo(sel.tipo)} · ${sel.operadorNombre ?? (sel.unidadRotulo ? t('asist.sinchofer') : t('asist.sinchofer.sinunidad'))}`}
          subtitulo={t('asist.vr.sub', { n: numero(seleccion + 1, idioma), total: numero(incidencias.length, idioma) })}
          hrefCerrar={hrefVer(null) || hrefBase}
          cifras={[
            { etiqueta: t('asist.col.prioridad'), valor: nombrePrio(sel.prioridad) },
            { etiqueta: t('asist.col.nivel'), valor: `${sel.nivelEscalado} / ${NIVEL_MAXIMO}` },
            { etiqueta: t('asist.col.atencion'), valor: sel.reconocidaEn ? t('asist.atendida.corta') : t('asist.sintomar.corta') },
            { etiqueta: t('asist.col.abierta'), valor: fechaHoraMx(sel.abiertaEn, idioma) },
          ]}
        >
          <div className="rv-as__cuerpo">
            <div className="rv-as__etiquetas">
              <StatusChip tono={sel.prioridad === 'critica' ? 'bad' : 'warn'}>{t('asist.prioridad', { p: nombrePrio(sel.prioridad).toLowerCase() })}</StatusChip>
              <Chip>{t('asist.nivel', { n: sel.nivelEscalado, max: NIVEL_MAXIMO })}</Chip>
              {sel.hayLesionados === true && <StatusChip tono="bad">{t('asist.lesionados')}</StatusChip>}
            </div>
            <p className="rv-as__nota">
              {sel.unidadRotulo ? t('asist.unidad', { r: sel.unidadRotulo }) : ''}
              {sel.unidadRotulo && sel.viajeFolio ? ' · ' : ''}
              {sel.viajeFolio ? t('asist.viaje', { folio: sel.viajeFolio }) : ''}
              {sel.unidadRotulo || sel.viajeFolio ? ' · ' : ''}
              {t('asist.abierta', { fecha: fechaHoraMx(sel.abiertaEn, idioma) })}
            </p>
            {sel.soloCamara && (
              <p className="rv-as__camara">
                <Icono icono={Camera} />
                {t('asist.camara')}
              </p>
            )}
            {sel.descripcion && (
              <p className="rv-as__descripcion">«{sel.descripcion.slice(0, 240)}»</p>
            )}
            <p className="rv-as__atencion" data-atendida={sel.reconocidaEn ? '' : undefined}>
              {sel.reconocidaEn
                ? t('asist.atendida', { quien: sel.reconocidaPorNombre ?? t('asist.alguien'), desde: fechaHoraMx(sel.reconocidaEn, idioma) })
                : t('asist.nadie')}
            </p>

            <span className="rv-as__acciones">
              {!sel.reconocidaEn && (
                <BotonAccionMesa
                  accion={tomarControl} campos={{ id: sel.id }} etiqueta={t('asist.tomar')}
                  titulo={t('asist.tomar.titulo')}
                />
              )}
              {sel.nivelEscalado < NIVEL_MAXIMO && (
                <div className="rv-as__nivel">
                  {/* A37-S16-05: el aviso NO puede ir solo en el `title` (en celular no existe). Se rotula con texto visible. */}
                  <BotonAccionMesa
                    accion={reescalar} campos={{ id: sel.id, nivel: sel.nivelEscalado + 1 }} etiqueta={t('asist.reescalar', { n: sel.nivelEscalado + 1 })}
                    titulo={t('asist.reescalar.titulo')}
                  />
                  <span className="rv-as__nota">
                    {t('asist.reescalar.nota')}
                  </span>
                </div>
              )}
            </span>

            {/* ── Timeline: la bitácora citable — quién supo qué y cuándo ── */}
            <Disclosure variante="linea" titulo={tp('asist.timeline', sel.eventos.length)}>
              {sel.eventos.length === 0 ? (
                <p className="rv-as__nota">
                  {t('asist.sineventos')}
                </p>
              ) : (
                <ol className="rv-as__linea">
                  {sel.eventos.map((e, idx) => (
                    <li key={idx}>
                      <span className="rv-as__hora">{fechaHoraMx(e.creadoEn, idioma)}</span>
                      {' — '}{ROTULO_EVENTO[e.tipo] ?? legible(e.tipo)}
                      {typeof e.detalle?.nota === 'string' ? `: «${String(e.detalle.nota).slice(0, 200)}»` : ''}
                      {typeof e.detalle?.texto === 'string' ? `: «${String(e.detalle.texto).slice(0, 200)}»` : ''}
                      {typeof e.detalle?.nivel === 'number' ? t('asist.evento.nivel', { n: e.detalle.nivel }) : ''}
                    </li>
                  ))}
                </ol>
              )}
            </Disclosure>

            {/* ── Cierre con nota obligatoria ─────────────────────────────── */}
            <FormaConAviso accion={resolver} boton={t('asist.cerrar')} columnas="md:grid-cols-1">
              <input type="hidden" name="id" value={sel.id} />
              <CampoTexto
                name="nota" etiqueta={t('asist.nota')} obligatorio
                placeholder={t('asist.nota.ph')}
                ayuda={t('asist.nota.ayuda')}
              />
            </FormaConAviso>
          </div>
        </CajonVistaRapida>
      ) : null}
    >
      <TarjetaTabla titulo={t('asist.tabla')} contador={leyoOk ? numero(visibles.length, idioma) : undefined}>
        {!leyoOk ? (
          <EstadoVacio contenido icono={TriangleAlert} titulo={t('asist.error.titulo')}>
            {t('asist.error')}
          </EstadoVacio>
        ) : visibles.length === 0 ? (
          <EstadoVacio contenido icono={ShieldCheck} titulo={filtro === 'todas' ? t('asist.vacio.titulo') : t('asist.filtro.vacio')}>
            {filtro === 'todas' ? t('asist.vacio') : t('asist.filtro.vacio.nota')}
          </EstadoVacio>
        ) : (
          <TablaLista<IncidenciaMesa>
            etiqueta={t('asist.tabla')} columnas={columnas} filas={visibles} idFila={(i) => i.id}
            base={RUTA} params={{}}
            atributosFila={(i) => ({ 'data-critica': i.prioridad === 'critica' ? '' : undefined })}
          />
        )}
      </TarjetaTabla>
    </EsqueletoTablaMaestra>
  );
}
