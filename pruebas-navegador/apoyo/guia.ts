import { execFileSync } from 'node:child_process';

/**
 * El avance de la guía vive en el SERVIDOR (tabla `onboarding_estado`, 0983): ya no basta con abrir un contexto limpio de navegador para
 * ser «primer ingreso». Las pruebas que ejercen la invitación y el recorrido borran, antes de entrar, la fila de la persona que van a usar.
 * Solo toca el Supabase LOCAL del workflow (127.0.0.1:54322); el correo va como variable de psql, nunca pegado en el SQL.
 */
const CONEXION = {
  host: process.env.E2E_DB_HOST ?? '127.0.0.1',
  puerto: process.env.E2E_DB_PORT ?? '54322',
  usuario: process.env.E2E_DB_USER ?? 'postgres',
  base: process.env.E2E_DB_NAME ?? 'postgres',
  clave: process.env.E2E_DB_PASSWORD ?? 'postgres',
};

export function reiniciarGuiaDe(correo: string): void {
  execFileSync(
    'psql',
    ['-h', CONEXION.host, '-p', CONEXION.puerto, '-U', CONEXION.usuario, '-d', CONEXION.base, '-v', 'ON_ERROR_STOP=1', '-v', `correo=${correo}`, '-q', '-f', '-'],
    {
      env: { ...process.env, PGPASSWORD: CONEXION.clave },
      input: "delete from public.onboarding_estado where user_id in (select id from public.app_user where email = :'correo');\n",
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
}
