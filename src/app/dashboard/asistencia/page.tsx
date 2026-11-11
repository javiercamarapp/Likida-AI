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
import { fechaHoraMx } from '../formato';
import { logger } from '@/lib/logger';
import { BotonAccionMesa } from './boton-accion';
import type { Metadata } from 'next';
import {
  CampoTexto, Chip, Disclosure, EstadoVacio, FormaConAviso, Icono, MarcoPagina, StatusChip, Tarjeta, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import './asistencia.css';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { numero } from '@/lib/formato';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { getT } from '@/lib/i18n/servidor';
export const metadata: Metadata = { title: 'Mesa de control' };

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
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
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

  return (
    <MarcoPagina titulo={t('asist.titulo')} apoyo={apoyo}>
      {!leyoOk && (
        <EstadoVacio pantalla contenido icono={TriangleAlert} titulo={t('asist.error.titulo')}>
          {t('asist.error')}
        </EstadoVacio>
      )}

      {leyoOk && (
        <TiraCifras sello={selloHoy('Mesa de control')}>
          <Cifra etiqueta={t('asist.cifra.abiertas')} valor={numero(incidencias.length, idioma)} info="asistencia.abiertas" />
          <Cifra etiqueta={t('asist.cifra.criticas')} valor={numero(criticas ?? 0, idioma)} tono={criticas ? 'bad' : undefined} info="asistencia.criticas" />
          <Cifra etiqueta={t('asist.cifra.sintomar')} valor={numero(incidencias.filter((i) => !i.reconocidaEn).length, idioma)}
            tono={incidencias.some((i) => !i.reconocidaEn) ? 'warn' : undefined} info="asistencia.sin_tomar" />
        </TiraCifras>
      )}

      {leyoOk && incidencias.length === 0 && (
        <EstadoVacio pantalla contenido icono={ShieldCheck} titulo={t('asist.vacio.titulo')}>
          {t('asist.vacio')}
        </EstadoVacio>
      )}

      {leyoOk && incidencias.map((inc) => (
        <Tarjeta
          key={inc.id}
          titulo={`${ROTULO_TIPO[inc.tipo] ? t(ROTULO_TIPO[inc.tipo]) : legible(inc.tipo)} · ${inc.operadorNombre ?? (inc.unidadRotulo ? t('asist.sinchofer') : t('asist.sinchofer.sinunidad'))}`}
        >
          <div className="rv-as__cuerpo">
            <div className="rv-as__etiquetas">
              <StatusChip tono={inc.prioridad === 'critica' ? 'bad' : 'warn'}>{t('asist.prioridad', { p: (ROTULO_PRIORIDAD[inc.prioridad] ? t(ROTULO_PRIORIDAD[inc.prioridad]) : legible(inc.prioridad)).toLowerCase() })}</StatusChip>
              <Chip>{t('asist.nivel', { n: inc.nivelEscalado, max: NIVEL_MAXIMO })}</Chip>
              {inc.hayLesionados === true && <StatusChip tono="bad">{t('asist.lesionados')}</StatusChip>}
            </div>
            <p className="rv-as__nota">
              {inc.unidadRotulo ? t('asist.unidad', { r: inc.unidadRotulo }) : ''}
              {inc.unidadRotulo && inc.viajeFolio ? ' · ' : ''}
              {inc.viajeFolio ? t('asist.viaje', { folio: inc.viajeFolio }) : ''}
              {inc.unidadRotulo || inc.viajeFolio ? ' · ' : ''}
              {t('asist.abierta', { fecha: fechaHoraMx(inc.abiertaEn, idioma) })}
            </p>
            {inc.soloCamara && (
              <p className="rv-as__camara">
                <Icono icono={Camera} />
                {t('asist.camara')}
              </p>
            )}
            {inc.descripcion && (
              <p className="rv-as__descripcion">«{inc.descripcion.slice(0, 240)}»</p>
            )}
            <p className="rv-as__atencion" data-atendida={inc.reconocidaEn ? '' : undefined}>
              {inc.reconocidaEn
                ? t('asist.atendida', { quien: inc.reconocidaPorNombre ?? t('asist.alguien'), desde: fechaHoraMx(inc.reconocidaEn, idioma) })
                : t('asist.nadie')}
            </p>

            <span className="rv-as__acciones">
              {!inc.reconocidaEn && (
                <BotonAccionMesa
                  accion={tomarControl} campos={{ id: inc.id }} etiqueta={t('asist.tomar')}
                  titulo={t('asist.tomar.titulo')}
                />
              )}
              {inc.nivelEscalado < NIVEL_MAXIMO && (
                <div className="rv-as__nivel">
                  {/* A37-S16-05: el aviso NO puede ir solo en el `title` (en celular no existe). Se rotula con texto visible. */}
                  <BotonAccionMesa
                    accion={reescalar} campos={{ id: inc.id, nivel: inc.nivelEscalado + 1 }} etiqueta={t('asist.reescalar', { n: inc.nivelEscalado + 1 })}
                    titulo={t('asist.reescalar.titulo')}
                  />
                  <span className="rv-as__nota">
                    {t('asist.reescalar.nota')}
                  </span>
                </div>
              )}
            </span>

            {/* ── Timeline: la bitácora citable — quién supo qué y cuándo ── */}
            <Disclosure variante="linea" titulo={tp('asist.timeline', inc.eventos.length)}>
              {inc.eventos.length === 0 ? (
                <p className="rv-as__nota">
                  {t('asist.sineventos')}
                </p>
              ) : (
                <ol className="rv-as__linea">
                  {inc.eventos.map((e, idx) => (
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
              <input type="hidden" name="id" value={inc.id} />
              <CampoTexto
                name="nota" etiqueta={t('asist.nota')} obligatorio
                placeholder={t('asist.nota.ph')}
                ayuda={t('asist.nota.ayuda')}
              />
            </FormaConAviso>
          </div>
        </Tarjeta>
      ))}
    </MarcoPagina>
  );
}
