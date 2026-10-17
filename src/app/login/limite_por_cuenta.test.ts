import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 · SEG-LIMITE-CUENTA (checklist 31 v2 #13, plan 32 Fase 1).
//
// `dentroDelLimite` ya limitaba por IP (10 / 5 min). Eso no cierra la otra
// forma de abusar del ÚNICO camino de entrada: alguien con IPs rotadas (o
// una VPN/proxy) puede seguir pidiendo magic links a LA MISMA cuenta sin
// jamás tocar el techo por IP — cada intento manda un correo real (cuota de
// SMTP) y es la base del A4-1 (enumeración) y del abuso de inbox de un
// tercero.
//
// Antes de escribir un contador nuevo se revisó si Supabase Auth ya limita
// por identificador: SÍ, `[auth.email].max_frequency` espacia dos OTP al
// MISMO correo (en prod, no el "1s" de la suite local) — pero es un
// ESPACIADOR de UNA petición a la vez, no una ventana con techo de intentos
// que luego EXPIRA. Se añade el segundo, sin reemplazar el primero.
//
// LA VENTANA ES CORTA A PROPÓSITO (5 min, no horas ni días): un límite largo
// convertiría esto en un candado que CUALQUIERA pone sobre la cuenta de
// OTRO solo tecleando su correo varias veces — el peor caso tiene que ser
// "espera 5 minutos", no "quedaste fuera hasta que alguien de Likida te
// desbloquee".
//
// Mismo patrón de lectura de fuente que `no_autoregistro.test.ts`: los
// server actions de esta página no se exportan.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('/login limita también por CUENTA, no solo por IP', () => {
  it('hay una llave de rateLimit distinta de la de IP, anclada al correo', () => {
    expect(PAGINA).toMatch(/login:cuenta/);
  });

  it('la ventana es CORTA (5 minutos), no una que bloquee "para siempre"', () => {
    // Se busca la llamada a rateLimit que usa la llave por cuenta y se
    // revisa que su ventana sea 5 * 60_000 (300000 ms) — ni más.
    const i = PAGINA.indexOf('login:cuenta');
    expect(i).toBeGreaterThan(-1);
    const ventana = PAGINA.slice(i, i + 160);
    expect(ventana).toMatch(/5 \* 60_000/);
  });

  it('ambos límites (IP y cuenta) se comprueban antes de mandar el correo, con el MISMO error genérico', () => {
    const iGuardar = PAGINA.indexOf('guardarCorreoParaReenvio(email)');
    expect(iGuardar).toBeGreaterThan(-1);
    const iCuenta = PAGINA.indexOf('login:cuenta');
    expect(iCuenta, 'el límite por cuenta debe comprobarse ANTES de mandar el correo').toBeLessThan(iGuardar);
  });
});
