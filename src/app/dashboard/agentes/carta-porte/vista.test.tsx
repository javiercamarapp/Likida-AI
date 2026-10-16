import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import { VistaAgenteCartaPorte, FRASE_SIN_GRUPOS, type BuzonCartaPorteVista } from './vista';

const BUZON: BuzonCartaPorteVista = { direccion: 'cp-abc123@correo.ejemplo.test', activo: true, remitentes: ['cliente.ejemplo.test'], dominioConfigurado: true };
const pintar = (buzon?: BuzonCartaPorteVista | null | 'no_leido') =>
  renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} {...(buzon === undefined ? {} : { buzon })} />);
/** El HTML sin la única frase que puede nombrar los grupos (para afirmar que no hay otra mención). */
const sinLaFrase = (html: string) => html.replace(FRASE_SIN_GRUPOS, '');

describe('Agente de Carta Porte: «Cómo mandarme documentos»', () => {
  it('con buzón activo enseña el correo del buzón con su botón de copiar, el 1:1 de WhatsApp y el panel', () => {
    const html = pintar(BUZON);
    expect(html).toContain('Cómo mandarme documentos');
    expect(html).toContain('cp-abc123@correo.ejemplo.test');
    expect(html).toContain('Copiar la dirección del buzón');
    expect(html).toContain('el medio oficial');
    expect(html).toContain('WhatsApp 1:1 de la oficina');
    expect(html).toContain('«carta porte»');
    expect(html).toContain('/dashboard/carta-porte/documentos');
  });

  it('dice sin rodeos que los grupos de WhatsApp no se pueden leer, y NO los ofrece como capacidad en ningún otro texto', () => {
    const html = pintar(BUZON);
    expect(html).toContain('Los grupos de WhatsApp no se pueden leer');
    expect(html).toContain('pide a tus clientes que escriban al correo o reenvíalos tú');
    expect(sinLaFrase(html)).not.toMatch(/grupo/i);
    // Tampoco sin buzón, ni con la lectura caída.
    expect(sinLaFrase(pintar(null))).not.toMatch(/grupo/i);
    expect(sinLaFrase(pintar('no_leido'))).not.toMatch(/grupo/i);
  });

  it('muestra los remitentes reconocidos (remitentes_permitidos) o dice que es cualquiera', () => {
    expect(pintar(BUZON)).toContain('cliente.ejemplo.test');
    expect(pintar(BUZON)).toContain('remitente no reconocido');
    expect(pintar({ ...BUZON, remitentes: [] })).toContain('Remitentes reconocidos: cualquiera');
  });

  it('sin buzón activado: estado vacío con la llamada a activarlo en el panel, y ninguna dirección inventada', () => {
    const html = pintar(null);
    expect(html).toContain('Aún no tienes buzón');
    expect(html).toContain('Actívalo en el panel de documentos');
    expect(html).not.toMatch(/cp-[a-z0-9]+@/);
    expect(html).toContain('/dashboard/carta-porte/documentos');
  });

  it('buzón apagado lo avisa; sin dominio configurado no inventa dirección; lectura caída no finge «sin buzón»', () => {
    expect(pintar({ ...BUZON, activo: false })).toContain('El buzón está apagado');
    const sinDominio = pintar({ direccion: null, activo: true, remitentes: [], dominioConfigurado: false });
    expect(sinDominio).toContain('El dominio de correo de Likida no está configurado');
    const caido = pintar('no_leido');
    expect(caido).toContain('No se pudo leer el buzón de tu flota');
    expect(caido).not.toContain('Aún no tienes buzón');
  });

  it('respeta el sufijo de tenant en la liga al panel', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} sufijo="?tenant=t1" buzon={BUZON} />);
    expect(html).toContain('/dashboard/carta-porte/documentos?tenant=t1');
  });

  it('sin el prop buzon (pantallas viejas) se comporta como «sin buzón»: ofrece activarlo', () => {
    expect(pintar()).toContain('Aún no tienes buzón');
  });

  it('liga al catálogo del cliente y conserva el sufijo del «ver como»', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} sufijo="?tenant=t1" buzon={BUZON} />);
    expect(html).toContain('/dashboard/agentes/carta-porte/catalogo?tenant=t1');
    expect(pintar(BUZON)).toContain('catálogo del cliente');
  });
});

// ── T-A3-37 · insights ──────────────────────────────────────────────────────
import { calcularInsights } from '@/lib/likida/carta_porte_docs/metricas';

