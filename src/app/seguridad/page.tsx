import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, Lock, EyeOff, FileCheck2, Scale, FlaskConical } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Seguridad — Likida',
  description: 'Cómo Likida aísla, protege y verifica los datos de cada flota.',
};

/**
 * /seguridad (F7 del plan — el patrón de Handle de vender con la página de
 * seguridad). REGLA DURA: aquí solo se afirma lo que el código y la base
 * HACEN hoy — nada de certificaciones que no se tienen ni promesas en
 * futuro. Cada afirmación es rastreable a un mecanismo del repo.
 */
export default function PaginaSeguridad() {
  const bloques = [
    {
      Icono: Lock,
      titulo: 'Cada flota vive aislada',
      texto: 'La base de datos niega el acceso por default (políticas de seguridad a nivel de fila) y cada consulta del servidor filtra explícitamente por la flota de la sesión. Toda acción del panel re-verifica sesión, rol y flota en el servidor — no en la pantalla.',
    },
    {
      Icono: ShieldCheck,
      titulo: 'La IA no decide sobre tus datos',
      texto: 'El modelo de lenguaje decide cuándo actuar, nunca con qué datos: los identificadores salen siempre del servidor. Y una guardia determinística compara cada cifra que la IA quiere decir contra lo que el motor calculó — si no coinciden, gana el motor o no se manda nada.',
    },
    {
      Icono: FileCheck2,
      titulo: 'Un efecto, una sola vez',
      texto: 'Los mensajes, avisos y cobros se reclaman en la base con candados de unicidad ANTES de ejecutarse: aunque dos procesos corran al mismo tiempo, el chofer recibe un solo mensaje y el registro queda una sola vez.',
    },
    {
      Icono: EyeOff,
      titulo: 'Los datos personales, con base legal',
      texto: 'Ningún comprobante se procesa antes de poner el aviso de privacidad a disposición del operador, con constancia de entrega y versión. Los derechos ARCO se ejercen desde el producto, y las fotos de comprobantes no se exhiben a humanos sin base legal para ello.',
    },
    {
      Icono: Scale,
      titulo: 'Lo fiscal, bajo candado',
      texto: 'La emisión de comprobantes fiscales vive detrás de un candado legal: no se enciende sin el mandato del cliente aceptado. Las reglas fiscales que el producto aplica citan su norma, y lo que la norma no sostiene, la pantalla no lo afirma.',
    },
    {
      Icono: FlaskConical,
      titulo: 'Verificado, no supuesto',
      texto: 'Más de 3,000 pruebas automáticas corren sobre el código, cada migración de la base deja su verificación con corrida real anotada, y el producto se audita por dentro con un tablero de hallazgos que se corrigen con prueba propia.',
    },
  ];

  return (
    <main className="min-h-dvh px-6 py-16" style={{ background: 'var(--canvas, #fff)' }}>
      <div className="mx-auto max-w-3xl">
        <p className="etiqueta-mono text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted, #666)' }}>
          Seguridad
        </p>
        <h1 className="font-display text-3xl font-semibold mt-2 tracking-tight">
          Los datos de tu flota, tratados como dinero — porque lo son
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--muted, #555)' }}>
          Esta página dice lo que Likida hace hoy, mecanismo por mecanismo. Sin siglas
          decorativas: cada afirmación es rastreable al código y a la base de datos.
        </p>

        <div className="mt-10 space-y-6">
          {bloques.map((b) => (
            <section key={b.titulo} className="flex items-start gap-4">
              <b.Icono width={20} height={20} strokeWidth={1.75} className="mt-1 shrink-0" style={{ color: 'var(--marca, #111)' }} />
              <div>
                <h2 className="font-display text-[16px] font-semibold">{b.titulo}</h2>
                <p className="mt-1 text-[14px] leading-relaxed" style={{ color: 'var(--muted, #555)' }}>{b.texto}</p>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 text-[13px]" style={{ color: 'var(--muted, #666)' }}>
          ¿Preguntas de seguridad o privacidad? Escríbenos — y para el detalle del tratamiento
          de datos personales, el <Link href="/privacidad" className="underline">aviso de privacidad</Link>.
        </p>
      </div>
    </main>
  );
}
