import { notFound } from 'next/navigation';
import { getDatosResponsable } from '@/lib/likida/repo';
import { avisoIntegral } from '@/lib/likida/privacidad';
import { fechaMx } from '@/lib/formato';
import { MarcoPublico } from '../../ui-v2/componentes/marco-publico';

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

/** LEG-12: la fecha del último cambio sustantivo de `avisoIntegral()`, no la
 *  fecha en que alguien abre la página. Actualizar junto con el texto. */
const VIGENTE_DESDE = '2026-09-01';

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
          ? <strong key={i}>{t.slice(2, -2)}</strong>
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
  // `null` SOLO cuando la flota no existe. Ni el domicilio (auditoría 19, legal
  // C3 / C.16) ni la RAZÓN SOCIAL (auditoría ola 1, #10) tumban ya la página: la
  // sección de la fr. I se pinta como pendiente —igual que el contacto del art. 29—
  // y nombra a la flota por su nombre de alta, porque un aviso que dice qué le
  // falta cumple más que un 404 mudo que deja al operador sin documento por un
  // dato que le toca capturar a su empresa.
  if (!datos) notFound();
  const nombreResponsable = datos.razonSocial || datos.nombreFlota || 'la empresa';

  const secciones = avisoIntegral(datos);
  const pendientes = secciones.filter((s) => s.pendiente);

  return (
    <MarcoPublico
      rotulo="Aviso de privacidad integral"
      titulo={nombreResponsable}
      apoyo={`Vigente desde el ${fechaMx(VIGENTE_DESDE)} · Ley Federal de Protección de Datos Personales en Posesión de los Particulares`}
      pie={
        <p>
          La herramienta con la que se procesan estos datos la opera <strong>Likida</strong> como persona encargada, por
          cuenta y bajo instrucciones de {nombreResponsable}. Este aviso está alojado aquí por encargo de la empresa; la
          responsable de tus datos sigue siendo ella.
        </p>
      }
    >
      {pendientes.length > 0 && (
        <p className="rv-pub__aviso-falta">
          Este aviso tiene {pendientes.length === 1 ? 'un dato' : `${pendientes.length} datos`} que
          la empresa aún no ha capturado. Aparece señalado más abajo en vez de quedar en blanco.
        </p>
      )}

      <div className="rv-pub__prosa">
        {secciones.map((s) => (
          <section key={s.titulo} className="rv-pub__sec">
            <h2>{s.titulo}</h2>
            <p className="rv-pub__nota">{s.fundamento}</p>
            {s.pendiente && <p className="rv-pub__nota"><strong>Pendiente de capturar</strong></p>}
            {s.parrafos.map((p, i) => (
              <p key={i}><ConNegritas texto={p} /></p>
            ))}
          </section>
        ))}
      </div>
    </MarcoPublico>
  );
}
