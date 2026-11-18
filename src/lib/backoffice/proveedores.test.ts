import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba es pura'); } }));

import { ErrorBo } from './utiles-c';
import { PROVEEDORES_SUGERIDOS, sugeridosFaltantes, validarProveedor } from './proveedores';

describe('proveedores', () => {
  it('los sugeridos son los fijos conocidos y NINGUNO trae monto', () => {
    expect(PROVEEDORES_SUGERIDOS.map((p) => p.nombre)).toEqual(['Vercel', 'Supabase', 'Resend', 'Sentry', 'Dominio', 'Claude Code', 'Facturapi', 'Mifiel', 'WhatsApp / Meta']);
    for (const p of PROVEEDORES_SUGERIDOS) expect(Object.keys(p).sort()).toEqual(['cadencia', 'categoria', 'nombre']);
  });

  it('sugeridosFaltantes compara sin acentos ni mayúsculas', () => {
    expect(sugeridosFaltantes([{ nombre: 'VERCEL' }, { nombre: ' mifiel ' }]).map((s) => s.nombre)).not.toContain('Vercel');
    expect(sugeridosFaltantes([]).length).toBe(PROVEEDORES_SUGERIDOS.length);
  });

  it('valida: nombre obligatorio, RFC opcional pero con formato, categoría y cadencia del catálogo', () => {
    expect(validarProveedor({ nombre: ' Vercel ' })).toMatchObject({ nombre: 'Vercel', rfc: null, categoria: 'otro', cadencia: 'mensual' });
    expect(validarProveedor({ nombre: 'Proveedor', rfc: 'abc010101aa1' }).rfc).toBe('ABC010101AA1');
    for (const malo of [{ nombre: '  ' }, { nombre: 'X', rfc: 'ABC123' }, { nombre: 'X', categoria: 'inventada' }, { nombre: 'X', cadencia: 'cada luna' }]) {
      expect(() => validarProveedor(malo)).toThrow(ErrorBo);
    }
  });
});
