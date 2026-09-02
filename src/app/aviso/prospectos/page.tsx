import { PaginaLegal, FaltaDato, type SeccionLegal } from '../../legal/marco';
import { avisoProspectos } from '@/lib/likida/privacidad';
import { LEGAL_CONFIG } from '@/lib/legal/config';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE PRIVACIDAD PARA PROSPECTOS — Likida como RESPONSABLE.
// Auditoría 18 (C2). Página PÚBLICA: es la liga que va al pie de cada primer
// toque (mapa-prospectos/mensaje), y quien la abre es una persona que no
// tiene cuenta ni la va a tener. El texto vive en `privacidad.ts`
// (`avisoProspectos`) para que se pruebe por su contenido, como el integral.
//
// Segmento ESTÁTICO junto al dinámico `[tenant]`: Next resuelve el estático
// primero, así que `/aviso/prospectos` nunca cae al aviso de una flota.
//
// AUDITORÍA 24 (LEG-4, ALTO): esta página traía su PROPIA copia de
// `RESPONSABLE` fija en `null, null` — nunca leía `LEGAL_CONFIG`, la fuente
// única que `/privacidad` y `/terminos` sí usan. Resultado medido en
// producción: esta liga (el pie de 6,524 correos fríos y 8,598 prospectos con
// mensaje generado) mostraba «🔴 razón social pendiente 🔴» mientras
// `/privacidad`, con el mismo dato ya capturado en el entorno, mostraba la
// razón social real. Y el contacto aquí era un buzón distinto
// (`likida.ai@gmail.com`) al de `/privacidad` (`LEGAL_CONFIG.contacto`): dos
// buzones para el mismo responsable. Ahora lee `LEGAL_CONFIG` — una sola
// fuente, un solo buzón — y si de verdad faltara el dato en el entorno, el
// texto lo dice como «aviso en actualización» (ver `avisoProspectos`) en vez
// de imprimir un marcador rojo hardcodeado en un documento público.
// ═══════════════════════════════════════════════════════════════════════════

export const metadata = {
  title: 'Aviso de privacidad para contactos comerciales — Likida',
  description: 'Qué datos tiene Likida de las personas a las que contacta para ofrecer su servicio, de dónde salieron y cómo pedir que se borren.',
};

const RESPONSABLE = {
  razonSocial: LEGAL_CONFIG.razonSocial,
  domicilio: LEGAL_CONFIG.domicilio,
  contacto: LEGAL_CONFIG.contacto,
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
      // LEG-12: fecha del último cambio SUSTANTIVO del texto de este aviso
      // (LEG-4, auditoría 24), no la fecha en que alguien lo abre.
      vigenteDesde="2026-09-01"
      secciones={secciones}
      aviso={faltan ? (
        <FaltaDato>
          A este aviso le faltan datos de identidad del responsable (razón social o domicilio
          de la entidad que opera Likida). La primera sección lo señala en su texto en vez de
          dejarlo en blanco o inventarlo.
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
