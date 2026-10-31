import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { envPuesta } from '@/lib/env';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { Boton } from '../ui-v2/componentes/boton';

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

export default function SinAcceso() {
  // Un correo de ayuda REAL o ninguno: no se inventa una dirección. Es público
  // (se pinta en el HTML), así que va en una variable `NEXT_PUBLIC_*`.
  const correoAyuda = envPuesta('NEXT_PUBLIC_SOPORTE_EMAIL') ? String(process.env.NEXT_PUBLIC_SOPORTE_EMAIL).trim() : null;
  return (
    <MarcoPublico
      rotulo="Error 403"
      titulo="Tu cuenta aún no tiene flota"
      ancho="estrecho"
      centrado
      apoyo="Iniciaste sesión, pero esta cuenta no está vinculada a ninguna flota en Likida."
      acciones={
        <>
          <form action={cerrarSesion}>
            <Boton type="submit" variante="primary">Cerrar sesión e ingresar con otra cuenta</Boton>
          </form>
          {correoAyuda && (
            <a
              href={`mailto:${correoAyuda}?subject=${encodeURIComponent('Mi cuenta no está vinculada a una flota')}`}
              className="rv-pub__enlace"
            >
              Escribir a ayuda: {correoAyuda}
            </a>
          )}
        </>
      }
    >
      <div className="rv-pub__prosa rv-pub__sec">
        <h2>Qué puede haber pasado</h2>
        <p>
          Entraste con un correo que todavía no está dado de alta en una flota (por ejemplo, otra cuenta de Google que la
          que te invitaron). Pídele a tu administrador que te dé de alta desde su panel, o cierra sesión y entra con el
          correo con el que te invitaron.
        </p>
      </div>
    </MarcoPublico>
  );
}
