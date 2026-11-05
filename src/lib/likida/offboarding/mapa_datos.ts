import type { ModuloPerfil } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// MAPA DE DATOS POR AGENTE — F9, CT-DAT-16 / CT-ENT-01.
//
// Para cada agente del perfil `cinco_agentes` (más la base común): qué tablas toca, qué categorías de datos personales contiene y a qué
// subencargados llega. Es la FUENTE de dos cosas: el paquete de exportación/offboarding de una flota (`paquete.ts`) y el documento de
// cliente `docs/enterprise/mapa-de-datos.md`, que se genera de aquí (la prueba falla si divergen).
//
// HONESTIDAD: las tablas se leyeron de las migraciones; los plazos de retención NO se declaran aquí — viven en `docs/legal/RETENCION.md`
// y su cifra final es la decisión D7 (pendiente); los subencargados salen de `docs/conocimiento/52-anexo-subencargados.md`. Lo que no se
// pudo confirmar se rotula `por_conectar`.
// ═══════════════════════════════════════════════════════════════════════════

export type CategoriaDato =
  | 'identidad_usuario' | 'identidad_operador' | 'financiero' | 'fiscal' | 'ubicacion' | 'comunicaciones' | 'jornada_laboral' | 'seguridad_auditoria' | 'operativo';

export interface EntradaMapa {
  agente: ModuloPerfil;
  nombre: string;
  /** Tablas con columna de flota que se exportan en el offboarding. */
  tablas: readonly string[];
  categorias: readonly CategoriaDato[];
  /** Subencargados por los que pasan los datos del agente (anexo 52). */
  subencargados: readonly string[];
  /** Lo que no está confirmado y por qué. */
  por_conectar?: string;
}

export const MAPA_DATOS_AGENTE: Readonly<Record<ModuloPerfil, EntradaMapa>> = {
  base: {
    agente: 'base', nombre: 'Base común (flota, equipo, auditoría)',
    tablas: ['tenant', 'app_user', 'cliente', 'unidad', 'bitacora_auditoria'],
    categorias: ['identidad_usuario', 'operativo', 'seguridad_auditoria'],
    subencargados: ['Supabase', 'Vercel', 'Sentry (solo errores redactados)', 'Resend'],
  },
  liquidacion: {
    agente: 'liquidacion', nombre: 'A1 · Liquidación',
    tablas: ['viaje', 'gasto', 'liquidacion'],
    categorias: ['financiero', 'fiscal', 'comunicaciones'],
    subencargados: ['Meta (WhatsApp)', 'OpenRouter (OCR y cuadre)', 'Supabase', 'Vercel'],
  },
  peajes: {
    agente: 'peajes', nombre: 'A2 · Peajes',
    tablas: ['peaje_curso', 'peaje_regla_flota', 'peaje_aviso_enviado'],
    categorias: ['financiero', 'operativo'],
    subencargados: ['Supabase', 'Vercel', 'Resend'],
  },
  carta_porte: {
    agente: 'carta_porte', nombre: 'A3 · Carta Porte',
    tablas: ['cp_documento', 'cp_documento_evento'],
    categorias: ['fiscal', 'operativo'],
    subencargados: ['Supabase', 'Vercel', 'PAC (proveedor de timbrado)'],
    por_conectar: 'El PAC contratado por cada flota no está identificado en el código: depende de la configuración de la flota.',
  },
  vigia: {
    agente: 'vigia', nombre: 'A4 · Vigía de servicio al cliente',
    tablas: ['vigia_evento', 'vigia_aviso', 'vigia_dato_viaje_manual'],
    categorias: ['identidad_operador', 'comunicaciones', 'operativo'],
    subencargados: ['Meta (WhatsApp)', 'Resend', 'Supabase', 'Vercel'],
  },
  conductor: {
    agente: 'conductor', nombre: 'A5 · Conductores y jornada',
    tablas: ['operador', 'jornada_dia', 'jornada_asiento', 'posicion'],
    categorias: ['identidad_operador', 'jornada_laboral', 'ubicacion'],
    subencargados: ['Meta (WhatsApp)', 'Supabase', 'Vercel', 'Proveedor de GPS de la flota'],
    por_conectar: 'El proveedor de GPS depende del conector que la flota active; no hay uno fijo.',
  },
};

/** Todas las tablas del paquete, sin repetir, en orden estable. */
export function tablasExportables(): string[] {
  return [...new Set(Object.values(MAPA_DATOS_AGENTE).flatMap((e) => e.tablas))];
}

/** Markdown del documento de cliente, generado de este mapa (no se edita a mano). */
export function mapaDeDatosMarkdown(): string {
  const filas = Object.values(MAPA_DATOS_AGENTE).map((e) =>
    `| ${e.nombre} | ${e.tablas.map((t) => `\`${t}\``).join(', ')} | ${e.categorias.join(', ')} | ${e.subencargados.join(', ')} | ${e.por_conectar ?? '-'} |`);
  return [
    '# Mapa de datos por agente',
    '',
    '> Generado de `src/lib/likida/offboarding/mapa_datos.ts`; no se edita a mano. Los plazos de retención viven en `docs/legal/RETENCION.md` (cifra final: decisión D7, pendiente). Los subencargados vienen de `docs/conocimiento/52-anexo-subencargados.md`.',
    '',
    '| Agente | Tablas | Categorías de datos | Subencargados | Por conectar |',
    '|---|---|---|---|---|',
    ...filas,
    '',
  ].join('\n');
}
