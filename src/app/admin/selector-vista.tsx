import Link from 'next/link';
import { Building2, Landmark, Send, Smartphone, ArrowRight } from 'lucide-react';

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
// · El chofer no puede pasar por `/chofer`: lo cierra `requireOperador` y un
//   superadmin rebota a `/dashboard` y de ahí a `/admin` — nunca ve la
//   pantalla. Su preview vive dentro de /admin, montando los componentes
//   REALES del panel del chofer (ver `vista-chofer/page.tsx`).
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
    href: '/dashboard/contador?vista=demo&rol=contador',
    titulo: 'Contador',
    quien: 'contador',
    que: 'Panel fiscal, de solo lectura: IVA, IEPS de diésel y CFDI por validar.',
    Icono: Landmark,
  },
  {
    href: '/dashboard?vista=demo&rol=encargado',
    titulo: 'Jefe de tráfico',
    quien: 'encargado',
    que: 'Operación y nada de dinero: qué no tiene chofer, carga por operador, incidencias.',
    Icono: Send,
  },
  {
    href: '/admin/vista-chofer',
    titulo: 'Chofer',
    quien: 'operador · /chofer',
    que: 'El panel del teléfono: su viaje de hoy, su saldo, sus tickets.',
    Icono: Smartphone,
  },
];

/**
 * `tenants` es el conteo REAL de flotas (`getResumenNegocio`). Con cero, las
 * cuatro vistas abren vacías y hay que decirlo AQUÍ, antes del clic: si no,
 * el primero que se prueba se lee como una pantalla rota.
 */
export function SelectorVista({ tenants }: { tenants: number }) {
  return (
    <section id="vistas" className="p-5 border-t scroll-mt-24" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Entrar a los otros paneles
        </h2>
        <span className="text-xs" style={{ color: 'var(--faint)' }}>
          Con tu propia sesión — no hacen falta credenciales de nadie
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {VISTAS.map(({ href, titulo, quien, que, Icono }) => (
          <Link key={href} href={href}
            className="card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{titulo}</span>
                <code className="text-[10px]" style={{ color: 'var(--faint)' }}>{quien}</code>
                <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0" style={{ color: 'var(--muted)' }} />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{que}</p>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
        {tenants === 0 ? (
          <>
            No hay ninguna flota dada de alta, así que las cuatro vistas abren VACÍAS y lo dicen en pantalla —
            sirven para mirar el frontend, no para leer una cifra.{' '}
            <Link href="/admin/flotas" className="underline font-medium">Dar de alta una flota</Link>.
          </>
        ) : (
          <>
            Cambian lo que se te ENSEÑA, no lo que puedes hacer: tu sesión sigue siendo la de superadmin y cada
            vista lleva una cinta que lo dice, con el regreso a esta consola.
          </>
        )}
      </p>
    </section>
  );
}
