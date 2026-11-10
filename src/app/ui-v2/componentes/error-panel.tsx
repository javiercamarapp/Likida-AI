'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/proveedor';
import { errores as erroresEs } from '@/lib/i18n/es/errores';
import { esErrorFlotaCambio } from '@/lib/auth/flota_cambio';
import { Boton, BotonEnlace } from './boton';
import { MarcoPagina } from './marco-pagina';
import { useRecuperacionChunk } from './recuperar-chunk';

/** Qué segmento falló: decide el título, la línea de apoyo y a dónde lleva «volver». */
export type VarianteError = 'panel' | 'admin' | 'agente';

const SALIDA: Record<VarianteError, { href: string; clave: 'accion.inicio' | 'accion.resumen' }> = {
  panel: { href: '/', clave: 'accion.inicio' },
  admin: { href: '/admin', clave: 'accion.resumen' },
  agente: { href: '/', clave: 'accion.inicio' },
};

/**
 * LA PANTALLA DE ERROR ÚNICA de los segmentos (`dashboard/error.tsx`, `admin/error.tsx`, `dashboard/agentes/error.tsx` y los
 * re-exports de `admin/*`). Se pinta DENTRO del chrome del panel con el marco de siempre (`MarcoPagina`: un solo h1) y habla igual que
 * Rovaq: qué pasó, UNA acción (Reintentar), la salida y el código del incidente seleccionable.
 *
 * Lo que NO hace: nunca pinta `error.message` ni la pila (en producción Next ya los borra, pero en desarrollo y en errores de
 * cliente sí vienen y pueden traer datos de la pantalla). Lo único que sale del error es el `digest`, que es el puente con la línea
 * del log del servidor. Esa línea se registra aquí (solo digest y nombre del error) con el nombre de evento que pasa el segmento.
 *
 * Casos: (1) la flota cambió bajo la pantalla (MX-002) → «recarga», no «reintentar», porque reintentar repetiría la flota vieja;
 * (2) código viejo tras un despliegue (ChunkLoadError) → recarga sola una vez y, si no, ofrece «Recargar»; (3) cualquier otro fallo.
 */
export function ErrorPanel({ error, reset, variante, evento }: {
  error: Error & { digest?: string };
  reset: () => void;
  variante: VarianteError;
  /** Nombre del evento de log del segmento (`panel.boundary`, `admin.boundary`…). */
  evento: string;
}) {
  const { t } = useT('errores', erroresEs);
  const { chunk, recargando, reintentar } = useRecuperacionChunk(error, reset);

  useEffect(() => {
    // Import perezoso: el logger es de servidor y esto es cliente. En el navegador queda en la consola de quien reproduce el fallo.
    void import('@/lib/logger').then(({ logger }) => logger.error(evento, { digest: error.digest ?? 'sin-digest', err: error.name }));
  }, [error, evento]);

  const salida = SALIDA[variante];

  if (esErrorFlotaCambio(error)) {
    return (
      <MarcoPagina titulo={t('flota.titulo')} idTitulo="error-titulo" ancho="lectura">
        <div className="rv-errpanel" role="alert">
          <p className="rv-errpanel__texto">{t('flota.cuerpo')}</p>
          <div className="rv-errpanel__acciones">
            <Boton variante="primary" onClick={() => window.location.reload()}>{t('accion.recargar')}</Boton>
          </div>
        </div>
      </MarcoPagina>
    );
  }

  if (recargando) {
    return (
      <MarcoPagina titulo={t('recargando.titulo')} idTitulo="error-titulo" ancho="lectura" apoyo={t('recargando.apoyo')}>
        <div role="status" aria-live="polite" />
      </MarcoPagina>
    );
  }

  return (
    <MarcoPagina
      titulo={chunk ? t('chunk.titulo') : t(`${variante}.titulo`)}
      idTitulo="error-titulo"
      ancho="lectura"
      apoyo={chunk ? t('chunk.apoyo') : t(`${variante}.apoyo`)}
    >
      <div className="rv-errpanel" role="alert">
        <div className="rv-errpanel__acciones">
          <Boton variante="primary" onClick={reintentar}>{chunk ? t('accion.recargar') : t('accion.reintentar')}</Boton>
          <BotonEnlace href={salida.href}>{t(salida.clave)}</BotonEnlace>
        </div>
        {error.digest ? (
          <p className="rv-errpanel__codigo">{t('codigo.rotulo')}: <span className="tabular">{error.digest}</span></p>
        ) : null}
      </div>
    </MarcoPagina>
  );
}
