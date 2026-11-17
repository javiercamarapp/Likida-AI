import Link from 'next/link';
import { Send } from 'lucide-react';
import '../conductores.css';
import { fechaHoraEnZona, numero, TZ_MX } from '@/lib/formato';
import {
  conteosConv, ESTADOS_CONV, armarHilo, type EntradaHilo, type EstadoConv, type FilaConv,
} from '@/lib/likida/conductor/conversaciones';
import type { DatosConversacion } from '@/lib/likida/conductor/repo_conversaciones';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import type { TipoHito } from '@/lib/likida/conductor/tipos';
import { Aviso, BarraPeriodo, BotonEnlace, EstadoError, EstadoVacio, hrefConParams, Icono, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSACIONES CON OPERADORES — izquierda la lista (los que NO responden arriba), derecha el hilo del viaje abierto.
// El hilo se reconstruye de la bitácora del agente (ver `lib/likida/conductor/conversaciones.ts`): lo que el sistema no guardó no se pinta.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/conductores/conversaciones';

export interface FiltrosConversaciones { estado: EstadoConv | ''; terminalId: string; operadorId: string }

const TONO_ESTADO: Record<EstadoConv, 'ok' | 'warn' | 'bad' | 'muted'> = { escalado: 'bad', sin_respuesta: 'warn', sin_telefono: 'muted', acepto: 'ok' };

/** «45 min», «3 h 10 min», «2 d 4 h»: unidades abreviadas, las mismas en los dos idiomas. */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${numero(m)} min`;
  if (m < 1440) { const r = m % 60; return r === 0 ? `${numero(Math.floor(m / 60))} h` : `${numero(Math.floor(m / 60))} h ${numero(r)} min`; }
  const h = Math.floor((m % 1440) / 60);
  return h === 0 ? `${numero(Math.floor(m / 1440))} d` : `${numero(Math.floor(m / 1440))} d ${numero(h)} h`;
}

const hitoTr = (tx: TAgentes, t: TipoHito | null): string => (t ? tx(`cop.h.${t}`) : tx('cop.m.aviso.sin_hito'));

function Ficha({ fila, tx, href, activa }: { fila: FilaConv; tx: TAgentes; href: string; activa: boolean }) {
  const v = fila.viaje;
  const folio = v.folio ?? tx('cop.lista.sin_folio');
  const operador = v.operadorNombre ?? tx('cop.lista.sin_operador');
  const ruta = [v.origen, v.destino].filter(Boolean).join(' → ');
  return (
    <li className="rv-conv__item">
      <Link href={href} prefetch={false} scroll={false} className="rv-conv__ficha" data-activa={activa || undefined} data-estado={fila.estado} aria-current={activa ? 'true' : undefined}>
        <span className="rv-conv__fila">
          <span className="rv-conv__nombre rv-cd__recorta" title={operador}>{operador}</span>
          <StatusChip tono={TONO_ESTADO[fila.estado]}>{tx(`cop.e.${fila.estado}`)}</StatusChip>
        </span>
        <span className="rv-cd__micro rv-cd__recorta" title={`${folio} · ${ruta}`}>{folio}{ruta ? ` · ${ruta}` : ''}</span>
        {fila.minutosSinRespuesta !== null ? (
          <span className="rv-conv__linea" data-tono={fila.estado === 'acepto' ? undefined : 'warn'}>{tx('cop.lista.sin_respuesta_hace', { tiempo: duracion(fila.minutosSinRespuesta) })}</span>
        ) : null}
        {fila.hitoEscalado ? <span className="rv-cd__micro" data-tono="warn">{tx('cop.lista.hito_escalado')}</span> : null}
        <span className="rv-conv__fila">
          <span className="rv-cd__micro rv-cd__recorta" title={v.terminalNombre ?? ''}>{v.terminalNombre ?? ''}</span>
          <span className="rv-cd__micro" data-tono={fila.prioridad === 'alta' ? 'warn' : 'muted'}>
            {fila.minutosACita === null || fila.citaTipo === null ? tx(`cop.p.${fila.prioridad}`) : (
              fila.minutosACita >= 0
                ? tx('cop.cita.en', { tipo: tx(`cop.cita.${fila.citaTipo}`), tiempo: duracion(fila.minutosACita) })
                : tx('cop.cita.vencida', { tipo: tx(`cop.cita.${fila.citaTipo}`), tiempo: duracion(-fila.minutosACita) })
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Entrada({ e, tx, zona }: { e: EntradaHilo; tx: TAgentes; zona: string }) {
  const hora = fechaHoraEnZona(new Date(e.en), zona);
  const lineas: string[] = [];
  let aparte: string | null = null;
  let tono: 'ok' | 'warn' | 'bad' | undefined;
  switch (e.tipo) {
    case 'aviso_viaje':
      lineas.push(tx('cop.m.aviso_viaje'));
      if (e.avisos > 1) aparte = tx('cop.m.aviso_viaje_n', { n: numero(e.avisos) });
      break;
    case 'aviso': {
      const a = e.aviso;
      const clase = ['solicitud', 'recordatorio', 'escalacion', 'confirmacion', 'aviso_oficina'].includes(a.clase) ? a.clase : 'otro';
      lineas.push(tx(`cop.m.aviso.${clase}` as 'cop.m.aviso.otro', { hito: hitoTr(tx, a.hitoTipo), nivel: numero(a.nivel) }));
      const canal = a.canal ? tx('cop.m.aviso.canal', { canal: tx(`cop.m.aviso.canal_${a.canal}` as 'cop.m.aviso.canal_texto') }) : '';
      aparte = [a.ok === true ? tx('cop.m.aviso.ok') : a.ok === false ? tx('cop.m.aviso.fallo') : tx('cop.m.aviso.sin_resultado'), canal].filter(Boolean).join(' · ');
      if (a.ok === false) tono = 'bad';
      break;
    }
    case 'acepto':
      lineas.push(tx('cop.m.acepto'));
      if (e.origen === 'importacion') aparte = tx('cop.m.acepto_importacion');
      break;
    case 'hito': {
      const h = e.hito;
      lineas.push(tx('cop.m.hito', { hito: hitoTr(tx, h.tipo) }));
      if (h.texto) lineas.push(tx('cop.m.hito_texto', { texto: h.texto }));
      if (h.lat !== null && h.lng !== null) lineas.push(tx('cop.m.hito_ubicacion', { lat: h.lat.toFixed(5), lng: h.lng.toFixed(5) }));
      if (h.conFoto) lineas.push(tx('cop.m.hito_foto'));
      if (h.contacto) lineas.push(tx('cop.m.hito_contacto', { nombre: h.contacto }));
      else if (h.sinContacto) lineas.push(tx('cop.m.hito_sin_contacto'));
      const partes: string[] = [];
      if (h.fuente) partes.push(tx('cop.m.hito_fuente', { fuente: tx(`cop.m.fuente.${h.fuente}` as 'cop.m.fuente.texto') }));
      if (h.validadoPor) partes.push(tx('cop.m.hito_validado_por', { quien: tx(`cop.m.quien.${h.validadoPor}` as 'cop.m.quien.gps') }));
      aparte = partes.join(' · ') || null;
      break;
    }
    case 'validacion': {
      const v = e.validacion;
      const fuente = v.fuente === 'pin' || v.fuente === 'gps' ? tx(`cop.m.val.fuente.${v.fuente}`) : tx('cop.m.val.fuente.otra');
      if (v.resultado === 'sin_dato') {
        const mot = v.motivo && ['sin_sitio', 'sin_ubicacion', 'ubicacion_fuera_de_ventana', 'coordenadas_invalidas'].includes(v.motivo) ? v.motivo : 'otro';
        lineas.push(tx('cop.m.val.sin_dato', { motivo: tx(`cop.m.val.motivo.${mot}` as 'cop.m.val.motivo.otro') }));
        tono = 'warn';
      } else {
        lineas.push(tx(v.resultado === 'validado' ? 'cop.m.val.validado' : 'cop.m.val.sin_coincidencia', { fuente, d: numero(v.distanciaM ?? 0), t: numero(v.toleranciaM) }));
        tono = v.resultado === 'validado' ? 'ok' : 'bad';
      }
      if (e.hitoTipo) aparte = tx('cop.m.val.hito', { hito: hitoTr(tx, e.hitoTipo) });
      break;
    }
    case 'escalado_viaje': lineas.push(tx('cop.m.escalado_viaje')); tono = 'bad'; break;
    case 'escalado_hito': lineas.push(tx('cop.m.escalado_hito', { n: numero(e.hito.escalacionNivel), hito: hitoTr(tx, e.hito.tipo) })); tono = 'bad'; break;
    case 'atendido_hito': lineas.push(tx('cop.m.atendido_hito', { hito: hitoTr(tx, e.hito.tipo) })); tono = 'ok'; break;
    case 'evento': {
      const ev = ['omitido', 'corregido', 'pospuesto', 'atendido', 'contacto'].includes(e.evento.evento) ? e.evento.evento : 'otro';
      lineas.push(tx(`cop.m.ev.${ev}` as 'cop.m.ev.otro', { hito: hitoTr(tx, e.evento.hitoTipo) }));
      break;
    }
    case 'escalacion': {
      const d = ['mesa_de_control', 'liquidacion', 'jefe_de_trafico', 'contador'].includes(e.escalacion.destino) ? tx(`cop.d.${e.escalacion.destino}` as 'cop.d.contador') : e.escalacion.destino;
      lineas.push(tx('cop.m.escalacion', { destino: d, resumen: e.escalacion.resumen }));
      tono = e.escalacion.estado === 'abierta' ? 'bad' : undefined;
      break;
    }
    case 'escalacion_atendida': {
      const d = ['mesa_de_control', 'liquidacion', 'jefe_de_trafico', 'contador'].includes(e.escalacion.destino) ? tx(`cop.d.${e.escalacion.destino}` as 'cop.d.contador') : e.escalacion.destino;
      lineas.push(tx('cop.m.escalacion_atendida', { destino: d }));
      if (e.escalacion.nota) aparte = tx('cop.m.escalacion_nota', { nota: e.escalacion.nota });
      tono = 'ok';
      break;
    }
  }
  return (
    <li className="rv-conv__msg" data-actor={e.actor}>
      <span className="rv-conv__cab"><strong>{tx(`cop.actor.${e.actor}`)}</strong><time dateTime={e.en}>{hora}</time></span>
      <span className="rv-conv__burbuja" data-tono={tono}>
        {lineas.map((l, i) => <span key={i} className="rv-conv__texto">{l}</span>)}
        {aparte ? <span className="rv-cd__micro rv-conv__texto">{aparte}</span> : null}
      </span>
    </li>
  );
}

function Hilo({ datos, tx, zona, hrefLista }: { datos: DatosConversacion; tx: TAgentes; zona: string; hrefLista: string }) {
  const entradas = armarHilo(datos);
  const v = datos.viaje;
  const folio = v.folio ?? tx('cop.lista.sin_folio');
  const ruta = [v.origen, v.destino].filter(Boolean).join(' → ');
  return (
    <Tarjeta titulo={tx('cop.hilo.titulo', { folio })}>
      <div className="rv-conv__hilo-cab">
        <Link href={hrefLista} prefetch={false} scroll={false} className="rv-cd__enlace rv-conv__volver">{tx('cop.hilo.volver_lista')}</Link>
        <span className="rv-cd__medio rv-cd__recorta" title={v.operadorNombre ?? ''}>{v.operadorNombre ?? tx('cop.lista.sin_operador')}</span>
        <span className="rv-cd__micro rv-cd__recorta" title={ruta}>{[ruta, v.terminalNombre].filter(Boolean).join(' · ')}</span>
      </div>
      {entradas.length === 0 ? (
        <EstadoVacio titulo={tx('cop.hilo.vacio_titulo')} contenido>{tx('cop.hilo.vacio_texto')}</EstadoVacio>
      ) : (
        <ol className="rv-conv__hilo" aria-label={tx('cop.hilo.etiqueta')}>
          {entradas.map((e) => <Entrada key={e.clave} e={e} tx={tx} zona={zona} />)}
        </ol>
      )}
      <p className="rv-cd__nota">{tx('cop.hilo.nota')}</p>
      <div className="rv-conv__atencion">
        <p className="rv-cd__rotulo">{tx('cop.at.titulo')}</p>
        {datos.atencion.length === 0 ? <p className="rv-cd__nota">{tx('cop.at.ninguno')}</p> : (
          <ul className="rv-cd__lista">
            {datos.atencion.map((c) => (
              <li key={`${c.nivel}-${c.nombre}-${c.ult4}`} className="rv-cd__nota rv-cd__recorta" title={c.nombre}>
                {tx('cop.at.nivel', { n: c.nivel, alcance: tx(c.alcance === 'terminal' ? 'cop.at.alcance_terminal' : 'cop.at.alcance_flota'), nombre: c.nombre, ult4: c.ult4 })}
              </li>
            ))}
          </ul>
        )}
        <p className="rv-cd__micro">{tx('cop.at.nota')}</p>
      </div>
      {/* Nada se envía desde aquí: el campo existe para mostrar a dónde llegará, deshabilitado hasta conectar la línea. */}
      <div className="rv-conv__responder">
        <label className="rv-cd__rotulo" htmlFor="rv-conv-resp">{tx('cop.resp.titulo')}</label>
        <div className="rv-conv__responder-fila">
          <textarea id="rv-conv-resp" className="rv-conv__campo" rows={2} disabled placeholder={tx('cop.resp.placeholder')} aria-describedby="rv-conv-resp-nota" />
          <button type="button" className="rv-conv__enviar" disabled aria-disabled="true"><Icono icono={Send} tam={14} />{tx('cop.resp.enviar')}</button>
        </div>
        <p id="rv-conv-resp-nota" className="rv-cd__micro">{tx('cop.resp.placeholder')}</p>
      </div>
    </Tarjeta>
  );
}

export function VistaConversaciones({ sufijo, filtros, catalogos, filas, hayMas, error, seleccion, hilo, hiloError, ocultos, zonaHoraria = TZ_MX, tr = TR_ES }: {
  sufijo: string; filtros: FiltrosConversaciones; catalogos: CatalogosFiltro | null;
  /** TODAS las filas leídas (sin el filtro de estado): los conteos de arriba salen de aquí. */
  filas: FilaConv[]; hayMas: boolean; error: string | null;
  seleccion: string; hilo: DatosConversacion | null; hiloError: boolean;
  ocultos: Record<string, string>; zonaHoraria?: string; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const todos = { valor: '', rotulo: tx('cop.f.todos') };
  const criterios = [
    { nombre: 'estado', etiqueta: tx('cop.f.estado'), valor: filtros.estado, opciones: [todos, ...ESTADOS_CONV.map((e) => ({ valor: e as string, rotulo: tx(`cop.e.${e}`) }))] },
    { nombre: 'terminal', etiqueta: tx('cop.f.patio'), valor: filtros.terminalId, opciones: [todos, ...(catalogos?.terminales ?? []).map((t) => ({ valor: t.id, rotulo: t.nombre }))] },
    { nombre: 'chofer', etiqueta: tx('cop.f.operador'), valor: filtros.operadorId, opciones: [todos, ...(catalogos?.operadores ?? []).map((o) => ({ valor: o.id, rotulo: o.nombre }))] },
  ];
  const base: Record<string, string> = { ...ocultos };
  for (const c of criterios) if (c.valor) base[c.nombre] = c.valor;
  const hrefLimpio = `?${new URLSearchParams(ocultos).toString()}`;
  const visibles = filtros.estado === '' ? filas : filas.filter((f) => f.estado === filtros.estado);
  const c = conteosConv(filas);
  const hrefDe = (id: string | null) => hrefConParams(RUTA, base, { viaje: id });

  const barra = (
    <BarraPeriodo etiqueta={tx('cop.etiqueta_filtros')}
      chips={criterios.filter((x) => x.valor).map((x) => ({ id: x.nombre, etiqueta: `${x.etiqueta}: ${x.opciones.find((o) => o.valor === x.valor)?.rotulo ?? ''}`, hrefQuitar: hrefConParams(RUTA, base, { [x.nombre]: null }) }))}
      cajon={{ accion: RUTA, ocultos: Object.entries(ocultos), limpiarHref: hrefLimpio, nActivos: criterios.filter((x) => x.valor).length, campos: { items: criterios.map((x) => ({ tipo: 'select' as const, ...x })) } }} />
  );

  return (
    <EsqueletoTablaMaestra
      titulo={tx('cop.titulo')}
      apoyo={tx('cop.apoyo')}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/conductores${sufijo}`}>{tx('cop.volver')}</BotonEnlace>}
      filtros={barra}
      avisos={!error && hayMas ? <Aviso tono="warn">{tx('cop.lista.hay_mas')}</Aviso> : undefined}
      cifras={error ? undefined : ESTADOS_CONV.map((e) => ({ etiqueta: tx(`cop.e.${e}`), valor: numero(c[e]), tono: e === 'escalado' && c[e] > 0 ? ('bad' as const) : e === 'sin_respuesta' && c[e] > 0 ? ('warn' as const) : undefined }))}
      etiquetaCifras={tx('cop.titulo')}
    >
      {error ? (
        <EstadoError compacto>{error}</EstadoError>
      ) : (
        <div className="rv-conv" data-abierto={seleccion ? '' : undefined}>
          <section className="rv-conv__lista" aria-label={tx('cop.lista.etiqueta')}>
            <Tarjeta titulo={tx('cop.lista.titulo')}>
              {visibles.length === 0 ? (
                <EstadoVacio titulo={tx('cop.lista.vacio_titulo')} contenido>{filas.length === 0 ? tx('cop.lista.vacio_texto') : tx('cop.lista.vacio_estado')}</EstadoVacio>
              ) : (
                <>
                  <p className="rv-cd__micro">{tx('cop.lista.mostrando', { n: numero(visibles.length) })}</p>
                  <ul className="rv-conv__fichas">
                    {visibles.map((f) => <Ficha key={f.viaje.id} fila={f} tx={tx} href={hrefDe(f.viaje.id)} activa={f.viaje.id === seleccion} />)}
                  </ul>
                </>
              )}
            </Tarjeta>
          </section>
          <section className="rv-conv__detalle" aria-live="polite">
            {!seleccion ? (
              <Tarjeta titulo={tx('cop.titulo')}><EstadoVacio titulo={tx('cop.hilo.elige_titulo')} contenido>{tx('cop.hilo.elige_texto')}</EstadoVacio></Tarjeta>
            ) : hilo ? (
              <Hilo datos={hilo} tx={tx} zona={zonaHoraria} hrefLista={hrefDe(null)} />
            ) : (
              <Tarjeta titulo={tx('cop.titulo')}>{hiloError
                ? <EstadoError compacto>{tx('cop.lista.error')}</EstadoError>
                : <EstadoVacio titulo={tx('cop.hilo.elige_titulo')} contenido>{tx('cop.hilo.no_hay')}</EstadoVacio>}</Tarjeta>
            )}
          </section>
        </div>
      )}
    </EsqueletoTablaMaestra>
  );
}
