import { uniformes } from '@/app/admin/cifras-uniformes';
import Link from 'next/link';
import {
  Play, Power, PowerOff, GitPullRequest, Image as ImageIcon, Bot,
} from 'lucide-react';
// SOLO tipos: lib/admin/bus importa supabaseAdmin y no debe entrar al bundle.
import type { EstadoBus, ResultadoPrs, RutinaBus } from '@/lib/admin/bus';
import { totalEscalacionesLegible, type BandejaEscalaciones } from '@/lib/admin/escalaciones';
import type { AgentesParados } from '@/lib/admin/agentes-parados';
import type { ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';
import { fechaHoraMx, numero } from '@/lib/formato';
import {
  Aviso, BarraFiltros, Boton, BotonEnlace, CampoTextarea, Disclosure, EstadoVacio, FilaTarjetas, FiltroOpciones, StatusChip, TablaBase, Tarjeta,
  clasesBoton, type ColumnaBase,
} from '../../ui-v2/componentes';
import { SelloDato } from '../../ui-v2/datos';
import { BotonConfirmar } from '../../ui-v2/componentes/confirmar';
import { EsqueletoPortada } from '../../ui-v2/esqueletos';
import { contarPorCausa, etiquetaCausa } from '../escalaciones/agentes-parados';
import { BotonEnvio } from './boton_envio';
import '../bandeja.css';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminInicioEs } from '@/lib/i18n/tr_admin';
const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/** El tope de piezas pendientes que trae `leerEstadoBus` (lib/admin/bus.ts).
 *  Se declara aquí porque es la vista quien tiene que confesarlo: con la cola
 *  llena, "(50)" se lee como el total del buzón (FE-13). */
const TOPE_PIEZAS = 50;

/** "hace 3 h" — mismo formato que la bandeja de escalaciones. */
function edadDe(desdeIso: string, ahora: number, t: TrDe<'admin_inicio'>): string {
  const horas = (ahora - new Date(desdeIso).getTime()) / 3_600_000;
  if (Number.isNaN(horas)) return '—';
  if (horas < 1) return t('turno.hace_menos_1h');
  if (horas < 48) return t('turno.hace_horas', { n: Math.floor(horas) });
  return t('turno.hace_dias', { n: Math.floor(horas / 24) });
}

const nombreOrden = (tipo: string, t: TrDe<'admin_inicio'>): string => {
  const ROTULOS: Record<string, string> = {
    correr_ahora: t('turno.orden_correr_ahora'),
    kill_switch_on: t('turno.orden_apagar_todas'),
    kill_switch_off: t('turno.orden_encender_todas'),
    editar_encargo: t('turno.orden_editar_encargo'),
    nota: t('turno.orden_nota'),
  };
  return ROTULOS[tipo] ?? tipo;
};

export type AccionForm = (fd: FormData) => Promise<void>;

/** El resumen de «Agentes que no corrieron» para Tu turno; el detalle y el porqué de cada uno viven en Escalaciones. */
function TarjetaAgentesParados({ parados, cola, t }: { parados: AgentesParados | null | undefined; cola: ResumenBandejaCola | null | undefined; t: TrDe<'admin_inicio'> }) {
  if (parados === null || parados === undefined) {
    return (
      <Tarjeta titulo={t('tu_turno_vista.agentes_que_no_corrieron')} estado="error"
        mensaje={t('tu_turno_vista.no_se_pudo_leer')} />
    );
  }
  if (parados.parados.length === 0) {
    return (
      <Tarjeta titulo={t('tu_turno_vista.agentes_que_no_corrieron')} estado="vacio" mensaje={t('tu_turno_vista.ningun_agente_parado')}
        detalle={t('tu_turno_vista.los_agentes_habilitados_corrieron', { habilitados: numero(parados.habilitados), umbralHoras: numero(parados.umbralHoras) })} />
    );
  }
  const causas = contarPorCausa(parados.parados).slice(0, 3);
  return (
    <Tarjeta titulo={t('tu_turno_vista.agentes_que_no_corrieron')}
      acciones={<BotonEnlace href="/admin/escalaciones#agentes-parados" variante="secondary" tamano="sm">{t('tu_turno_vista.ver_cuales_y_por')}</BotonEnlace>}>
      <ul className="bj-lista">
        <li>
          <span className="bj-lista__texto">
            {t('turno.parados_resumen', { n: numero(parados.parados.length), habilitados: numero(parados.habilitados), umbral: numero(parados.umbralHoras) })}
          </span>
        </li>
        {causas.map((c) => (
          <li key={c.causa ?? 'sin-dato'}>
            <span className="bj-lista__texto">{etiquetaCausa(c.causa, t) ?? t('tu_turno_vista.sin_dato_del_motivo')}</span>
            <span className="bj-lista__apoyo">{numero(c.n)}</span>
          </li>
        ))}
      </ul>
      {cola?.frenaAlRunner && (
        <Aviso tono="error" titulo={t('tu_turno_vista.la_bandeja_de_aprobacion')}
          acciones={<BotonEnlace href="/admin/aprobaciones" variante="secondary" tamano="sm">{t('tu_turno_vista.ir_a_aprobaciones')}</BotonEnlace>}>
          {t('turno.piezas_pendientes_esperan', { n: numero(cola.pendientes) })}
        </Aviso>
      )}
    </Tarjeta>
  );
}

