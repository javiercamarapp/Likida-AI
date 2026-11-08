import { AvisoCompacto } from '../../ui-v2/componentes/aviso';

/**
 * Aviso COMPACTO y accionable cuando GitHub no se puede leer desde /admin (Dev y Actividad de código). Es una falta de configuración, no
 * algo que el código pueda corregir: la variable es `GITHUB_TOKEN` (y, opcional, `GITHUB_REPO`; por omisión `javiercamarapp/likida.ai`),
 * que se define en Vercel → Settings → Environment Variables (entorno Production) y exige un redeploy para surtir efecto.
 * `sin_token`: la variable no existe. `error`: existe pero GitHub la rechazó o no contestó (un 401 = token vencido o sin permiso de lectura).
 * Sin funciones como props: se pinta desde componentes de servidor.
 */
export function AvisoGitHub({ causa }: { causa: 'sin_token' | 'error' }) {
  return (
    <AvisoCompacto
      tono="warn"
      resumen={causa === 'sin_token'
        ? <>Falta configurar el acceso a GitHub: define la variable <code>GITHUB_TOKEN</code> en Vercel (Production).</>
        : <>GitHub no dejó leer el repo: revisa que <code>GITHUB_TOKEN</code> en Vercel siga vigente y tenga lectura del repositorio.</>}
      mas={(
        <>
          <p>Va en Vercel → Settings → Environment Variables → Production, y se necesita un nuevo despliegue para que la tome. El repo es privado, así que el token
            debe ser de solo lectura sobre <code>javiercamarapp/likida.ai</code> (otro repo: variable <code>GITHUB_REPO</code>).</p>
          {causa === 'error' && <p>Un error 401 significa que el token existe pero venció, fue revocado o no tiene ese permiso: genera uno nuevo y sustitúyelo.</p>}
          <p>Mientras tanto estas secciones no afirman nada: no es que no haya commits, es que no se pudieron leer.</p>
        </>
      )}
    />
  );
}
