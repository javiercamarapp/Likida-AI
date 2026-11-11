import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ShieldAlert } from 'lucide-react';
import { BotonEnlace, Disclosure, EstadoError, EstadoVacio, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import {
  getEventosSeguridad, resumenEventosSeguridad,
  type FilaSeguridad, type ResumenSeguridad,
} from '@/lib/seguridad/eventos';
import { coberturaEventosSeguridad, type CoberturaFuente } from '@/lib/seguridad/cobertura';
import { fechaHoraMx, numero } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';
import type { Idioma } from '@/lib/i18n/idioma';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// Trust & Safety — el registro consultable de lo que los emisores de seguridad atrapan.
//
// CT-SEG-11 (4-nov-2026): esta pantalla decía «los detectores están cableados — así que el
// silencio aquí es bueno de verdad». Era falso en la dirección peligrosa: no había registro
// de login fallido, de llaves de API inválidas, de rutas negadas ni de exportes de dinero, y
// varios tipos (correo entrante, rate limits, inyección de prompt) nunca tuvieron un emisor.
// Un panel vacío no prueba que no pasó nada; prueba que nadie escribió.
//
// Ahora la pantalla MIDE su propia cobertura: `FUENTES_SEGURIDAD` (lib/seguridad/cobertura.ts)
// declara fuente por fuente qué emite y qué no — atado al código por una prueba — y aquí se
// pinta con el conteo real de 30 días. Una fuente que emite y marca 0 es silencio real O una
// fuente rota, y el panel dice que no las distingue.
//
// Contratos de la casa: los conteos se miden EN la base (count exacto, nunca contando una
// rebanada); la lista declara «mostrando N de M» con M exacta; una lectura fallida se dice
// («no se pudo leer» ≠ «no hay eventos»); lo que NO se detecta se dice con esas palabras.
// ═══════════════════════════════════════════════════════════════════════════

const LIMITE_LISTA = 50;

const pillSeveridad = (t: TSistema = T_SISTEMA_ES): Record<string, { tono: TonoEstado; etiqueta: string }> => ({
  alta: { tono: 'bad', etiqueta: t('trust_safety.alta') },
  media: { tono: 'warn', etiqueta: t('trust_safety.media') },
  info: { tono: 'neutral', etiqueta: t('trust_safety.info') },
});

const columnasEventos = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma, pag?: string): ColumnaTabla<FilaSeguridad>[] => ([
  { id: 'cuando', titulo: t('trust_safety.cuando'), corta: true, celda: (e) => fechaHoraMx(e.creadoEn, idioma) },
  {
    // UNA línea por fila (40 px): el origen es su propia columna, no un segundo renglón.
    id: 'que', titulo: t('trust_safety.que_y_de_donde'), principal: true,
    celda: (e) => (
      <span className="font-medium">
        {e.tipo.replace(/_/g, ' ')}
        {/* 0681: una ráfaga de la misma señal es UNA fila con su conteo — el número es lo medido, no una estimación. */}
        {(e.repeticiones ?? 1) > 1 && (
          <span className="ml-1.5 cifra-mono text-xs text-muted" title={t('trust_safety.veces_que_se_vio_la_misma')}>×{e.repeticiones}</span>
        )}
      </span>
    ),
  },
  { id: 'origen', titulo: t('trust_safety.origen'), celda: (e) => <span className="adm-sis-celda-texto" title={e.origen}>{e.origen}</span> },
  {
    id: 'severidad', titulo: t('trust_safety.severidad'),
    celda: (e) => {
      const pill = pillSeveridad(t)[e.severidad] ?? { tono: 'neutral' as TonoEstado, etiqueta: e.severidad };
      return <StatusChip tono={pill.tono}>{pill.etiqueta}</StatusChip>;
    },
  },
  {
    // El actor viene ya truncado a 120 y JAMÁS trae un secreto completo (contrato de registrarEventoSeguridad). Sin actor no se inventa.
    id: 'actor', titulo: t('trust_safety.actor'), celda: (e) => <span className="adm-sis-celda-texto" title={e.actor ?? undefined}>{e.actor ?? '—'}</span>,
  },
  { id: 'flota', titulo: t('observabilidad.flota'), celda: (e) => <span className="cifra-mono text-xs text-muted">{e.tenantId ? e.tenantId.slice(0, 8) : t('trust_safety.sin_flota')}</span> },
  {
    id: 'vr', titulo: t('trust_safety.vista_rapida'), tituloOculto: true, alinear: 'der',
    celda: (e) => <BotonEnlace href={`/admin/trust-safety?${new URLSearchParams({ ...(pag ? { pag } : {}), ver: String(e.id) })}`} variante="ghost" tamano="sm">{t('trust_safety.vista_rapida')}</BotonEnlace>,
  },
]);

