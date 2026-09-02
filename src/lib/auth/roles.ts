// ═══════════════════════════════════════════════════════════════════════════
// LOS RÓTULOS DE LOS ROLES — UNA sola fuente (auditoría 24, H18 / ADM-7).
//
// Había CUATRO copias del nombre y la descripción de cada rol, y no decían lo
// mismo: `dashboard/usuarios/vista.tsx` describía al contador como «solo
// lectura de lo fiscal»; `admin/usuarios/nuevo` decía que el encargado
// «exporta, sin facturación»; `mi-perfil` lo llamaba «Dueño / Admin de
// flota» y `aviso-rol.tsx` «Dueño de la flota». Un rótulo que cambia según
// la pantalla se lee como dos roles distintos.
//
// Este módulo NO importa nada a propósito: lo consumen Client Components
// (`aviso-rol.tsx`, las formas) y arrastrar `errores.ts` → `logger` al bundle
// del navegador era justo lo que `forma.tsx` de usuarios evitaba con un
// `import type`. Lo que cada rol PUEDE hacer lo deciden `visibilidad.ts` y
// `permisos.ts`; aquí solo vive cómo se le llama y cómo se resume eso.
// ═══════════════════════════════════════════════════════════════════════════

export interface RotuloRol {
  /** Cómo se le llama en pantalla. */
  nombre: string;
  /** Qué ve y qué no — la verdad de `AREAS_POR_ROL`, en una línea. */
  detalle: string;
}

export const ROTULOS_ROL: Record<string, RotuloRol> = {
  flota_admin: {
    nombre: 'Dueño de la flota',
    detalle: 'Todo el panel: operación, dinero y la administración de la cuenta — incluido invitar y las llaves de API.',
  },
  contador: {
    nombre: 'Contador',
    detalle: 'Ve el dinero y lo fiscal — facturación, cobranza, clientes y tarifas — y puede exportar. No despacha viajes.',
  },
  encargado: {
    nombre: 'Encargado (jefe de tráfico)',
    detalle: 'Despacha y da seguimiento: viajes, operadores, unidades y mapa. No ve un peso — ni tarifas, ni facturación, ni rentabilidad.',
  },
  operador: {
    nombre: 'Operador (chofer)',
    detalle: 'No entra a este panel: habla con el bot por WhatsApp.',
  },
  superadmin: {
    nombre: 'Superadmin (Likida)',
    detalle: 'Personal de Likida — no pertenece a la flota.',
  },
  vendedor: {
    nombre: 'Vendedor (Likida)',
    detalle: 'Personal de ventas de Likida — su panel es /vendedor, no este.',
  },
};

/** El nombre en pantalla de un rol; un rol fuera del catálogo se enseña tal
 *  cual (nunca se inventa un nombre bonito para algo que la base no conoce). */
export function nombreDeRol(rol: string): string {
  return ROTULOS_ROL[rol]?.nombre ?? rol;
}

/** La descripción, o una verdad honesta cuando el rol no está en el catálogo. */
export function detalleDeRol(rol: string): string {
  return ROTULOS_ROL[rol]?.detalle ?? 'Rol sin descripción en el catálogo.';
}
