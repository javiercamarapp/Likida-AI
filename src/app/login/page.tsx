import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { mensajeDeError } from '@/lib/auth/motivo_login';
import { guardarCorreoParaReenvio } from '@/lib/auth/reenvio_enlace';
import { Logo, GlifoAdorno } from '../logo';
import './login.css';

export const dynamic = 'force-dynamic';

// ── LAS DOS VOCES QUE EL SOFTWARE NO TENÍA ────────────────────────────────
//
// `layout.tsx` carga Inter, Inter Tight e IBM Plex Mono para TODA la app. Son
// las voces de un panel de trabajo y están bien ahí. La landing de likida.ai
// habla otras dos —Fraunces para los titulares, Instrument Sans para el
// cuerpo— y el login es la bisagra entre las dos pantallas: se ve después de
// la landing y antes del panel.
//
// SE CARGAN AQUÍ Y NO EN `layout.tsx` a propósito. `next/font` emite el
// `<link rel=preload>` y el `@font-face` SOLO en las rutas que importan el
// módulo, así que estas dos familias viajan únicamente en `/login`: ni el
// dashboard ni el admin ni el PDF pagan dos tipografías que no pintan.
// Ponerlas en el layout raíz habría metido ~90 KB de fuentes en cada pantalla
// del panel.
//
// Y se aplican POR VARIABLE CSS (`--font-fraunces`, `--font-instrument`), no
// cambiando `--font-sans`: la clase que las declara vive en el `<main>` de
// esta página, así que ninguna regla global de `globals.css` se mueve. Quien
// quiera ver de dónde salen los valores, `login.css` los mapea a
// `--serif-marca`/`--sans-marca` y ahí se acaba su alcance.
//
// `<link>` suelto NO: sin `next/font` la fuente se pide después de que el CSS
// se descargó y se parseó (una cascada más), no hay `size-adjust` calculado
// contra el fallback —así que al cambiar Georgia por Fraunces el titular
// SALTA— y en producción el archivo sale de fonts.gstatic.com en vez del
// propio dominio.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
});
const instrument = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});

/**
 * Sobre esto se arman el `emailRedirectTo` del magic link y el `redirectTo` de
 * Google: es el dominio donde tiene que aterrizar `/auth/callback`.
 *
 * EL SUELO DEJÓ DE SER `likida.ai` el 17-ago-2026. Ese dominio ya no sirve esta
 * app — hoy es la landing de marketing, un proyecto de HTML estático aparte —,
 * así que sin `NEXT_PUBLIC_APP_URL` el correo llegaba, el link abría, y el
 * usuario caía en un sitio que NO TIENE `/auth/callback`: sesión nunca
 * completada, cero errores en ningún log, nadie entra. El suelo tiene que ser
 * el dominio del SOFTWARE (ver CLAUDE.md: la variable debe valer esto mismo).
 */
function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai';
}

/**
 * Mismo límite por IP que traía el passcode compartido que este login
 * reemplazó (10 / 5 min; la ruta `/acceso` y `auth/passcode.ts` se borraron
 * el 5-ago-2026, ver auditoría 10 seguridad — llevaban desde que este login
 * los reemplazó sin ningún llamador real): quitar el límite al cambiar de
 * mecanismo habría sido una regresión. Aquí pesa MÁS que allá — cada intento
 * del camino de email manda un correo real por el SMTP de Supabase, que
 * tiene cuota diaria: quemarla deja el panel sin la única vía de entrada que
 * hoy funciona.
 */
async function dentroDelLimite(llave: string): Promise<boolean> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')) ?? 'desconocida';
  return await rateLimit(`${llave}:${ip}`, 10, 5 * 60_000);
}

/**
 * Correo que NO tiene cuenta, con `shouldCreateUser:false`.
 *
 * Supabase lo marca con el código `otp_disabled` (422, «Signups not allowed for
 * otp»); `signup_disabled` es el mismo caso con los registros apagados a nivel
 * proyecto. Se mira también el mensaje porque el `code` solo existe en las
 * versiones nuevas del SDK, y fallar a "error" aquí reabriría el oráculo de
 * enumeración que este manejo existe para cerrar.
 */
