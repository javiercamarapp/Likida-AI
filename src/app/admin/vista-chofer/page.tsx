import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Smartphone } from 'lucide-react';
import { MarcoChofer } from '../../chofer/marco';
import {
  Titulo, SinViaje, SinViajeParaSaldo, SinViajeParaComprobantes, SinViajesRegistrados,
} from '../../chofer/vista';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// EL PANEL DEL CHOFER, MIRADO DESDE LA CONSOLA DE JAVIER.
//
// ── POR QUÉ NO ES UN LINK A /chofer ──────────────────────────────────────
//
// Porque /chofer no se le abre a un superadmin, y no es un descuido que haya
// que arreglar: `requireOperador` (guard.ts) rebota todo rol ≠ operador a
// `inicioDe(rol)`, y para superadmin eso es `/dashboard`, que a su vez rebota
// a `/admin` por `esRaiz`. Un botón "Chofer" que apunte a /chofer da dos
// saltos y te deja donde empezaste, sin haber visto la pantalla.
//
// Abrirle /chofer al superadmin costaría relajar la puerta del único panel que
// hoy solo se toca desde un teléfono, para poder mirarlo. La previsualización
// no puede pagarse con la puerta: se monta aquí, DENTRO de /admin, que ya está
// cerrado con `requireSuperadmin` en su layout.
//
// ── LO QUE SE MONTA SON LOS COMPONENTES REALES — LOS CUATRO, NO SOLO TRES ──
//
// `MarcoChofer` (con su `ruta`, que existe justo para esto) y las cuatro
// pantallas de "no hay nada todavía" (`SinViaje`, `SinViajeParaSaldo`,
// `SinViajeParaComprobantes`, `SinViajesRegistrados`) salen TODAS de
// `chofer/vista.tsx` — se importan, no se copian.
//
// AUDITORÍA 10, BAJO — hasta antes de esto, solo `SinViaje` (la pestaña
// "Hoy") se importaba; las otras tres se mirroreaban a mano aquí abajo, y el
// espejo YA había divergido: le faltaba `<EnlaceViajes/>` ("Ver mis viajes"),
// el botón que `/chofer/liquidacion` real agrega cuando no hay viaje abierto.
// Una copia se lee bien hasta que alguien cambia el original y nadie se
// acuerda de tocar la copia — que es exactamente lo que pasó. Ahora las
// cuatro pantallas están exportadas junto a `Titulo`/`Pendiente` en
// `vista.tsx` (el mismo archivo cuyo propio docstring dice: "el preview
// temporal importa EL MISMO componente que ve el chofer en vez de una copia
// — una copia solo se verifica a sí misma"), así que esta página ya no tiene
// NADA que mirrorear: si `/chofer` cambia un texto o un botón, este preview
// lo hereda solo.
//
// ── LAS PESTAÑAS DE ADENTRO NO NAVEGAN ───────────────────────────────────
//
// `NavInferior` apunta a `/chofer/...`, que desde aquí rebota. Se pinta —es lo
// que hay que mirar, con su pestaña activa— pero se le quita el clic, y el
// cambio de pantalla se hace con los chips de arriba, que son de esta página.
// Un menú que te expulsa del preview al tocarlo es peor que uno que no toca.
// ═══════════════════════════════════════════════════════════════════════════

type Pestana = { clave: string; etiqueta: string; ruta: string };

const PESTANAS: Pestana[] = [
  { clave: 'hoy', etiqueta: 'Hoy', ruta: '/chofer' },
  { clave: 'saldo', etiqueta: 'Mi saldo', ruta: '/chofer/liquidacion' },
  { clave: 'tickets', etiqueta: 'Tickets', ruta: '/chofer/comprobantes' },
  { clave: 'viajes', etiqueta: 'Viajes', ruta: '/chofer/viajes' },
];

/** El estado de cada pantalla cuando el chofer no trae viaje abierto — que es
 *  exactamente lo que hay con la base vacía. Las CUATRO son el componente
 *  real de `chofer/vista.tsx`, no un espejo (ver el bloque de arriba). */
function Contenido({ clave }: { clave: string }) {
  switch (clave) {
    case 'saldo': return <SinViajeParaSaldo />;
    case 'tickets': return <SinViajeParaComprobantes />;
    case 'viajes': return <SinViajesRegistrados />;
    default:
      return (
        <>
          <Titulo>Hoy</Titulo>
          <SinViaje />
        </>
      );
  }
}

export default async function VistaChofer({
  searchParams,
}: {
  searchParams: Promise<{ pestana?: string }>;
}) {
  const sp = await searchParams;
  const activa = PESTANAS.find((p) => p.clave === sp?.pestana) ?? PESTANAS[0];

  // `MarcoChofer` exige una acción para su botón "Salir". Aquí NO cierra
  // sesión —te dejaría fuera de tu propia consola por tocar un preview— sino
  // que devuelve a /admin, que es la salida que esta pantalla necesita.
  async function volverAConsola() {
    'use server';
    redirect('/admin');
  }

  return (
    <main className="flex flex-col gap-3">
      <div className="glass-panel p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
            Panel del chofer
          </h1>
          <Link href="/admin" className="text-xs font-medium underline shrink-0">← Volver a mi consola</Link>
        </div>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Los componentes reales de <code className="text-xs">/chofer</code>, montados aquí porque esa ruta solo
          se le abre a un rol <code className="text-xs">operador</code>. Es el panel de un teléfono: por eso el
          marco mide lo que mide.
        </p>

        <div className="mt-3">
          <EstadoVacio icono={<Smartphone width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            No hay operadores dados de alta ni viajes en la base, así que las cuatro pantallas salen en su estado
            de &quot;todavía no hay nada&quot;. Es el estado real, no un maquetado: es lo primero que ve un chofer
            recién dado de alta.
          </EstadoVacio>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {PESTANAS.map((p) => (
            <Link key={p.clave} href={`/admin/vista-chofer?pestana=${p.clave}`}
              className="text-xs font-medium px-3 py-1.5 rounded-full hairline transition-opacity hover:opacity-70"
              style={p.clave === activa.clave
                ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
                : undefined}>
              {p.etiqueta}
            </Link>
          ))}
        </div>
      </div>

      {/* El `transform` no es decorativo: convierte esta caja en el bloque
          contenedor de los `position: fixed` de adentro (la barra de pestañas
          del chofer), que si no se pegaría al borde inferior de TODA la
          consola. Con él, el panel del teléfono se queda dentro del teléfono. */}
      <div className="preview-chofer"
        style={{
          width: 390, maxWidth: '100%', height: 760, position: 'relative',
          overflowY: 'auto', transform: 'translateZ(0)', borderRadius: 26,
          border: '1px solid var(--line)', background: 'var(--bg)',
        }}>
        {/* `nombre` va en null a propósito: no hay ningún operador en la base,
            y escribir un nombre de ejemplo en el encabezado sería inventar el
            único dato de esta pantalla. `MarcoChofer` cae solo a "Mi cuenta". */}
        <MarcoChofer nombre={null} cerrarSesion={volverAConsola} ruta={activa.ruta}>
          <Contenido clave={activa.clave} />
        </MarcoChofer>
      </div>

      {/* Las pestañas de adentro apuntan a /chofer y desde aquí rebotan: se
          miran, no se tocan. Los chips de arriba son los que cambian de
          pantalla. */}
      <style>{'.preview-chofer nav[aria-label="Secciones"] a{pointer-events:none}'}</style>
    </main>
  );
}