describe('Agente de Carta Porte: «Cómo le va al agente»', () => {
  const vacio = calcularInsights({ docs: [], correcciones: new Map(), camposCorregidos: new Map(), causasRechazo: {}, envios: [], ahora: new Date('2026-10-15T12:00:00Z') });

  it('sin insights pedidos no pinta el bloque', () => {
    expect(pintar(BUZON)).not.toContain('Cómo le va al agente');
  });

  it('estado vacío correcto: dice que no hay qué medir y NO pinta un 0 % como medición', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} insights={vacio} />);
    expect(html).toContain('Cómo le va al agente');
    expect(html).toContain('Todavía no hay resultados que medir');
    expect(html).not.toContain('0 %');
    expect(html).not.toContain('Aprobados sin tocar');
  });

  it('si la lectura falló lo dice, no finge «sin datos»', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} insights="no_leido" />);
    expect(html).toContain('No se pudieron leer los resultados del agente');
    expect(html).not.toContain('Todavía no hay resultados que medir');
  });

  it('con datos muestra % sin tocar, tarjeta «qué pasó / qué significa / qué hacer» y el nombre del cliente', () => {
    const base = { tenantId: 't', canal: 'manual', formato: 'excel', nombreArchivo: 'x', mime: null, bytes: 1, sha256: 'a'.repeat(64), storageRuta: null, version: 1, perfilId: null, perfilVersion: null, remitente: null, asunto: null,
      remitenteReconocido: null, textoExtracto: null, riesgoInyeccion: false, extraccion: null, validacion: null, confianzaMin: null, nivelModelo: 1, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null,
      procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null, revisadoPor: null, aprobadoPor: null, rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '', purgadoEn: null, createdAt: '', updatedAt: '' } as const;
    const docs = [1, 2].map((n) => ({ ...base, id: `d${n}`, estado: 'aprobado', clienteId: 'c1', aprobadoEn: '2026-10-14T00:00:00Z' })) as never[];
    const i = calcularInsights({
      docs, correcciones: new Map(), camposCorregidos: new Map(), causasRechazo: {}, ahora: new Date('2026-10-15T12:00:00Z'), nombresCliente: new Map([['c1', 'Cliente Ejemplo']]),
      envios: [
        { documentoId: 'd1', estado: 'pendiente_reque', createdAt: '2026-10-14T00:00:00Z', enviadoEn: null, causaPendiente: 'El requerimiento no existe en el TMS.' },
        { documentoId: 'd2', estado: 'pendiente_reque', createdAt: '2026-10-14T01:00:00Z', enviadoEn: null, causaPendiente: 'El requerimiento no existe en el TMS.' },
      ],
    });
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} insights={i} nombresCliente={{ c1: 'Cliente Ejemplo' }} />);
    expect(html).toContain('100 %');
    expect(html).toContain('2 documentos de Cliente Ejemplo esperan requerimiento hace más de 24 h');
    expect(html).toContain('Qué significa');
    expect(html).toContain('Qué hacer');
    expect(html).toContain('Calidad por formato');
  });
});

describe('Agente de Carta Porte: «Viajes salidos sin Carta Porte» (T-A3-66)', () => {
  const listado = {
    vacio: false, total: 2,
    grupos: [{ clienteId: 'c1', clienteNombre: 'Cliente Ejemplo A', masAntiguoHoras: 80, colorMax: 'rojo' as const, viajes: [
      { viajeId: 'v1', folio: 'F-1', salidaEn: '2026-03-07T10:00:00Z', horas: 80, dias: 3, color: 'rojo' as const, localAbierto: false },
      { viajeId: 'v2', folio: 'F-2', salidaEn: '2026-03-10T10:00:00Z', horas: 5, dias: 0, color: 'verde' as const, localAbierto: true },
    ] }],
  };
  const pintarSin = (sinCcp?: Parameters<typeof VistaAgenteCartaPorte>[0]['sinCcp']) =>
    renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} {...(sinCcp === undefined ? {} : { sinCcp })} />);

  it('lista por cliente con horas, riesgo y la descarga del CSV con sus columnas', () => {
    const html = pintarSin(listado);
    expect(html).toContain('Viajes salidos sin Carta Porte');
    expect(html).toContain('Cliente Ejemplo A');
    expect(html).toContain('F-1');
    expect(html).toContain('Riesgo de multa');
    expect(html).toContain('local abierto');
    expect(html).toContain('download="viajes-sin-carta-porte.csv"');
    expect(decodeURIComponent(html.match(/href="data:text\/csv;charset=utf-8,([^"]+)"/)![1]!)).toContain('Cliente,Folio,Salida');
  });

  it('sin viajes dice el estado vacío y no ofrece descarga; con la lectura caída lo dice y no finge «sin pendientes»', () => {
    const vacio = pintarSin({ vacio: true, total: 0, grupos: [] });
    expect(vacio).toContain('No hay viajes salidos sin Carta Porte');
    expect(vacio).not.toContain('Descargar reporte');
    const caido = pintarSin('no_leido');
    expect(caido).toContain('No se pudo leer la lista de viajes salidos sin Carta Porte');
    expect(caido).not.toContain('No hay viajes salidos');
  });

  it('sin la prop no pinta el bloque', () => {
    expect(pintarSin()).not.toContain('Viajes salidos sin Carta Porte');
  });
});
