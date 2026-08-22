import { PaginaLegal, FaltaDato, type SeccionLegal } from '../../legal/marco';
import { avisoProspectos } from '@/lib/likida/privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE PRIVACIDAD PARA PROSPECTOS — Likida como RESPONSABLE.
// Auditoría 18 (C2). Página PÚBLICA: es la liga que va al pie de cada primer
// toque (mapa-prospectos/mensaje), y quien la abre es una persona que no
// tiene cuenta ni la va a tener. El texto vive en `privacidad.ts`
// (`avisoProspectos`) para que se pruebe por su contenido, como el integral.
//
// Segmento ESTÁTICO junto al dinámico `[tenant]`: Next resuelve el estático
// primero, así que `/aviso/prospectos` nunca cae al aviso de una flota.
// ═══════════════════════════════════════════════════════════════════════════

export const metadata = {
  title: 'Aviso de privacidad para contactos comerciales — Likida',
  description: 'Qué datos tiene Likida de las personas a las que contacta para ofrecer su servicio, de dónde salieron y cómo pedir que se borren.',
};

const RESPONSABLE = {
  // 🔴 PENDIENTE: los mismos dos datos que faltan en /privacidad. Hasta que
  // estén, la página lo DICE en vez de inventarlos.
  razonSocial: null as string | null,
  domicilio: null as string | null,
  contacto: 'likida.ai@gmail.com',
};

export default function AvisoProspectos() {
  const secciones: SeccionLegal[] = avisoProspectos(RESPONSABLE).map((s) => ({
    titulo: s.titulo, fundamento: s.fundamento, parrafos: s.parrafos,
  }));
  const faltan = !RESPONSABLE.razonSocial || !RESPONSABLE.domicilio;

  return (
    <PaginaLegal
      etiqueta="Aviso de privacidad · contactos comerciales"
      bajada="Ley Federal de Protección de Datos Personales en Posesión de los Particulares"
      secciones={secciones}
      aviso={faltan ? (
        <FaltaDato>
          Falta capturar la razón social y el domicilio fiscal de la empresa que opera Likida.
          Aparece señalado en vez de quedar en blanco.
        </FaltaDato>
      ) : undefined}
      pie={
        <p>
          ¿Ya eres cliente de Likida? Tu aviso es la política de privacidad en{' '}
          <strong style={{ color: 'var(--ink)' }}>/privacidad</strong>. ¿Eres operador de una
          flota? El tuyo lo publica tu empresa: escribe{' '}
          <strong style={{ color: 'var(--ink)' }}>PRIVACIDAD</strong> por el chat de WhatsApp.
        </p>
      }
    />
  );
}
