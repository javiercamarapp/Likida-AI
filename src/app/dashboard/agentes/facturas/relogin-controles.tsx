'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, RotateCw, ShieldOff, TriangleAlert } from 'lucide-react';
import { fechaCorta } from '@/lib/formato';

// ════════════════════════════════════════════════════════════════════════════
// LA CASILLA DEL RE-LOGIN — «guardar mi contraseña para reconectar sola».
//
// Es el único sitio del producto donde una flota puede decir que sí a que
// Likida guarde una contraseña suya y la use. Por eso el texto de aquí no es
// una etiqueta: es la explicación completa de qué implica, escrita antes de la
// casilla y no en una ayuda que nadie abre.
//
// LAS TRES COSAS QUE EL TEXTO TIENE QUE DECIR, Y DICE:
//
//   1. QUÉ SE GUARDA Y DÓNDE. La contraseña, cifrada, y se descifra SOLO en el
//      momento de volver a entrar — nunca al facturar un ticket.
//   2. QUÉ NO VA A HACER NUNCA. CAPTCHA, código de verificación, pregunta de
//      seguridad, cambio de contraseña y cuenta bloqueada: ahí se detiene y
//      llama a una persona. Prometer lo contrario sería vender un automatismo
//      que en el primer muro deja al cliente esperando.
//   3. QUE SE PUEDE DESHACER. El botón de borrar está aquí mismo, al lado, y
//      no en una pantalla de ajustes.
//
// Sin la casilla marcada, la pantalla y el sistema se comportan EXACTAMENTE
// como antes: la sesión caduca y el contralor entra una vez.
// ════════════════════════════════════════════════════════════════════════════

export type AccionRelogin = (
  prev: { error?: string; ok?: string } | null,
  fd: FormData,
) => Promise<{ error?: string; ok?: string } | null>;

/** Lo que la pantalla sabe del permiso de un portal. Ya serializado. */
export interface EstadoRelogin {
  permitido: boolean;
  permitidoPor: string | null;
  permitidoEn: string | null;
  /** Cuándo reconectó sola por última vez. La frase citable. */
  ultimoExitoEn: string | null;
  ultimoMotivo: string | null;
  ultimaClase: string | null;
  intentosDia: number;
  /** `true` = detenido hasta que una persona guarde la contraseña buena. */
  bloqueado: boolean;
}

export function ControlesRelogin({ clave, nombre, estado, autorizar, revocar }: {
  clave: string;
  nombre: string;
  /** `null` = no se pudo leer el permiso. NO es «no autorizado». */
  estado: EstadoRelogin | null;
  autorizar: AccionRelogin;
  revocar: AccionRelogin;
}) {
  if (estado === null) {
    return (
      <p className="text-[11px] mt-1" style={{ color: 'var(--bad)' }}>
        No se pudo leer si autorizaste la reconexión automática de este portal. No es que no la hayas
        autorizado: esta parte de la pantalla está ciega.
      </p>
    );
  }

  return estado.permitido
    ? <Autorizado clave={clave} nombre={nombre} estado={estado} revocar={revocar} />
    : <SinAutorizar clave={clave} nombre={nombre} autorizar={autorizar} />;
}

