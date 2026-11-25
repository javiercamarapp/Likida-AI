import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { MisCasos, antiguedadTexto } from './mis_casos';
import { VistaDocumentos, type DatosDocumentos } from './vista';
import { casoDe, medicionDeRevisor } from '@/lib/likida/carta_porte_docs/mis_casos';
import { calcularMetricas } from '@/lib/likida/carta_porte_docs/metricas';
import { validarExtraccion } from '@/lib/likida/carta_porte_docs/validacion';
import { CAMPOS_DOC, CAMPOS_MERCANCIA } from '@/lib/likida/carta_porte_docs/campos';
import { cv, extraccionAtlasOk } from '@/lib/likida/carta_porte_docs/documentos_sinteticos.fixture';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';

const html = (e: ReactElement) => renderToStaticMarkup(e);
const YO = 'u-yo';
const AHORA = new Date('2026-10-03T16:00:00.000Z');
const accion = async () => null;
const todas = { subir: accion, procesar: accion, activarBuzon: accion, guardarRemitentes: accion, guardarExport: accion, borrarExport: accion, volverVersion: accion };

const doc = (over: Partial<DocumentoFila> = {}, ext = extraccionAtlasOk()): DocumentoFila => ({
  id: 'd1', tenantId: 't', canal: 'correo', formato: 'excel', nombreArchivo: 'plan-atlas.xlsx', mime: null, bytes: 2048, sha256: 'a'.repeat(64), storageRuta: 'x', estado: 'por_revisar', version: 4,
  clienteId: 'c1', perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: true, textoExtracto: null, riesgoInyeccion: false,
  extraccion: { ...ext, meta: { origen: 'llm', nivel: 2, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } }, validacion: validarExtraccion(ext),
  confianzaMin: 0.9, nivelModelo: 2, modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null,
  revisadoPor: null, aprobadoPor: null, aprobadoEn: null, rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '', purgadoEn: null,
  createdAt: '2026-10-01T16:00:00.000Z', updatedAt: '', ...over,
});
const clientes = [{ id: 'c1', nombre: 'Grupo Boreal' }];

describe('antiguedadTexto', () => {
  it('horas, días y sin fecha', () => {
    expect(antiguedadTexto(0.4)).toBe('llegó hace menos de 1 h');
    expect(antiguedadTexto(5.9)).toBe('llegó hace 5 h');
    expect(antiguedadTexto(72)).toBe('llegó hace 3 d');
    expect(antiguedadTexto(null)).toBe('sin fecha de llegada');
  });
});

