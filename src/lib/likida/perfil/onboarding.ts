import type { DatosOnboarding } from './preguntas';
import { declararOnboarding } from './preguntas';

/** Interpreta un select de sí/no. Vacío = no declarado (no se inventa un no). */
export function siNo(v: string): boolean | undefined {
  if (v === 'si') return true;
  if (v === 'no') return false;
  return undefined;
}

export function parseOnboarding(fd: {
  get(name: string): FormDataEntryValue | null;
}): { ok: true; datos: DatosOnboarding } | { ok: false; error: string } {
  const ingresos = String(fd.get('ingresos') ?? '');
  const parte = String(fd.get('parte') ?? '');
  if (ingresos !== 'menor' && ingresos !== 'mayor') {
    return { ok: false, error: 'Falta decir si los ingresos del último ejercicio fueron menores a $300 millones.' };
  }
  if (parte !== 'si' && parte !== 'no') {
    return { ok: false, error: 'Falta decir si la flota es parte relacionada (LISR art. 179).' };
  }

  const pago = String(fd.get('pagoOperador') ?? '');
  const pagoOperador = pago === 'viaje' || pago === 'km' || pago === 'sueldo' ? pago : undefined;

  const limpio = (k: string): string | undefined => {
    const t = String(fd.get(k) ?? '').trim();
    return t === '' ? undefined : t;
  };

  return {
    ok: true,
    datos: {
      ingresosMenoresA300M: ingresos === 'menor',
      parteRelacionada: parte === 'si',
      dedicacionExclusivaCarga: siNo(String(fd.get('dedicacion') ?? '')),
      regimenElegible: siNo(String(fd.get('regimen') ?? '')),
      transporteDedicado: siNo(String(fd.get('dedicado') ?? '')),
      hombreCamion: siNo(String(fd.get('hombreCamion') ?? '')),
      gps: limpio('gps'),
      erp: limpio('erp'),
      tag: limpio('tag'),
      monedero: limpio('monedero'),
      stackOtro: limpio('stackOtro'),
      pagoOperador,
      tanquePropio: siNo(String(fd.get('tanquePropio') ?? '')),
    },
  };
}

export function patchOnboarding(datos: DatosOnboarding): Record<string, unknown> {
  return declararOnboarding(datos);
}
