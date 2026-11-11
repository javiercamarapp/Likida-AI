'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, RotateCw, ShieldOff, TriangleAlert } from 'lucide-react';
import './facturas.css';
import { Boton as BotonV2, Icono } from '@/app/ui-v2/componentes';
import { fechaCorta } from '@/lib/formato';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

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
  const { t: tx } = useT('agentes', agentesEs);
  if (estado === null) {
    return (
      <p className="rv-fact__nota" data-tono="bad">{tx('rest.no_se_pudo_leer_si_autorizaste')}</p>
    );
  }

  return estado.permitido
    ? <Autorizado clave={clave} nombre={nombre} estado={estado} revocar={revocar} />
    : <SinAutorizar clave={clave} nombre={nombre} autorizar={autorizar} />;
}

/** El ofrecimiento, con el texto honesto delante de la casilla. */
function SinAutorizar({ clave, nombre, autorizar }: { clave: string; nombre: string; autorizar: AccionRelogin }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(autorizar, null);

  return (
    <form action={accion} className="rv-fact__relogin">
      <input type="hidden" name="comercio" value={clave} />
      <Icono icono={KeyRound} tam={16} />
      <div className="rv-fact__pila">
        <p className="rv-fact__titulo">{tx('rest.guardar_mi_contrasena_para_reconectar_sola')}</p>
        <p className="rv-fact__nota">{ricoT(tx('rest.si_lo_activas_likida_guarda_tu', { nombre }), { strong: (c) => <strong>{c}</strong> })}</p>
        <p className="rv-fact__nota">{ricoT(tx('rest.lo_que_strong_no_strong_va'), { strong: (c) => <strong>{c}</strong> })}</p>
        <p className="rv-fact__nota" data-tono="faint">{tx('rest.maximo_3_reconexiones_por_dia_con')}</p>
        {estado?.error && <p role="alert" className="rv-fact__nota" data-tono="bad">{estado.error}</p>}
        <div>
          <Boton icono={<Icono icono={KeyRound} tam={14} />}>{tx('rest.si_guarda_mi_contrasena_y_reconecta')}</Boton>
        </div>
      </div>
    </form>
  );
}

/** Lo autorizado: quién y cuándo, la bitácora de lo que hizo, y cómo deshacerlo. */
function Autorizado({ clave, nombre, estado, revocar }: {
  clave: string; nombre: string; estado: EstadoRelogin; revocar: AccionRelogin;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [res, accion] = useActionState(revocar, null);

  return (
    <div className="rv-fact__relogin">
      <Icono icono={RotateCw} tam={16} />
      <div className="rv-fact__pila">
        <p className="rv-fact__titulo">{tx('rest.reconecta_sola')}</p>
        <p className="rv-fact__nota">
          {estado.permitidoPor
            ? tx('rest.lo_autorizo', { permitidoPor: estado.permitidoPor, v: estado.permitidoEn ? ` el ${fechaCorta(estado.permitidoEn)}` : '' })
            : 'Autorizado.'}
        </p>

        {/* LA BITÁCORA VISIBLE. Nunca se inventa una fecha: sin
            `ultimoExitoEn` se dice que todavía no ha hecho falta. */}
        <p className="rv-fact__nota">
          {estado.ultimoExitoEn
            ? tx('rest.reconecto_sola_por_ultima_vez_el', { fechaCorta: fechaCorta(estado.ultimoExitoEn) })
            : tx('rest.todavia_no_ha_hecho_falta_reconectar', { nombre })}
          {estado.intentosDia > 0 && ` ${estado.intentosDia} ${estado.intentosDia === 1 ? 'intento' : 'intentos'} hoy.`}
        </p>

        {estado.bloqueado && (
          <p className="rv-fact__nota" data-tono="warn">
            <Icono icono={TriangleAlert} tam={14} />{' '}{ricoT(tx('rest.strong_detenido_strong'), { strong: (c) => <strong>{c}</strong> })}{' '}{estado.ultimoMotivo ?? tx('rest.hay_que_revisarlo')}{' '}{tx('rest.vuelve_a_guardar_la_contrasena_correcta')}</p>
        )}
        {!estado.bloqueado && estado.ultimoMotivo && (
          <p className="rv-fact__nota" data-tono="faint">{tx('rest.ultimo_corte')}{' '}{estado.ultimoMotivo}</p>
        )}

        {res?.error && <p role="alert" className="rv-fact__nota" data-tono="bad">{res.error}</p>}
        {res?.ok && <p role="status" className="rv-fact__nota" data-tono="ok">{res.ok}</p>}

        <form action={accion}>
          <input type="hidden" name="comercio" value={clave} />
          <Boton icono={<Icono icono={ShieldOff} tam={14} />}>{tx('rest.borrar_mi_contrasena_y_volver_al')}</Boton>
        </form>
      </div>
    </div>
  );
}

/** El botón, con su estado de envío. Deshabilitado mientras corre. */
function Boton({ children, icono }: { children: React.ReactNode; icono: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" tamano="sm" loading={pending} icono={icono}>
      {pending ? 'Guardando…' : children}
    </BotonV2>
  );
}
