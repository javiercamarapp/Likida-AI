import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 13, seguridad, MEDIO — el avatar del superadmin subía SIN
// candado de tipo ni de peso.
//
// `dashboard/mi-perfil/page.tsx` (el panel del CLIENTE) ya tenía la puerta
// completa, con el motivo escrito: el bucket `avatares` es PÚBLICO, y un
// `.svg` puede traer script adentro — servirlo desde nuestro dominio sería
// XSS almacenado. `admin/mi-perfil/page.tsx` (el panel de Javier) escribía al
// MISMO bucket público con la MISMA server action, pero derivaba la
// extensión del NOMBRE del archivo (`archivo.name.split('.').pop()`, del
// cliente) en vez de un tipo validado, y no comprobaba el peso — solo que no
// viniera vacío.
//
// El alcance real es acotado (`requireSuperadmin()` sigue gateando la
// ruta: solo Javier la dispara hoy), pero es la MISMA clase de hueco que la
// versión del cliente ya cerró con su propio comentario de seguridad, y
// dejarlo abierto aquí es la puerta de repuesto si esa cuenta se
// comprometiera. Esta prueba lee el código fuente y falla si el candado
// vuelve a faltar — mismo patrón que `dashboard/foto_no_expuesta.test.ts`
// para algo que no se presta a extraerse como función pura (la lógica vive
// dentro de una Server Action inline en el Server Component).
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

describe('admin/mi-perfil: el avatar del superadmin valida tipo y peso antes de subir', () => {
  it('define la lista blanca de tipos de imagen', () => {
    expect(PAGINA).toMatch(/const TIPOS = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
  });

  it('define un tope de bytes', () => {
    expect(PAGINA).toMatch(/const TOPE_BYTES = 2 \* 1024 \* 1024/);
  });

  it('la server action de subida comprueba TIPOS antes de escribir a storage', () => {
    const subida = PAGINA.slice(PAGINA.indexOf('async function subirAvatar'), PAGINA.indexOf('async function subirAvatar') + 1200);
    const posTipo = subida.indexOf('TIPOS.has(archivo.type)');
    const posUpload = subida.indexOf('.storage.from(');
    expect(posTipo).toBeGreaterThan(-1);
    expect(posUpload).toBeGreaterThan(-1);
    expect(posTipo).toBeLessThan(posUpload);
  });

  it('la server action de subida comprueba TOPE_BYTES antes de escribir a storage', () => {
    const subida = PAGINA.slice(PAGINA.indexOf('async function subirAvatar'), PAGINA.indexOf('async function subirAvatar') + 1200);
    const posPeso = subida.indexOf('archivo.size > TOPE_BYTES');
    const posUpload = subida.indexOf('.storage.from(');
    expect(posPeso).toBeGreaterThan(-1);
    expect(posPeso).toBeLessThan(posUpload);
  });

  it('la extensión sale del tipo validado, no del nombre del archivo que manda el cliente', () => {
    expect(PAGINA).not.toMatch(/archivo\.name\.split\('\.'\)\.pop\(\)/);
    expect(PAGINA).toMatch(/archivo\.type === 'image\/png' \? 'png' : archivo\.type === 'image\/webp' \? 'webp' : 'jpg'/);
  });
});
