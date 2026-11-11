'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import { Aviso as Franja, Boton, BotonEnlace, CampoSelect, StatusChip, Tarjeta, type TonoEstado } from '../componentes';
import { SegmentedControl } from '../componentes/segmented';
import { useFormato, useT } from '@/lib/i18n/proveedor';
import { avisos as avisosEs } from '@/lib/i18n/es/avisos';
import {
  CATEGORIAS, clavesParaMarcarTodo, contarPestanas, estaLeido, filtrarAvisos, FILTROS_INICIALES,
  type Aviso, type Categoria, type Filtros, type Pestana, type Severidad,
} from '@/lib/avisos/modelo';
import { marcarAvisos, type Destino } from './acciones';
import './avisos.css';

const TONO: Record<Severidad, TonoEstado> = { critica: 'bad', atencion: 'warn', info: 'info' };

/**
 * La lista de avisos (clon del panel de Rovaq: pestañas No leídas / Leídas / Todas, origen, hora, enlace a la pantalla que lo resuelve,
 * marcar leído / no leído, marcar todo, filtros por tipo y severidad). El estado «leído» es del servidor (por persona y ámbito): aquí solo
 * se pinta optimistamente y se pide `router.refresh()` para que el número del pie se recalcule con la MISMA función.
 */
export default function PanelAvisos({ destino, ambito, avisos, leidas: leidasIniciales, generadoEn, sufijo, errorLeidas, errorPrefs }: {
  destino: Destino;
  ambito: 'admin' | 'flota';
  avisos: Aviso[];
  leidas: string[];
  generadoEn: string;
  /** `?tenant=…` que hay que arrastrar en los enlaces del panel del cliente (vacío en /admin). */
  sufijo: string;
  errorLeidas: boolean;
  errorPrefs: boolean;
}) {
  const { t, tp } = useT('avisos', avisosEs);
  const f = useFormato();
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const [leidas, setLeidas] = useState<Set<string>>(() => new Set(leidasIniciales));
  const [fallo, setFallo] = useState(false);
  // Tras `router.refresh()` llega la lista del servidor: se adopta (el estado optimista solo vive hasta entonces).
  const [previas, setPrevias] = useState(leidasIniciales);
  if (previas !== leidasIniciales) { setPrevias(leidasIniciales); setLeidas(new Set(leidasIniciales)); }

  const conteos = useMemo(() => contarPestanas(avisos, leidas), [avisos, leidas]);
  const visibles = useMemo(() => filtrarAvisos(avisos, leidas, filtros), [avisos, leidas, filtros]);
  const hayFiltros = filtros.categoria !== 'todas' || filtros.severidad !== 'todas';

  const marcar = (claves: string[], leido: boolean) => {
    if (claves.length === 0) return;
    const antes = leidas;
    setLeidas((p) => { const n = new Set(p); for (const c of claves) { if (leido) n.add(c); else n.delete(c); } return n; });
    setFallo(false);
    empezar(async () => {
      const r = await marcarAvisos(destino, claves, leido).catch(() => ({ ok: false as const, error: 'red' }));
      if (!r.ok) { setLeidas(antes); setFallo(true); return; }
      router.refresh();
    });
  };

  const pestanas: Array<{ valor: Pestana; etiqueta: string; conteo: number }> = [
    { valor: 'no_leidos', etiqueta: t('notif.pestana.no_leidos'), conteo: conteos.no_leidos },
    { valor: 'leidos', etiqueta: t('notif.pestana.leidos'), conteo: conteos.leidos },
    { valor: 'todos', etiqueta: t('notif.pestana.todos'), conteo: conteos.todos },
  ];
  const paraTodo = clavesParaMarcarTodo(visibles, leidas);

  return (
    <div className="av-pila">
      {errorLeidas ? <Franja tono="error">{t('notif.err.leidas')}</Franja> : null}
      {errorPrefs ? <Franja tono="warn">{t('notif.err.prefs')}</Franja> : null}
      {fallo ? <Franja tono="error">{t('notif.err.accion')}</Franja> : null}

      <div className="av-barra">
        <SegmentedControl<Pestana>
          etiqueta={t('notif.pestana.etiqueta')} valor={filtros.pestana} onChange={(v) => setFiltros((p) => ({ ...p, pestana: v }))}
          opciones={pestanas.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta, conteo: p.conteo }))}
        />
        <div className="av-filtros">
          <CampoSelect etiqueta={t('notif.filtro.tipo')} value={filtros.categoria} onChange={(e) => setFiltros((p) => ({ ...p, categoria: e.target.value as Categoria | 'todas' }))}>
            <option value="todas">{t('notif.filtro.todos')}</option>
            {CATEGORIAS[ambito].map((c) => <option key={c} value={c}>{t(`notif.cat.${c}` as 'notif.cat.sistema')}</option>)}
          </CampoSelect>
          <CampoSelect etiqueta={t('notif.filtro.severidad')} value={filtros.severidad} onChange={(e) => setFiltros((p) => ({ ...p, severidad: e.target.value as Severidad | 'todas' }))}>
            <option value="todas">{t('notif.filtro.todos')}</option>
            {(['critica', 'atencion', 'info'] as const).map((s) => <option key={s} value={s}>{t(`notif.sev.${s}` as 'notif.sev.info')}</option>)}
          </CampoSelect>
          {hayFiltros ? <Boton tamano="sm" variante="ghost" onClick={() => setFiltros((p) => ({ ...p, categoria: 'todas', severidad: 'todas' }))}>{t('notif.filtro.limpiar')}</Boton> : null}
          <Boton tamano="sm" variante="secondary" disabled={pendiente || paraTodo.length === 0} onClick={() => marcar(paraTodo, true)} icono={<CheckCheck width={13} height={13} strokeWidth={1.75} />}>
            {t('notif.accion.marcarTodo')}
          </Boton>
        </div>
      </div>

      {visibles.length === 0 ? (
        <Tarjeta titulo={t('notif.titulo')} estado="vacio" mensaje={hayFiltros ? t('notif.vacio.filtro') : t(`notif.vacio.${filtros.pestana}` as 'notif.vacio.todos')} />
      ) : (
        <Tarjeta titulo={tp('notif.conteo', conteos.no_leidos)}>
          <ul className="av-lista" aria-label={t('notif.titulo')}>
            {visibles.map((a) => {
              const leido = estaLeido(a, leidas);
              const fuenteClave = `notif.fuente.${a.fuente}`;
              const origen = t((fuenteClave in avisosEs ? fuenteClave : 'notif.fuente.otro') as 'notif.fuente.otro');
              return (
                <li key={a.clave} className="av-fila" data-leido={leido ? 'si' : 'no'}>
                  <i className="av-punto" aria-hidden="true" />
                  <div className="av-cuerpo">
                    <div className="av-meta">
                      <StatusChip tono={TONO[a.severidad]}>{t(`notif.sev.${a.severidad}` as 'notif.sev.info')}</StatusChip>
                      <span>{origen}</span>
                      <span>·</span>
                      <span>{leido ? t('notif.estado.leido') : t('notif.estado.noLeido')}</span>
                      <span>·</span>
                      <time dateTime={a.desde ?? generadoEn}>
                        {a.desde ? t('notif.desde', { fecha: f.fechaHoraMx(a.desde) }) : t('notif.medido', { hora: f.horaMx(generadoEn) })}
                      </time>
                    </div>
                    <span className="av-titulo">{a.titulo}</span>
                    {a.detalle ? <span className="av-detalle">{t('notif.masUrgentes', { texto: a.detalle })}</span> : null}
                    {!a.silenciable ? <span className="av-nota">{t('notif.fijo')}</span> : null}
                  </div>
                  <div className="av-acciones">
                    {a.href ? <BotonEnlace tamano="sm" variante="secondary" href={`${a.href}${sufijo ? (a.href.includes('?') ? `&${sufijo.slice(1)}` : sufijo) : ''}`}>{t('notif.accion.abrir')}</BotonEnlace> : <span className="av-nota">{t('notif.accion.sinPantalla')}</span>}
                    {a.silenciable ? (
                      <Boton tamano="sm" variante="ghost" disabled={pendiente} onClick={() => marcar([a.clave], !leido)}>
                        {leido ? t('notif.accion.marcarNoLeido') : t('notif.accion.marcarLeido')}
                      </Boton>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}
    </div>
  );
}