/**
 * La VISTA de "Tu turno" — todo el cuerpo de la bandeja, sin auth ni fetch
 * (eso vive en page.tsx). Server component a propósito: los formularios usan
 * server actions que llegan por props, patrón de agentes/peajes.
 */
export function VistaTuTurno({
  bus, escalaciones, envios, prs, ahora, aviso, error, sesionNombre,
  accionPieza, accionOrden, parados, cola, fuente = '', t = trAdminInicioEs,
}: {
  bus: EstadoBus;
  escalaciones: BandejaEscalaciones;
  envios: PiezaEnCola[];
  prs: ResultadoPrs;
  ahora: number;
  aviso?: string;
  error?: string;
  sesionNombre: string;
  accionPieza: AccionForm;
  accionOrden: AccionForm;
  /** «Agentes que no corrieron» (`getAgentesParados`); `null` = no se pudo leer, `undefined` = la página no lo pidió. */
  parados?: AgentesParados | null;
  cola?: ResumenBandejaCola | null;
  /** El filtro «Mostrar» (`?fuente=`): piezas, envios, cambios, escalaciones o rutinas. Vacío = todo. */
  fuente?: string;
  t?: TrDe<'admin_inicio'>;
}) {
  // ADM-4: tres de las seis fuentes vienen topadas; el total sale de los conteos REALES. Lectura caída = null («—»), nunca 0.
  const totalEscalaciones = totalEscalacionesLegible(escalaciones);
  const piezasSinDato = bus.errores.some((e) => /pieza/i.test(e));
  const ver = (clave: string) => fuente === '' || fuente === clave;
  const vencidas = escalaciones.cola.filter((it) => it.vence && new Date(it.vence).getTime() < ahora).length;
  const urgentes = envios.filter((p) => p.prioridad === 'urgente').length;
  // El titular cuenta SOLO lo leído; una fuente caída se dice, no se suma como cero.
  const partes: string[] = [];
  if (!piezasSinDato && bus.piezasPendientes.length > 0) partes.push(t((bus.piezasPendientes.length) === 1 ? 'turno.parte_piezas_uno' : 'turno.parte_piezas', { n: numero(bus.piezasPendientes.length) }));
  if (envios.length > 0) partes.push(t((envios.length) === 1 ? 'turno.parte_envios_uno' : 'turno.parte_envios', { n: numero(envios.length) }));
  if (prs.estado === 'ok' && prs.prs.length > 0) partes.push(t((prs.prs.length) === 1 ? 'turno.parte_cambios_uno' : 'turno.parte_cambios', { n: numero(prs.prs.length) }));
  if (totalEscalaciones !== null && totalEscalaciones > 0) partes.push(t((totalEscalaciones) === 1 ? 'turno.parte_escalaciones_uno' : 'turno.parte_escalaciones', { n: numero(totalEscalaciones) }));
  const hayCiegas = piezasSinDato || prs.estado === 'error' || totalEscalaciones === null;
  const titular = (partes.length > 0 ? t('turno.titular_hay', { partes: partes.join(' · ') }) : t('turno.titular_nada')) + (hayCiegas ? ` ${t('turno.titular_sin_lectura')}` : '');
  // La siguiente mejor acción sale de las mismas cifras, en orden de daño: lo que frena a los agentes, lo urgente, lo vencido, lo demás.
  const siguiente: { texto: string; href: string; boton: string } | null =
    cola?.frenaAlRunner ? { texto: t('turno.sig_bandeja', { n: numero(cola.pendientes) }), href: '/admin/aprobaciones', boton: t('tu_turno_vista.ir_a_aprobaciones') }
    : urgentes > 0 ? { texto: t((urgentes) === 1 ? 'turno.sig_urgentes_uno' : 'turno.sig_urgentes', { n: numero(urgentes) }), href: '/admin/aprobaciones', boton: t('tu_turno_vista.revisar_y_aprobar_en') }
    : vencidas > 0 ? { texto: t((vencidas) === 1 ? 'turno.sig_vencidas_uno' : 'turno.sig_vencidas', { n: numero(vencidas) }), href: '/admin/escalaciones', boton: t('tu_turno_vista.la_cola_completa') }
    : !piezasSinDato && bus.piezasPendientes.length > 0 ? { texto: t((bus.piezasPendientes.length) === 1 ? 'turno.sig_piezas_uno' : 'turno.sig_piezas', { n: numero(bus.piezasPendientes.length) }), href: '#tt-piezas', boton: t('turno.sig_ver_piezas') }
    : envios.length > 0 ? { texto: t((envios.length) === 1 ? 'turno.sig_envios_uno' : 'turno.sig_envios', { n: numero(envios.length) }), href: '/admin/aprobaciones', boton: t('tu_turno_vista.revisar_y_aprobar_en') }
    : totalEscalaciones !== null && totalEscalaciones > 0 ? { texto: t((totalEscalaciones) === 1 ? 'turno.sig_escalaciones_uno' : 'turno.sig_escalaciones', { n: numero(totalEscalaciones) }), href: '/admin/escalaciones', boton: t('tu_turno_vista.la_cola_completa') }
    : null;

  const columnasRutinas: ColumnaBase<RutinaBus>[] = [
    { id: 'rutina', titulo: t('tu_turno_vista.rutina'), principal: true, celda: (r) => r.nombre },
    { id: 'horario', titulo: t('tu_turno_vista.horario'), celda: (r) => r.horario || '—' },
    { id: 'ultima', titulo: t('tu_turno_vista.ultima_corrida'), celda: (r) => (r.ultimaCorrida ? fechaHoraMx(r.ultimaCorrida.inicio) : t('tu_turno_vista.sin_corridas_en_el')) },
    {
      id: 'veredicto', titulo: t('tu_turno_vista.veredicto'),
      celda: (r) => (r.ultimaCorrida ? (
        <>
          {r.ultimaCorrida.exitCode !== null && (
            <StatusChip tono={r.ultimaCorrida.exitCode === 0 ? 'ok' : 'bad'}>{r.ultimaCorrida.exitCode === 0 ? 'ok' : `exit ${r.ultimaCorrida.exitCode}`}</StatusChip>
          )}{' '}
          {r.ultimaCorrida.veredicto ?? '—'}
          {r.ultimaCorrida.prUrl && <>{' '}<a href={r.ultimaCorrida.prUrl} target="_blank" rel="noreferrer">PR</a></>}
        </>
      ) : '—'),
    },
    {
      id: 'accion', titulo: t('tu_turno_vista.accion'), alinear: 'der',
      celda: (r) => (
        <form action={accionOrden}>
          <input type="hidden" name="tipo" value="correr_ahora" />
          <input type="hidden" name="rutina" value={r.nombre} />
          <BotonEnvio><Play {...ICONO} />  {t('tu_turno_vista.correr_ahora')}</BotonEnvio>
        </form>
      ),
    },
  ];

  return (
    <EsqueletoPortada
      titulo={t('tu_turno_vista.tu_turno')}
      apoyo={t('tu_turno_vista.todo_lo_que_espera')}
      titular={titular}
      filtros={(
        <BarraFiltros accion="/admin/tu-turno" enLinea etiqueta={t('turno.filtrar')} nActivos={fuente === '' ? 0 : 1} limpiarHref="/admin/tu-turno">
          <FiltroOpciones etiqueta={t('turno.mostrar')} nombre="fuente" valor={fuente} opciones={[
            { valor: '', rotulo: t('turno.todo') }, { valor: 'piezas', rotulo: t('turno.f_piezas') }, { valor: 'envios', rotulo: t('turno.f_envios') },
            { valor: 'cambios', rotulo: t('turno.f_cambios') }, { valor: 'escalaciones', rotulo: t('turno.f_escalaciones') }, { valor: 'rutinas', rotulo: t('turno.f_rutinas') },
          ]} />
        </BarraFiltros>
      )}
      etiquetaProcedencia={t('turno.procedencia')}
      procedencia={(
        <>
          <li><SelloDato tipo={bus.errores.length > 0 ? 'sin_dato' : 'observado'} fuente={t('turno.fuente_bus')} leidoEn={ahora} ahora={ahora} edad={false} /></li>
          <li><SelloDato tipo={prs.estado === 'ok' ? 'observado' : 'sin_dato'} fuente="GitHub" leidoEn={ahora} ahora={ahora} edad={false} /></li>
          <li><SelloDato tipo={totalEscalaciones === null ? 'sin_dato' : 'observado'} fuente={t('turno.fuente_escalaciones')} leidoEn={ahora} ahora={ahora} edad={false} /></li>
        </>
      )}
      metodo={t('turno.sesion_pie', { sesionNombre })}
      avisos={(aviso || error || bus.errores.length > 0) ? (
        <>
          {aviso && <Aviso tono="ok">{aviso}</Aviso>}
          {error && <Aviso tono="error">{error}</Aviso>}
          {bus.errores.length > 0 && (
            <Aviso tono="warn" titulo={t('tu_turno_vista.fuentes_que_no_se')}>{bus.errores.join(' · ')}</Aviso>
          )}
        </>
      ) : null}
      /* Cifras REALES de lo que espera a un humano. Una fuente que no se pudo leer es «—», no un cero. */
      etiquetaCifras={t('tu_turno_vista.lo_que_espera_tu')}
      cifras={uniformes([
          {
            etiqueta: t('tu_turno_vista.piezas_para_tu_tap'), formato: 'entero',
            valor: piezasSinDato ? null : bus.piezasPendientes.length,
            nota: piezasSinDato ? t('tu_turno_vista.no_se_pudo_leer_2') : bus.piezasPendientes.length >= TOPE_PIEZAS ? t('tu_turno_vista.se_cuentan_las_mas', { TOPE_PIEZAS }) : undefined,
          },
          { etiqueta: t('tu_turno_vista.envios_por_aprobar'), valor: envios.length, formato: 'entero' },
          {
            etiqueta: t('tu_turno_vista.cambios_por_aprobar'), formato: 'entero',
            valor: prs.estado === 'ok' ? prs.prs.length : null,
            nota: prs.estado === 'ok' ? undefined : prs.estado === 'sin_token' ? t('tu_turno_vista.falta_conectar_github') : t('tu_turno_vista.github_no_contesto'),
          },
          {
            etiqueta: t('tu_turno_vista.escalaciones'), valor: totalEscalaciones, formato: 'entero',
            nota: totalEscalaciones === null ? t('tu_turno_vista.no_se_pudo_leer_3') : undefined,
          },
      ])}
    >

      {ver('piezas') ? (
        <FilaTarjetas variante="8-4">
          {/* ── 1 · Piezas de las rutinas — el tap de publicar. FE-13: `leerEstadoBus` trae 50 como tope; con la cola llena, "(50)" se lee como el total. */}
          <Tarjeta
            titulo={t('turno.piezas_para_tap', { n: bus.piezasPendientes.length, mas: bus.piezasPendientes.length >= TOPE_PIEZAS ? '+' : '' })}
            estado={piezasSinDato ? 'error' : bus.piezasPendientes.length === 0 ? 'vacio' : 'ok'} contenida
            mensaje={piezasSinDato ? t('tu_turno_vista.no_se_pudo_leer_2') : t('tu_turno_vista.no_hay_piezas_esperando')}
            detalle={t('tu_turno_vista.las_piezas_que_preparan')}
          >
            <div id="tt-piezas">
              {bus.piezasPendientes.length >= TOPE_PIEZAS && <p className="bj-nota">{t('turno.se_listan_recientes', { n: TOPE_PIEZAS })}</p>}
              <div className="bj-piezas bj-piezas--compacta">
            {bus.piezasPendientes.map((p) => (
              <article key={p.id} className="bj-pieza">
                <div className="bj-pieza__marco">
                  {p.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage, dominio propio
                    <img src={p.mediaUrl} alt={p.titulo} loading="lazy" />
                  ) : (
                    <span><ImageIcon {...ICONO} />  {t('tu_turno_vista.sin_imagen')}</span>
                  )}
                </div>
                <div className="bj-pieza__cuerpo">
                  <div className="bj-pieza__meta">
                    <StatusChip tono="neutral">{p.tipo}</StatusChip>
                    <span>{p.rutina}</span>
                    <span className="bj-pieza__edad">{edadDe(p.creadoEn, ahora, t)}</span>
                  </div>
                  <h3 className="bj-pieza__titulo" title={p.titulo}>{p.titulo}</h3>
                  {p.copyMd && (
                    <details className="bj-pieza__copy">
                      <summary>{t('tu_turno_vista.ver_el_copy')}</summary>
                      <pre>{p.copyMd}</pre>
                    </details>
                  )}
                  <div className="bj-pieza__acciones">
                    {/* Acción principal sólida y secundaria discreta: aprobar publica, descartar no. */}
                    <form action={accionPieza}>
                      <input type="hidden" name="pieza" value={p.id} />
                      <input type="hidden" name="accion" value="aprobada" />
                      <Boton type="submit" variante="primary" tamano="sm">Aprobar</Boton>
                    </form>
                    <form action={accionPieza}>
                      <input type="hidden" name="pieza" value={p.id} />
                      <input type="hidden" name="accion" value="descartada" />
                      <Boton type="submit" variante="ghost" tamano="sm">Descartar</Boton>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
            </div>
          </Tarjeta>

          {/* ── Siguiente mejor acción: sale de las mismas cifras, nunca de una estimación ── */}
          <Tarjeta className="bj-sig" titulo={t('turno.siguiente_accion')} estado={siguiente === null ? 'vacio' : 'ok'} contenida
            mensaje={t('turno.sig_nada')} detalle={hayCiegas ? t('turno.titular_sin_lectura') : t('turno.sig_nada_detalle')}>
            {siguiente ? (
              <div className="bj-bloque">
                <p className="bj-siguiente">{siguiente.texto}</p>
                <div><BotonEnlace href={siguiente.href} variante="primary" tamano="sm">{siguiente.boton}</BotonEnlace></div>
              </div>
            ) : null}
          </Tarjeta>
        </FilaTarjetas>
      ) : null}

      {ver('envios') || ver('escalaciones') ? (
      <FilaTarjetas variante="6-6">
        {/* ── 2 · Envíos redactados (0117) — dinero directo, se resuelven en Aprobaciones ─ */}
        {ver('envios') ? <Tarjeta
          titulo={t('tu_turno_vista.envios_por_aprobar_2', { length: envios.length })}
          estado={envios.length === 0 ? 'vacio' : 'ok'} contenida mensaje={t('tu_turno_vista.nada_redactado_esperando_tu')}
          acciones={<BotonEnlace href="/admin/aprobaciones" variante="secondary" tamano="sm">{t('tu_turno_vista.revisar_y_aprobar_en')}</BotonEnlace>}
        >
          <ul className="bj-lista">
            {envios.slice(0, 5).map((p) => (
              <li key={p.id}>
                <StatusChip tono={p.prioridad === 'urgente' ? 'warn' : 'neutral'}>{p.prioridad}</StatusChip>
                <span className="bj-lista__texto">{p.titulo}</span>
                <span className="bj-lista__apoyo">{p.prospectoEmpresa ?? p.agente}</span>
              </li>
            ))}
          </ul>
        </Tarjeta> : null}

        {/* ── 4 · Escalaciones — el top; la cola completa vive en su pantalla ── */}
        {ver('escalaciones') ? <Tarjeta
          titulo={t('tu_turno_vista.escalaciones_2', { totalEscalaciones: totalEscalaciones === null ? '—' : totalEscalaciones })}
          estado={totalEscalaciones === null ? 'error' : totalEscalaciones === 0 ? 'vacio' : 'ok'} contenida
          mensaje={totalEscalaciones === null ? t('tu_turno_vista.no_se_pudo_leer_4') : t('tu_turno_vista.nada_escalado_a_un')}
          acciones={<BotonEnlace href="/admin/escalaciones" variante="secondary" tamano="sm">{t('tu_turno_vista.la_cola_completa')}</BotonEnlace>}
        >
          <ul className="bj-lista">
            {escalaciones.cola.slice(0, 5).map((it, i) => (
              <li key={`${it.fuente}-${i}`}>
                <StatusChip tono={it.vence && new Date(it.vence).getTime() < ahora ? 'bad' : 'neutral'}>{it.fuente}</StatusChip>
                {it.href ? <Link className="bj-lista__texto" href={it.href}>{it.titulo}</Link> : <span className="bj-lista__texto">{it.titulo}</span>}
                <span className="bj-lista__apoyo">{edadDe(it.desde, ahora, t)}</span>
              </li>
            ))}
          </ul>
        </Tarjeta> : null}
      </FilaTarjetas>
      ) : null}

      {ver('cambios') || ver('escalaciones') ? (
      <FilaTarjetas variante="6-6">
        {/* ── 3 · Cambios de código (PRs) — la aprobación de CÓDIGO es fusionarlos en GitHub, no un botón aquí ── */}
        {!ver('cambios') ? null : prs.estado === 'sin_token' ? (
          <Tarjeta titulo={t('tu_turno_vista.cambios_por_aprobar')} estado="vacio" contenida mensaje={t('tu_turno_vista.falta_conectar_github')}
            detalle={t('tu_turno_vista.sin_ese_acceso_no')} />
        ) : prs.estado === 'error' ? (
          <Tarjeta titulo={t('tu_turno_vista.cambios_por_aprobar')} estado="error"
            mensaje={t('tu_turno_vista.github_no_contesto_no')} />
        ) : (
          <Tarjeta titulo={t('tu_turno_vista.cambios_por_aprobar')} estado={prs.prs.length === 0 ? 'vacio' : 'ok'} contenida mensaje={t('tu_turno_vista.no_hay_cambios_por')} detalle={t('tu_turno_vista.cuando_alguien_proponga_un')}>
            <ul className="bj-lista">
              {prs.prs.map((pr) => (
                <li key={pr.numero}>
                  <GitPullRequest {...ICONO} aria-hidden="true" />
                  <a className="bj-lista__texto" href={pr.url} target="_blank" rel="noreferrer">#{pr.numero} · {pr.titulo}</a>
                  <span className="bj-lista__apoyo">{edadDe(pr.creadoEn, ahora, t)}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {/* ── Agentes que no corrieron y por qué (P0 de visibilidad) ──────── */}
        {ver('escalaciones') ? <TarjetaAgentesParados t={t} parados={parados} cola={cola} /> : null}
      </FilaTarjetas>
      ) : null}

      {/* ── 5 · Las rutinas de la Mac — estado y mando ───────────────────── */}
      {ver('rutinas') ? (
      <Tarjeta
        titulo={t('turno.rutinas_automaticas', { n: bus.rutinas.length })}
        acciones={(
          <div className="bj-acciones">
            <form action={accionOrden}>
              <input type="hidden" name="tipo" value="kill_switch_on" />
              {/* A37-S08-03: un toque accidental apagaba TODAS las rutinas. */}
              <BotonConfirmar
                etiqueta={t('tu_turno_vista.apagar_todas')} icono={<PowerOff {...ICONO} />} tono="peligro"
                etiquetaConfirmar="Sí, apagar todas" titulo={t('tu_turno_vista.apagar_todas_las_rutinas')}
                descripcion={t('tu_turno_vista.se_encola_la_orden', { length: bus.rutinas.length })}
                className={clasesBoton('secondary', 'sm')}
              />
            </form>
            <form action={accionOrden}>
              <input type="hidden" name="tipo" value="kill_switch_off" />
              <BotonConfirmar
                etiqueta={t('tu_turno_vista.encender_todas')} icono={<Power {...ICONO} />} tono="normal"
                etiquetaConfirmar="Sí, encender todas" titulo={t('tu_turno_vista.encender_todas_las_rutinas')}
                descripcion={t('tu_turno_vista.se_encola_la_orden_2', { length: bus.rutinas.length })}
                className={clasesBoton('secondary', 'sm')}
              />
            </form>
          </div>
        )}
      >
        {bus.killSwitchPendiente && (
          <p className="bj-nota">{t('turno.orden_esperando')}</p>
        )}
        {bus.rutinas.length === 0 ? (
          <EstadoVacio titulo={t('tu_turno_vista.aun_no_hay_rutinas')} icono={Bot} contenido>
            
            {t('tu_turno_vista.cuando_el_equipo_tecnico')}
          </EstadoVacio>
        ) : (
          <>
            <TablaBase etiqueta={t('tu_turno_vista.rutinas_programadas')} columnas={columnasRutinas} filas={bus.rutinas} idFila={(r) => r.nombre} densa tarjetaMovil />
            {/* ── EL EDITOR DE RUTINAS (Fase D, cerrado 17-ago-2026) ────────
                El encargo se edita AQUÍ y viaja como orden editar_encargo: la Mac abre un PR chico con el cambio — jamás escritura
                directa. Solo rutinas con encargo sembrado se pueden editar (sin el texto original no hay qué pre-llenar ni qué PR). */}
            {bus.rutinas.filter((r) => r.encargoMd).map((r) => (
              <Disclosure key={`ed-${r.nombre}`} titulo={t('tu_turno_vista.editar_encargo', { nombre: r.nombre })}>
                <form action={accionOrden} className="bj-item__forma">
                  <input type="hidden" name="tipo" value="editar_encargo" />
                  <input type="hidden" name="rutina" value={r.nombre} />
                  <CampoTextarea etiqueta={t('tu_turno_vista.encargo_de', { nombre: r.nombre })} etiquetaOculta name="contenido" defaultValue={r.encargoMd} required maxLength={20000} rows={12} />
                  <div className="bj-item__fila">
                    <BotonEnvio variante="primary">{t('tu_turno_vista.encolar_el_cambio_la')}</BotonEnvio>
                    <p className="bj-nota">{t('tu_turno_vista.nada_se_escribe_directo')}</p>
                  </div>
                </form>
              </Disclosure>
            ))}
          </>
        )}
      </Tarjeta>
      ) : null}

      {/* ── 6 · Órdenes recientes — el acuse de la Mac ───────────────────── */}
      {ver('rutinas') ? <Tarjeta titulo={t('tu_turno_vista.ordenes_recientes')} estado={bus.ordenesRecientes.length === 0 ? 'vacio' : 'ok'} mensaje={t('tu_turno_vista.aun_no_has_ordenado')}>
        <ul className="bj-lista">
          {bus.ordenesRecientes.map((o) => (
            <li key={o.id}>
              <StatusChip tono={o.estado === 'hecha' ? 'ok' : o.estado === 'fallida' ? 'bad' : 'neutral'}>{o.estado}</StatusChip>
              <span>{nombreOrden(o.tipo, t)}{o.rutina ? ` · ${o.rutina}` : ''}</span>
              <span className="bj-lista__apoyo">{edadDe(o.creadoEn, ahora, t)}</span>
              {o.resultado && <span className="bj-lista__texto bj-lista__apoyo">— {o.resultado}</span>}
            </li>
          ))}
        </ul>
      </Tarjeta> : null}

    </EsqueletoPortada>
  );
}
