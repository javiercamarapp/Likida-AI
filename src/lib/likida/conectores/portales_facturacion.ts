import { COMERCIOS } from '../facturacion/comercios';
import { faltantes, sinApiQueProbar, type CampoCredencial, type Conector } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// PORTALES DE FACTURACIÓN QUE EXIGEN CUENTA — el eslabón que faltaba entre el
// cofre y el robot.
//
// La regla del 4-ago-2026 dice: portal con cuenta → lo factura el encargado,
// que es quien tiene la sesión. Eso era verdad mientras no hubiera DÓNDE
// compartir esa sesión. El cofre (`conector_credencial`, 0094) y su pantalla
// (/dashboard/conexiones) existen desde antes; lo que no existía era la ficha
// de estos portales en el catálogo, así que la flota no tenía forma de decir
// "esta cuenta es tuya también, factura tú".
//
// Este archivo SE DERIVA de `facturacion/comercios.ts` a propósito: una ficha
// por cada comercio con `requiereCuenta: true`, ni una más. El día que un
// portal nuevo entre al registro con cuenta, su conector aparece solo; una
// lista paralela es la que alguien olvida al meter el segundo.
//
// ── QUÉ SE AFIRMA Y QUÉ NO ───────────────────────────────────────────────
//
// De estos portales NO hay documentación de API —son formularios web para el
// titular— y de casi ninguno se ha leído su pantalla de login. Por eso:
//
//   · `fuente: null` (sin_verificar) en todos: no hay doc primaria que citar.
//   · `formaDeConectar: 'requiere_piloto'`: el camino existe (el cofre guarda,
//     el agente de facturación abre portales) y el último tramo necesita la
//     cuenta real de un cliente.
//   · Los campos de credencial son los del CLIENTE (con qué entra él), no una
//     descripción del fabricante. El único portal con login LEÍDO en campo es
//     La Gas (29-jul-2026: correo + contraseña) y su ficha lo dice; el resto
//     pide el par usuario/contraseña genérico y la ayuda lo declara.
//   · `probar()` no llama a nada: la prueba real de una cuenta de portal es
//     entrar con navegador, y eso es trabajo del agente de facturación, no de
//     un ping HTTP que leería un 200 de página de login como credencial buena.
// ═══════════════════════════════════════════════════════════════════════════

/** El id del conector que guarda la cuenta del portal de un comercio. */
export function conectorDePortal(claveComercio: string): string {
  return `portal_facturacion:${claveComercio}`;
}

/** Y el camino de vuelta: de un conector_id a la clave del comercio, o null. */
export function comercioDeConector(conectorId: string): string | null {
  const pre = 'portal_facturacion:';
  return conectorId.startsWith(pre) ? conectorId.slice(pre.length) : null;
}

const USUARIO_Y_CONTRASENA: readonly CampoCredencial[] = [
  {
    clave: 'usuario',
    rotulo: 'Usuario del portal',
    forma: 'texto',
    requerida: true,
    ayuda: 'Con lo que entras tú al portal de facturación: usuario, correo o RFC, según el portal.',
  },
  {
    clave: 'contrasena',
    rotulo: 'Contraseña del portal',
    forma: 'secreto',
    requerida: true,
    ayuda: 'La contraseña de esa cuenta. Se guarda cifrada y no vuelve a la pantalla.',
  },
];

/** Login LEÍDO en el portal real, no supuesto. La fecha va en la ficha. */
const CAMPOS_VERIFICADOS: Record<string, readonly CampoCredencial[]> = {
  la_gas: [
    {
      clave: 'usuario',
      rotulo: 'Correo de la cuenta',
      forma: 'correo',
      requerida: true,
      ayuda: 'El correo con el que se registró la cuenta en facturacion.lagas.com.mx (leído en el portal el 29-jul-2026).',
    },
    {
      clave: 'contrasena',
      rotulo: 'Contraseña',
      forma: 'secreto',
      requerida: true,
      ayuda: 'La contraseña de esa cuenta. Se guarda cifrada y no vuelve a la pantalla.',
    },
  ],
};

/**
 * Un conector por cada comercio del registro de facturación que exige cuenta.
 *
 * La flota que comparta aquí su acceso le está dando al robot lo único que le
 * faltaba para intentar ESE portal; mientras no lo comparta, el ticket sigue
 * yendo al encargado con la liga y los datos, como siempre.
 */
export const CONECTORES_PORTALES_FACTURACION: readonly Conector[] = COMERCIOS
  .filter((c) => c.requiereCuenta)
  .map((c): Conector => {
    const credenciales = CAMPOS_VERIFICADOS[c.clave] ?? USUARIO_Y_CONTRASENA;
    return {
    id: conectorDePortal(c.clave),
    nombre: c.nombre,
    categoria: 'Portal de facturación',
    queHace: `Con tu cuenta compartida, el Agente de Facturas puede entrar a ${c.portal} y facturar los tickets de ese comercio sin que nadie teclee.`,
    formaDeConectar: 'requiere_piloto',
    comoConectaHoy: 'Guardas tu acceso al portal en el cofre (cifrado) y el robot lo usa para entrar con navegador, igual que lo harías tú. Sin cuenta compartida, el aviso de WhatsApp te lleva la liga y los datos para hacerlo a mano.',
    paraSubirDeEscalon: 'Probar el camino completo con la cuenta real de un cliente en ese portal. Un portal que pida CAPTCHA se queda con la persona: eso no se rodea.',
    capacidades: ['emitir_factura'],
    credenciales,
    fuente: null,
    claveAlmacen: null,
    // La MISMA guarda que todo conector: sin los campos requeridos ni se
    // contesta "no hay API" — se dice qué falta, que es lo accionable.
    probar: async (valores) => {
      const falta = faltantes({ credenciales }, valores);
      if (falta.length > 0) {
        return { ok: false, detalle: `Faltan datos para guardar la cuenta: ${falta.join(', ')}.`, verificadoContra: null, sobreLaCredencial: 'no_se_sabe', falta };
      }
      return sinApiQueProbar(
        `${c.nombre} no publica API: la cuenta se prueba entrando al portal con navegador, y eso lo hace el Agente de Facturas en su siguiente corrida, no un ping desde esta pantalla.`,
      );
    },
  };
  });
