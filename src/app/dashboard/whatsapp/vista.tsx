import Link from 'next/link';
import { numero } from '@/lib/formato';
import { AccionesEnlace } from './acciones';
import type { NumeroWhatsApp } from '@/lib/likida/arranque_whatsapp';
import { EsqueletoConfiguracion, type SeccionConfig } from '@/app/ui-v2/esqueletos';
import { Aviso, EstadoError, MarcaIntegracion } from '@/app/ui-v2/componentes';
import './whatsapp.css';
import type { operacion as operacionEs } from '@/lib/i18n/es/operacion';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

export interface DatosArranque {
  numero: NumeroWhatsApp;
  nombreFlota: string;
  /** El enlace wa.me con texto prellenado; null si no hay número que enlazar. */
  enlace: string | null;
  /** El SVG del QR (ya armado en el servidor); null si no hay enlace o no cupo. */
  qrSvg: string | null;
  /** Cuántos operadores activos hay y cuántos esperan invitación; null = no se pudo contar. */
  operadores: { activos: number; pendientesDeInvitar: number } | null;
  /** CT-A345-19: el perfil de la flota. Con `cinco_agentes` la guía NO describe el flujo clásico (fotos de tickets, «LISTO», liquidación por el chat). */
  perfil?: 'cinco_agentes' | null;
}

/** Cada paso es una pareja de claves del diccionario (título, detalle): el módulo no puede traducir, la vista sí. */
type ClaveOp = keyof typeof operacionEs;
type Paso = readonly [ClaveOp, ClaveOp];
const PASOS_CHOFER = [
  ['wa.paso.alta.t', 'wa.paso.alta.d'],
  ['wa.paso.guarda.t', 'wa.paso.guarda.d'],
  ['wa.paso.privacidad.t', 'wa.paso.privacidad.d'],
  ['wa.paso.tickets.t', 'wa.paso.tickets.d'],
  ['wa.paso.listo.t', 'wa.paso.listo.d'],
] as const satisfies ReadonlyArray<Paso>;

/**
 * CT-A345-19: bajo el perfil `cinco_agentes` el chat del chofer NO recibe fotos de tickets para liquidar ni entrega la
 * liquidación por «LISTO»: esas promesas son del flujo clásico y aquí serían falsas. Se dice qué sí hace el chat.
 */
export const PASOS_CHOFER_CINCO_AGENTES: ReadonlyArray<Paso> = [
  PASOS_CHOFER[0], PASOS_CHOFER[1], PASOS_CHOFER[2],
  ['wa.paso.avisos.t', 'wa.paso.avisos.d'],
  ['wa.paso.nolisto.t', 'wa.paso.nolisto.d'],
];

/**
 * LA GUÍA DE ARRANQUE DEL CHOFER (W2 «producto»). Responde la pregunta que ninguna
 * pantalla contestaba —«¿a qué número le escribe mi chofer?»— y le da al dueño
 * tres formas de repartirlo: el enlace, el QR y un cartel para imprimir.
 */
export function VistaArranqueWhatsApp({ tr = TR_OPERACION_ES, datos, hrefOperadores, hrefAyuda }: { tr?: TrOperacion;
  datos: DatosArranque;
  hrefOperadores: string;
  hrefAyuda: string;
}) {
  const { t } = tr;
  const n = datos.numero;
  const secciones: SeccionConfig[] = [];
  if (n.estado === 'configurado' && datos.enlace) {
    secciones.push({
      id: 'cartel', titulo: t('wa.cartel.titulo'),
      // El cartel imprimible es el ÚNICO bloque que sale al imprimir (whatsapp.css).
      contenido: (
        <div id="cartel-whatsapp">
          {/* A36-R15-06: la leyenda va DENTRO del cartel; el CSS de impresión oculta todo lo de fuera, y un cartel de prueba sin marca se pegaba en los patios. */}
          {n.esPrueba && <p className="rv-wa__prueba">{t('wa.cartel.prueba')}</p>}
          <div className="rv-wa__cartel">
            {datos.qrSvg && (
              // El SVG lo arma `lib/qr.ts` en el servidor desde un texto que SALE de nuestra configuración (número + nombre de la
              // flota, ya codificados): no es HTML de un usuario.
              <div className="rv-wa__qr" dangerouslySetInnerHTML={{ __html: datos.qrSvg }} />
            )}
            <div className="rv-wa__texto">
              <p className="rv-wa__numero"><MarcaIntegracion id="whatsapp" /> {n.visible}</p>
              <p className="rv-wa__nota">
                {t('wa.cartel.escanea.pre')} {datos.nombreFlota}{t('wa.cartel.escanea.post')}
              </p>
              <p className="rv-wa__enlace-largo">
                <a href={datos.enlace} className="rv-wa__enlace" rel="noopener noreferrer">{datos.enlace}</a>
              </p>
            </div>
          </div>
          <div className="rv-wa__acciones"><AccionesEnlace enlace={datos.enlace} esPrueba={n.esPrueba} /></div>
        </div>
      ),
    });
  }
  secciones.push({
    id: 'flujo', titulo: t('wa.flujo.titulo'),
    contenido: (
      <ol className="rv-wa__pasos">
        {((datos.perfil === 'cinco_agentes' ? PASOS_CHOFER_CINCO_AGENTES : PASOS_CHOFER) as ReadonlyArray<Paso>).map(([titulo, detalle]) => (
          <li key={titulo}>
            <p className="rv-wa__paso">{t(titulo)}</p>
            <p className="rv-wa__nota">{t(detalle)}</p>
          </li>
        ))}
      </ol>
    ),
  }, {
    id: 'avance', titulo: t('wa.avance.titulo'),
    contenido: datos.operadores === null ? (
      <p className="rv-wa__nota">{t('wa.avance.nocuenta')}</p>
    ) : datos.operadores.activos === 0 ? (
      <p className="rv-wa__nota">
        {t('wa.avance.ninguno')} <Link href={hrefOperadores} className="rv-wa__enlace">{t('wa.avance.alta')}</Link>{t('wa.avance.alta.post')}
      </p>
    ) : (
      <p className="rv-wa__nota">
        {t('wa.avance.tienes')} <strong>{numero(datos.operadores.activos)}</strong> {t('wa.avance.activos')}
        {datos.operadores.pendientesDeInvitar > 0
          ? <> {t('comun.y')} <strong>{numero(datos.operadores.pendientesDeInvitar)}</strong> {t('wa.avance.pendientes')} <Link href={hrefOperadores} className="rv-wa__enlace">{t('wa.avance.invita')}</Link>{t('wa.avance.invita.post')}</>
          : t('wa.avance.todos')}
      </p>
    ),
  });
  return (
    <EsqueletoConfiguracion
      titulo={t('wa.titulo')}
      apoyo={t('wa.apoyo')}
      avisos={(
        <>
          {n.estado === 'sin_configurar' && (
            <div role="alert">
              <Aviso tono="warn" titulo={t('wa.sinconfig.titulo')}>
                {t('wa.sinconfig.pre')} <Link href={hrefAyuda} className="rv-wa__enlace">{t('wa.sinconfig.ayuda')}</Link>{t('wa.sinconfig.post')}
              </Aviso>
            </div>
          )}
          {n.estado === 'invalido' && (
            <EstadoError>{t('wa.invalido', { motivo: n.motivo })}</EstadoError>
          )}
          {n.estado === 'configurado' && n.esPrueba && (
            <Aviso tono="warn">
              {t('wa.prueba.aviso')}
            </Aviso>
          )}
        </>
      )}
      secciones={secciones}
    />
  );
}
