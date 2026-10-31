import type { ReactNode } from 'react';
import { Logo, GlifoAdorno } from '../logo';
import { LoginArtwork } from '@/components/login/artwork';
import { BotonEnvio } from './boton-envio';
import { mensajeDeError } from '@/lib/auth/motivo_login';

/**
 * Presentación de /login, idéntica en composición a la entrada de Vexa AI: columna de formulario (máx. 530 px)
 * a la derecha y panel oscuro con arte a la izquierda desde 1024 px; kicker mono, titular serif, divisor, Google,
 * separador, correo con estado reservado, ayuda plegable, línea de alta y nota al pie.
 *
 * Es solo marcado: la lógica de autenticación (límites por IP y por cuenta, `shouldCreateUser:false`, respuesta
 * idéntica en texto y en tiempo, destinos permitidos) vive en `page.tsx` y llega aquí como las dos server actions.
 * Separarla permite renderizar todos los estados en el arnés de capturas.
 */
export type PropsVistaLogin = {
  next: string;
  enviado: boolean;
  reenviado: boolean;
  error?: string;
  entrarConGoogle: (formData: FormData) => void | Promise<void>;
  entrarConEmail: (formData: FormData) => void | Promise<void>;
  /** Clase de las variables de fuente (next/font) que el `page` carga solo para esta ruta. */
  claseFuentes?: string;
};

function IconoGoogle(): ReactNode {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function VistaLogin({ next, enviado, reenviado, error, entrarConGoogle, entrarConEmail, claseFuentes = '' }: PropsVistaLogin) {
  return (
    <main className={`login login-editorial tema-neutro ${claseFuentes}`}>
      <section className="login-column">
        <div className="login-inner">
          <header className="auth-brand">
            <Logo alto="h-7" />
          </header>

          <div className="login-copy">
            <p className="login-kicker login-entra">Acceso al panel</p>
            <h1 className="login-serif login-entra">Bienvenido a Likida</h1>
            <p className="login-intro login-entra">El panel de liquidación de tu flota.</p>
            <div className="login-divider" />

            {/* `role="alert"` y texto por motivo (`mensajeDeError`): un enlace usado o caducado no dice «intenta
                otra vez». Habla del estado del ENLACE, nunca de la cuenta (sin oráculo de enumeración). */}
            {error && (
              <p className="login-message" role="alert">
                {mensajeDeError(error)}
              </p>
            )}

            <form action={entrarConGoogle} className="login-google login-entra">
              <input type="hidden" name="next" value={next} />
              <BotonEnvio className="login-btn login-btn-borde" reposo="Continuar con Google" enVuelo="Abriendo Google…" icono={<IconoGoogle />} />
            </form>

            <div className="login-separator">
              <span />
              <p>o</p>
              <span />
            </div>

            <form action={entrarConEmail} className="login-email login-entra" aria-label="Acceder por correo">
              <input type="hidden" name="next" value={next} />
              <label className="sr-only" htmlFor="login-email">
                Tu correo
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                maxLength={254}
                placeholder="tu@flota.com"
                autoComplete="email"
                className="login-campo"
              />
              <BotonEnvio
                className="login-btn login-btn-tinta"
                reposo="Continuar con correo"
                enVuelo="Solicitando…"
                icono={
                  <span aria-hidden className="login-glifo">
                    <GlifoAdorno color="#ffffff" />
                  </span>
                }
              />
              {/* Región de estado con altura reservada: no salta el diseño. El aviso de «enviado» va DEBAJO del
                  botón y no lo reemplaza: con un dedazo en el correo la pantalla ofrece volver a escribirlo. */}
              <div className="login-message login-email-status" role="status">
                {enviado && (
                  <>
                    <p className="login-estado-titulo">
                      {reenviado
                        ? 'Ese enlace ya se había usado o caducado — te mandamos uno nuevo.'
                        : 'Te mandamos un enlace a tu correo.'}
                    </p>
                    <p>
                      {reenviado
                        ? 'Abre el correo más reciente, desde este mismo dispositivo.'
                        : 'Ábrelo desde este mismo dispositivo.'}
                    </p>
                    <p className="login-estado-nota">¿No llega o te equivocaste de correo? Vuelve a escribirlo arriba.</p>
                  </>
                )}
              </div>
            </form>

            <details className="login-access-help">
              <summary>¿Necesitas ayuda para entrar?</summary>
              <p>
                No necesitas contraseña. Usa el correo con el que tu flota te dio de alta y abre el enlace seguro que
                recibas. Revisa también la carpeta de correo no deseado.
              </p>
            </details>
            <p className="login-help">
              ¿Tu correo no tiene acceso? <strong>Pídele a tu flota que te dé de alta.</strong>
            </p>
            <p className="login-footnote">
              Acceso reservado a equipos autorizados. Inicia sesión sin contraseña con Google o un enlace seguro en tu
              correo. Al continuar, aceptas los <a href="/terminos">Términos de Servicio</a> y el{' '}
              <a href="/privacidad">Aviso de Privacidad</a> de Likida.
            </p>
          </div>
        </div>
      </section>

      <aside className="login-visual" aria-label="De comprobantes a liquidaciones">
        <div className="login-story-surface">
          <div className="login-story-copy">
            <p className="login-kicker">Likida · Liquidación</p>
            <h2 className="login-serif">Flotas de carga en México. El cierre del día, por WhatsApp.</h2>
            <p className="login-story-description">
              El operador manda sus comprobantes; un motor los cuadra contra el anticipo y la política, y entrega la
              liquidación en PDF.
            </p>
          </div>
          <LoginArtwork />
        </div>
      </aside>
    </main>
  );
}