const columnasCobertura = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<CoberturaFuente>[] => ([
  { id: 'fuente', titulo: t('trust_safety.fuente'), principal: true, celda: (f) => f.titulo },
  { id: 'estado', titulo: t('salud_sistema.estado'), celda: (f) => <StatusChip tono={f.emite ? 'ok' : 'warn'}>{f.emite ? t('trust_safety.emite') : t('trust_safety.pendiente')}</StatusChip> },
  {
    id: 'filas', titulo: t('trust_safety.filas_30_dias'),
    celda: (f) => {
      const medida = f.filas30d === null ? t('trust_safety.sin_evento') : f.emite && f.filas30d === 0 ? t('trust_safety.0_en_30_dias') : numero(f.filas30d, idioma);
      return <span className={`tabular whitespace-nowrap ${f.emite && f.filas30d === 0 ? 'text-muted' : ''}`}>{medida}</span>;
    },
  },
  {
    // Las rutas de código no son para el superadmin: quedan plegadas EN UN SOLO bloque bajo la tabla, no en cada fila.
    id: 'detalle', titulo: t('trust_safety.detalle'),
    celda: (f) => <span className="adm-sis-celda-texto">{f.emite ? t('trust_safety.registra_eventos_aqui') : t('trust_safety.todavia_no_escribe_aqui')}</span>,
  },
]);

