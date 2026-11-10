import { numero } from '@/lib/formato';
import type { OnboardingFlota } from './onboarding';

// El arranque de una flota en SEIS casillas medibles (las que /admin/flotas ya medía, ahora en un solo lugar para la tabla —
// "Arranque n de 6"— y para la ficha). Tres estados y los tres se dicen distinto: `ok`, `pendiente` y `sin_medir` (la lectura falló:
// NO es "falta"). Una palomita sin medición sería inventada, por eso no existen casillas de lo que no se puede medir.

export type EstadoCasilla = 'ok' | 'pendiente' | 'sin_medir';

export interface CasillaArranque {
  clave: 'telefono' | 'politica' | 'credenciales' | 'avisos' | 'viaje' | 'privacidad';
  estado: EstadoCasilla;
  texto: string;
  href: string;
  accion: string;
}

export interface EntradaArranque {
  id: string;
  viajes: number;
  politicaPropia: boolean;
  /** `undefined`/`null` = la lectura de teléfonos falló. */
  telefono: string | null | undefined;
  telefonosLegibles: boolean;
  /** `null` = la lectura de onboarding falló. */
  onboarding: OnboardingFlota | null;
}

export function casillasDeArranque(e: EntradaArranque): CasillaArranque[] {
  const ob = e.onboarding;
  return [
    {
      clave: 'telefono',
      estado: !e.telefonosLegibles ? 'sin_medir' : e.telefono ? 'ok' : 'pendiente',
      texto: !e.telefonosLegibles
        ? 'Teléfono del jefe: no se pudo leer (no es que falte)'
        : e.telefono ? 'Teléfono del jefe capturado'
          : 'Sin teléfono de jefe ni de dueño: la escalación por WhatsApp no tiene a quién avisar',
      href: '/admin/usuarios/nuevo', accion: 'capturar',
    },
    {
      clave: 'politica',
      estado: e.politicaPropia ? 'ok' : 'pendiente',
      texto: e.politicaPropia ? 'Política de gastos propia guardada' : 'Sin política propia: el motor cuadra con los topes de demostración',
      href: `/dashboard/politicas?tenant=${e.id}`, accion: 'configurar',
    },
    {
      clave: 'credenciales',
      estado: ob === null ? 'sin_medir' : ob.credenciales.probadas > 0 ? 'ok' : 'pendiente',
      texto: ob === null ? 'Credenciales de conectores: no se pudo leer (no es que falten)'
        : ob.credenciales.total === 0 ? 'Sin credenciales de conectores guardadas'
          : `Credenciales de conectores: ${numero(ob.credenciales.probadas)} de ${numero(ob.credenciales.total)} probadas contra el sistema real`,
      href: `/dashboard/conexiones?tenant=${e.id}`, accion: 'conectar',
    },
    {
      clave: 'avisos',
      estado: ob === null ? 'sin_medir' : ob.avisosConfigurados > 0 ? 'ok' : 'pendiente',
      texto: ob === null ? 'Avisos de agentes: no se pudo leer (no es que falten)'
        : ob.avisosConfigurados > 0 ? `Avisos ajustados en ${numero(ob.avisosConfigurados)} ${ob.avisosConfigurados === 1 ? 'agente' : 'agentes'}`
          : 'Avisos sin ajustar: corren los valores del código (no está roto, pero nadie los decidió)',
      href: `/dashboard/agentes/liquidacion?tenant=${e.id}`, accion: 'ajustar',
    },
    {
      clave: 'viaje',
      estado: e.viajes > 0 ? 'ok' : 'pendiente',
      texto: e.viajes > 0 ? `${numero(e.viajes)} ${e.viajes === 1 ? 'viaje registrado' : 'viajes registrados'}` : 'Ni un viaje registrado todavía',
      href: `/dashboard/viajes?tenant=${e.id}`, accion: 'ver viajes',
    },
    {
      clave: 'privacidad',
      estado: ob === null ? 'sin_medir' : ob.avisoPrivacidad.razonSocial && ob.avisoPrivacidad.domicilio ? 'ok' : 'pendiente',
      texto: ob === null ? 'Aviso de privacidad: no se pudo leer (no es que falte)'
        : !ob.avisoPrivacidad.razonSocial ? 'Aviso de privacidad sin responsable: falta la razón social y sus choferes no pueden mandar comprobantes'
          : !ob.avisoPrivacidad.domicilio ? 'Aviso de privacidad incompleto: falta el domicilio fiscal'
            : 'Aviso de privacidad completo: razón social y domicilio capturados',
      href: `/dashboard/suscripcion?tenant=${e.id}`, accion: 'capturar',
    },
  ];
}

/** "n de 6" solo si las seis se midieron; con alguna sin medir devuelve `null` (la tabla pinta «—», nunca un número a medias). */
export function resumenArranque(c: readonly CasillaArranque[]): { hechas: number; total: number } | null {
  if (c.some((x) => x.estado === 'sin_medir')) return null;
  return { hechas: c.filter((x) => x.estado === 'ok').length, total: c.length };
}