function esCorreoSinCuenta(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'otp_disabled' ||
    error.code === 'signup_disabled' ||
    /signups not allowed/i.test(error.message ?? '')
  );
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; enviado?: string; reenviado?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp?.next && sp.next.startsWith('/dashboard') ? sp.next : '/dashboard';

  async function entrarConGoogle(formData: FormData) {
    'use server';
    const rawNext = String(formData.get('next') ?? '/dashboard');
    const dest = rawNext.startsWith('/dashboard') ? rawNext : '/dashboard';
    if (!(await dentroDelLimite('login:google'))) {
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}` },
    });
    if (error || !data.url) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    redirect(data.url);
  }

  async function entrarConEmail(formData: FormData) {
    'use server';
    const rawNext = String(formData.get('next') ?? '/dashboard');
    const dest = rawNext.startsWith('/dashboard') ? rawNext : '/dashboard';
    // Al exceder el límite se responde el error GENÉRICO, no "vas muy rápido":
    // la diferencia le diría a quien prueba correos cuándo dejó de contar.
    if (!(await dentroDelLimite('login:email'))) {
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    // Deja dicho a quién reenviar si este enlace muere (reenvio_enlace.ts).
    // ANTES de saber si el correo tiene cuenta, a propósito: guardarlo solo
    // para los que existen reabriría el oráculo de enumeración por cookie.
    await guardarCorreoParaReenvio(email);
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}`,
        // Nadie se da de alta solo (decisión 1 del spec): las cuentas las crea
        // `provisionarUsuario`. Sin esto, Supabase por default crea el
        // `auth.users` de CUALQUIER correo que alguien teclee aquí.
        shouldCreateUser: false,
      },
    });
    // Un correo sin cuenta se responde EXACTAMENTE igual que uno con cuenta: si
    // "no existe" se viera distinto de "te mandamos el link", esta pantalla
    // sería un oráculo para enumerar qué correos son contralores reales. Solo un
    // fallo de otra naturaleza (cuota de correo, correo malformado, config rota)
    // sale como error.
    if (error) {
      if (!esCorreoSinCuenta(error)) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
      // El usuario ve "enviado"; el motivo real solo queda aquí. Sin correo en el
      // log: el código y el status bastan para distinguirlo de una cuota agotada.
      logger.warn('login.otp_sin_cuenta', { code: error.code, status: error.status });
    }
    redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1`);
  }

  // ── EL LOGIN HABLA EL IDIOMA DE LA MARCA ──────────────────────────────────
  //
  // La estructura de dos columnas con foto a la derecha se queda: funciona y no
  // hay por qué cambiarla. Lo que cambió el 17-ago-2026 es EL IDIOMA, porque
  // ese día la landing se mudó a https://likida.ai con uno nuevo y esta
  // pantalla quedó siendo la única que no lo hablaba.
  //
  // Los cinco cambios, y cada uno es una cosa que se veía mal:
  //
  //  1. TIPOGRAFÍA. El titular iba en la sans del sistema. Ahora va en
  //     Fraunces —la serif de la landing— y el cuerpo en Instrument Sans, las
  //     dos cargadas arriba con `next/font` y aplicadas por variable CSS.
  //     Los micro-rótulos van en IBM Plex Mono, que la app ya cargaba.
  //  2. LA FOTO. Era un tráiler naranja al atardecer: saturación media 0.331 y
  //     un sesgo cálido de +43 (R−B) contra una paleta de papel y tinta. La
  //     nueva es un patio de cajas secas en niebla — 0.074 de saturación,
  //     sesgo −12: neutra fría. Medido, no a ojo (ver el commit).
  //  3. EL GESTO DEL GLIFO. Los botones de la landing revelan el glifo de
  //     Likida al pasar el cursor; el botón negro de aquí no hacía nada. Está
  //     portado con los mismos números en `login.css`.
  //  4. GEOMETRÍA. Píldoras de 999px y hairlines, no `rounded-lg` — ese radio
  //     es el de los botones del PANEL, correcto allá y ajeno aquí.
  //  5. COMPOSICIÓN. El bloque estaba centrado; la landing es editorial y va
  //     alineada a la izquierda, con el kicker ordenando la jerarquía antes
  //     del titular.
  //
  // NADA de la lógica de arriba se tocó: `siteUrl()`, el `emailRedirectTo`, el
  // límite por IP, la respuesta idéntica para un correo sin cuenta (el oráculo
  // de enumeración) y `shouldCreateUser:false` siguen exactamente igual. Este
  // archivo cambió de piel, no de puerta.
  //
  // TEMA: esta pantalla es SIEMPRE clara, y no por descuido. El script de
  // `layout.tsx` que aplica el tema guardado arranca con
  // `if (location.pathname.indexOf('/dashboard') !== 0) return` — el oscuro es
  // del panel. Aquí no hay `data-theme`, así que los tokens quedan en su rama
  // clara y la pantalla se ve igual para todos. `tema-neutro` se conserva por
  // otra razón: pone `--marca` en tinta y no en el naranja #c2410c, que es lo
  // que hace que el glifo del logo salga negro — la landing no tiene naranja.
  return (
    <main
      className={`login tema-neutro ${fraunces.variable} ${instrument.variable} min-h-screen lg:grid lg:grid-cols-2`}
    >
      {/* ── COLUMNA DEL FORMULARIO ──
          UNA SOLA COLUMNA ÓPTICA. El logo, el titular, los botones y la línea
          legal cuelgan todos del MISMO borde izquierdo (`max-w-[392px]`
          centrado en la mitad), en vez de que el logo se vaya al filo de la
          pantalla y el formulario se quede a 100px de distancia. Con el logo
          pegado al margen y el bloque centrado había dos ejes verticales
          compitiendo, que es exactamente lo que hace que una pantalla se vea
          armada por partes. */}
      <section className="flex min-h-screen flex-col px-6 py-7 sm:px-10 lg:px-14 lg:py-10">
        <div className="mx-auto flex w-full max-w-[392px] flex-1 flex-col">
          <header className="login-entra flex items-center">
            <Logo alto="h-6" />
          </header>

          <div className="flex flex-1 items-center py-12">
            <div className="w-full">
              <p className="login-entra login-kicker" style={{ animationDelay: '40ms' }}>
                Acceso al panel
              </p>
              <h1
                className="login-entra login-serif mt-5 text-[38px] sm:text-[44px]"
                style={{ color: 'var(--ink)', animationDelay: '90ms' }}
              >
                Bienvenido a Likida
              </h1>
              <p
                className="login-entra mt-4 text-[15px] leading-[1.6]"
                style={{ color: 'var(--muted)', animationDelay: '140ms' }}
              >
                El panel de liquidación de tu flota.
              </p>

              {sp?.enviado ? (
                <div
                  role="status"
                  className="login-entra mt-9 rounded-[18px] p-5"
                  style={{ background: 'var(--crema)', border: '1px solid var(--line)', animationDelay: '190ms' }}
                >
                  <p className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {sp?.reenviado
                      ? 'Ese enlace ya se había usado o caducado — te mandamos uno nuevo.'
                      : 'Te mandamos un enlace a tu correo.'}
                  </p>
                  <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {sp?.reenviado
                      ? 'Abre el correo más reciente, desde este mismo dispositivo.'
                      : 'Ábrelo desde este mismo dispositivo.'}
                  </p>
                </div>
              ) : (
                <>
                  {/* El hairline que separa el encabezado de las acciones. Es la
                      línea de 1px de la landing, no un margen más: marca dónde
                      deja de leerse y empieza a hacerse algo. */}
                  <div
                    className="login-entra mt-9 h-px"
                    style={{ background: 'var(--line)', animationDelay: '180ms' }}
                  />

                  <form action={entrarConGoogle} className="login-entra mt-8" style={{ animationDelay: '220ms' }}>
                    <input type="hidden" name="next" value={next} />
                    <button type="submit" className="login-btn login-btn-borde">
                      <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
                        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
                        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                        <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                      </svg>
                      Continuar con Google
                    </button>
                  </form>

                  <div className="login-entra my-6 flex items-center gap-4" style={{ animationDelay: '250ms' }}>
                    <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
                    {/* NI mono NI versalitas para esta palabra, aunque el resto
                        de los micro-rótulos de esta pantalla sí lo sean: en IBM
                        Plex Mono la «O» mayúscula es casi idéntica al cero, y en
                        el primer render este separador se leía «0». Un caracter
                        suelto no tiene contexto que lo desambigüe. */}
                    <span className="text-[13px] lowercase" style={{ color: 'var(--faint)' }}>o</span>
                    <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
                  </div>

                  <form
                    action={entrarConEmail}
                    className="login-entra flex flex-col gap-3"
                    style={{ animationDelay: '280ms' }}
                  >
                    <input type="hidden" name="next" value={next} />
                    <label htmlFor="login-email" className="sr-only">Tu correo</label>
                    <input
                      id="login-email"
                      name="email"
                      type="email"
                      required
                      placeholder="tu@flota.com"
                      autoComplete="email"
                      className="login-campo"
                    />
                    {/* EL BOTÓN CON EL GESTO. `GlifoAdorno` pinta el glifo con
                        `mask-image`, así que toma el color que se le pase: aquí
                        `--bg` (papel), que es el color del TEXTO de esta píldora
                        —nunca `--marca`—. El envoltorio es el que anima de 0 a
                        17px de ancho; por eso el glifo va sin altura propia. */}
                    <button type="submit" className="login-btn login-btn-tinta mt-1">
                      <span aria-hidden className="login-glifo">
                        <GlifoAdorno color="var(--bg)" />
                      </span>
                      <span>Continuar con correo</span>
                    </button>
                  </form>

                  <p
                    className="login-entra mt-7 text-pretty text-[14px] leading-relaxed"
                    style={{ color: 'var(--muted)', animationDelay: '320ms' }}
                  >
                    ¿Tu correo no tiene acceso?{' '}
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                      Pídele a tu flota que te dé de alta.
                    </span>
                  </p>
                </>
              )}

              {/* `role="alert"` — antes era un <p> mudo: quien usa lector de
                  pantalla enviaba el formulario, volvía a la misma página y nada
                  le anunciaba que había fallado.
                  El TEXTO depende del motivo (`mensajeDeError`): un enlace ya
                  usado decía «intenta otra vez», que ahí es el único consejo
                  garantizado a fallar — reintentar un enlace de un solo uso. */}
              {sp?.error && (
                <p role="alert" className="mt-5 text-[14px]" style={{ color: 'var(--color-bad)' }}>
                  {mensajeDeError(sp.error)}
                </p>
              )}

              {/* Los DOS, no solo privacidad: aquí es donde se acepta el contrato,
                  y hasta hoy la única liga era la del aviso — se aceptaban unos
                  términos que no había forma de leer desde esta pantalla. */}
              <p
                className="login-entra mt-10 text-pretty text-[12px] leading-[1.7]"
                style={{ color: 'var(--faint)', animationDelay: '360ms' }}
              >
                Al continuar, aceptas los{' '}
                <a
                  href="/terminos"
                  className="underline underline-offset-2 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--ink)' }}
                >
                  Términos de Servicio
                </a>{' '}
                y el{' '}
                <a
                  href="/privacidad"
                  className="underline underline-offset-2 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--ink)' }}
                >
                  Aviso de Privacidad
                </a>{' '}
                de Likida.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── LA LÁMINA DE LA FOTO ──────────────────────────────────────────────
          `hidden lg:flex`, igual que siempre: por debajo de 1024px NO se pinta.
          Esa es la respuesta a "que en móvil la foto no aplaste el formulario"
          — en 390px no hay foto que aplastar nada, la pantalla es papel, serif
          y aire. Meter aquí una banda de imagen le habría robado alto vertical
          al único formulario que importa, en el dispositivo donde menos alto
          hay. Y como está en `display:none`, tampoco se descarga ni la lee un
          lector de pantalla en el teléfono. */}
      <aside className="hidden lg:flex lg:flex-col lg:py-10 lg:pl-6 lg:pr-10">
        <figure className="login-lamina min-h-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- fondo estático de marca, no contenido de producto: `next/image` aquí solo agrega un pase de optimización sobre un JPEG que ya se sirve al tamaño exacto */}
          <img
            src="/images/login-hero.jpg"
            alt="Fila de cajas secas estacionadas en un patio de maniobras, perdiéndose en la niebla de la mañana."
            className="login-foto"
          />
          <div className="login-velo" />
          <figcaption className="absolute inset-x-0 bottom-0 p-9">
            <p className="login-kicker" style={{ color: 'color-mix(in srgb, var(--bg) 78%, transparent)' }}>
              Liquidación de viajes
            </p>
            {/* Las dos frases son literales de lo que el producto ES (CLAUDE.md
                y la `description` del layout). Cero cifras, cero promesas: la
                regla de "un rótulo tiene que ser verdad" también aplica a un
                pie de foto en la pantalla de entrada. */}
            {/* Tamaño FLUIDO, no fijo. A 27px clavados el pie cabía en 1440 y
                en 1024 —donde la lámina mide ~460px— "El cierre del día, por
                WhatsApp." se partía en tres renglones con "WhatsApp." solo. El
                `clamp` lo baja a 20px justo en ese ancho y lo deja en dos. */}
            <p
              className="login-serif mt-3.5"
              style={{ color: 'var(--bg)', fontSize: 'clamp(20px, 1.9vw, 27px)' }}
            >
              Flotas de carga en México.
              <br />
              El cierre del día, por WhatsApp.
            </p>
          </figcaption>
        </figure>
      </aside>
    </main>
  );
}
