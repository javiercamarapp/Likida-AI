import { clienteAvisos } from '@/lib/avisos/cliente';
import { getT } from '@/lib/i18n/servidor';
import { ahoraMs } from '@/lib/saludo';
import { TabsLinea } from '../componentes';
import { resolverBandeja, type FuenteAvisos } from '@/lib/avisos/bandeja';
import { leerPreferencias, leerSilencio } from '@/lib/avisos/estado';
import { SILENCIO_POR_OMISION, type Ambito } from '@/lib/avisos/modelo';
import type { Destino } from './acciones';
import PanelAvisos from './panel-avisos';
import ConfigAvisos from './config-avisos';

/** Cuerpo (pestañas de sección + lista o configuración) de las dos pantallas de avisos (/admin/notificaciones y /dashboard/notificaciones): la lista y la configuración. */
export default async function PaginaAvisos({ destino, ambito, userId, fuente, base, params, sufijo, seccion }: {
  destino: Destino;
  ambito: Ambito;
  userId: string;
  fuente: FuenteAvisos;
  /** La ruta de la pantalla, sin query. */
  base: string;
  /** Los parámetros que viajan en los enlaces entre secciones (`tenant`, `vista`, `rol`). */
  params: Record<string, string>;
  sufijo: string;
  seccion: 'avisos' | 'configuracion';
}) {
  const { t } = await getT('avisos');
  const db = clienteAvisos();
  const qs = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ ...params, ...extra });
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  const bandeja = await resolverBandeja(db, ambito, userId, fuente);
  const pestanas = [
    { clave: 'avisos', etiqueta: t('notif.seccion.avisos'), href: qs({}), conteo: bandeja.noLeidos, atencion: bandeja.hayCritico },
    { clave: 'configuracion', etiqueta: t('notif.seccion.config'), href: qs({ seccion: 'configuracion' }) },
  ];

  let cuerpo;
  if (seccion === 'configuracion') {
    const [p, s] = await Promise.all([leerPreferencias(db, ambito, userId), leerSilencio(db, ambito, userId)]);
    cuerpo = (
      <ConfigAvisos
        destino={destino} ambito={ambito.tipo} prefs={p.ok ? p.prefs : []} silencio={s.ok ? s.silencio : SILENCIO_POR_OMISION}
        errorPrefs={!p.ok} errorSilencio={!s.ok} ahoraMs={ahoraMs()}
      />
    );
  } else {
    cuerpo = (
      <PanelAvisos
        destino={destino} ambito={ambito.tipo} avisos={bandeja.avisos} leidas={[...bandeja.leidas]} generadoEn={bandeja.generadoEn}
        sufijo={sufijo} errorLeidas={bandeja.errorLeidas !== null} errorPrefs={bandeja.errorPrefs !== null}
      />
    );
  }
  return (
    <>
      <TabsLinea etiqueta={t('notif.seccion.etiqueta')} pestanas={pestanas} actual={seccion === 'configuracion' ? 'configuracion' : 'avisos'} />
      {cuerpo}
    </>
  );
}
