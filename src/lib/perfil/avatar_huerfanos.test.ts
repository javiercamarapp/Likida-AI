import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { rutasAvatarObsoletas, descartarAvataresViejos } from './avatar_huerfanos';

describe('A37-S07-06 — avatares huérfanos al cambiar de extensión', () => {
  it('las rutas obsoletas son las otras dos extensiones del mismo usuario', () => {
    expect(rutasAvatarObsoletas('u1', 'jpg')).toEqual(['u1/avatar.png', 'u1/avatar.webp']);
    expect(rutasAvatarObsoletas('u1', 'png')).toEqual(['u1/avatar.jpg', 'u1/avatar.webp']);
  });

  it('borra del bucket avatares y no lanza si Storage falla', async () => {
    const remove = vi.fn(async () => { throw new Error('caído'); });
    const from = vi.fn(() => ({ remove }));
    await expect(descartarAvataresViejos({ storage: { from } }, 'u1', 'webp')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('avatares');
    expect(remove).toHaveBeenCalledWith(['u1/avatar.jpg', 'u1/avatar.png']);
  });

  for (const ruta of ['../../app/admin/mi-perfil/page.tsx', '../../app/dashboard/mi-perfil/page.tsx']) {
    it(`${ruta.split('/')[3]}: tras guardar avatar_url (no antes) retira los avatares viejos`, () => {
      const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
      const iUpdate = src.search(/avatar_url: `\$\{pub\.publicUrl\}/);
      const iLimpia = src.indexOf('descartarAvataresViejos(');
      expect(iUpdate).toBeGreaterThan(-1);
      expect(iLimpia).toBeGreaterThan(iUpdate);
    });
  }
});
