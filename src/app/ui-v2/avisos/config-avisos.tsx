'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso as Franja, Boton, Campo, Casilla, StatusChip, Switch, TablaBase, Tarjeta, type ColumnaBase } from '../componentes';
import { useT } from '@/lib/i18n/proveedor';
import { avisos as avisosEs } from '@/lib/i18n/es/avisos';
import { CANALES, CATEGORIAS, enSilencio, estaActivo, validarSilencio, type Canal, type Categoria, type Preferencia, type Silencio } from '@/lib/avisos/modelo';
import { guardarPreferenciaAviso, guardarSilencioAviso, type Destino } from './acciones';
import './avisos.css';

/** El envío por correo y WhatsApp aún no tiene un despachador que lea esta lista: se dice «pendiente», no se finge «disponible». */
const DISPONIBLE: Record<Canal, boolean> = { app: true, correo: false, whatsapp: false };

/**
 * La configuración de avisos (clon de `settings/notifications` de Rovaq): qué tipos de aviso recibir por cada canal y el horario de silencio.
 * Es por persona y ámbito (mig. 1002). Lo que no se pudo leer se dice: la pantalla no presenta el valor por omisión como si fuera lo guardado.
 */
export default function ConfigAvisos({ destino, ambito, prefs: prefsIniciales, silencio: silencioInicial, errorPrefs, errorSilencio, ahoraMs }: {
  destino: Destino;
  ambito: 'admin' | 'flota';
  prefs: Preferencia[];
  silencio: Silencio;
  errorPrefs: boolean;
  errorSilencio: boolean;
  ahoraMs: number;
}) {
  const { t } = useT('avisos', avisosEs);
  const router = useRouter();
  const [ocupado, empezar] = useTransition();
  const [prefs, setPrefs] = useState<Preferencia[]>(prefsIniciales);
  const [silencio, setSilencio] = useState<Silencio>(silencioInicial);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);

  const cambiar = (categoria: Categoria, canal: Canal, activo: boolean) => {
    const antes = prefs;
    setPrefs((p) => [...p.filter((x) => !(x.categoria === categoria && x.canal === canal)), { categoria, canal, activo }]);
    setAviso(null);
    empezar(async () => {
      const r = await guardarPreferenciaAviso(destino, categoria, canal, activo).catch(() => ({ ok: false as const, error: 'red' }));
      if (!r.ok) { setPrefs(antes); setAviso({ tono: 'error', texto: t('notif.err.accion') }); return; }
      setAviso({ tono: 'ok', texto: t('notif.cfg.guardado') });
      router.refresh();
    });
  };

  const guardarHorario = () => {
    setAviso(null);
    if (!validarSilencio(silencio)) { setAviso({ tono: 'error', texto: t('notif.err.horario') }); return; }
    empezar(async () => {
      const r = await guardarSilencioAviso(destino, silencio).catch(() => ({ ok: false as const, error: 'red' }));
      setAviso(r.ok ? { tono: 'ok', texto: t('notif.cfg.silencio.guardado') } : { tono: 'error', texto: t('notif.err.accion') });
    });
  };

  const columnas: ColumnaBase<Categoria>[] = [
    { id: 'tipo', titulo: t('notif.cfg.tipo'), principal: true, celda: (cat) => t(`notif.cat.${cat}` as 'notif.cat.sistema') },
    ...CANALES.map((c): ColumnaBase<Categoria> => ({
      id: c, titulo: t(`notif.cfg.canal.${c}` as 'notif.cfg.canal.app'),
      celda: (cat) => (
        <Casilla
          etiqueta={<span className="sr-only">{t('notif.cfg.activar', { tipo: t(`notif.cat.${cat}` as 'notif.cat.sistema'), canal: t(`notif.cfg.canal.${c}` as 'notif.cfg.canal.app') })}</span>}
          checked={estaActivo(prefs, cat, c)} disabled={ocupado} onChange={(e) => cambiar(cat, c, e.target.checked)}
        />
      ),
    })),
  ];

  return (
    <div className="av-pila">
      {errorPrefs ? <Franja tono="warn">{t('notif.cfg.err.prefs')}</Franja> : null}
      {errorSilencio ? <Franja tono="warn">{t('notif.cfg.err.silencio')}</Franja> : null}
      {aviso ? <Franja tono={aviso.tono === 'ok' ? 'ok' : 'error'}>{aviso.texto}</Franja> : null}

      <div className="av-canales">
        {CANALES.map((c) => (
          <Tarjeta key={c} titulo={t(`notif.cfg.canal.${c}` as 'notif.cfg.canal.app')} acciones={
            <StatusChip tono={DISPONIBLE[c] ? 'ok' : 'muted'}>{DISPONIBLE[c] ? t('notif.cfg.estado.disponible') : t('notif.cfg.estado.pendiente')}</StatusChip>
          }>
            <p className="av-nota">{t(`notif.cfg.nota.${c}` as 'notif.cfg.nota.app')}</p>
          </Tarjeta>
        ))}
      </div>

      <Tarjeta titulo={t('notif.cfg.titulo')}>
        <p className="av-nota">{t('notif.cfg.apoyo')}</p>
        <TablaBase etiqueta={t('notif.cfg.titulo')} columnas={columnas} filas={CATEGORIAS[ambito]} idFila={(cat) => cat} altoMaximo={false} />
      </Tarjeta>

      <Tarjeta titulo={t('notif.cfg.silencio.titulo')}>
        <div className="av-silencio">
          <p className="av-nota">{t('notif.cfg.silencio.apoyo')}</p>
          <Switch nombre="av-silencio-activo" etiqueta={t('notif.cfg.silencio.activar')} checked={silencio.activo} onChange={(e) => setSilencio((s) => ({ ...s, activo: e.target.checked }))} />
          <div className="av-horas">
            <Campo etiqueta={t('notif.cfg.silencio.desde')}><input type="time" className="rv-ctl" value={silencio.desde} onChange={(e) => setSilencio((s) => ({ ...s, desde: e.target.value }))} /></Campo>
            <Campo etiqueta={t('notif.cfg.silencio.hasta')}><input type="time" className="rv-ctl" value={silencio.hasta} onChange={(e) => setSilencio((s) => ({ ...s, hasta: e.target.value }))} /></Campo>
          </div>
          <Switch nombre="av-silencio-criticos" etiqueta={t('notif.cfg.silencio.criticos')} checked={silencio.permiteCriticos} onChange={(e) => setSilencio((s) => ({ ...s, permiteCriticos: e.target.checked }))} />
          {silencio.activo && validarSilencio(silencio)
            ? <p className="av-nota" role="status">{enSilencio(silencio, ahoraMs) ? t('notif.cfg.silencio.dentro') : t('notif.cfg.silencio.fuera')}</p>
            : null}
          <div><Boton disabled={ocupado} onClick={guardarHorario}>{t('notif.cfg.silencio.guardar')}</Boton></div>
        </div>
      </Tarjeta>
    </div>
  );
}
