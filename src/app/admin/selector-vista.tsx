import Link from 'next/link';
import { Building2, Landmark, Send, ArrowRight } from 'lucide-react';
import { Tarjeta } from '../ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA A LOS OTROS CUATRO PANELES — desde el de Javier, sin credenciales.
//
// El cableado ya existía repartido y sin puerta de entrada: `?vista=demo` en un
// link del sidebar, `?rol=` en la tabla de flotas (que solo se pinta si HAY
// flotas — hoy no hay ninguna), `sufijoTenant` para arrastrarlos, `AvisoRol`
// para anunciarlos. Faltaba el sitio donde se elige. Esto no inventa un
// mecanismo nuevo: arma las cuatro URLs que ese cableado ya honra.
//
// ── POR QUÉ CADA DESTINO ES EL QUE ES ────────────────────────────────────
//
// · Dueño y jefe de tráfico caen en `/dashboard`, que se bifurca solo por área
//   (`puedeVerArea(rol,'dinero')`): el dueño ve el Resumen con pesos, el
//   encargado ve `InicioOperacion`. Es la misma URL a propósito — así se
//   compara la MISMA pantalla con dos pares de ojos.
//
// · El contador NO cae en `/dashboard`: esa ruta es de `operacion` y él no la
//   ve, así que `resolverTenantEfectivo` lo rebotaría a `inicioDe('contador')`.
//   Se le apunta directo a su casa, que es a donde ese rebote va.
//
// · El chofer ya no tiene panel propio ni cuenta — solo WhatsApp (retirado
//   el 7-ago-2026, con /chofer, /mis-viajes y el rol `operador` de login).
//   No hay nada que previsualizar aquí para él.
//
// TODOS llevan `?rol=`, incluido el dueño, que ya es lo que un superadmin ve
// sin él: sin el parámetro no hay cinta, y una previsualización que no se
// anuncia es la que acaba en "¿por qué mi panel dice esto?".
// ═══════════════════════════════════════════════════════════════════════════

type Vista = {
  href: string;
  titulo: string;
  quien: string;
  que: string;
  Icono: typeof Building2;
};

const VISTAS: Vista[] = [
  {
    href: '/dashboard?vista=demo&rol=flota_admin',
    titulo: 'Dueño de flota',
    quien: 'flota_admin',
    que: 'Resumen con pesos: lo señalado por el motor, acreditables y monto comprobado.',
    Icono: Building2,
  },
  {
    // El panel del contador se borró el 10-ago-2026 y su raíz se
    // reconstruyó el 14-ago (`/dashboard/contador`) — el mismo destino al
    // que `inicioDe` (visibilidad.ts) vuelve a aterrizarlo. Mientras estuvo
    // borrado, este botón apuntaba a Suscripción.
    href: '/dashboard/contador?vista=demo&rol=contador',
    titulo: 'Contador',
    quien: 'contador',
    que: 'Acreditables del ejercicio, motor fiscal, deducibilidad y el papel que falta.',
    Icono: Landmark,
  },
  {
    href: '/dashboard?vista=demo&rol=encargado',
    titulo: 'Jefe de tráfico',
    quien: 'encargado',
    que: 'Operación y nada de dinero: qué no tiene chofer, carga por operador, incidencias.',
    Icono: Send,
  },
];

/**
 * `tenants` es el conteo REAL de flotas (`getResumenNegocio`). Con cero, las
 * cuatro vistas abren vacías y hay que decirlo AQUÍ, antes del clic: si no,
 * el primero que se prueba se lee como una pantalla rota.
 */
export function SelectorVista({ tenants }: {
  /** Cuántas flotas hay. `null` = NO SE PUDO CONTAR (FE-24): antes un fallo
   *  de la consulta llegaba como 0 y la pantalla afirmaba "no hay ninguna
   *  flota dada de alta", que con la base caída es falso — y manda a dar de
   *  alta una flota que puede ya existir. */
  tenants: number | null;
}) {
  return (
    <Tarjeta titulo="Entrar a los otros paneles" acciones={<span className="text-xs font-normal text-muted">Con tu propia sesión — no hacen falta credenciales de nadie</span>}>
      <div id="vistas" className="scroll-mt-24">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {VISTAS.map(({ href, titulo, quien, que, Icono }) => (
            <Link key={href} href={href} className="block min-h-11 py-0.5 no-underline">
              <span className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 transition-colors hover:bg-[var(--canvas)]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--marca)]">
                  <Icono width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{titulo}</span>
                    <code className="text-[11px] text-muted">{quien}</code>
                    <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0 text-muted" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-xs text-muted">{que}</span>
                </span>
              </span>
            </Link>
          ))}
        </div>

        <p className="m-0 mt-3 text-xs text-muted">
          {tenants === null ? (
            <>
              No se pudo contar cuántas flotas hay, así que no se sabe si estas vistas van a abrir con
              datos o vacías. Recarga en un momento — esto NO significa que no haya flotas.
            </>
          ) : tenants === 0 ? (
            <>
              No hay ninguna flota dada de alta, así que las tres vistas abren VACÍAS y lo dicen en pantalla —
              sirven para mirar el frontend, no para leer una cifra.{' '}
              <Link href="/admin/flotas" className="font-medium underline">Dar de alta una flota</Link>.
            </>
          ) : (
            <>
              Cambian lo que se te ENSEÑA, no lo que puedes hacer: tu sesión sigue siendo la de superadmin y cada
              vista lleva una cinta que lo dice, con el regreso a esta consola.
            </>
          )}
        </p>
      </div>
    </Tarjeta>
  );
}
