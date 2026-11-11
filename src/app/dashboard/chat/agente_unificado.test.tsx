/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo con rutas fijas */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE UNIFICADO (R8): «Pregunta a tus datos» y el Copiloto de /admin son el MISMO componente. Estas pruebas vigilan que no vuelvan a
// divergir (misma estructura y mismas clases en los dos modos), que la portada solo afirme lo que es verdad en cada modo, que la
// tarjeta de acción exija confirmar y que ninguna función cruce del servidor al cliente.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import AgenteConversacion from './agente-conversacion';
import TarjetaAccion from './tarjeta-accion';
import { PERFIL_CLIENTE, PERFIL_SUPERADMIN } from './perfiles';
import { RespuestaVista } from './mensajes';
import { rotuloTool, respuestaDeBloques } from './respuestas';
import { leerRespuestaAgente, cerrarPaso } from './transporte';

const clases = (html: string): Set<string> => {
  const s = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('rv-')) s.add(c);
  return s;
};
const cliente = renderToStaticMarkup(<AgenteConversacion modo="cliente" kpis={null} acred={null} />);
const superadmin = renderToStaticMarkup(<AgenteConversacion modo="superadmin" />);

describe('UN solo <h1> por página: el panel lateral del Copiloto no compite con el título de la pantalla', () => {
  const panel = renderToStaticMarkup(<AgenteConversacion modo="superadmin" variante="panel" marca="simbolo" />);
  it('la variante panel pinta el título como <h2>', () => {
    expect(panel).not.toContain('<h1');
    expect(panel).toMatch(/<h2>[^<]+<\/h2>/);
  });
  it('la variante página (el chat de /dashboard y la página del Copiloto) conserva su <h1>', () => {
    expect((superadmin.match(/<h1/g) ?? []).length).toBe(1);
  });
});

describe('el cliente y el superadmin comparten estructura y clases', () => {
  it('las clases rv-* son las mismas salvo el clip de adjuntar (el copiloto no tiene adjuntos)', () => {
    const c = clases(cliente);
    const s = clases(superadmin);
    const soloCliente = [...c].filter((x) => !s.has(x)).sort();
    const soloSuperadmin = [...s].filter((x) => !c.has(x)).sort();
    expect(soloCliente).toEqual(['rv-chat__clip']);
    // El briefing «Decide hoy» es de la portada del Copiloto (F5): su estructura propia es lo único que el superadmin tiene de más.
    expect(soloSuperadmin).toEqual(['rv-btn--sm', 'rv-chat__briefing', 'rv-chat__briefing-acciones', 'rv-chat__briefing-cuerpo', 'rv-chat__briefing-resumen', 'rv-chat__briefing-titulo', 'rv-chat__nota', 'rv-tarjeta']);
  });

  it.each([['cliente', cliente], ['superadmin', superadmin]])('%s: portada completa (hero, recuadro, temas con punto, chips, historial) y cero style=', (_n, html) => {
    for (const k of ['rv-chat__hero', 'rv-chat__dock', 'rv-chat__composer', 'rv-chat__temas', 'rv-chat__tema', 'rv-chat__preguntas', 'rv-chat__meta', 'rv-chat__hist-boton', 'rv-chat__enviar']) {
      expect(html, k).toContain(k);
    }
    // El único `style=` es el del logo vectorial (LogoV2, igual en los dos modos); el resto del componente va por clases.
    expect(html.replace(/<span class="rv-chat__logo".*?<\/svg><\/span>/s, '')).not.toMatch(/\bstyle=/);
    expect(html).toContain('<textarea');
    expect(html).toContain('data-tema="1"');
  });

  it('cada modo lleva su título, su placeholder y sus temas; el logo y el título tienen el mismo marcado', () => {
    expect(cliente).toContain(PERFIL_CLIENTE.textos.titulo);
    expect(superadmin).toContain(PERFIL_SUPERADMIN.textos.titulo);
    expect(superadmin).toContain(PERFIL_SUPERADMIN.textos.placeholder);
    for (const t of PERFIL_SUPERADMIN.temas) expect(superadmin).toContain(t.categoria);
    expect(superadmin).toContain('data-modo="superadmin"');
    expect(cliente).toContain('data-modo="cliente"');
  });

  it('solo el cliente pinta el clip; el copiloto lo omite y su composer lo declara', () => {
    expect(cliente).toContain('Adjuntar comprobante');
    expect(superadmin).not.toContain('Adjuntar comprobante');
    expect(superadmin).toContain('data-sin-clip');
  });

  it('los chips solo afirman lo que es verdad en cada modo (el copiloto no dice «Cifras calculadas por el motor»)', () => {
    expect(cliente).toContain('Cifras calculadas por el motor');
    expect(superadmin).not.toContain('Cifras calculadas por el motor');
    expect(superadmin).toContain('Tú confirmas cada acción');
    expect(cliente).not.toContain('Tú confirmas cada acción');
  });

  it('D10 (auditoría 11-nov): «Decide hoy» va DESPUÉS de los temas y plegado: nada entre el recuadro y los temas', () => {
    const iDock = superadmin.indexOf('rv-chat__dock');
    const iTemas = superadmin.indexOf('rv-chat__temas');
    const iBriefing = superadmin.indexOf('rv-chat__briefing');
    expect(iDock).toBeGreaterThan(-1);
    expect(iTemas).toBeGreaterThan(iDock);
    expect(iBriefing).toBeGreaterThan(iTemas);
    expect(superadmin).toMatch(/<details[^>]*rv-chat__briefing/);
    expect(superadmin).not.toMatch(/<details[^>]*rv-chat__briefing[^>]* open/);
  });

  it('el panel lateral usa la misma pantalla en variante compacta', () => {
    const panel = renderToStaticMarkup(<AgenteConversacion modo="superadmin" variante="panel" marca="simbolo" />);
    expect(panel).toContain('data-variante="panel"');
    // El briefing «Decide hoy» es solo de la página: el panel, cerrado, no pide nada a la red.
    // El panel conserva TODAS las clases de la pantalla; solo suma la hoja del historial (el Drawer del motor de overlays).
    for (const c of [...clases(superadmin)].filter((x) => !x.startsWith('rv-chat__hist') && !x.startsWith('rv-chat__briefing') && !['rv-btn--ghost', 'rv-btn--sm', 'rv-chat__nota', 'rv-tarjeta'].includes(x))) expect(clases(panel).has(c), c).toBe(true);
  });

  it('los perfiles son datos puros: ninguna función en textos ni temas (props serializables)', () => {
    const sinFunciones = (v: unknown): boolean => typeof v === 'function' ? false : Array.isArray(v) ? v.every(sinFunciones) : v && typeof v === 'object' ? Object.values(v).every(sinFunciones) : true;
    expect(sinFunciones(PERFIL_CLIENTE.textos) && sinFunciones(PERFIL_CLIENTE.temas)).toBe(true);
    expect(sinFunciones(PERFIL_SUPERADMIN.textos) && sinFunciones(PERFIL_SUPERADMIN.temas)).toBe(true);
  });
});

