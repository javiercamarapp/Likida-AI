import type { Metadata } from 'next';
import Link from 'next/link';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { ShieldCheck, Lock, EyeOff, FileCheck2, Scale, FlaskConical, KeyRound } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Seguridad — Likida',
  description: 'Cómo Likida aísla, protege y verifica los datos de cada flota.',
};

/**
 * /seguridad (F7 del plan — el patrón de vender con la página de
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
      Icono: KeyRound,
      titulo: 'Tus credenciales, cifradas y de ida',
      texto: 'Si conectas tu ERP, tu GPS o tus monederos de peaje, las credenciales se guardan cifradas (AES-256-GCM) con una llave que no vive en la base de datos. Nunca se muestran de vuelta — ni en pantalla ni en soporte: solo se enseñan pistas parciales para que sepas cuál guardaste. Desactivarlas desde el panel corta el acceso.',
    },
    {
      Icono: FlaskConical,
      titulo: 'Verificado, no supuesto',
      texto: 'Más de 3,000 pruebas automáticas corren sobre el código, cada migración de la base deja su verificación con corrida real anotada, y el producto se audita por dentro con un tablero de hallazgos que se corrigen con prueba propia.',
    },
  ];

  return (
    <MarcoPublico
      rotulo="Seguridad"
      titulo="Los datos de tu flota, tratados como dinero — porque lo son"
      apoyo="Esta página dice lo que Likida hace hoy, mecanismo por mecanismo. Sin siglas decorativas: cada afirmación es rastreable al código y a la base de datos."
    >
      <ul className="rv-pub__lista rv-pub__sec">
        {bloques.map((b) => (
          <li key={b.titulo} className="rv-pub__item">
            <b.Icono width={20} height={20} strokeWidth={1.75} aria-hidden="true" />
            <section>
              <h2>{b.titulo}</h2>
              <p>{b.texto}</p>
            </section>
          </li>
        ))}
      </ul>

      <p className="rv-pub__prosa rv-pub__sec">
        ¿Preguntas de seguridad o privacidad? Escríbenos — y para el detalle del tratamiento de datos personales, el{' '}
        <Link href="/privacidad">aviso de privacidad</Link>.
      </p>
    </MarcoPublico>
  );
}
