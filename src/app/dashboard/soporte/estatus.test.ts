import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ESTADOS_TICKET } from '@/lib/likida/soporte';
import { PILL_TICKET, pillTicket } from './estatus';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21 (frontend, MEDIO 1): EL ESTADO DEL TICKET LLEGABA CRUDO AL
// PANEL DEL CLIENTE.
//
// `/admin/soporte` tenía su `PILL_TICKET` privado y traducía bien;
// `/dashboard/soporte` imprimía `{t.estado}` tal cual — el flota_admin veía
// "en_proceso", con el guion bajo, en la columna Estado de su bandeja de
// quejas. Esta prueba fija dos cosas: que el mapa compartido traduce TODO el
// dominio de la 0051 (ningún estado conocido puede salir crudo), y que las
// DOS páginas de verdad lo usan (leyendo su fuente, como
// `etiquetas_panel.test.ts`) — porque el bug no fue que faltara el mapa, fue
// que una pantalla no lo importaba.
// ═══════════════════════════════════════════════════════════════════════════

describe('pillTicket — el mapa compartido de estados de ticket', () => {
  it('traduce cada estado del dominio de la 0051 — ninguno sale crudo', () => {
    for (const estado of ESTADOS_TICKET) {
      const pill = pillTicket(estado);
      // La etiqueta es un rótulo humano, no la clave de base: sin guion bajo
      // y con mayúscula inicial.
      expect(pill.etiqueta, `el estado '${estado}' salió crudo`).not.toBe(estado);
      expect(pill.etiqueta).not.toContain('_');
      expect(pill.etiqueta[0]).toBe(pill.etiqueta[0].toUpperCase());
    }
  });

  it("el caso que reportó la auditoría: 'en_proceso' se lee 'En proceso', no 'en_proceso'", () => {
    expect(pillTicket('en_proceso')).toEqual({ estado: 'warn', etiqueta: 'En proceso' });
  });

  it('el mapa cubre exactamente el dominio — un estado nuevo sin rótulo no compila y no se cuela aquí', () => {
    // `Record<EstadoTicket, …>` ya lo exige en compilación; esto vigila que
    // nadie relaje el tipo a `Record<string, …>` y deje huecos en runtime.
    expect(Object.keys(PILL_TICKET).sort()).toEqual([...ESTADOS_TICKET].sort());
  });

  it('un valor fuera del dominio degrada con seguridad: clave cruda en neutro, nunca inventada', () => {
    expect(pillTicket('archivado')).toEqual({ estado: 'neutral', etiqueta: 'archivado' });
  });
});

describe('las dos pantallas de soporte usan el mapa compartido', () => {
  const fuenteCliente = readFileSync('src/app/dashboard/soporte/page.tsx', 'utf8');
  const fuenteAdmin = readFileSync('src/app/admin/soporte/page.tsx', 'utf8');

  it('/dashboard/soporte traduce con pillTicket y ya no imprime t.estado dentro del pill', () => {
    expect(fuenteCliente, 'el panel del cliente dejó de usar el mapa compartido').toContain('pillTicket(');
    expect(fuenteCliente, 'volvió el estado crudo al pill del cliente').not.toMatch(/StatusPill[^>]*>\s*\{t\.estado\}/);
  });

  it('/admin/soporte importa el mismo mapa en vez de mantener una copia privada', () => {
    expect(fuenteAdmin).toContain('pillTicket(');
    expect(fuenteAdmin, 'reapareció un PILL_TICKET privado en /admin/soporte').not.toMatch(/const PILL_TICKET/);
  });
});
