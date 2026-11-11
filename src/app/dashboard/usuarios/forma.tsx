'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { UserPlus } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, Icono, clasesBoton } from '@/app/ui-v2/componentes';
import './usuarios.css';
// SOLO TIPOS: el catálogo `ROLES_INVITABLES` viaja como PROP desde la página
// (mismo patrón que `MODOS_TARIFA` en /dashboard/clientes). `invitar.ts` hoy
// no importa `supabaseAdmin`, pero importa `errores.ts` → `logger`, y un
// import de valor ataría este bundle a lo que ese árbol importe mañana.
import type { OpcionRol } from '@/lib/auth/invitar';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function BotonInvitar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={UserPlus} />}>
      {pending ? 'Invitando…' : 'Invitar'}
    </Boton>
  );
}

/** El aviso del resultado: el UNICO del panel (`admin/ui/aviso-resultado`). El error
 *  del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

/**
 * Invitar a alguien del equipo. Solo ALTA, sin `id` oculto: cambiar rol, dar
 * de baja y reenviar el acceso son formas APARTE por renglón (abajo), cada una
 * con su propio server action y su propia puerta.
 *
 * El tenant NO viaja en el formulario, ni oculto: el server action lo saca de
 * la sesión re-resuelta. Aquí solo se captura QUIÉN entra, no A DÓNDE.
 */
export function FormaInvitar({ accion, roles }: {
  accion: AccionForma;
  roles: ReadonlyArray<OpcionRol>;
}) {
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="rv-usu__forma">
      <div className="rv-usu__rejilla">
        <CampoTexto etiqueta="Correo" id="inv-email" name="email" tipo="email" required maxLength={160}
          placeholder="contralor@tuflota.mx"
          ayuda="Es su llave de entrada: en el panel teclea este correo y le llega un enlace mágico — no hay contraseña que inventarle." />

        <CampoTexto etiqueta="Nombre (opcional)" id="inv-nombre" name="nombre" maxLength={120}
          placeholder="Como quieres verlo en la lista" />

        <div>
          {/* `contador` primero y por default: es el caso por el que existe
              esta pantalla (D6). Arrancar en `flota_admin` repartiría control
              total de la cuenta por pura inercia del que no cambia el select. */}
          <CampoSelect etiqueta="Rol" id="inv-rol" name="rol" required defaultValue="contador">
            {roles.map((r) => (
              <option key={r.valor} value={r.valor}>{r.rotulo}</option>
            ))}
          </CampoSelect>
          {/* La ayuda dice la VERDAD de visibilidad.ts, no marketing: qué ve
              y qué NO ve cada rol es exactamente lo que el dueño necesita
              saber antes de repartir accesos. */}
          <div className="rv-usu__roles">
            {roles.map((r) => (
              <p key={r.valor}>
                <strong>{r.rotulo}:</strong> {r.detalle}
              </p>
            ))}
          </div>
        </div>

        <CampoTexto etiqueta="WhatsApp (opcional)" id="inv-telefono" name="telefono" maxLength={20}
          placeholder="10 dígitos" inputMode="tel" claseControl="cifra-mono"
          ayuda="Para que el bot la reconozca cuando escriba por WhatsApp (avisos contestables, despacho por chat). Sin número, el bot no la reconoce." />
      </div>

      <Aviso estado={estado} />
      <div><BotonInvitar /></div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES POR RENGLÓN (auditoría 24, SEG-1 / H5): cambiar rol, dar de
// baja, reactivar, reenviar acceso. Cada una es su propio <form> con su
// `useActionState`, así el aviso sale JUNTO al renglón que lo produjo. El
// `id` viaja oculto porque es el objetivo, no la autorización: el server
// action lo vuelve a leer ANCLADO al tenant de la sesión.
// ═══════════════════════════════════════════════════════════════════════════

function BotonChico({ etiqueta, ocupado }: { etiqueta: string; ocupado: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" tamano="sm" loading={pending}>
      {pending ? ocupado : etiqueta}
    </Boton>
  );
}

/** Cambiar el rol: un select con el catálogo invitable y un botón. */
export function FormaCambiarRol({ accion, id, rolActual, roles }: {
  accion: AccionForma;
  id: string;
  rolActual: string;
  roles: ReadonlyArray<OpcionRol>;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <div className="rv-usu__cambiar">
        <input type="hidden" name="id" value={id} />
        <select name="rol" defaultValue={rolActual} aria-label="Nuevo rol" className="rv-ctl">
          {roles.map((r) => <option key={r.valor} value={r.valor}>{r.rotulo}</option>)}
        </select>
        <BotonChico etiqueta="Cambiar rol" ocupado="Cambiando…" />
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/**
 * Dar de baja, con el diálogo de confirmación ÚNICO del panel (W2): dice qué
 * pasa con la sesión y con el historial antes de que se confirme.
 */
export function FormaDarDeBaja({ accion, id, nombre }: {
  accion: AccionForma;
  id: string;
  nombre: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta="Dar de baja" tono="peligro" etiquetaConfirmar="Sí, dar de baja"
        titulo={`Dar de baja a ${nombre}`}
        descripcion="Deja de entrar al panel en su siguiente clic y su sesión se revoca. No se borra nada: queda en la lista como dada de baja y se puede reactivar."
        className={clasesBoton('danger', 'sm')}
      />
      <Aviso estado={estado} />
    </form>
  );
}

export function FormaReactivar({ accion, id }: { accion: AccionForma; id: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonChico etiqueta="Reactivar" ocupado="Reactivando…" />
      <Aviso estado={estado} />
    </form>
  );
}

export function FormaReenviarAcceso({ accion, id }: { accion: AccionForma; id: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonChico etiqueta="Reenviar acceso" ocupado="Enviando…" />
      <Aviso estado={estado} />
    </form>
  );
}

/**
 * FASE 1 · SEG-SESIONES: cierra TODAS sus sesiones vivas sin darla de baja
 * — el caso de "sospecho que alguien más tiene su sesión" o "perdió el
 * celular", donde la persona sigue trabajando y no hay por qué banearla.
 * Sin diálogo de confirmación aparte (a diferencia de Dar de baja): es
 * reversible por completo con solo volver a iniciar sesión.
 */
export function FormaCerrarSesiones({ accion, id }: { accion: AccionForma; id: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonChico etiqueta="Cerrar sus sesiones" ocupado="Cerrando…" />
      <Aviso estado={estado} />
    </form>
  );
}
