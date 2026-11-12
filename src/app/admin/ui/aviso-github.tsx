import { AvisoCompacto } from '../../ui-v2/componentes/aviso';

/**
 * Aviso COMPACTO y accionable cuando GitHub no se puede leer desde /admin (Dev y Actividad de código). Es una falta de configuración, no
 * algo que el código pueda corregir: la variable es `GITHUB_TOKEN` (y, opcional, `GITHUB_REPO`; por omisión `javiercamarapp/likida.ai`),
 * que se define en Vercel → Settings → Environment Variables (entorno Production) y exige un redeploy para surtir efecto.
 * `sin_token`: la variable no existe. `error`: existe pero GitHub la rechazó o no contestó (un 401 = token vencido o sin permiso de lectura).
 * Sin funciones como props: se pinta desde componentes de servidor.
 */
export function AvisoGitHub({ causa }: { causa: 'sin_token' | 'error' }) {
  // Lo visible NO nombra variables de entorno ni paneles de despliegue (Rovaq nunca los muestra): el nombre de la variable y dónde
  // se define quedan en el comentario de arriba, para quien arregle la configuración.
  return (
    <AvisoCompacto
      tono="warn"
      resumen={causa === 'sin_token'
        ? <>Falta configurar el acceso a GitHub: pídele al equipo técnico que conecte la lectura del repositorio.</>
        : <>GitHub no dejó leer el repositorio: el acceso configurado puede haber vencido o no tener permiso de lectura.</>}
      mas={(
        <>
          <p>Es una configuración del servidor, no algo que se corrija desde esta pantalla; el acceso debe ser de solo lectura sobre el repositorio y se estrena con un nuevo despliegue.</p>
          {causa === 'error' && <p>Si GitHub rechazó el acceso (vencido o revocado), hay que generar uno nuevo y sustituirlo.</p>}
          <p>Mientras tanto estas secciones no afirman nada: no es que no haya commits, es que no se pudieron leer.</p>
        </>
      )}
    />
  );
}
