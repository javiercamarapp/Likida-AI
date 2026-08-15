// ═══════════════════════════════════════════════════════════════════════════
// INVITAR A ALGUIEN DEL EQUIPO DESDE EL PANEL DEL CLIENTE (D6, auditoría 4).
//
// `provisionarUsuario` ya hace el alta completa (Auth + app_user + teléfono
// normalizado). Lo que faltaba era la puerta del DUEÑO: hasta hoy todo usuario
// nuevo pasaba por Javier (/admin/usuarios/nuevo). Este módulo es la parte
// PURA de esa puerta — validar lo capturado y traducir los errores duros — y
// vive aparte de la página por dos razones:
//
//   1. Se prueba sin sesión y sin Supabase (invitar.test.ts).
//   2. No importa `supabaseAdmin`, así que el catálogo `ROLES_INVITABLES`
//      puede viajar como PROP al formulario cliente sin riesgo de arrastrar
//      la llave de servicio al bundle (el mismo patrón que `MODOS_TARIFA` en
//      /dashboard/clientes).
//
// ── POR QUÉ VALIDAR ANTES **Y** TRADUCIR DESPUÉS, y no solo una de las dos ─
//
// `provisionarUsuario` lanza `Error` genérico, no `DatoInvalido`, así que
// `mensajeParaPantalla` convertiría "ese correo ya existe" en "falla del
// sistema" — mentira doble: acusa al sistema y no dice qué corregir.
//
//   · El TELÉFONO CORTO se valida AQUÍ, antes de llamar: la regla es
//     determinista (menos de 10 dígitos rechaza, el mismo piso que
//     `normalizarTelefonoOficina`) y atajarla antes evita hasta la
//     posibilidad de un alta a medias. El piso es EL MISMO a propósito y no
//     más estricto: `destinatarioWhatsApp` acepta 10, 12 (52+10) y 13 (521+10)
//     dígitos, y rechazar aquí lo que provisionar aceptaría sería inventar
//     una regla.
//   · El CORREO DUPLICADO no se puede saber antes sin consultar dos almacenes
//     (auth.users y app_user) y aun así quedaría la carrera entre consultar y
//     crear. La fuente de verdad es el error de Supabase, así que ese se
//     TRADUCE después, por patrón (`descifrarErrorProvision`).
// ═══════════════════════════════════════════════════════════════════════════
import { DatoInvalido } from '@/lib/likida/errores';

/**
 * Los roles que un dueño puede invitar, con la verdad de qué ve cada uno —
 * los `detalle` salen de `AREAS_POR_ROL` (visibilidad.ts), que es quien de
 * verdad decide, no de lo que suene bien en un formulario.
 *
 * `superadmin` NO está y también se rechaza en el servidor (`validarInvitacion`
 * cae al fail-closed del catálogo): el select no lo ofrece, pero una server
 * action es un endpoint POST alcanzable sin pasar por el select — el mismo
 * agujero que la auditoría 13 cerró en /admin/usuarios/nuevo. `operador`
 * tampoco: ya no tiene login (7-ago-2026, solo WhatsApp). Y `vendedor`
 * (0105) tampoco: es un rol de LIKIDA (tenant null, panel /vendedor) y su
 * única puerta es /admin/vendedores — ver `validarInvitacionVendedor`.
 */
export const ROLES_INVITABLES = [
  {
    valor: 'contador',
    rotulo: 'Contador',
    detalle: 'Ve el dinero y lo fiscal — facturación, cobranza, clientes y tarifas — y puede exportar. No despacha viajes.',
  },
  {
    valor: 'encargado',
    rotulo: 'Encargado (jefe de tráfico)',
    detalle: 'Despacha y da seguimiento: viajes, operadores, unidades y mapa. No ve un peso — ni tarifas, ni facturación, ni rentabilidad.',
  },
  {
    valor: 'flota_admin',
    rotulo: 'Dueño (flota_admin)',
    detalle: 'Todo el panel: operación, dinero y la administración de la cuenta — incluido invitar y las llaves de API.',
  },
] as const;

export type RolInvitable = (typeof ROLES_INVITABLES)[number]['valor'];
export type OpcionRol = (typeof ROLES_INVITABLES)[number];

export interface InvitacionValida {
  email: string;
  nombre?: string;
  rol: RolInvitable;
  /** Como se tecleó (recortado): `provisionarUsuario` lo normaliza adentro. */
  telefono?: string;
}

/** El mismo criterio superficial que `validarCliente`: forma de correo, no
 *  existencia — comprobar que existe requeriría mandarle algo. */
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minúsculas a propósito: Supabase Auth guarda el correo en minúsculas, y
 *  si `app_user.email` quedara como se tecleó ("Ana@Flota.mx"), las dos
 *  tablas dirían correos distintos de la misma cuenta. Compartido entre las
 *  DOS puertas de invitación (flota y vendedor) para que las reglas del
 *  correo no puedan divergir. */
