import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { VistaDocumentos, type DatosDocumentos } from './vista';
import { VistaRevision } from './[id]/vista';
import { calcularMetricas } from '@/lib/likida/carta_porte_docs/metricas';
import { revisionDe } from '@/lib/likida/carta_porte_docs/presentacion';
import { validarExtraccion } from '@/lib/likida/carta_porte_docs/validacion';
import { CAMPOS_DOC, CAMPOS_MERCANCIA } from '@/lib/likida/carta_porte_docs/campos';
import { cv, extraccionAtlasOk } from '@/lib/likida/carta_porte_docs/documentos_sinteticos.fixture';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';

const html = (e: ReactElement) => renderToStaticMarkup(e);
/** El botón con esa `intencion`, sin importar el orden en que React serializa los atributos. */
const conIntencion = (h: string, i: string): boolean => new RegExp(`<button[^>]*value="${i}"[^>]*name="intencion"|<button[^>]*name="intencion"[^>]*value="${i}"`).test(h);
const accion = async () => null;
const todas = { subir: accion, procesar: accion, activarBuzon: accion, guardarRemitentes: accion, guardarExport: accion, borrarExport: accion, volverVersion: accion };
const ninguna = { subir: null, procesar: null, activarBuzon: null, guardarRemitentes: null, guardarExport: null, borrarExport: null, volverVersion: null };

const doc = (over: Partial<DocumentoFila> = {}, ext = extraccionAtlasOk()): DocumentoFila => ({
  id: 'd1', tenantId: 't', canal: 'correo', formato: 'excel', nombreArchivo: 'plan-atlas.xlsx', mime: null, bytes: 2048, sha256: 'a'.repeat(64), storageRuta: 'x', estado: 'por_revisar', version: 4,
  clienteId: 'c1', perfilId: null, perfilVersion: null, remitente: 'ana@cliente.example', asunto: 'Embarque 20481', remitenteReconocido: true, textoExtracto: 'Folio | ATL', riesgoInyeccion: false,
  extraccion: { ...ext, meta: { origen: 'llm', nivel: 2, escalamientos: [{ de: 1, a: 2, motivo: 'x' }], avisos: [], notasModelo: [], indiciosInyeccion: [] } }, validacion: validarExtraccion(ext),
  confianzaMin: 0.9, nivelModelo: 2, modelo: 'google/gemini-3.8-flash', tokensIn: 1, tokensOut: 1, costoUsd: 0.0071, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null,
  revisadoPor: null, aprobadoPor: null, aprobadoEn: null, rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '', purgadoEn: null, createdAt: '2026-10-01T16:00:00.000Z', updatedAt: '', ...over,
});

const datos = (filas: DocumentoFila[] = [], over: Partial<DatosDocumentos> = {}): DatosDocumentos => ({
  filas, total: filas.length, metricas: calcularMetricas(filas, new Map()), perfiles: [], clientes: [{ id: 'c1', nombre: 'Grupo Boreal' }], buzon: null, configs: [], ...over,
});

