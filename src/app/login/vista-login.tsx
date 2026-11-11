import type { ReactNode } from 'react';
import { MailCheck, OctagonAlert } from 'lucide-react';
import { Logo, GlifoAdorno } from '../logo';
import { LoginArtwork } from '@/components/login/artwork';
import { BotonEnvio } from './boton-envio';
import { TurnstileWidget } from './turnstile-widget';
import { login as loginEs } from '@/lib/i18n/es/login';
import { crearTraductor, type Traductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';

type TraductorLogin = Traductor<DiccionarioDe<'login'>>;
/** El traductor en español: lo que dice /login sin idioma elegido (y lo que usan las pruebas que recorren `VistaLogin`). */
const TRADUCTOR_ES: TraductorLogin = crearTraductor<DiccionarioDe<'login'>>('es', loginEs, loginEs);

const MOTIVOS_ERROR = ['caducado', 'caducado_reciente', 'navegador'] as const;
/** El texto del motivo de fallo (`?error=…`): el parámetro desconocido o `1` cae al mensaje genérico, como `mensajeDeError`. */
function textoDeError(parametro: string, t: TraductorLogin['t']): string {
  const motivo = (MOTIVOS_ERROR as readonly string[]).includes(parametro) ? (parametro as (typeof MOTIVOS_ERROR)[number]) : 'generico';
  return t(`error.${motivo}`);
}

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
  /** El traductor del namespace `login` (la página lo arma en el servidor con `getT`). Sin él, español. */
  tr?: TraductorLogin;
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

export function VistaLogin({ next, enviado, reenviado, error, entrarConGoogle, entrarConEmail, claseFuentes = '', tr = TRADUCTOR_ES }: PropsVistaLogin) {
  const { t } = tr;
  // El aviso legal lleva dos enlaces: la frase completa es UNA clave con `{terminos}` y `{privacidad}`, y aquí solo se parte donde están.
  const piezasLegal = t('pie.aceptas').split(/(\{terminos\}|\{privacidad\})/);
  return (
    <main className={`login login-editorial tema-neutro ${claseFuentes}`} lang={tr.idioma === 'es' ? undefined : tr.idioma}>
      <section className="login-column">
        <div className="login-inner">
          <header className="auth-brand">
            <Logo alto="h-7" />
          </header>

          <div className="login-copy">
            <p className="login-kicker login-entra">{t('kicker')}</p>
            <h1 className="login-serif login-entra">{t('titulo')}</h1>
            <p className="login-intro login-entra">{t('intro')}</p>
            <div className="login-divider" />

            {/* `role="alert"` y texto por motivo (`mensajeDeError`): un enlace usado o caducado no dice «intenta
                otra vez». Habla del estado del ENLACE, nunca de la cuenta (sin oráculo de enumeración). */}
            {error && (
              <div className="login-message" data-tipo="error" role="alert">
                <OctagonAlert width={16} height={16} strokeWidth={2} aria-hidden="true" />
                <p>{textoDeError(error, t)}</p>
              </div>
            )}

            <form action={entrarConGoogle} className="login-google login-entra">
              <input type="hidden" name="next" value={next} />
              <BotonEnvio className="login-btn login-btn-borde" reposo={t('google.reposo')} enVuelo={t('google.enVuelo')} icono={<IconoGoogle />} />
            </form>

            <div className="login-separator">
              <span />
              <p>{t('separador')}</p>
              <span />
            </div>

            <form action={entrarConEmail} className="login-email login-entra" aria-label={t('correo.formulario')}>
              <input type="hidden" name="next" value={next} />
              <label className="sr-only" htmlFor="login-email">
                {t('correo.etiqueta')}
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                maxLength={254}
                placeholder={t('correo.placeholder')}
                autoComplete="email"
                className="login-campo"
              />
              <TurnstileWidget />
              <BotonEnvio
                className="login-btn login-btn-tinta"
                reposo={t('correo.reposo')}
                enVuelo={t('correo.enVuelo')}
                icono={
                  <span aria-hidden className="login-glifo">
                    <GlifoAdorno color="#ffffff" />
                  </span>
                }
              />
              {/* Región de estado con altura reservada: no salta el diseño. El aviso de «enviado» va DEBAJO del
                  botón y no lo reemplaza: con un dedazo en el correo la pantalla ofrece volver a escribirlo. */}
              <div className="login-message login-email-status" role="status" data-tipo={enviado ? 'enviado' : undefined}>
                {enviado && (
                  <>
                    <MailCheck width={16} height={16} strokeWidth={2} aria-hidden="true" />
                    <div>
                    <p className="login-estado-titulo">
                      {reenviado ? t('reenviado.titulo') : t('enviado.titulo')}
                    </p>
                    <p>
                      {reenviado ? t('reenviado.detalle') : t('enviado.detalle')}
                    </p>
                    <p className="login-estado-nota">{t('enviado.nota')}</p>
                    </div>
                  </>
                )}
              </div>
            </form>

            <details className="login-access-help">
              <summary>{t('ayuda.resumen')}</summary>
              <p>{t('ayuda.cuerpo')}</p>
            </details>
            <p className="login-help">
              {t('alta.pregunta')} <strong>{t('alta.accion')}</strong>
            </p>
            <p className="login-footnote">
              {t('pie.reservado')}{' '}
              {piezasLegal.map((pieza, i) => (pieza === '{terminos}'
                ? <a key={i} href="/terminos">{t('pie.terminos')}</a>
                : pieza === '{privacidad}' ? <a key={i} href="/privacidad">{t('pie.privacidad')}</a> : pieza))}
            </p>
          </div>
        </div>
      </section>

      <aside className="login-visual" aria-label={t('historia.aria')}>
        <div className="login-story-surface">
          <div className="login-story-copy">
            <p className="login-kicker">{t('historia.kicker')}</p>
            <h2 className="login-serif">{t('historia.titulo')}</h2>
            <p className="login-story-description">{t('historia.descripcion')}</p>
          </div>
          <LoginArtwork />
        </div>
      </aside>
    </main>
  );
}
