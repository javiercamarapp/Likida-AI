// ═══════════════════════════════════════════════════════════════════════════
// ARQUITECTURA 25 (ALTO) — nada ata FIRMA (`revision.ts`) con TIMBRA
// (`auth/permisos.ts`), y la suite entera se quedaba verde si se separaban.
//
// Los dos conjuntos existen por la MISMA razón, escrita en los dos archivos:
// firmar una liquidación autoriza un pago al chofer y timbrar emite el CFDI
// que fija el ingreso declarado del viaje — «el DUEÑO y el CONTADOR, sí; el
// ENCARGADO no» (`revision.ts:36-38`, citando literalmente a `puedeTimbrar`).
// Hasta hoy ninguna prueba comparaba los dos `Set`: durante la auditoría 25 el
// árbol de trabajo tuvo transitoriamente un cuarto miembro en FIRMA
// (`encargado`) y 168 pruebas de los dos archivos pasaron sin que ninguna lo
// notara.
//
// Esta prueba no impone que los dos conjuntos sean iguales para siempre — el
// día que un negocio real distinga «quién firma dinero» de «quién timbra»,
// alguien va a tener que decidirlo a propósito. Lo que hace es que ESE día no
// pueda pasar en silencio: si `puedeFirmarLiquidacion` y `puedeTimbrar`
// contestan distinto para el mismo rol, esta prueba se pone roja y hay que
// tocarla (y sus comentarios) a la vez que se toca el permiso.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { puedeFirmarLiquidacion } from './revision';
import { puedeTimbrar } from '@/lib/auth/permisos';

// El dominio completo de `app_user.rol` (`RolAppUser` en `auth/provisionar.ts`)
// más un valor desconocido, para probar el fail-closed de los dos lados.
const ROLES = ['superadmin', 'flota_admin', 'contador', 'encargado', 'vendedor', 'operador', ''] as const;

describe('ARQ-25 · quién firma dinero y quién timbra CFDI son, hoy, EL MISMO conjunto', () => {
  it.each(ROLES)('puedeFirmarLiquidacion(%s) === puedeTimbrar(%s)', (rol) => {
    expect(puedeFirmarLiquidacion(rol), `revision.ts y permisos.ts divergieron para el rol "${rol}": si es a propósito, actualiza esta prueba Y los comentarios de los dos archivos que se citan mutuamente.`)
      .toBe(puedeTimbrar(rol));
  });
});