function correoDeInvitacion(crudo: string): string {
  const email = crudo.trim().toLowerCase();
  if (email === '') throw new DatoInvalido('Falta el correo: es con lo que esta persona va a entrar al panel.');
  if (email.length > 160) throw new DatoInvalido('El correo no puede pasar de 160 caracteres.');
  if (!CORREO_RE.test(email)) {
    throw new DatoInvalido(`"${email}" no se ve como un correo. Escríbelo completo (nombre@empresa.com).`);
  }
  return email;
}

function nombreDeInvitacion(crudo: string): string | undefined {
  const nombre = crudo.trim();
  if (nombre.length > 120) throw new DatoInvalido('El nombre no puede pasar de 120 caracteres.');
  return nombre || undefined;
}

export function validarInvitacion(c: {
  email: string;
  nombre: string;
  rol: string;
  telefono: string;
}): InvitacionValida {
  const email = correoDeInvitacion(c.email);
  const nombre = nombreDeInvitacion(c.nombre);

  // Fail closed contra el catálogo: cualquier valor que no esté en la lista
  // rebota — `superadmin` incluido, aunque el select nunca lo ofrezca.
  const rol = ROLES_INVITABLES.find((r) => r.valor === c.rol)?.valor;
  if (!rol) {
    throw new DatoInvalido('Elige el rol de la lista: contador, encargado o dueño. Ningún otro se puede invitar desde el panel.');
  }

  const telefono = c.telefono.trim();
  if (telefono !== '') {
    const digitos = telefono.replace(/[^\d]/g, '');
    if (digitos.length < 10) {
      throw new DatoInvalido(
        `El WhatsApp "${telefono}" tiene ${digitos.length} dígitos y un número mexicano necesita 10. Complétalo o déjalo vacío.`,
      );
    }
  }

  return { email, nombre: nombre || undefined, rol, telefono: telefono || undefined };
}

/**
 * Los errores DUROS de `provisionarUsuario` que sí son culpa de lo capturado,
 * traducidos a `DatoInvalido` para que `mensajeParaPantalla` los enseñe
 * VERBATIM en vez de generizarlos a "falla del sistema".
 *
 * Devuelve `null` para todo lo demás: un error desconocido NO es de captura y
 * debe seguir su camino (log completo + mensaje genérico honesto).
 */
export function descifrarErrorProvision(e: unknown): DatoInvalido | null {
  const m = e instanceof Error ? e.message : '';

  // Supabase Auth: "A user with this email address has already been
  // registered" (y variantes), o el índice único de app_user.email si el
  // duplicado se colara hasta el insert. OJO con lo que el mensaje NO afirma:
  // no dice "ya puede entrar" — la cuenta podría existir a medias (Auth sí,
  // app_user no) o en otra flota, y afirmarlo sería inventar.
  if (/already (been )?registered|email_exists|app_user_email/i.test(m)) {
    return new DatoInvalido(
      'Ese correo ya tiene una cuenta registrada en Likida, así que no se puede invitar de nuevo. ' +
      'Si no aparece en tu equipo aquí abajo, avísale a Likida para revisarla.',
    );
  }

  // El índice único global de 0059: un teléfono es LA llave de enrutamiento
  // del bot y no puede señalar a dos cuentas. Falla en el insert, DESPUÉS de
  // crear el usuario de Auth — por eso el mensaje pide reintentar con otro
  // correo no: con otro NÚMERO, que es lo que estorbó.
  if (/app_user_telefono_uniq/.test(m)) {
    return new DatoInvalido(
      'Ese WhatsApp ya identifica a otra cuenta, y el bot enruta por número: no puede ser de dos personas. ' +
      'El alta no se completó — inténtalo con otro número o sin WhatsApp.',
    );
  }

  // El teléfono corto de `normalizarTelefonoOficina`. `validarInvitacion` lo
  // ataja antes, así que esto es cinturón y tirantes por si otro camino llama
  // a provisionar sin pasar por ella: el mensaje ya está escrito para leerse.
  if (/necesita 10 más la lada 52/.test(m)) return new DatoInvalido(m);

  return null;
}

export interface InvitacionVendedorValida {
  email: string;
  nombre?: string;
}

/**
 * La validación del alta de un VENDEDOR (0105) — la puerta de
 * /admin/vendedores, solo superadmin. El rol NO se pregunta: esta puerta
 * produce únicamente `vendedor` (rol de LIKIDA, tenant null), así que no hay
 * catálogo que ofrecer ni forma de pedir otro por POST. Correo y nombre
 * pasan por LOS MISMOS helpers que `validarInvitacion`: si la regla del
 * correo cambia, cambia para las dos puertas a la vez. Sin teléfono a
 * propósito: el vendedor no habla con el bot de WhatsApp de ninguna flota.
 */
export function validarInvitacionVendedor(c: { email: string; nombre: string }): InvitacionVendedorValida {
  return { email: correoDeInvitacion(c.email), nombre: nombreDeInvitacion(c.nombre) };
}