describe('VistaDocumentos', () => {
  it('base caída: un error visible, NUNCA una bandeja vacía', () => {
    const h = html(<VistaDocumentos datos={null} acciones={todas} />);
    expect(h).toMatch(/No pude leer los documentos de tu flota/);
    expect(h).not.toMatch(/Bandeja de revisión/);
  });

  it('sin documentos: estado vacío honesto y métricas sin cifras inventadas', () => {
    const h = html(<VistaDocumentos datos={datos()} acciones={todas} />);
    expect(h).toMatch(/Todavía no ha llegado ningún documento/);
    expect(h).toMatch(/Aún no hay aprobados: no se pinta un porcentaje/);
    expect(h).toMatch(/aún no hay aprobados medidos/);
    expect(h).not.toMatch(/0 min|0%/);
  });

  it('la bandeja pone primero lo que necesita a una persona y dice qué falta', () => {
    const malo = extraccionAtlasOk(); delete malo.campos.destino_rfc; malo.campos.origen_cp = cv('44100', 0.6);
    const filas = [
      doc({ id: 'ap', estado: 'aprobado', nombreArchivo: 'aprobado.pdf', aprobadoEn: 'x', viajeId: 'v1' }),
      doc({ id: 'rev', nombreArchivo: 'por-revisar.xlsx', validacion: validarExtraccion(malo) }, malo),
      doc({ id: 'fa', estado: 'fallido', nombreArchivo: 'roto.pdf', ultimoError: 'El PDF está dañado.', intentos: 5 }),
      doc({ id: 're', estado: 'recibido', nombreArchivo: 'nuevo.png', formato: 'imagen' }),
    ];
    const h = html(<VistaDocumentos datos={datos(filas)} acciones={todas} sufijo="?tenant=abc" />);
    expect(h.indexOf('por-revisar.xlsx')).toBeLessThan(h.indexOf('roto.pdf'));
    expect(h.indexOf('roto.pdf')).toBeLessThan(h.indexOf('nuevo.png'));
    expect(h.indexOf('nuevo.png')).toBeLessThan(h.indexOf('aprobado.pdf'));
    expect(h).toMatch(/1 por corregir/);
    expect(h).toMatch(/por confirmar/);
    expect(h).toMatch(/El PDF está dañado\./);
    expect(h).toMatch(/Con viaje/);
    expect(h).toMatch(/href="\/dashboard\/carta-porte\/documentos\/rev\?tenant=abc"/);
    expect(h).toMatch(/Leer ahora/);
    expect(h).not.toMatch(/Reintentar/); // agotó sus intentos: reintentar no sirve
  });

  it('un documento con instrucciones para un modelo lo dice en la fila', () => {
    expect(html(<VistaDocumentos datos={datos([doc({ riesgoInyeccion: true })])} acciones={todas} />)).toMatch(/trae instrucciones para un modelo/);
  });

  it('métricas medidas: porcentaje, ahorro con su supuesto a la vista y el costo', () => {
    const a = doc({ id: 'a', estado: 'aprobado', aprobadoEn: 'x', tiempoRevisionSeg: 120 });
    const b = doc({ id: 'b', estado: 'aprobado', aprobadoEn: 'x', tiempoRevisionSeg: 360 });
    const h = html(<VistaDocumentos datos={datos([a, b], { metricas: calcularMetricas([a, b], new Map([['b', 2]])) })} acciones={todas} />);
    expect(h).toMatch(/50%/);
    expect(h).toMatch(/1 de 2/);
    expect(h).toMatch(/12 min de captura manual \(supuesto\)/);
    expect(h).toMatch(/US\$0\.0142/);
  });

  it('canales: sin buzón ofrece activarlo; con buzón enseña la dirección; sin dominio lo dice', () => {
    expect(html(<VistaDocumentos datos={datos()} acciones={todas} />)).toMatch(/Activar buzón/);
    const con = html(<VistaDocumentos datos={datos([], { buzon: { direccion: 'cp-abc@mail.likida.ai', activo: true, remitentes: ['cliente.com'], dominioConfigurado: true } })} acciones={todas} />);
    expect(con).toMatch(/cp-abc@mail\.likida\.ai/);
    expect(con).toMatch(/cliente\.com/);
    expect(con).not.toMatch(/Activar buzón/);
    expect(html(<VistaDocumentos datos={datos([], { buzon: { direccion: null, activo: true, remitentes: [], dominioConfigurado: false } })} acciones={todas} />)).toMatch(/dominio de correo de Likida no está configurado/);
  });

  it('perfiles con su historial de versiones y «volver a esta»', () => {
    const h = html(<VistaDocumentos datos={datos([], { perfiles: [{ id: 'p1', nombre: 'Atlas · excel', formato: 'excel', versionActiva: 2, mapeos: 15, versiones: [{ version: 2, nota: 'Nuevo: fecha_salida', mapeos: 15 }, { version: 1, nota: null, mapeos: 14 }] }] })} acciones={todas} />);
    expect(h).toMatch(/Atlas · excel/);
    expect(h).toMatch(/versión 2/);
    expect(h).toMatch(/Nuevo: fecha_salida/);
    expect(h).toMatch(/activa/);
    expect(h).toMatch(/Volver a esta/);
  });

  it('exportación: enlaces del estándar y de los formatos guardados, con el tenant del superadmin', () => {
    const h = html(<VistaDocumentos datos={datos([], { configs: [{ id: 'cfg-1', nombre: 'Innovativos', formato: 'csv', config: {} }] })} acciones={todas} apiSufijo="&tenant=abc" />);
    expect(h).toContain('/api/export/carta-porte-docs?config=estandar&amp;formato=csv&amp;tenant=abc');
    expect(h).toContain('config=cfg-1&amp;formato=csv');
    expect(h).toMatch(/Innovativos · CSV/);
    expect(h).toMatch(/apóstrofo/);
  });

  it('sin acciones (rol sin permiso) no pinta formularios que no podrían usarse', () => {
    const h = html(<VistaDocumentos datos={datos([doc({ estado: 'recibido' })])} acciones={ninguna} />);
    expect(h).not.toMatch(/Subir y leer/);
    expect(h).not.toMatch(/Declarar un formato destino/);
  });
});

