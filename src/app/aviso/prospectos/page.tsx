import { PaginaLegal, FaltaDato, type SeccionLegal } from '../../legal/marco';
import { avisoProspectos } from '@/lib/likida/privacidad';
import { LEGAL_CONFIG } from '@/lib/legal/config';
import { trPublico } from '@/lib/i18n/publico_tr';
import { rico } from '@/lib/i18n/rico';

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

export async function generateMetadata() {
  const { t } = await trPublico();
  return { title: t('av.prospectos.meta.titulo'), description: t('av.prospectos.meta.descripcion') };
}

const RESPONSABLE = {
  razonSocial: LEGAL_CONFIG.razonSocial,
  domicilio: LEGAL_CONFIG.domicilio,
  contacto: LEGAL_CONFIG.contacto,
};

// LEGAL: la interfaz en inglés está pendiente de revisión legal; el cuerpo (avisoProspectos) no se traduce aquí.
export default async function AvisoProspectos() {
  const { t } = await trPublico();
  const secciones: SeccionLegal[] = avisoProspectos(RESPONSABLE).map((s) => ({
    titulo: s.titulo, fundamento: s.fundamento, parrafos: s.parrafos,
  }));
  const faltan = !RESPONSABLE.razonSocial || !RESPONSABLE.domicilio;

  return (
    <PaginaLegal
      etiqueta={t('av.prospectos.etiqueta')}
      bajada={t('av.prospectos.bajada')}
      // LEG-12: fecha del último cambio SUSTANTIVO del texto de este aviso
      // (LEG-4, auditoría 24), no la fecha en que alguien lo abre.
      vigenteDesde="2026-09-01"
      secciones={secciones}
      aviso={faltan ? (
        <FaltaDato>{t('av.prospectos.faltan')}</FaltaDato>
      ) : undefined}
      pie={<p>{rico(t('av.prospectos.pie'), { strong: (c) => <strong>{c}</strong> })}</p>}
    />
  );
}
