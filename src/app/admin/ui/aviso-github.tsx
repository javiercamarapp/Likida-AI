import { AvisoCompacto } from '../../ui-v2/componentes/aviso';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminInicioEs } from '@/lib/i18n/tr_admin';

/**
 * Aviso COMPACTO y accionable cuando GitHub no se puede leer desde /admin (Dev y Actividad de código). Es una falta de configuración, no
 * algo que el código pueda corregir: la variable es `GITHUB_TOKEN` (y, opcional, `GITHUB_REPO`; por omisión `javiercamarapp/likida.ai`),
 * que se define en Vercel → Settings → Environment Variables (entorno Production) y exige un redeploy para surtir efecto.
 * `sin_token`: la variable no existe. `error`: existe pero GitHub la rechazó o no contestó (un 401 = token vencido o sin permiso de lectura).
 * Sin funciones como props: se pinta desde componentes de servidor.
 */
export function AvisoGitHub({ causa, t = trAdminInicioEs }: { causa: 'sin_token' | 'error'; t?: TrDe<'admin_inicio'> }) {
  // Lo visible NO nombra variables de entorno ni paneles de despliegue (Rovaq nunca los muestra): el nombre de la variable y dónde
  // se define quedan en el comentario de arriba, para quien arregle la configuración.
  return (
    <AvisoCompacto
      tono="warn"
      resumen={causa === 'sin_token'
        ? <>{t('raiz7.github_sin_token')}</>
        : <>{t('raiz7.github_error')}</>}
      mas={(
        <>
          <p>{t('raiz7.github_mas_config')}</p>
          {causa === 'error' && <p>{t('raiz7.github_mas_rechazo')}</p>}
          <p>{t('raiz7.github_mas_mientras')}</p>
        </>
      )}
    />
  );
}
