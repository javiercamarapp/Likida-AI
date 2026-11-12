'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { UserPlus } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, Icono, clasesBoton } from '@/app/ui-v2/componentes';
import '../filas-ctl.css';
import './usuarios.css';
// SOLO TIPOS: el catálogo `ROLES_INVITABLES` viaja como PROP desde la página
// (mismo patrón que `MODOS_TARIFA` en /dashboard/clientes). `invitar.ts` hoy
// no importa `supabaseAdmin`, pero importa `errores.ts` → `logger`, y un
// import de valor ataría este bundle a lo que ese árbol importe mañana.
import type { OpcionRol } from '@/lib/auth/invitar';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { nombreDeRol } from '@/lib/auth/roles';

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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="rv-usu__forma">
      {/* Filas rótulo-control (Rovaq «Equipo»): rótulo 14/600 y ayuda 12 a la izquierda, control de ~200 px a la derecha, divisor entre filas. */}
      <div className="rv-usu__rejilla">
        <CampoTexto className="rv-fila-c" etiqueta={t('cfg.correo')} id="inv-email" name="email" tipo="email" required maxLength={160}
          placeholder="contralor@tuflota.mx"
          ayuda={t('cfg.es_su_llave_de_entrada_en')} />

        <CampoTexto className="rv-fila-c" etiqueta={t('cfg.nombre_opcional')} id="inv-nombre" name="nombre" maxLength={120}
          placeholder={t('cfg.como_quieres_verlo_en_la_lista')} />

        <CampoSelect className="rv-fila-c" etiqueta="Rol" id="inv-rol" name="rol" required defaultValue="contador">
          {roles.map((r) => (
            <option key={r.valor} value={r.valor}>{r.rotulo}</option>
          ))}
        </CampoSelect>

        <CampoTexto className="rv-fila-c" etiqueta={t('cfg.whatsapp_opcional')} id="inv-telefono" name="telefono" maxLength={20}
          placeholder={t('cfg.10_digitos')} inputMode="tel" claseControl="cifra-mono"
          ayuda={t('cfg.para_que_el_bot_la_reconozca')} />
      </div>

      <Aviso estado={estado} />
      <div className="rv-fila-pie"><BotonInvitar /></div>
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

function BotonChico({ etiqueta, ocupado, enMenu = false }: { etiqueta: string; ocupado: string; enMenu?: boolean }) {
  const { pending } = useFormStatus();
  // Dentro del menú de la fila es una FILA DE MENÚ (ghost, hover suave), no un botón con contorno.
  if (enMenu) {
    return <button type="submit" role="menuitem" className="rv-menu__item" disabled={pending}>{pending ? ocupado : etiqueta}</button>;
  }
  return (
    <Boton type="submit" tamano="sm" loading={pending}>
      {pending ? ocupado : etiqueta}
    </Boton>
  );
}

/** Cambiar el rol (Rovaq «Equipo»): un select de 28 px que envía AL ELEGIR; sin JavaScript queda el botón. La acción y su puerta no cambian. */
export function FormaCambiarRol({ accion, id, rolActual, roles }: {
  accion: AccionForma;
  id: string;
  rolActual: string;
  roles: ReadonlyArray<OpcionRol>;
}) {
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <div className="rv-usu__cambiar">
        <input type="hidden" name="id" value={id} />
        <SelectRol rolActual={rolActual} roles={roles} etiqueta={t('cfg.nuevo_rol')} />
        <noscript><button type="submit" className={clasesBoton('secondary', 'sm')}>{t('cfg.cambiar_rol')}</button></noscript>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

function SelectRol({ rolActual, roles, etiqueta }: { rolActual: string; roles: ReadonlyArray<OpcionRol>; etiqueta: string }) {
  const { pending } = useFormStatus();
  return (
    <select name="rol" defaultValue={rolActual} aria-label={etiqueta} className="rv-ctl rv-usu__rol" disabled={pending}
      onChange={(e) => { if (e.currentTarget.value !== rolActual) e.currentTarget.form?.requestSubmit(); }}>
      {/* El rol REAL siempre se ve: un rol fuera del catálogo invitable (p. ej. nómina) no se muestra como «Contador». */}
      {roles.some((r) => r.valor === rolActual) ? null : <option value={rolActual}>{nombreDeRol(rolActual)}</option>}
      {roles.map((r) => <option key={r.valor} value={r.valor}>{r.rotulo}</option>)}
    </select>
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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta={t('cfg.dar_de_baja')} tono="peligro" etiquetaConfirmar={t('cfg.si_dar_de_baja')}
        titulo={`Dar de baja a ${nombre}`}
        descripcion={t('cfg.deja_de_entrar_al_panel_en')}
        className="rv-menu__item"
      />
      <Aviso estado={estado} />
    </form>
  );
}

export function FormaReactivar({ accion, id }: { accion: AccionForma; id: string }) {
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonChico etiqueta={t('cfg.reactivar')} ocupado={t('cfg.reactivando')} />
      <Aviso estado={estado} />
    </form>
  );
}

export function FormaReenviarAcceso({ accion, id }: { accion: AccionForma; id: string }) {
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonChico enMenu etiqueta={t('cfg.reenviar_acceso')} ocupado={t('cfg.enviando')} />
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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-usu__fila-forma">
      <input type="hidden" name="id" value={id} />
      <BotonChico enMenu etiqueta={t('cfg.cerrar_sus_sesiones')} ocupado={t('cfg.cerrando')} />
      <Aviso estado={estado} />
    </form>
  );
}