/** El ofrecimiento, con el texto honesto delante de la casilla. */
function SinAutorizar({ clave, nombre, autorizar }: { clave: string; nombre: string; autorizar: AccionRelogin }) {
  const [estado, accion] = useActionState(autorizar, null);

  return (
    <form action={accion} className="mt-2 rounded-lg p-2.5" style={{ background: 'var(--canvas)' }}>
      <input type="hidden" name="comercio" value={clave} />
      <div className="flex items-start gap-2">
        <KeyRound width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
        <div className="min-w-0">
          <p className="text-[12px] font-medium">Guardar mi contraseña para reconectar sola</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Si lo activas, Likida guarda tu contraseña de {nombre} <strong>cifrada</strong> y la usa
            <strong> solo</strong> cuando el portal cierre tu sesión: vuelve a entrar una vez y sigue
            facturando. Al facturar un ticket <strong>nunca</strong> se abre esa contraseña.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
            Lo que <strong>no</strong> va a hacer: si el portal pide un CAPTCHA, un código de
            verificación, una pregunta de seguridad, cambiar la contraseña, o si la cuenta está
            bloqueada, se detiene y te avisa. Y si el portal dice que la contraseña no sirve, se para
            en seco — insistir es lo que hace que te bloqueen la cuenta.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Máximo 3 reconexiones por día, con 15 minutos entre una y otra. Queda registrado quién lo
            autorizó y cada vez que se usa. Puedes borrar la contraseña cuando quieras.
          </p>
          {estado?.error && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--bad)' }}>{estado.error}</p>
          )}
          <Boton icono={<KeyRound width={11} height={11} strokeWidth={2} />}>
            Sí, guarda mi contraseña y reconecta sola
          </Boton>
        </div>
      </div>
    </form>
  );
}

/** Lo autorizado: quién y cuándo, la bitácora de lo que hizo, y cómo deshacerlo. */
function Autorizado({ clave, nombre, estado, revocar }: {
  clave: string; nombre: string; estado: EstadoRelogin; revocar: AccionRelogin;
}) {
  const [res, accion] = useActionState(revocar, null);

  return (
    <div className="mt-2 rounded-lg p-2.5" style={{ background: 'var(--canvas)' }}>
      <div className="flex items-start gap-2">
        <RotateCw width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
        <div className="min-w-0 w-full">
          <p className="text-[12px] font-medium">Reconecta sola</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
            {estado.permitidoPor
              ? `Lo autorizó ${estado.permitidoPor}${estado.permitidoEn ? ` el ${fechaCorta(estado.permitidoEn)}` : ''}.`
              : 'Autorizado.'}
          </p>

          {/* LA BITÁCORA VISIBLE. Nunca se inventa una fecha: sin
              `ultimoExitoEn` se dice que todavía no ha hecho falta. */}
          <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
            {estado.ultimoExitoEn
              ? `Reconectó sola por última vez el ${fechaCorta(estado.ultimoExitoEn)}.`
              : `Todavía no ha hecho falta reconectar ${nombre}.`}
            {estado.intentosDia > 0 && ` ${estado.intentosDia} ${estado.intentosDia === 1 ? 'intento' : 'intentos'} hoy.`}
          </p>

          {estado.bloqueado && (
            <p className="text-[11px] mt-1.5 flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
              <TriangleAlert width={11} height={11} strokeWidth={2} className="mt-0.5 shrink-0" />
              <span>
                <strong>Detenido.</strong> {estado.ultimoMotivo ?? 'Hay que revisarlo.'} Vuelve a
                guardar la contraseña correcta en Conexiones y autorízalo otra vez.
              </span>
            </p>
          )}
          {!estado.bloqueado && estado.ultimoMotivo && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
              Último corte: {estado.ultimoMotivo}
            </p>
          )}

          {res?.error && <p className="text-[11px] mt-1.5" style={{ color: 'var(--bad)' }}>{res.error}</p>}
          {res?.ok && <p className="text-[11px] mt-1.5" style={{ color: 'var(--ok)' }}>{res.ok}</p>}

          <form action={accion}>
            <input type="hidden" name="comercio" value={clave} />
            <Boton icono={<ShieldOff width={11} height={11} strokeWidth={2} />}>
              Borrar mi contraseña y volver al modo manual
            </Boton>
          </form>
        </div>
      </div>
    </div>
  );
}

/** El botón, con su estado de envío. Deshabilitado mientras corre. */
function Boton({ children, icono }: { children: React.ReactNode; icono: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors hover:bg-[var(--line2)] disabled:opacity-50"
      style={{ borderColor: 'var(--line)' }}>
      {icono}
      {pending ? 'Guardando…' : children}
    </button>
  );
}
