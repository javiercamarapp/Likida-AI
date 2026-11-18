import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { envPuesta } from '@/lib/env';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { Boton } from '../ui-v2/componentes/boton';
import '../legal/publico-r2.css';
import '../legal/flujo-publico.css';
import { getT } from '@/lib/i18n/servidor';

export const metadata = { title: 'Sin acceso — Likida' };

// El 403 de la casa sobre el marco público único (L9a): la CAUSA dicha en claro (la cuenta no está vinculada a una flota, o se
// entró con otro correo) y la SALIDA a la vista (cerrar sesión e ingresar con otra cuenta, o escribir a ayuda).
//
// W2 (auditoría de producto): el comentario de este archivo decía «llegar aquí es
// un callejón» y lo era — sin cerrar sesión, sin contacto y sin enlace de regreso
// (un usuario que entró con la cuenta equivocada no tenía salida desde aquí). Ahora
// puede cerrar sesión e ingresar con otra cuenta (el mismo `signOut` de `/cuenta`)
// y, si Likida configuró un correo de ayuda, escribirle.
async function cerrarSesion() {
  'use server';
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}

export default async function SinAcceso() {
  const { t } = await getT('ui_comun');
  // Un correo de ayuda REAL o ninguno: no se inventa una dirección. Es público
  // (se pinta en el HTML), así que va en una variable `NEXT_PUBLIC_*`.
  const correoAyuda = envPuesta('NEXT_PUBLIC_SOPORTE_EMAIL') ? String(process.env.NEXT_PUBLIC_SOPORTE_EMAIL).trim() : null;
  return (
    <MarcoPublico
      rotulo={t('sa.rotulo')}
      titulo={t('sa.titulo')}
      ancho="estrecho"
      apoyo={t('sa.apoyo')}
      acciones={
        <>
          <form action={cerrarSesion}>
            <Boton type="submit" variante="primary">{t('sa.cerrar')}</Boton>
          </form>
          {correoAyuda && (
            <a
              href={`mailto:${correoAyuda}?subject=${encodeURIComponent(t('sa.asunto'))}`}
              className="rv-pub__enlace"
            >
              {t('sa.escribir', { correo: correoAyuda })}
            </a>
          )}
        </>
      }
    >
      <div className="rv-flujo" aria-hidden="true" />
      <div className="rv-pub__prosa rv-pub__sec">
        <h2>{t('sa.h2')}</h2>
        <p>{t('sa.p')}</p>
      </div>
    </MarcoPublico>
  );
}
