import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { VistaDocumentos, filtroEnvioDe, pasaFiltroEnvio, type DatosDocumentos } from './vista';
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

  it('A37-S16-01: si las métricas se calcularon sobre una muestra lo dice; sin muestra no hay aviso', () => {
    const con = html(<VistaDocumentos datos={datos([], { metricasMuestra: { usados: 500, total: 731 } })} acciones={todas} />);
    expect(con).toMatch(/Hubo 731 documentos en los últimos 90 días; estas cifras se calcularon solo con los 500 más recientes/);
    expect(html(<VistaDocumentos datos={datos()} acciones={todas} />)).not.toMatch(/se calcularon solo con/);
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
    expect(con).toContain('cliente.com');
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
    const h = html(<VistaDocumentos datos={datos([], { configs: [{ id: 'cfg-1', nombre: 'Cliente demo', formato: 'csv', config: {} }] })} acciones={todas} apiSufijo="&tenant=abc" />);
    expect(h).toContain('/api/export/carta-porte-docs?config=estandar&amp;formato=csv&amp;tenant=abc');
    expect(h).toContain('config=cfg-1&amp;formato=csv');
    expect(h).toMatch(/Cliente demo · CSV/);
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
    // A37-A3-04: no hay formulario de revisión, pero SÍ la única salida: «Reintentar lectura».
    expect(conIntencion(h, 'reintentar')).toBe(true);
    expect(conIntencion(h, 'aprobar')).toBe(false);
    expect(conIntencion(h, 'guardar')).toBe(false);
    expect(h).toMatch(/No hay archivo\./);
  });
  it('A37-A3-04: sin acciones de revisión (rol sin permiso) no se ofrece reintentar', () => {
    const d = doc({ estado: 'fallido', extraccion: null, validacion: null, ultimoError: 'x' });
    const h = html(<VistaRevision doc={d} revision={null} original={{ tipo: 'nada', motivo: 'n' }} operadores={[]} eventos={[]} acciones={{ revisar: null }} />);
    expect(conIntencion(h, 'reintentar')).toBe(false);
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

describe('archivos con varios embarques (P13, 0670)', () => {
  const padre = () => doc({ id: 'pa', estado: 'dividido', nombreArchivo: 'plan-del-dia.xlsx', extraccion: null, validacion: null });
  const hijo = (n: number, folio: string, over: Partial<DocumentoFila> = {}) => doc({ id: `h${n}`, nombreArchivo: `plan-del-dia · embarque ${folio}.csv`, formato: 'csv', estado: 'recibido', extraccion: null, validacion: null, ...over });

  it('la bandeja dice «Embarque i de N · folio» en cada hijo y cuántos embarques trajo el original', () => {
    const h = html(<VistaDocumentos datos={datos([padre(), hijo(1, 'ATL-1'), hijo(2, 'ATL-2')], {
      linaje: { pa: { rol: 'padre', indice: null, total: 2, clave: null }, h1: { rol: 'hijo', indice: 1, total: 2, clave: 'ATL-1' }, h2: { rol: 'hijo', indice: 2, total: 2, clave: 'ATL-2' } },
    })} acciones={todas} />);
    expect(h).toMatch(/Embarque 1 de 2 · folio ATL-1/);
    expect(h).toMatch(/Embarque 2 de 2 · folio ATL-2/);
    expect(h).toMatch(/Dividido en embarques/);
    expect(h).toMatch(/Trae 2 embarques: cada uno es un documento aparte/);
    // El original dividido no ofrece «Leer ahora» (no se vuelve a leer): solo «Ver».
    expect(h.match(/Leer ahora/g)).toHaveLength(2);
  });

  it('sin linaje (base sin la 0670) la bandeja se ve igual que antes, sin etiquetas', () => {
    const h = html(<VistaDocumentos datos={datos([hijo(1, 'ATL-1')])} acciones={todas} />);
    expect(h).not.toMatch(/Embarque 1 de/);
  });

  it('el original dividido lista sus embarques con su estado y enlaza a cada uno', () => {
    const h = html(<VistaRevision doc={padre()} revision={null} original={{ tipo: 'nada', motivo: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: accion }} sufijo="?tenant=abc"
      hijos={[
        { id: 'h1', indice: 1, clave: 'ATL-1', estado: 'por_revisar', nombre: 'a.csv', bloqueos: 2, porConfirmar: 0 },
        { id: 'h2', indice: 2, clave: 'ATL-2', estado: 'aprobado', nombre: 'b.csv', bloqueos: 0, porConfirmar: 0 },
      ]} />);
    expect(h).toMatch(/Este archivo traía varios embarques/);
    expect(h).toMatch(/href="\/dashboard\/carta-porte\/documentos\/h1\?tenant=abc"[^>]*>Folio ATL-1</);
    expect(h).toMatch(/2 por corregir/);
    expect(h).toMatch(/Aprobado/);
    expect(h).not.toMatch(/Guardar cambios|Aprobar</); // el original no se revisa
  });

  it('un hijo dice de qué archivo nació y enlaza de regreso', () => {
    const h = html(<VistaRevision doc={hijo(1, 'ATL-1', { estado: 'por_revisar' })} revision={null} original={{ tipo: 'nada', motivo: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: accion }}
      embarque={{ indice: 1, total: 3, clave: 'ATL-1', padreId: 'pa', padreNombre: 'plan-del-dia.xlsx' }} />);
    expect(h).toMatch(/Embarque 1 de 3 \(folio ATL-1\) del archivo/);
    expect(h).toMatch(/href="\/dashboard\/carta-porte\/documentos\/pa"[^>]*>plan-del-dia\.xlsx</);
  });
});

describe('VistaRevision · modo manual del TMS', () => {
  const aprobado = () => doc({ id: 'd9', estado: 'aprobado', aprobadoEn: 'x' });
  const montar = (d: DocumentoFila, envio: React.ComponentProps<typeof VistaRevision>['envio'], sufijo = '') => html(
    <VistaRevision doc={d} revision={revisionDe(d)} original={{ tipo: 'texto', texto: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: accion }} envio={envio} sufijo={sufijo} />,
  );

  it('aprobado con envío pendiente: enlace de descarga a la plantilla y botón «Ya la subí a mano»', () => {
    const h = montar(aprobado(), { estado: 'pendiente_prechequeo' });
    expect(h).toContain('href="/api/export/carta-porte-docs?formato=plantilla_tms&amp;documento=d9"');
    expect(h).toMatch(/Descargar plantilla del TMS/);
    expect(conIntencion(h, 'subido_a_mano')).toBe(true);
  });

  it('el enlace conserva el sufijo de la flota elegida', () => {
    expect(montar(aprobado(), { estado: 'listo' }, '?tenant=abc')).toContain('href="/api/export/carta-porte-docs?tenant=abc&amp;formato=plantilla_tms&amp;documento=d9"');
  });

  it('aprobado sin envío registrado (flota sin perfil): también ofrece el modo manual', () => {
    const h = montar(aprobado(), null);
    expect(h).toMatch(/Descargar plantilla del TMS/);
    expect(conIntencion(h, 'subido_a_mano')).toBe(true);
  });

  it('ya subido a mano: sigue la descarga, desaparece el botón y se dice que no se reenvía', () => {
    const h = montar(aprobado(), { estado: 'subido_a_mano' });
    expect(h).toMatch(/Descargar plantilla del TMS/);
    expect(conIntencion(h, 'subido_a_mano')).toBe(false);
    expect(h).toMatch(/Marcada como subida a mano/);
  });

  it('envío ya enviado por el sistema: ni descarga ni botón', () => {
    const h = montar(aprobado(), { estado: 'enviado' });
    expect(h).not.toMatch(/Descargar plantilla del TMS/);
    expect(conIntencion(h, 'subido_a_mano')).toBe(false);
  });

  it('documento por revisar o rechazado: no hay modo manual', () => {
    for (const d of [doc({ id: 'd9' }), doc({ id: 'd9', estado: 'rechazado', rechazoMotivo: 'x' })]) {
      const h = montar(d, null);
      expect(h).not.toMatch(/Descargar plantilla del TMS/);
      expect(conIntencion(h, 'subido_a_mano')).toBe(false);
    }
  });
});

describe('VistaRevision · modo manual con envío rechazado por el TMS', () => {
  it('ofrece la descarga y «Ya la subí a mano» (subir a mano es lo que se hace tras un rechazo)', () => {
    const d = doc({ id: 'd9', estado: 'aprobado', aprobadoEn: 'x' });
    const h = html(<VistaRevision doc={d} revision={revisionDe(d)} original={{ tipo: 'texto', texto: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: accion }} envio={{ estado: 'rechazado_tms' }} />);
    expect(h).toMatch(/Descargar plantilla del TMS/);
    expect(conIntencion(h, 'subido_a_mano')).toBe(true);
  });
});

describe('VistaDocumentos · filtro por estado de envío', () => {
  const a1 = doc({ id: 'a1', estado: 'aprobado', nombreArchivo: 'uno.xlsx' });
  const a2 = doc({ id: 'a2', estado: 'aprobado', nombreArchivo: 'dos.xlsx' });
  const a3 = doc({ id: 'a3', estado: 'aprobado', nombreArchivo: 'tres.xlsx' });
  const a4 = doc({ id: 'a4', estado: 'aprobado', nombreArchivo: 'cuatro.xlsx' });
  const p1 = doc({ id: 'p1', estado: 'por_revisar', nombreArchivo: 'pendiente.xlsx' });
  const envios = { a1: 'rechazado_tms', a2: 'subido_a_mano', a3: 'listo' } as const;
  const mostrar = (f: string) => html(<VistaDocumentos datos={datos([a1, a2, a3, a4, p1], { envios })} acciones={ninguna} filtroEnvio={filtroEnvioDe(f)} />);

  it('un valor desconocido en la URL vuelve a «todos»', () => {
    expect(filtroEnvioDe('x')).toBe('todos');
    expect(filtroEnvioDe(undefined)).toBe('todos');
    expect(filtroEnvioDe('subido_a_mano')).toBe('subido_a_mano');
  });

  it('cada filtro deja solo los aprobados de ese grupo; «todos» no esconde nada', () => {
    const nombres = (h: string) => ['uno', 'dos', 'tres', 'cuatro', 'pendiente'].filter((n) => h.includes(`${n}.xlsx`));
    expect(nombres(mostrar('todos'))).toEqual(['uno', 'dos', 'tres', 'cuatro', 'pendiente']);
    expect(nombres(mostrar('rechazado_tms'))).toEqual(['uno']);
    expect(nombres(mostrar('subido_a_mano'))).toEqual(['dos']);
    expect(nombres(mostrar('en_curso'))).toEqual(['tres']);
    expect(nombres(mostrar('sin_envio'))).toEqual(['cuatro']);
    expect(nombres(mostrar('enviado'))).toEqual([]);
    expect(mostrar('enviado')).toMatch(/Ningún documento aprobado tiene ese estado de envío/);
  });

  it('los enlaces del filtro arrastran el sufijo de la flota', () => {
    const h = html(<VistaDocumentos datos={datos([a1], { envios })} acciones={ninguna} sufijo="?tenant=abc" />);
    expect(h).toContain('href="/dashboard/carta-porte/documentos?tenant=abc&amp;envio=subido_a_mano"');
    expect(h).toContain('href="/dashboard/carta-porte/documentos?tenant=abc"');
  });

  it('pasaFiltroEnvio: un documento no aprobado nunca entra a un filtro de envío', () => {
    expect(pasaFiltroEnvio({ id: 'p1', estado: 'por_revisar' }, envios, 'sin_envio')).toBe(false);
  });
});

describe('VistaRevision · perfil restringido (envío al TMS, sin viaje)', () => {
  const aprobado = () => doc({ id: 'd9', estado: 'aprobado', aprobadoEn: 'x' });
  const montar = (d: DocumentoFila, perfilRestringido: boolean, envio: React.ComponentProps<typeof VistaRevision>['envio'] = null) => html(
    <VistaRevision doc={d} revision={revisionDe(d)} original={{ tipo: 'texto', texto: 'x' }} operadores={[{ id: 'o1', nombre: 'Operador Uno' }]} eventos={[]} acciones={{ revisar: accion }}
      envio={envio} perfilRestringido={perfilRestringido} salida={{ folio: 'F-1' }} />,
  );

  it('salida simulada: la tarjeta de envío lleva «Simulado» y dice «Subido al TMS (simulado)»; sin simulador dice solo «Enviado.»', () => {
    const sim = montar(aprobado(), true, { estado: 'enviado', simulado: true });
    expect(sim).toMatch(/data-testid="rotulo-simulado"[^>]*>Simulado</);
    expect(sim).toMatch(/Subido al TMS \(simulado\)/);
    const real = montar(aprobado(), true, { estado: 'enviado' });
    expect(real).not.toMatch(/Simulado|simulado/);
    expect(real).toMatch(/Enviado\./);
  });

  it('por revisar con perfil: no hay selector de operador ni «crea o completa el viaje»; sí «No timbra nada»', () => {
    const h = montar(doc(), true);
    expect(h).not.toMatch(/Operador del viaje/);
    expect(h).not.toMatch(/crea o completa el viaje/);
    expect(h).toMatch(/prepara el envío al sistema del cliente/);
    expect(h).toMatch(/No timbra nada/);
  });

  it('aprobado con perfil: ni «Crear el viaje», ni operador, ni enlace al borrador, aunque el documento tenga viaje', () => {
    for (const d of [aprobado(), doc({ id: 'd9', estado: 'aprobado', aprobadoEn: 'x', viajeId: 'v1' })]) {
      const h = montar(d, true, { estado: 'listo' });
      expect(h).not.toMatch(/Crear el viaje|Actualizar el viaje/);
      expect(h).not.toMatch(/cp-operador|Operador Uno/);
      expect(h).not.toMatch(/\/borrador\//);
      expect(conIntencion(h, 'viaje')).toBe(false);
      expect(h).toMatch(/Envío al sistema del cliente/);
    }
  });

  it('sin perfil todo sigue igual: operador, «Crear el viaje» y enlace al borrador', () => {
    const sinViaje = montar(aprobado(), false);
    expect(sinViaje).toMatch(/Crear el viaje/);
    expect(sinViaje).toMatch(/cp-operador2/);
    expect(conIntencion(sinViaje, 'viaje')).toBe(true);
    expect(sinViaje).not.toMatch(/Envío al sistema del cliente/);
    expect(montar(doc({ id: 'd9', estado: 'aprobado', aprobadoEn: 'x', viajeId: 'v1' }), false)).toMatch(/\/borrador\/v1/);
    expect(montar(doc(), false)).toMatch(/Operador del viaje/);
  });

  it('cada estado del envío pinta su frase en lenguaje llano', () => {
    const f = (envio: React.ComponentProps<typeof VistaRevision>['envio']) => montar(aprobado(), true, envio);
    expect(f(null)).toMatch(/Aún no se ha enviado nada/);
    expect(f({ estado: 'descartado' })).toMatch(/Aún no se ha enviado nada/);
    expect(f({ estado: 'pendiente_prechequeo' })).toMatch(/Listo para enviar/);
    expect(f({ estado: 'listo' })).toMatch(/Listo para enviar/);
    expect(f({ estado: 'enviando' })).toMatch(/Enviándose al sistema del cliente/);
    expect(f({ estado: 'enviado' })).toMatch(/Enviado\./);
    expect(f({ estado: 'subido_a_mano' })).toMatch(/Subido a mano/);
    const espera = f({ estado: 'pendiente_reque', proximaRevision: '2026-10-20T15:00:00.000Z' });
    expect(espera).toMatch(/Esperando que exista el requerimiento — se reintentará el /);
    expect(espera).toMatch(/2026|20/);
    expect(f({ estado: 'pendiente_reque' })).toMatch(/Esperando que exista el requerimiento\./);
    expect(f({ estado: 'error_transitorio' })).toMatch(/no contestó — se reintentará/);
    const rechazo = f({ estado: 'rechazado_tms', motivo: 'hoja Mercancias, fila 22, campo Cantidad' });
    expect(rechazo).toMatch(/lo rechazó: hoja Mercancias, fila 22, campo Cantidad — corrige y vuelve a aprobar/);
  });

  it('conserva los botones del modo manual (descargar plantilla y marcar subido a mano)', () => {
    const h = montar(aprobado(), true, { estado: 'listo' });
    expect(h).toMatch(/Descargar plantilla del TMS/);
    expect(conIntencion(h, 'subido_a_mano')).toBe(true);
  });
});

describe('VistaDocumentos · perfil restringido', () => {
  const a = doc({ id: 'a1', estado: 'aprobado', nombreArchivo: 'uno.xlsx', viajeId: null });
  it('la bandeja habla del envío al TMS y no de viajes; sin perfil, igual que siempre', () => {
    const con = html(<VistaDocumentos datos={datos([a], { envios: { a1: 'listo' } })} acciones={ninguna} perfilRestringido />);
    expect(con).toMatch(/Envío al TMS: En curso/);
    expect(con).not.toMatch(/Sin viaje todavía|Con viaje/);
    const sin = html(<VistaDocumentos datos={datos([a], { envios: { a1: 'listo' } })} acciones={ninguna} />);
    expect(sin).toMatch(/Sin viaje todavía/);
  });
});

describe('T-A3-31: destinatario de revisión en la bandeja', () => {
  const ME = 'u-yo';
  const OTRA = 'u-otra';
  const filas = [doc({ id: 'mio', nombreArchivo: 'mio.xlsx' }), doc({ id: 'ajeno', nombreArchivo: 'ajeno.xlsx' }), doc({ id: 'nadie', nombreArchivo: 'nadie.xlsx' })];
  const asignacion: Partial<DatosDocumentos> = {
    asignacionActiva: true, asignados: { mio: ME, ajeno: OTRA }, revisores: [{ id: ME, nombre: 'Persona Uno' }, { id: OTRA, nombre: 'Persona Dos' }],
  };

  it('sin configuración la bandeja es la de siempre: ni columna «Asignado a» ni filtro «Mis casos»', () => {
    const h = html(<VistaDocumentos datos={datos(filas)} acciones={todas} usuarioId={ME} soloMios />);
    expect(h).not.toMatch(/Asignado a|Mis casos/);
    expect(h).toMatch(/mio\.xlsx/); expect(h).toMatch(/ajeno\.xlsx/); expect(h).toMatch(/nadie\.xlsx/);
  });

  it('con asignación activa: columna con el nombre de la persona y «Todos los revisores» para lo no asignado', () => {
    const h = html(<VistaDocumentos datos={datos(filas, asignacion)} acciones={todas} usuarioId={ME} />);
    expect(h).toMatch(/Asignado a/);
    expect(h).toMatch(/Persona Uno/); expect(h).toMatch(/Persona Dos/);
    expect(h).toMatch(/Todos los revisores/);
    expect(h).toMatch(/Mis casos/);
  });

  it('«Mis casos» solo muestra los suyos', () => {
    const h = html(<VistaDocumentos datos={datos(filas, asignacion)} acciones={todas} usuarioId={ME} soloMios />);
    expect(h).toMatch(/mio\.xlsx/);
    expect(h).not.toMatch(/ajeno\.xlsx/);
    expect(h).not.toMatch(/nadie\.xlsx/);
  });

  it('«Mis casos» sin ningún caso asignado lo dice, y explica que lo no asignado le toca a todos', () => {
    const h = html(<VistaDocumentos datos={datos(filas, { ...asignacion, asignados: { ajeno: OTRA } })} acciones={todas} usuarioId={ME} soloMios />);
    expect(h).toMatch(/No tienes casos asignados/);
  });

  it('el enlace «Mis casos» conserva el ?tenant= de la vista', () => {
    const h = html(<VistaDocumentos datos={datos(filas, asignacion)} acciones={todas} usuarioId={ME} sufijo="?tenant=abc" />);
    expect(h).toMatch(/href="\/dashboard\/carta-porte\/documentos\?tenant=abc&amp;mios=1"/);
  });
});

describe('T-A3-31: reasignar desde el visor', () => {
  const opciones = [{ id: 'u1', nombre: 'Persona Uno' }, { id: 'u2', nombre: 'Persona Dos' }];
  const ver = (d: DocumentoFila, revisor: { actualId: string | null; opciones: typeof opciones } | null, reasignar: typeof accion | null = accion) =>
    html(<VistaRevision doc={d} revision={null} original={{ tipo: 'nada', motivo: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: accion, reasignar }} revisor={revisor} />);

  it('sin configuración de asignación no se pinta nada', () => {
    expect(ver(doc(), null)).not.toMatch(/Asignado a|Reasignar/);
  });

  it('muestra a quién le toca y el selector para reasignar (con «Todos los revisores»)', () => {
    const h = ver(doc(), { actualId: 'u1', opciones });
    expect(h).toMatch(/Asignado a: <strong[^>]*>Persona Uno/);
    expect(h).toMatch(/name="revisorId"/);
    expect(h).toMatch(/<option value="u2">Persona Dos/);
    expect(h).toMatch(/<option value="">Todos los revisores/);
    expect(h).toMatch(/Reasignar/);
  });

  it('sin asignar dice «Todos los revisores»; un documento ya aprobado no ofrece reasignar', () => {
    expect(ver(doc(), { actualId: null, opciones })).toMatch(/Asignado a: <strong[^>]*>Todos los revisores/);
    const aprobado = ver(doc({ estado: 'aprobado', aprobadoEn: 'x' }), { actualId: 'u1', opciones });
    expect(aprobado).toMatch(/Asignado a/);
    expect(aprobado).not.toMatch(/name="revisorId"/);
  });
});

describe('T-A3-63: lo inferido y lo poco seguro se resaltan al lado del documento', () => {
  const montar = (d: DocumentoFila, texto: string) => html(
    <VistaRevision doc={d} revision={revisionDe(d)} original={{ tipo: 'texto', texto }} operadores={[]} eventos={[]} acciones={{ revisar: accion }} />,
  );
  const conMarcas = () => {
    const e = extraccionAtlasOk();
    e.campos.origen_cp = { ...cv('44100', 0.6), evidencia: 'CP Origen: 44100' };
    e.campos.unidad_placas = cv('ABC1234', 0.95, 'catalogo');
    return doc({}, e);
  };

  it('el inferido lleva rótulo «Inferido», su aviso en llano y nunca el rótulo de leído', () => {
    const h = montar(conMarcas(), 'Folio | ATL-20481');
    expect(h).toContain('data-marca="inferido"');
    expect(h).toMatch(/Inferido del catálogo del cliente: el documento no lo trae/);
    expect(h).toMatch(/>Inferido</);
  });

  it('el poco seguro se rotula y su línea del documento original va resaltada', () => {
    const h = montar(conMarcas(), 'Folio | ATL-20481\nCP Origen: 44100');
    expect(h).toContain('data-marca="poco-seguro"');
    expect(h).toMatch(/>Poco seguro</);
    expect(h).toContain('data-linea-resaltada');
    expect(h.match(/data-linea-resaltada/g)).toHaveLength(1);
  });

  it('el resumen cuenta lo resaltado y avisa que aprobar con correcciones enseña al formato', () => {
    const h = montar(conMarcas(), 'x');
    expect(h).toMatch(/1 dato inferido/);
    expect(h).toMatch(/1 dato poco seguro/);
    expect(h).toMatch(/el siguiente documento igual sale sin modelo/);
  });

  it('un documento sin nada que resaltar no pinta marcas ni resumen', () => {
    const h = montar(doc(), 'Folio | ATL-20481');
    expect(h).not.toContain('data-marca=');
    expect(h).not.toContain('resumen-marcas');
    expect(h).not.toContain('data-linea-resaltada');
  });
});