describe('MisCasos', () => {
  it('sin aprobados suyos: «aún no medible: falta …» en las tres cifras, ningún 0 de medición', () => {
    const h = html(<MisCasos casos={[]} medicion={medicionDeRevisor([], new Map(), YO)} clientes={clientes} />);
    expect((h.match(/Aún no medible: falta/g) ?? []).length).toBe(3);
    expect(h).toMatch(/falta al menos un documento aprobado por ti en los últimos 90 días/);
    expect(h).not.toMatch(/>0</);
    expect(h).not.toMatch(/data-testid="mis-casos-caso"/);
  });

  it('con medición: casos, tiempo medio y campos corregidos; el tiempo sin marca dice qué falta', () => {
    const filas = [doc({ id: 'a', estado: 'aprobado', aprobadoPor: YO, tiempoRevisionSeg: 180 }), doc({ id: 'b', estado: 'aprobado', aprobadoPor: YO })];
    const h = html(<MisCasos casos={[]} medicion={medicionDeRevisor(filas, new Map([['a', 2]]), YO)} clientes={clientes} />);
    expect(h).toMatch(/Casos que aprobaste/);
    expect(h).toMatch(/3 min/);
    expect(h).toMatch(/Medido en 1 de tus 2 aprobados/);
    expect(h).toMatch(/Campos corregidos/);
    expect(h).not.toMatch(/Aún no medible/);
  });

  it('medición ausente: lo dice, no pinta ceros', () => {
    const h = html(<MisCasos casos={[]} medicion={null} clientes={clientes} />);
    expect(h).toMatch(/Aún no medible: falta poder leer tus documentos aprobados/);
  });

  it('un caso trae cliente, antigüedad, conteo ✔/◐/✗ y qué falta con su porqué', () => {
    const e = extraccionAtlasOk();
    e.campos.origen_cp = cv(null, 0, 'llm');
    const caso = casoDe(doc({}, e), AHORA);
    const h = html(<MisCasos casos={[caso]} medicion={null} clientes={clientes} sufijo="?tenant=abc" />);
    expect(h).toMatch(/plan-atlas\.xlsx/);
    expect(h).toMatch(/Grupo Boreal · llegó hace 2 d/);
    expect(h).toMatch(/✔ \d+/); expect(h).toMatch(/◐ \d+/); expect(h).toMatch(/✗ [1-9]/);
    expect(h).toMatch(/✗ [^<]+<\/strong>/);
    expect(h).toMatch(/href="\/dashboard\/carta-porte\/documentos\/d1\?tenant=abc"/);
  });

  it('un caso sin lectura no inventa conteos', () => {
    const caso = casoDe(doc({ extraccion: null, validacion: null }), AHORA);
    const h = html(<MisCasos casos={[caso]} medicion={null} clientes={clientes} />);
    expect(h).toMatch(/Todavía no tiene lectura/);
    expect(h).not.toMatch(/✔/);
  });

  it('muestra pocos problemas y cuenta los que quedan', () => {
    const e = extraccionAtlasOk();
    for (const c of CAMPOS_DOC.filter((x) => x.critico)) e.campos[c.clave] = cv(null, 0, 'llm');
    for (const c of CAMPOS_MERCANCIA.filter((x) => x.critico)) e.mercancias[0][c.clave] = cv(null, 0, 'llm');
    const caso = casoDe(doc({}, e), AHORA);
    expect(caso.problemas.length).toBeGreaterThan(5);
    expect(html(<MisCasos casos={[caso]} medicion={null} clientes={clientes} />)).toMatch(/y \d+ más en el documento/);
  });

  it('la ventana parcial se declara', () => {
    const h = html(<MisCasos casos={[]} medicion={medicionDeRevisor([], new Map(), YO)} clientes={clientes} parcial={{ leidos: 500, total: 800 }} />);
    expect(h).toMatch(/Cifras de los 500 documentos más recientes de 800/);
  });

  it('no muestra porcentajes de acierto (los del conjunto sintético no son de documentos reales)', () => {
    const h = html(<MisCasos casos={[casoDe(doc(), AHORA)]} medicion={medicionDeRevisor([], new Map(), YO)} clientes={clientes} />);
    expect(h).not.toMatch(/%/);
  });
});

describe('VistaDocumentos con «Mis casos»', () => {
  const filas = [doc({ id: 'mio', nombreArchivo: 'mio.xlsx' }), doc({ id: 'ajeno', nombreArchivo: 'ajeno.xlsx' })];
  const datos = (over: Partial<DatosDocumentos> = {}): DatosDocumentos => ({
    filas, total: filas.length, metricas: calcularMetricas(filas, new Map()), perfiles: [], clientes, buzon: null, configs: [],
    asignacionActiva: true, asignados: { mio: YO, ajeno: 'u-otra' }, revisores: [{ id: YO, nombre: 'Persona Uno' }], leidoEn: AHORA.toISOString(), ...over,
  });

  it('con ?mios=1 aparece el panel con sus casos; sin el filtro no', () => {
    const con = html(<VistaDocumentos datos={datos()} acciones={todas} usuarioId={YO} soloMios />);
    expect(con).toMatch(/data-testid="mis-casos-caso"/);
    expect((con.match(/data-testid="mis-casos-caso"/g) ?? []).length).toBe(1);
    expect(con).toMatch(/Casos por revisar a tu nombre/);
    const sin = html(<VistaDocumentos datos={datos()} acciones={todas} usuarioId={YO} />);
    expect(sin).not.toMatch(/Casos por revisar a tu nombre|Aún no medible/);
  });

  it('sin asignación configurada no aparece (la bandeja es la de siempre)', () => {
    const h = html(<VistaDocumentos datos={datos({ asignacionActiva: undefined })} acciones={todas} usuarioId={YO} soloMios />);
    expect(h).not.toMatch(/Casos por revisar a tu nombre|Aún no medible/);
  });

  it('con la medición calculada por la página la usa; sin ella dice que no es medible', () => {
    const aprobado = doc({ id: 'ap', estado: 'aprobado', aprobadoPor: YO, tiempoRevisionSeg: 300 });
    const h = html(<VistaDocumentos datos={datos({ medicionRevisor: medicionDeRevisor([aprobado], new Map(), YO) })} acciones={todas} usuarioId={YO} soloMios />);
    expect(h).toMatch(/5 min/);
    const sin = html(<VistaDocumentos datos={datos()} acciones={todas} usuarioId={YO} soloMios />);
    expect(sin).toMatch(/Aún no medible: falta poder leer tus documentos aprobados/);
  });
});