describe('VistaRevision', () => {
  const rev = (d: DocumentoFila) => revisionDe(d);
  const montar = (d: DocumentoFila, o: Partial<React.ComponentProps<typeof VistaRevision>> = {}) => html(
    <VistaRevision doc={d} revision={rev(d)} original={{ tipo: 'texto', texto: 'Folio | ATL-20481' }} operadores={[{ id: 'o1', nombre: 'Juan Pérez' }]} eventos={[]} acciones={{ revisar: accion }} {...o} />,
  );

  it('TODOS los campos del complemento aparecen como inputs con el contrato c:/m:/k:', () => {
    const h = montar(doc());
    for (const c of CAMPOS_DOC) expect(h, c.clave).toContain(`name="c:${c.clave}"`);
    for (const c of CAMPOS_MERCANCIA) { expect(h, c.clave).toContain(`name="m:0:${c.clave}"`); expect(h).toContain(`name="m:1:${c.clave}"`); }
    expect(h).toMatch(/Agregar una mercancía que falte/);
    expect(h).toContain('name="documentoId" value="d1"');
    expect(h).toContain('name="version" value="4"');
  });

  it('el original va al lado y la lectura dice cómo se hizo', () => {
    const h = montar(doc());
    expect(h).toMatch(/Folio \| ATL-20481/);
    expect(h).toMatch(/modelo nivel 2/);
    expect(h).toMatch(/google\/gemini-3\.8-flash/);
    expect(h).toMatch(/se releyó 1 vez con un modelo más fuerte/);
    expect(h).toMatch(/US\$0\.0071/);
  });

  it('lo que bloquea sale en rojo con su motivo, lo dudoso pide confirmar y el resumen cuenta', () => {
    const e = extraccionAtlasOk(); delete e.campos.destino_rfc; e.campos.origen_cp = cv('44100', 0.6);
    const d = doc({}, e);
    const h = montar(d);
    expect(h).toMatch(/el documento no lo trae o no se pudo leer/);
    expect(h).toMatch(/la lectura no es segura \(60 %\)/);
    expect(h).toContain('name="k:c:origen_cp"');
    expect(h).toMatch(/1 dato por corregir/);
    expect(h).toMatch(/1 dato por confirmar/);
    expect(h).not.toMatch(/Todo en orden/);
  });

  it('un documento limpio dice «puedes aprobar»', () => {
    expect(montar(doc())).toMatch(/Todo en orden: puedes aprobar/);
  });

  it('el botón Aprobar, Guardar, Rechazar y Quitar renglón usan `intencion`', () => {
    const h = montar(doc());
    for (const i of ['guardar', 'aprobar', 'rechazar', 'quitar:0']) expect(conIntencion(h, i), i).toBe(true);
    expect(h).toMatch(/No timbra nada/);
  });

  it('documento con instrucciones: banner de alerta', () => {
    expect(montar(doc({ riesgoInyeccion: true }))).toMatch(/texto con forma de instrucción para un modelo[\s\S]*ningún dato crítico/);
  });

  it('aprobado: campos de solo lectura, sin botones de edición, con «Reabrir» y la liga al borrador', () => {
    const d = doc({ estado: 'aprobado', aprobadoEn: 'x', viajeId: 'v1' });
    const h = montar(d, { salida: { folio: 'ATL-20481' } });
    expect(h).toMatch(/readOnly=""|readonly=""/i);
    expect(conIntencion(h, 'aprobar')).toBe(false);
    expect(conIntencion(h, 'reabrir')).toBe(true);
    expect(h).toContain('/dashboard/carta-porte/borrador/v1');
    expect(h).toMatch(/Con viaje ATL-20481/);
  });

  it('aprobado sin viaje: pide elegir operador y ofrece crearlo', () => {
    const h = montar(doc({ estado: 'aprobado', aprobadoEn: 'x', viajeId: null }));
    expect(h).toMatch(/Todavía sin viaje/);
    expect(conIntencion(h, 'viaje')).toBe(true);
    expect(h).toMatch(/Crear el viaje/);
  });

  it('fallido o sin extracción: no hay formulario, dice por qué', () => {
    const d = doc({ estado: 'fallido', extraccion: null, validacion: null, ultimoError: 'El PDF está dañado.' });
    const h = html(<VistaRevision doc={d} revision={null} original={{ tipo: 'nada', motivo: 'No hay archivo.' }} operadores={[]} eventos={[]} acciones={{ revisar: accion }} />);
    expect(h).toMatch(/El documento no se pudo leer; no hay datos que revisar/);
    expect(h).not.toContain('name="intencion"');
    expect(h).toMatch(/No hay archivo\./);
  });

  it('eliminar solo se ofrece a quien administra, y no mientras se lee', () => {
    expect(conIntencion(montar(doc(), { puedeEliminar: true }), 'eliminar')).toBe(true);
    expect(conIntencion(montar(doc()), 'eliminar')).toBe(false);
    expect(conIntencion(montar(doc({ estado: 'procesando' }), { puedeEliminar: true }), 'eliminar')).toBe(false);
    expect(montar(doc(), { puedeEliminar: true })).toMatch(/solicitud de cancelación/);
  });

  it('sin permiso (acción nula) no hay formulario', () => {
    expect(montar(doc(), { acciones: { revisar: null } })).toMatch(/Tu rol no puede revisar este documento/);
  });

  it('el original puede ser imagen, páginas o nada; y la bitácora se lista', () => {
    expect(montar(doc(), { original: { tipo: 'imagen', url: 'https://x.supabase.co/f.png' } })).toContain('src="https://x.supabase.co/f.png"');
    expect(montar(doc(), { original: { tipo: 'imagenes', urls: ['data:image/png;base64,AA', 'data:image/png;base64,BB'] } })).toMatch(/Página 2 del documento/);
    const h = montar(doc(), { eventos: [{ tipo: 'extraccion_ok', creadoEn: '2026-10-01T16:00:00Z' }, { tipo: 'aprobado', creadoEn: '2026-10-01T17:00:00Z' }] });
    expect(h).toMatch(/Bitácora de este documento \(2\)/);
    expect(h).toMatch(/Leído/);
  });

  it('la evidencia y la confianza de cada dato son visibles; los valores hostiles se escapan', () => {
    const e = extraccionAtlasOk();
    e.campos.origen_nombre = { valor: '<script>alert(1)</script>', confianza: 0.93, evidencia: '"><img src=x onerror=alert(2)>', origen: 'llm' };
    const h = montar(doc({}, e));
    expect(h).toMatch(/93 %/);
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).not.toContain('<img src=x onerror');
    expect(h).toContain('&lt;script&gt;');
  });
});