export default async function TrustSafetyPage({ searchParams }: { searchParams: Promise<{ pag?: string; ver?: string }> }) {
  const { t, idioma } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { pag, ver } = (await searchParams) ?? {};
  // Las dos lecturas caen POR SEPARADO: que los conteos fallen no debe
  // esconder la lista, ni al revés — y cada fallo se dice con su alcance.
  const [eventos, resumen, cobertura] = await Promise.all([
    getEventosSeguridad(LIMITE_LISTA).catch((): FilaSeguridad[] | null => null),
    resumenEventosSeguridad().catch((): ResumenSeguridad | null => null),
    coberturaEventosSeguridad().catch((): CoberturaFuente[] | null => null),
  ]);

  const posicion = ver && eventos ? eventos.findIndex((e) => String(e.id) === ver) : -1;
  const sel = posicion >= 0 && eventos ? eventos[posicion] : null;
  const hrefCerrar = pag ? `/admin/trust-safety?pag=${encodeURIComponent(pag)}` : '/admin/trust-safety';

  return (
    <EsqueletoTablaMaestra
      titulo={t('trust_safety.trust_safety')}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.tipo.replace(/_/g, ' ')} subtitulo={t('trust_safety.vr_subtitulo', { n: posicion + 1, total: eventos!.length })} hrefCerrar={hrefCerrar}
          cifras={[
            { etiqueta: t('trust_safety.severidad'), valor: (pillSeveridad(t)[sel.severidad] ?? { etiqueta: sel.severidad }).etiqueta },
            { etiqueta: t('trust_safety.cuando'), valor: fechaHoraMx(sel.creadoEn, idioma) },
            { etiqueta: t('trust_safety.vr_veces'), valor: String(sel.repeticiones ?? 1) },
            { etiqueta: t('observabilidad.flota'), valor: sel.tenantId ? sel.tenantId.slice(0, 8) : t('trust_safety.sin_flota') },
          ]}
        >
          <p className="adm-sis-nota">{t('trust_safety.origen')}: {sel.origen}</p>
          <p className="adm-sis-nota">{t('trust_safety.actor')}: {sel.actor ?? '—'}</p>
        </CajonVistaRapida>
      ) : null}
      /* ── Los conteos, medidos en la base ── */
      avisos={resumen === null ? <EstadoError>{t('trust_safety.no_se_pudieron_leer_los_conteos')}</EstadoError> : null}
      etiquetaCifras={t('trust_safety.ultimos_30_dias_por_severidad')}
      cifras={resumen === null ? undefined : [
        { etiqueta: t('trust_safety.severidad_alta_30_dias'), valor: resumen.d30.alta, tono: resumen.d30.alta > 0 ? 'bad' : undefined },
        { etiqueta: t('trust_safety.severidad_media_30_dias'), valor: resumen.d30.media, tono: resumen.d30.media > 0 ? 'warn' : undefined },
        { etiqueta: t('trust_safety.informativos_30_dias'), valor: resumen.d30.info },
        { etiqueta: t('trust_safety.total_historico'), valor: resumen.total },
      ]}
    >

      {/* ── La cobertura REAL, medida ── */}
      <Tarjeta titulo={t('trust_safety.cobertura_que_fuentes_escriben_aqui_y')}>
        {cobertura === null ? (
          <p className="m-0 text-sm text-muted">{t('trust_safety.no_se_pudo_medir_la_cobertura')}</p>
        ) : (
          <>
            <p className="m-0 mb-3 text-xs text-muted">{t('trust_safety.de_fuentes_emiten_las_demas_estan', { length: cobertura.filter((f) => f.emite).length, length2: cobertura.length })}</p>
            <TablaBase etiqueta={t('trust_safety.cobertura_por_fuente_de_seguridad')} columnas={columnasCobertura(t, idioma)} filas={cobertura} idFila={(f) => f.id} altoMaximo={false} />
            <Disclosure titulo={t('trust_safety.detalle_tecnico')} variante="linea" resumen={String(cobertura.length)}>
              <ul className="adm-sis-lista">
                {cobertura.map((f) => <li key={f.id}><span>{f.titulo}</span><span className="break-words text-xs text-muted">{f.donde}</span></li>)}
              </ul>
            </Disclosure>
          </>
        )}
      </Tarjeta>

      {/* ── La lista ── */}
      <Tarjeta titulo={t('trust_safety.eventos_registrados')}>
        {eventos === null ? (
          <p className="m-0 text-sm text-muted">{t('trust_safety.no_se_pudieron_leer_los_eventos')}</p>
        ) : eventos.length === 0 ? (
          <EstadoVacio titulo={t('trust_safety.sin_eventos')} icono={ShieldAlert} contenido>{t('trust_safety.ningun_evento_registrado_eso_no_prueba')}</EstadoVacio>
        ) : (
          <>
            <TablaLista<FilaSeguridad> etiqueta={t('trust_safety.eventos_de_seguridad_registrados')} columnas={columnasEventos(t, idioma, pag)} filas={eventos} idFila={(e) => String(e.id)} base="/admin/trust-safety" params={{ pag }} paginacion={{ tamano: 25 }} />
            <p className="m-0 mt-3 text-xs text-muted">
              {resumen === null
                ? t('trust_safety.mostrando_los_ultimos_el_total_historico', { numero: numero(eventos.length, idioma) })
                : t('trust_safety.mostrando_de_eventos_historicos_del_mas', { numero: numero(eventos.length, idioma), numero2: numero(resumen.total, idioma) })}
            </p>
          </>
        )}
      </Tarjeta>

      {/* ── Lo que este panel NO afirma — la lista de pendientes sale de la MISMA cobertura medida, no de texto fijo ── */}
      <Tarjeta titulo={t('trust_safety.que_se_registra_y_que_esta')}>
        <p className="m-0 text-xs text-muted">{rico(t('trust_safety.emite_significa_solo_que_existe_codigo'), { e0: (c) => <code className="font-mono">{c}</code> })}</p>
        {cobertura === null ? (
          <p className="m-0 mt-2 text-xs text-muted">{t('trust_safety.sin_la_medicion_de_cobertura_no')}</p>
        ) : cobertura.filter((f) => !f.emite).length === 0 ? (
          <p className="m-0 mt-2 text-xs text-muted">{t('trust_safety.todas_las_fuentes_declaradas_emiten_eso')}</p>
        ) : (
          <>
            <p className="m-0 mt-2 text-xs text-muted">{t('trust_safety.pendiente_hoy_no_se_registra')}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
              {cobertura.filter((f) => !f.emite).map((f) => <li key={f.id}>{f.titulo}</li>)}
            </ul>
          </>
        )}
        <p className="m-0 mt-2 text-xs text-muted">{rico(t('trust_safety.tampoco_hay_un_pipeline_dedicado_de'), { e0: (c) => <code className="font-mono">{c}</code>, e1: (c) => <code className="font-mono">{c}</code>, e2: (c) => <code className="font-mono">{c}</code> })}</p>
      </Tarjeta>
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('trust_safety.trust_safety') };
}
