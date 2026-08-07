import { notFound } from 'next/navigation';
import { getDatosResponsable } from '@/lib/likida/repo';
import { avisoIntegral } from '@/lib/likida/privacidad';
import { fechaMx } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO INTEGRAL DE UNA FLOTA. Página PÚBLICA, y tiene que serlo.
//
// El art. 16 fr. II obliga a "señalar el sitio donde se podrá consultar el aviso
// integral". El operador la abre desde WhatsApp, en el celular, probablemente
// con mala señal: sin sesión, sin JavaScript necesario, sin imágenes.
//
// ── QUÉ SE EXPONE, Y POR QUÉ NO ES UNA FUGA ───────────────────────────────
//
// La URL lleva el `tenant_id` en claro. Se revisó antes de escribirla:
//
//   · Ninguna ruta de la app acepta un tenant del cliente. El webhook lo resuelve
//     por teléfono y las de export lo leen de `DEMO_TENANT_ID`. O sea que el id
//     no es una capacidad: tenerlo no abre nada.
//   · Esta página devuelve razón social, domicilio y —si está— el contacto de
//     privacidad. Los dos primeros ya se los manda el aviso simplificado por
//     WhatsApp a cada operador, así que no hay información nueva.
//   · El id del tenant demo lleva meses en `seed.sql`, en un repo público.
//
// Lo que NO puede pasar de aquí: cualquier otra columna de `tenant`. El RFC, el
// plan y la config no tienen nada que hacer en un aviso de privacidad, y
// `getDatosResponsable` no los trae.
//
// `notFound()` ante un id desconocido, sin distinguir "no existe" de "está a
// medias": una página que respondiera distinto según el caso convertiría esta
// ruta en un detector de qué flotas están dadas de alta.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Aviso de privacidad',
  // El integral es público por obligación legal, pero no es contenido que deba
  // rankear: es un documento dirigido a quien ya recibió la liga.
  robots: { index: false, follow: false },
};

/** Negritas de `**así**` sin traer un parser de Markdown a una página estática. */
function ConNegritas({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*\*[^*]+\*\*)/g).map((t, i) =>
        t.startsWith('**') && t.endsWith('**')
          ? <strong key={i} className="font-semibold" style={{ color: 'var(--ink)' }}>{t.slice(2, -2)}</strong>
          : <span key={i}>{t}</span>,
      )}
    </>
  );
}

export default async function AvisoIntegral({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;

  // Un id que ni siquiera tiene forma de UUID no llega a consultar la base: es
  // ruido de un rastreador, y `maybeSingle` con un uuid inválido devuelve error
  // de Postgres, no `null` — se leería como una caída.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) notFound();

  const datos = await getDatosResponsable(tenant);
  // `null` también cuando la flota existe pero le falta razón social o
  // domicilio: un aviso sin responsable no dice a quién reclamarle, que es
  // justamente para lo que sirve. Mejor 404 que un documento a medias que
  // aparente cumplimiento.
  if (!datos) notFound();

  const secciones = avisoIntegral(datos);
  const pendientes = secciones.filter((s) => s.pendiente);

  return (
    // LOS COLORES SALEN DEL SISTEMA (`--ink`, `--muted`, `--line`), no de una
    // paleta fija. La primera versión usaba `text-neutral-900` y en un teléfono
    // en modo oscuro los títulos quedaban casi invisibles sobre el fondo: negro
    // sobre negro. `globals.css` ya invierte estas variables con
    // `prefers-color-scheme`, y este documento es justo el que se abre de noche,
    // desde la cabina, con el celular en oscuro.
    <main
      className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed"
      style={{ color: 'var(--muted)' }}
    >
      <header className="pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Aviso de privacidad integral
        </p>
        {/* `break-words`: una razón social larga no puede empujar la página a lo
            ancho. En un teléfono eso deja scroll horizontal en TODO el documento. */}
        <h1 className="mt-2 text-2xl font-semibold break-words" style={{ color: 'var(--ink)' }}>
          {datos.razonSocial}
        </h1>
        <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
          Vigente al {fechaMx(new Date().toISOString())} · Ley Federal de Protección de
          Datos Personales en Posesión de los Particulares
        </p>
      </header>

      {pendientes.length > 0 && (
        // Visible para el titular, no escondido en un log. Si la flota no ha
        // designado a su responsable de datos, quien lee el aviso tiene derecho
        // a saber que ese hueco existe: es la diferencia entre un aviso
        // incompleto y uno que finge estar completo.
        <p
          className="mt-6 rounded-md px-4 py-3 text-sm"
          style={{ border: '1px solid var(--color-warn)', color: 'var(--ink)' }}
        >
          Este aviso tiene {pendientes.length === 1 ? 'un dato' : `${pendientes.length} datos`} que
          la empresa aún no ha capturado. Aparece señalado más abajo en vez de quedar en blanco.
        </p>
      )}

      {secciones.map((s) => (
        <section key={s.titulo} className="mt-8">
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{s.titulo}</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{s.fundamento}</p>
          {s.pendiente && (
            <p className="mt-2 text-xs font-medium" style={{ color: 'var(--color-warn)' }}>
              Pendiente de capturar
            </p>
          )}
          {s.parrafos.map((p, i) => (
            <p key={i} className="mt-3">
              <ConNegritas texto={p} />
            </p>
          ))}
        </section>
      ))}

      <footer className="mt-12 pt-6 text-sm" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}>
        <p>
          La herramienta con la que se procesan estos datos la opera{' '}
          <strong style={{ color: 'var(--ink)' }}>Likida</strong> como persona encargada, por cuenta
          y bajo instrucciones de {datos.razonSocial}. Este aviso está alojado aquí por encargo de
          la empresa; la responsable de tus datos sigue siendo ella.
        </p>
      </footer>
    </main>
  );
}
