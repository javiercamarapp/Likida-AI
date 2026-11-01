import type { Recorrido } from '@/app/ui-v2/movimiento/tour';
import { menuPorPerfil } from '../shell/menu-por-perfil';
import { asistenteDe } from '@/lib/onboarding/asistente';
import { AGENTES, construirRecorridoAgente } from '@/lib/onboarding/agentes';
import { PISTAS_CONTEXTUALES } from '@/lib/onboarding/pantallas';
import { pistaDeRol } from '@/lib/onboarding/roles';
import { construirRecorrido } from '@/lib/onboarding/tour';
import type { PistaContextual } from '@/lib/onboarding/tipos';
import { puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL LAYOUT LE ENTREGA AL MOTOR DEL RECORRIDO, calculado en el servidor para ESTE rol y ESTE perfil:
//   · el recorrido corto y el completo de su pista (derivados del menú real),
//   · un recorrido corto por cada agente que ve (solo en flotas con los cinco agentes),
//   · las pistas contextuales de las subpantallas que puede abrir,
//   · el asistente de configuración que le corresponde.
// Todo son DATOS serializables. El rol no gana ningún acceso: cada ruta se vuelve a filtrar con `puedeVerRuta`.
// ═══════════════════════════════════════════════════════════════════════════

export interface OnboardingDeLaSesion {
  recorridos: Recorrido[];
  principal: string | null;
  asistente: { href: string; nombre: string } | null;
  pistas: Record<string, PistaContextual>;
  rutas: string[];
}

export function onboardingDeLaSesion(rol: string, perfil: PerfilTenant | null | undefined): OnboardingDeLaSesion {
  const pista = pistaDeRol(rol);
  const vacio: OnboardingDeLaSesion = { recorridos: [], principal: null, asistente: null, pistas: {}, rutas: [] };
  if (!pista) return vacio;
  const corto = construirRecorrido(rol, perfil, 'corto');
  const completo = construirRecorrido(rol, perfil, 'completo');
  if (!corto || !completo) return vacio;
  const agentes = AGENTES.map((a) => construirRecorridoAgente(a, rol, perfil)).filter((r): r is Recorrido => r !== null);
  const recorridos = [corto, completo, ...agentes];

  const menu = menuPorPerfil(rol, perfil);
  const nombreDe = (href: string) => [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].find((i) => i.href === href)?.nombre;
  const pistas: Record<string, PistaContextual> = {};
  for (const [ruta, p] of Object.entries(PISTAS_CONTEXTUALES)) {
    // Una pista solo se ofrece si el rol llega a la pantalla de la que se abre y a la propia (el detalle y el borrador cuelgan de su padre).
    const propia = ruta.includes('[id]') ? true : puedeVerRuta(rol, ruta, perfil);
    const origen = nombreDe(p.desde);
    if (propia && origen && puedeVerRuta(rol, p.desde, perfil)) pistas[ruta] = { ...p, desde: origen };
  }
  const rutas = [...new Set(recorridos.flatMap((r) => r.pasos.map((p) => p.ruta).filter((x): x is string => Boolean(x))))];
  return { recorridos, principal: pista, asistente: asistenteDe(rol, perfil), pistas, rutas };
}
