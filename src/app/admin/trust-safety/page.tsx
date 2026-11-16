import { uniformes } from '@/app/admin/cifras-uniformes';
import { observadas } from '@/app/admin/sello-observado';
import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ShieldAlert } from 'lucide-react';
import { BotonEnlace, Disclosure, EstadoError, EstadoVacio, FilaTarjetas, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { BarList, DonaMini } from '../../ui-v2/graficas';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import {
  getEventosSeguridad, resumenEventosSeguridad,
  type FilaSeguridad, type ResumenSeguridad,
} from '@/lib/seguridad/eventos';
import { coberturaEventosSeguridad, type CoberturaFuente } from '@/lib/seguridad/cobertura';
import { fechaHoraMx, numero } from '@/lib/formato';
import { opcionesBitacora } from '@/lib/admin/bitacora';
import { ChipCopiable } from '../bitacora/chip-copiable';
import '../sistema.css';
import '../control.css';
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

/** Nombres legibles de flotas y personas (id → nombre). Un identificador sin nombre conocido se queda como id-chip: nunca se inventa un nombre. */
type Nombres = { flotas: Map<string, string>; personas: Map<string, string> };
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const columnasEventos = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma, pag?: string, nombres: Nombres = { flotas: new Map(), personas: new Map() }): ColumnaTabla<FilaSeguridad>[] => ([
  { id: 'cuando', titulo: t('trust_safety.cuando'), corta: true, celda: (e) => fechaHoraMx(e.creadoEn, idioma) },
  {
    // UNA línea por fila (40 px): el origen es su propia columna, no un segundo renglón.
    id: 'que', titulo: t('trust_safety.que_y_de_donde'), principal: true,
    celda: (e) => (
      <span className="adm-ctl-fuerte">
        {e.tipo.replace(/_/g, ' ')}
        {/* 0681: una ráfaga de la misma señal es UNA fila con su conteo — el número es lo medido, no una estimación. */}
        {(e.repeticiones ?? 1) > 1 && (
          <span className="adm-ctl-rep" title={t('trust_safety.veces_que_se_vio_la_misma')}>×{e.repeticiones}</span>
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
    id: 'actor', titulo: t('trust_safety.actor'),
    celda: (e) => {
      if (e.actor === null || e.actor === '') return '—';
      const nombre = nombres.personas.get(e.actor);
      if (nombre) return <span className="adm-sis-celda-texto" title={nombre}>{nombre}</span>;
      // Un identificador (UUID) va en id-chip de Rovaq, con «Copiar»; un texto ya legible (una llave truncada, una IP) se queda como texto.
      return ES_UUID.test(e.actor) ? <ChipCopiable texto={e.actor} copiar={t('bitacora.copiar')} copiado={t('bitacora.copiado')} /> : <span className="adm-sis-celda-texto" title={e.actor}>{e.actor}</span>;
    },
  },
  {
    id: 'flota', titulo: t('observabilidad.flota'),
    celda: (e) => {
      if (!e.tenantId) return <span className="adm-ctl-sin-fuente">{t('trust_safety.sin_flota')}</span>;
      const nombre = nombres.flotas.get(e.tenantId);
      return nombre ? <span className="adm-sis-celda-texto" title={nombre}>{nombre}</span> : <ChipCopiable texto={e.tenantId} copiar={t('bitacora.copiar')} copiado={t('bitacora.copiado')} />;
    },
  },
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
      return <span className="adm-ctl-num" data-apagado={f.emite && f.filas30d === 0 ? '' : undefined}>{medida}</span>;
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
  const { t: tc } = await getT('resto');
  const { t: ti } = await getT('admin_inicio');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { pag, ver } = (await searchParams) ?? {};
  // Las dos lecturas caen POR SEPARADO: que los conteos fallen no debe
  // esconder la lista, ni al revés — y cada fallo se dice con su alcance.
  const [eventos, resumen, cobertura, opciones] = await Promise.all([
    getEventosSeguridad(LIMITE_LISTA).catch((): FilaSeguridad[] | null => null),
    resumenEventosSeguridad().catch((): ResumenSeguridad | null => null),
    coberturaEventosSeguridad().catch((): CoberturaFuente[] | null => null),
    opcionesBitacora().catch(() => ({ flotas: null, personas: null })),
  ]);
  // Si no se pudieron leer los nombres, las celdas caen al id-chip (el identificador real), no a un nombre inventado.
  const nombres: Nombres = {
    flotas: new Map((opciones.flotas ?? []).map((f) => [f.id, f.nombre])),
    personas: new Map((opciones.personas ?? []).map((u) => [u.id, u.nombre])),
  };

  const posicion = ver && eventos ? eventos.findIndex((e) => String(e.id) === ver) : -1;
  const sel = posicion >= 0 && eventos ? eventos[posicion] : null;
  const hrefCerrar = pag ? `/admin/trust-safety?pag=${encodeURIComponent(pag)}` : '/admin/trust-safety';

  return (
    <EsqueletoTablaMaestra
      titulo={t('trust_safety.trust_safety')}
      apoyo={t('trust_safety.apoyo')}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.tipo.replace(/_/g, ' ')} subtitulo={t('trust_safety.vr_subtitulo', { n: posicion + 1, total: eventos!.length })} hrefCerrar={hrefCerrar}
          cifras={[
            { etiqueta: t('trust_safety.severidad'), valor: (pillSeveridad(t)[sel.severidad] ?? { etiqueta: sel.severidad }).etiqueta },
            { etiqueta: t('trust_safety.cuando'), valor: fechaHoraMx(sel.creadoEn, idioma) },
            { etiqueta: t('trust_safety.vr_veces'), valor: String(sel.repeticiones ?? 1) },
            { etiqueta: t('observabilidad.flota'), valor: sel.tenantId ? (nombres.flotas.get(sel.tenantId) ?? sel.tenantId.slice(0, 8)) : t('trust_safety.sin_flota') },
          ]}
        >
          <p className="adm-sis-nota">{t('trust_safety.origen')}: {sel.origen}</p>
          <p className="adm-sis-nota">{t('trust_safety.actor')}: {sel.actor ? (nombres.personas.get(sel.actor) ?? sel.actor) : '—'}</p>
        </CajonVistaRapida>
      ) : null}
      /* ── Los conteos, medidos en la base ── */
      avisos={resumen === null ? <EstadoError>{t('trust_safety.no_se_pudieron_leer_los_conteos')}</EstadoError> : null}
      etiquetaCifras={t('trust_safety.ultimos_30_dias_por_severidad')}
      cifras={resumen === null ? undefined : observadas(uniformes([
        { etiqueta: t('trust_safety.severidad_alta_30_dias'), valor: resumen.d30.alta, tono: resumen.d30.alta > 0 ? 'bad' : undefined },
        { etiqueta: t('trust_safety.severidad_media_30_dias'), valor: resumen.d30.media, tono: resumen.d30.media > 0 ? 'warn' : undefined },
        { etiqueta: t('trust_safety.informativos_30_dias'), valor: resumen.d30.info },
        { etiqueta: t('trust_safety.total_historico'), valor: resumen.total },
      ]), ti('a1r4.observado'))}
    >

      {/* ── Dos gráficas con lo medido: severidad a 30 días y eventos por fuente ── */}
      <FilaTarjetas variante="6-6" className="adm-ctl-pareja adm-ctl-pareja--libre">
        {resumen === null ? (
          <Tarjeta titulo={tc('ctl.ts_sev_titulo')} estado="error" mensaje={t('trust_safety.no_se_pudieron_leer_los_conteos')} />
        ) : resumen.d30.alta + resumen.d30.media + resumen.d30.info === 0 ? (
          <Tarjeta titulo={tc('ctl.ts_sev_titulo')} estado="vacio" mensaje={tc('ctl.ts_sev_vacio')} detalle={tc('ctl.ts_sev_vacio_detalle')} />
        ) : (
          <Tarjeta titulo={tc('ctl.ts_sev_titulo')}>
            <div className="adm-ctl-grafica">
              <DonaMini etiqueta={tc('ctl.ts_sev_titulo')} centro={numero(resumen.d30.alta + resumen.d30.media + resumen.d30.info, idioma)}
                gajos={[
                  { etiqueta: t('trust_safety.alta'), valor: resumen.d30.alta },
                  { etiqueta: t('trust_safety.media'), valor: resumen.d30.media },
                  { etiqueta: t('trust_safety.info'), valor: resumen.d30.info },
                ]} />
            </div>
          </Tarjeta>
        )}
        {cobertura === null ? (
          <Tarjeta titulo={tc('ctl.ts_fuente_titulo')} estado="error" mensaje={t('trust_safety.no_se_pudo_medir_la_cobertura')} />
        ) : (
          <Tarjeta titulo={tc('ctl.ts_fuente_titulo')}>
            <div className="adm-ctl-grafica">
              <BarList etiqueta={tc('ctl.ts_fuente_titulo')} formato={(v) => numero(v, idioma)}
                items={cobertura.map((f) => ({ clave: f.id, etiqueta: f.titulo, valor: f.emite ? f.filas30d : null }))} />
            </div>
          </Tarjeta>
        )}
      </FilaTarjetas>

      {/* ── La cobertura REAL, medida ── */}
      <Tarjeta titulo={t('trust_safety.cobertura_que_fuentes_escriben_aqui_y')}>
        {cobertura === null ? (
          <EstadoError>{t('trust_safety.no_se_pudo_medir_la_cobertura')}</EstadoError>
        ) : (
          <>
            <p className="adm-sis-nota">{t('trust_safety.de_fuentes_emiten_las_demas_estan', { length: cobertura.filter((f) => f.emite).length, length2: cobertura.length })}</p>
            {/* Top 8 a la vista; el resto plegado en la misma tabla (no se pierde ninguna fuente). */}
            <TablaBase etiqueta={t('trust_safety.cobertura_por_fuente_de_seguridad')} columnas={columnasCobertura(t, idioma)} filas={cobertura.slice(0, 8)} idFila={(f) => f.id} altoMaximo={false} tarjetaMovil />
            {cobertura.length > 8 ? (
              <Disclosure titulo={t('pul9.ts_ver_todas', { n: cobertura.length - 8 })} variante="linea" resumen={String(cobertura.length - 8)}>
                <TablaBase etiqueta={t('trust_safety.cobertura_por_fuente_de_seguridad')} columnas={columnasCobertura(t, idioma)} filas={cobertura.slice(8)} idFila={(f) => f.id} altoMaximo={false} tarjetaMovil />
              </Disclosure>
            ) : null}
            <Disclosure titulo={t('trust_safety.detalle_tecnico')} variante="linea" resumen={String(cobertura.length)}>
              <ul className="adm-sis-lista">
                {cobertura.map((f) => <li key={f.id}><span>{f.titulo}</span><span className="adm-sis-sub">{f.donde}</span></li>)}
              </ul>
            </Disclosure>
          </>
        )}
      </Tarjeta>

      {/* ── La lista ── */}
      <Tarjeta titulo={t('trust_safety.eventos_registrados')}>
        {eventos === null ? (
          <EstadoError>{t('trust_safety.no_se_pudieron_leer_los_eventos')}</EstadoError>
        ) : eventos.length === 0 ? (
          <EstadoVacio titulo={t('trust_safety.sin_eventos')} icono={ShieldAlert} contenido>{t('trust_safety.ningun_evento_registrado_eso_no_prueba')}</EstadoVacio>
        ) : (
          <>
            <TablaLista<FilaSeguridad> etiqueta={t('trust_safety.eventos_de_seguridad_registrados')} columnas={columnasEventos(t, idioma, pag, nombres)} filas={eventos} idFila={(e) => String(e.id)} base="/admin/trust-safety" params={{ pag }} paginacion={{ tamano: 25 }} />
            <p className="adm-ctl-pie">
              {resumen === null
                ? t('trust_safety.mostrando_los_ultimos_el_total_historico', { numero: numero(eventos.length, idioma) })
                : t('trust_safety.mostrando_de_eventos_historicos_del_mas', { numero: numero(eventos.length, idioma), numero2: numero(resumen.total, idioma) })}
            </p>
          </>
        )}
      </Tarjeta>

      {/* ── Lo que este panel NO afirma — la lista de pendientes sale de la MISMA cobertura medida, no de texto fijo ── */}
      <Tarjeta titulo={t('trust_safety.que_se_registra_y_que_esta')}>
        <p className="adm-ctl-nota-sup">{rico(t('trust_safety.emite_significa_solo_que_existe_codigo'), { e0: (c) => <code className="adm-ctl-codigo">{c}</code> })}</p>
        {cobertura === null ? (
          <p className="adm-ctl-nota-sup">{t('trust_safety.sin_la_medicion_de_cobertura_no')}</p>
        ) : cobertura.filter((f) => !f.emite).length === 0 ? (
          <p className="adm-ctl-nota-sup">{t('trust_safety.todas_las_fuentes_declaradas_emiten_eso')}</p>
        ) : (
          <>
            <p className="adm-ctl-nota-sup">{t('trust_safety.pendiente_hoy_no_se_registra')}</p>
            <ul className="adm-ctl-vinetas">
              {cobertura.filter((f) => !f.emite).map((f) => <li key={f.id}>{f.titulo}</li>)}
            </ul>
          </>
        )}
        <p className="adm-ctl-nota-sup">{rico(t('trust_safety.tampoco_hay_un_pipeline_dedicado_de'), { e2: (c) => <code className="adm-ctl-codigo">{c}</code> })}</p>
      </Tarjeta>
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('trust_safety.trust_safety') };
}