describe('las páginas solo pasan props serializables al componente', () => {
  const fuente = (r: string) => readFileSync(join(process.cwd(), 'src/app', r), 'utf8');
  it('/admin/copiloto y el panel pasan solo cadenas; /dashboard/chat solo datos y un elemento', () => {
    expect(fuente('admin/copiloto/page.tsx')).toMatch(/<AgenteConversacion modo="superadmin" variante="pagina" \/>/);
    expect(fuente('admin/copiloto-panel.tsx')).toMatch(/<AgenteConversacion modo="superadmin" variante="panel" marca="simbolo" \/>/);
    expect(fuente('dashboard/chat/chat-flota.tsx')).not.toMatch(/=\{\s*\(/);
  });
});

describe('TarjetaAccion: nunca ejecuta sin confirmar', () => {
  const base = { accion: 'apagar_agente', gateo: 'confirma' as const, implementada: true, objetivo: 'cobranza', efecto: 'Deja de enviar recordatorios.', revertir: 'Encenderlo desde Agentes.', motivoSugerido: null };
  it('con llave: muestra efecto, cómo revertir, motivo obligatorio y los dos botones (sin fetch en el render)', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const h = renderToStaticMarkup(<TarjetaAccion a={{ ...base, intentId: 'i-1' }} endpoint="/api/admin/copiloto" onEjecutada={() => {}} />);
    vi.unstubAllGlobals();
    expect(f).not.toHaveBeenCalled();
    expect(h).toContain('Voy a apagar');
    expect(h).toContain('Motivo (obligatorio)');
    expect(h).toContain('Efecto:');
    expect(h).toContain('Revertir:');
    expect(h).toContain('>Cancelar<');
    expect(h).toContain('>Apagar<');
  });
  it('sin llave de ejecución no hay botón de ejecutar', () => {
    const h = renderToStaticMarkup(<TarjetaAccion a={base} endpoint="/x" onEjecutada={() => {}} />);
    expect(h).not.toContain('>Apagar<');
    expect(h).toContain('ya no trae su llave');
  });
  it('una acción no implementada se dice y no ofrece botón', () => {
    const h = renderToStaticMarkup(<TarjetaAccion a={{ ...base, implementada: false, intentId: 'i-1' }} endpoint="/x" onEjecutada={() => {}} />);
    expect(h).toContain('todavía no está implementada');
    expect(h).not.toContain('<button');
  });
});

describe('RespuestaVista: acciones solo en modo superadmin y archivadas sin botón', () => {
  const accion = { accion: 'apagar_agente', gateo: 'confirma' as const, implementada: true, objetivo: 'cobranza', efecto: 'e', revertir: 'r', motivoSugerido: null, intentId: 'i-1' };
  const turno = (archivada: boolean) => ({ id: 't', q: 'Apaga el agente de cobranza', nuevo: false, r: { texto: 'Listo para confirmar.', accion, archivada, origen: 'copiloto' as const, fuentes: [{ ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' }] } });
  const render = (t: ReturnType<typeof turno>, acciones: boolean) => renderToStaticMarkup(
    <RespuestaVista turno={t} ultimo ocupado={false} fase="" pasosVivos={[]} onRepetir={() => {}} acciones={acciones} endpointAccion="/api/admin/copiloto" />,
  );
  it('con acciones apagadas (cliente) el bloque accion jamás se pinta', () => {
    expect(render(turno(false), false)).not.toContain('Confirmar acción');
  });
  it('con acciones encendidas pinta la tarjeta con confirmación y la fuente clicable', () => {
    const h = render(turno(false), true);
    expect(h).toContain('Confirmar acción');
    expect(h).toContain('href="/admin/observabilidad"');
    expect(h).toContain('Respuesta del copiloto');
  });
  it('una acción reabierta del historial se muestra archivada y sin botón', () => {
    const h = render(turno(true), true);
    expect(h).toContain('Propuesta archivada del historial');
    expect(h).not.toContain('>Apagar<');
  });
});

describe('transporte común', () => {
  const flujo = (lineas: string[], tipo = 'application/x-ndjson') =>
    new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const l of lineas) c.enqueue(e.encode(`${l}\n`)); c.close(); } }), { status: 200, headers: { 'content-type': tipo } });

  it('lee pasos en vivo y devuelve el evento final; ignora líneas ilegibles', async () => {
    const pasos: string[] = [];
    const d = await leerRespuestaAgente(
      flujo(['{"t":"paso","tool":"metrica_negocio","fase":"inicio"}', 'basura', '{"t":"paso","tool":"metrica_negocio","fase":"fin"}', '{"t":"fin","bloques":[{"tipo":"texto","texto":"hola"}]}']),
      (tool, fase) => pasos.push(`${tool}:${fase}`),
    );
    expect(pasos).toEqual(['metrica_negocio:inicio', 'metrica_negocio:fin']);
    expect(d?.t).toBe('fin');
  });
  it('un camino de tope contesta JSON plano y también se entiende', async () => {
    const d = await leerRespuestaAgente(new Response(JSON.stringify({ bloques: [] }), { status: 200, headers: { 'content-type': 'application/json' } }), () => {});
    expect(d).toEqual({ bloques: [] });
  });
  it('cerrarPaso palomea el último renglón abierto de esa tool', () => {
    const p = cerrarPaso([{ tool: 'a', listo: false }, { tool: 'a', listo: false }], 'a', { ms: 5 } as never);
    expect(p).toEqual([{ tool: 'a', listo: false }, { tool: 'a', listo: true, ms: 5 }]);
  });
});

describe('adaptador superadmin: bloques y rótulos', () => {
  it('los bloques del copiloto traen texto, visuales y la acción propuesta', () => {
    const r = respuestaDeBloques([{ tipo: 'texto', texto: 'Sí.' }, { tipo: 'dona', segmentos: [{ etiqueta: 'a', valor: 1 }] }, { tipo: 'accion', accion: 'apagar_agente', objetivo: 'x' }]);
    expect(r.texto).toBe('Sí.');
    expect(r.visuales?.[0].tipo).toBe('dona');
    expect(r.accion?.accion).toBe('apagar_agente');
  });
  it('rotuloTool entiende las tools de los dos agentes sin inventar rótulos', () => {
    expect(rotuloTool('metrica_negocio')).toBe('Leyendo las métricas del negocio');
    expect(rotuloTool('kpis_flota')).toBe('Leyendo los KPIs de la flota');
    expect(rotuloTool('tool_rara')).toBe('tool rara');
  });
});
