import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { envPuesta } from '@/lib/env';
import { Logo } from '../logo';

// El 403 de la casa, en el MISMO lenguaje que el 404 (orden del 17-ago:
// nada del estilo anterior — logo, display grande y elegante, mucho aire).
// Sin botón de color: llegar aquí es un callejón, no una acción del
// producto, y el acento de la marca se reserva para lo que sí importa.
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
    <main
      className="min-h-screen flex flex-col justify-between px-8 py-8 md:px-14 md:py-12"
      style={{ background: 'var(--bg)' }}
    >
      <Logo alto="h-6" className="self-start" />

      <div className="max-w-3xl">
        <p
          className="text-xs font-medium uppercase"
          style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}
        >
          Error 403
        </p>

        <h1
          className="mt-5 font-medium"
          style={{
            fontFamily: 'var(--font-display), system-ui, sans-serif',
            fontSize: 'clamp(38px, 7vw, 82px)',
            lineHeight: 0.98,
            letterSpacing: '-0.042em',
            textWrap: 'balance',
          }}
        >
          Tu cuenta aún no tiene flota
        </h1>

        <p
          className="mt-6 max-w-lg"
          style={{ color: 'var(--muted)', fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.55 }}
        >
          Iniciaste sesión, pero esta cuenta no está vinculada a ninguna flota en Likida.
          Pídele a tu administrador que te dé de alta desde su panel.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <form action={cerrarSesion}>
            <button type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ border: '1px solid var(--line)', color: 'var(--ink)', outlineColor: 'var(--marca)' }}>
              Cerrar sesión e ingresar con otra cuenta
            </button>
          </form>
          {correoAyuda && (
            <a href={`mailto:${correoAyuda}?subject=${encodeURIComponent('Mi cuenta no está vinculada a una flota')}`}
              className="text-sm underline underline-offset-4" style={{ color: 'var(--muted)' }}>
              Escribir a ayuda: {correoAyuda}
            </a>
          )}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint, var(--muted))' }}>
        Likida · Liquidación de viajes por WhatsApp
      </p>
    </main>
  );
}
