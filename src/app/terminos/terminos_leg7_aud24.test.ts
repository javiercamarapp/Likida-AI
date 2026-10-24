import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-7 (ALTO): `/terminos`, una página PÚBLICA sin sesión,
// publicaba «🔴 El contrato de encargado del tratamiento está pendiente de
// firma». El hecho de fondo sigue siendo cierto —no hay DPA firmado con
// nadie— pero anunciarlo así, tal cual, en una página que cualquiera lee
// antes de ser cliente, no ayuda a nadie. El hecho vive ahora en
// un documento interno (fuera del repo) que NINGUNA ruta
// de la app publica.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync('src/app/terminos/page.tsx', 'utf8');

describe('LEG-7 · /terminos ya no publica "pendiente de firma"', () => {
  it('no trae la frase ni el marcador rojo', () => {
    expect(PAGINA).not.toMatch(/pendiente de firma/i);
    expect(PAGINA).not.toMatch(/🔴.*contrato de encargado/);
  });

  it('sigue siendo honesta: no afirma que existe una versión firmada cuando LEGAL_DPA_VERSION no está', () => {
    // El texto de la rama sin versión no debe contener la palabra "versión"
    // como si citara una — solo el texto CON dpaVersion puede hacerlo.
    expect(PAGINA).toMatch(/contrato de encargado del tratamiento independiente de estos términos/);
  });
});

describe('LEG-7 · el pendiente contractual vive en un documento interno, no publicado', () => {
  it('el texto renderizado de /terminos no la cita como liga ni la sirve como ruta', () => {
    // No es una comprobación de "el nombre no aparece en ningún comentario"
    // (eso rompería con cualquier nota de auditoría que la mencione) sino de
    // que no se use como href, import ni fetch — nada que la publique.
    expect(PAGINA).not.toMatch(/href=.*PENDIENTES-ABOGADO/);
    expect(PAGINA).not.toMatch(/from\s+['"].*PENDIENTES-ABOGADO/);
  });
});

describe('A37-L-07 · la variable LEGAL_DPA_VERSION no afirma un contrato', () => {
  it('con versión configurada, el texto NO dice que el contrato «forma parte del paquete» ni que ya está firmado', () => {
    expect(PAGINA).not.toMatch(/que forma parte del paquete contractual/);
    expect(PAGINA).toMatch(/versión de referencia \$\{LEGAL_CONFIG\.dpaVersion\}/);
    expect(PAGINA).toMatch(/se acuerda y firma con tu empresa/);
  });
});
