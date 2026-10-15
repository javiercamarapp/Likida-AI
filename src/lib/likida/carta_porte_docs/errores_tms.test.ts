import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_entrada: unknown, _opciones?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: vi.fn(async () => null) }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, llmBoreal, sembrarFlotas, subirYProcesar } from './escenario.fixture';
import { aprobarDocumento, corregirCampos, reabrirPorRechazoTms } from './bandeja';
import { fijarGuardiaPerfil } from './envio';
import { hallazgoGenerico, hallazgoRepetido, razonDe, traducirErroresTms, ubicar } from './errores_tms';
import { LAYOUT_NORMAL } from './plantilla_tms.layout';
import { columnasDeCambios } from './repo_envios';
import { conservarHallazgosTms, type ResultadoValidacion } from './validacion';
import { pdfBoreal } from './documentos_sinteticos.fixture';
import { DatoInvalido } from '../errores';
import type { ErrorFila } from './tms_puerto';

// T-A3-29: lo que el sistema del cliente rechaza vuelve a la bandeja como hallazgos sobre campos de Likida.
// Todo sintético: ni un nombre, RFC ni valor de ninguna persona o empresa real.

/** Un valor que JAMÁS debe aparecer en un hallazgo, un evento ni la columna `errores`. */
const VALOR_SECRETO = 'VALOR-SINTETICO-98765';

beforeEach(() => { reset(); sembrarFlotas(); bitacora.anotarBitacora.mockClear(); fijarGuardiaPerfil(async (t) => t === A); });
afterEach(() => fijarGuardiaPerfil());

const FRACCION: ErrorFila = { hoja: 'Mercancias', fila: 22, campo: 'Fracción Arancelaria', detalle: `El valor ${VALOR_SECRETO} no existe en el catálogo` };

describe('traducirErroresTms: celda/columna del TMS → campo de Likida', () => {
  it('Mercancias fila 22 «Fracción Arancelaria» ⇒ hallazgo BLOQUEO sobre la fracción de la mercancía 1', () => {
    const t = traducirErroresTms([FRACCION], { mercancias: 1 });
    expect(t).toMatchObject({ mapeados: 1, sinMapeo: 0 });
    expect(t.hallazgos).toHaveLength(1);
    expect(t.hallazgos[0]).toMatchObject({ campo: 'fraccion_arancelaria', renglon: 0, severidad: 'bloqueo', codigo: 'tms_rechazo', origen: 'tms' });
    expect(t.hallazgos[0].mensaje).toContain('Mercancía 1');
    expect(t.hallazgos[0].mensaje).toContain('no está en el catálogo del sistema del cliente');
  });

  it('la fila decide el renglón y la columna el campo (también por letra o por texto parecido)', () => {
    expect(ubicar({ hoja: 'Mercancias', fila: 24, campo: 'Peso kg', detalle: 'x' }, LAYOUT_NORMAL, 3)).toEqual({ campo: 'peso_kg', renglon: 2 });
    expect(ubicar({ hoja: 'mercancías', fila: 22, campo: 'I', detalle: 'x' }, LAYOUT_NORMAL, 3)).toEqual({ campo: 'peso_kg', renglon: 0 });
    expect(ubicar({ hoja: 'Mercancias', fila: 23, campo: 'Peso', detalle: 'x' }, LAYOUT_NORMAL, 3)).toEqual({ campo: 'peso_kg', renglon: 1 });
  });

  it('celdas fijas: la fila (o la coordenada) identifica el campo del documento', () => {
    expect(ubicar({ hoja: 'RemintenteDestinatario', fila: 8, campo: 'Folio', detalle: 'x' }, LAYOUT_NORMAL, 1)).toEqual({ campo: 'folio_cliente', renglon: null });
    expect(ubicar({ hoja: 'RemintenteDestinatario', campo: 'C12', detalle: 'x' }, LAYOUT_NORMAL, 1)).toEqual({ campo: 'origen_rfc', renglon: null });
    expect(ubicar({ hoja: 'RemintenteDestinatario', fila: 7, campo: 'Cliente', detalle: 'x' }, LAYOUT_NORMAL, 1)).toEqual({ campo: 'numero_cliente_interno', renglon: null });
  });

  it('tabla de destinos: columnas del destino ⇒ campos del documento', () => {
    expect(ubicar({ hoja: 'RemintenteDestinatario', fila: 50, campo: 'RFC', detalle: 'x' }, LAYOUT_NORMAL, 1)).toEqual({ campo: 'destino_rfc', renglon: null });
  });

  it('lo que no se puede ubicar NO se adivina: renglón inexistente, hoja o columna desconocida, columna ambigua', () => {
    expect(ubicar({ hoja: 'Mercancias', fila: 30, campo: 'Peso kg', detalle: 'x' }, LAYOUT_NORMAL, 1)).toBeNull(); // renglón 9 de 1
    expect(ubicar({ hoja: 'Mercancias', fila: 5, campo: 'Peso kg', detalle: 'x' }, LAYOUT_NORMAL, 9)).toBeNull(); // arriba de la tabla
    expect(ubicar({ hoja: 'Otra', fila: 22, campo: 'Peso kg', detalle: 'x' }, LAYOUT_NORMAL, 1)).toBeNull();
    expect(ubicar({ hoja: 'Mercancias', fila: 22, campo: 'Columna Inventada', detalle: 'x' }, LAYOUT_NORMAL, 1)).toBeNull();
    expect(ubicar({ hoja: 'Mercancias', fila: 22, campo: 'Material', detalle: 'x' }, LAYOUT_NORMAL, 1)).toBeNull(); // «Material Peligroso» vs «Clave Material Peligroso»
    expect(ubicar({ hoja: 'Mercancias', fila: 22, detalle: 'x' }, LAYOUT_NORMAL, 1)).toBeNull();
  });

  it('error desconocido ⇒ UN hallazgo genérico con el mensaje llano; mezclado con uno ubicable, salen los dos', () => {
    const solo = traducirErroresTms([{ hoja: 'Hoja9', fila: 1, campo: 'zzz', detalle: VALOR_SECRETO }], { mercancias: 1, mensajeLlano: 'El sistema rechazó el archivo por un motivo que no sabemos ubicar.' });
    expect(solo).toMatchObject({ mapeados: 0, sinMapeo: 1 });
    expect(solo.hallazgos).toEqual([expect.objectContaining({ campo: 'documento', renglon: null, severidad: 'bloqueo', origen: 'tms',
      mensaje: 'El sistema del cliente rechazó el archivo: El sistema rechazó el archivo por un motivo que no sabemos ubicar.' })]);
    const mezcla = traducirErroresTms([FRACCION, { hoja: 'Hoja9', fila: 1, campo: 'zzz', detalle: 'x' }], { mercancias: 1, mensajeLlano: 'Hubo errores.' });
    expect(mezcla.hallazgos.map((h) => h.campo)).toEqual(['fraccion_arancelaria', 'documento']);
  });

  it('un rechazo sin lista de errores igual deja su hallazgo (nunca queda mudo)', () => {
    const t = traducirErroresTms([], { mensajeLlano: '  Rechazado.  ' });
    expect(t.hallazgos).toHaveLength(1);
    expect(t.hallazgos[0].mensaje).toBe('El sistema del cliente rechazó el archivo: Rechazado.');
    expect(hallazgoGenerico(undefined).mensaje).toContain('no dijo el motivo');
  });

  it('varios errores de la misma celda se juntan en UN hallazgo; la razón se clasifica sin copiar el texto', () => {
    const t = traducirErroresTms([
      { ...FRACCION },
      { hoja: 'Mercancias', fila: 22, campo: 'Fracción Arancelaria', detalle: `Formato inválido: ${VALOR_SECRETO}` },
    ], { mercancias: 1 });
    expect(t.hallazgos).toHaveLength(1);
    expect(t.hallazgos[0].mensaje).toContain('no está en el catálogo');
    expect(t.hallazgos[0].mensaje).toContain('no tiene el formato que pide');
    expect(razonDe('Campo obligatorio vacío')).toBe('obligatorio');
    expect(razonDe(undefined)).toBe('otra');
  });

  it('SIN ECO: ni los hallazgos ni las ubicaciones contienen el valor que el TMS citó', () => {
    const t = traducirErroresTms([FRACCION, { hoja: 'Hoja9', fila: 2, campo: 'q', detalle: VALOR_SECRETO }], { mercancias: 1, mensajeLlano: 'Rechazo.' });
    expect(JSON.stringify(t)).not.toContain(VALOR_SECRETO);
    expect(t.ubicaciones).toContain('Mercancias!22!Fracción Arancelaria');
  });

  it('la columna `errores` de la base (jsonb) conserva solo la ubicación, nunca el detalle ni el valor', () => {
    const col = columnasDeCambios({ errores: [FRACCION] });
    expect(col.errores).toEqual([{ hoja: 'Mercancias', fila: 22, campo: 'Fracción Arancelaria' }]);
    expect(JSON.stringify(col)).not.toContain(VALOR_SECRETO);
  });
});

describe('conservarHallazgosTms: el rechazo sobrevive a la revalidación hasta corregir', () => {
  const tms = traducirErroresTms([FRACCION], { mercancias: 1 }).hallazgos;
  const previa: ResultadoValidacion = { hallazgos: tms, bloqueos: 1, porConfirmar: 0, listoParaAprobar: false };
  const limpia: ResultadoValidacion = { hallazgos: [], bloqueos: 0, porConfirmar: 0, listoParaAprobar: true };

  it('sin corrección sobre ese campo, el bloqueo sigue; confirmar sin cambiar no lo levanta', () => {
    const r = conservarHallazgosTms(limpia, previa, []);
    expect(r).toMatchObject({ bloqueos: 1, listoParaAprobar: false });
    expect(r.hallazgos).toHaveLength(1);
    expect(conservarHallazgosTms(limpia, previa, [{ campo: 'peso_kg', renglon: 0 }]).bloqueos).toBe(1);
  });

  it('corregir ESE campo y renglón lo levanta', () => {
    expect(conservarHallazgosTms(limpia, previa, [{ campo: 'fraccion_arancelaria', renglon: 0 }])).toEqual(limpia);
  });

  it('quitar el renglón (o uno anterior) levanta los de ese renglón; el genérico cae con cualquier corrección', () => {
    expect(conservarHallazgosTms(limpia, previa, [{ campo: 'mercancia', renglon: 0 }])).toEqual(limpia);
    const gen: ResultadoValidacion = { hallazgos: [hallazgoGenerico('x')], bloqueos: 1, porConfirmar: 0, listoParaAprobar: false };
    expect(conservarHallazgosTms(limpia, gen, []).bloqueos).toBe(1);
    expect(conservarHallazgosTms(limpia, gen, [{ campo: 'origen_cp', renglon: null }])).toEqual(limpia);
    expect(hallazgoRepetido()).toMatchObject({ severidad: 'bloqueo', origen: 'tms', campo: 'documento' });
  });

  it('no mezcla hallazgos propios: solo arrastra los de origen tms', () => {
    const aviso = { campo: 'x', renglon: null, severidad: 'aviso' as const, codigo: 'a', mensaje: 'a' };
    const r = conservarHallazgosTms(limpia, { hallazgos: [aviso, ...tms] }, []);
    expect(r.hallazgos).toEqual(tms);
  });
});

describe('el ciclo completo: rechazo → por revisar → corregir → aprobar → envío nuevo', () => {
  async function aprobadoConEnvio() {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'orden.pdf', { clienteId: 'cli-boreal', remitente: 'logistica@boreal.example' });
    const id = r.documentoId;
    const ap = await aprobarDocumento(A, id, estado.docs.get(id)!.version, ACTOR);
    expect(ap.envio).toMatchObject({ ok: true, creado: true });
    return id;
  }
  const doc = (id: string) => estado.docs.get(id)!;
  const tipos = (id: string) => estado.eventos.filter((e) => e.documentoId === id).map((e) => e.tipo);

  it('el rechazo deja el documento por revisar con el bloqueo visible; corregir y reaprobar crea un envío nuevo y conserva el rechazo viejo', async () => {
    const id = await aprobadoConEnvio();
    const envioViejo = estado.envios[0];
    envioViejo.estado = 'rechazado_tms'; // lo dejó así el worker

    const t = traducirErroresTms([FRACCION], { mercancias: doc(id).extraccion!.mercancias.length, mensajeLlano: 'Rechazo.' });
    await reabrirPorRechazoTms(A, id, doc(id).version, t.hallazgos, t.ubicaciones);

    expect(doc(id)).toMatchObject({ estado: 'por_revisar', rechazoCausa: 'tms_rechazo', aprobadoEn: null });
    expect(doc(id).validacion).toMatchObject({ bloqueos: 1, listoParaAprobar: false });
    expect(doc(id).validacion!.hallazgos.find((h) => h.origen === 'tms')).toMatchObject({ campo: 'fraccion_arancelaria', renglon: 0, severidad: 'bloqueo' });
    const reabierto = estado.eventos.find((e) => e.documentoId === id && e.tipo === 'reabierto')!;
    expect(reabierto.detalle).toMatchObject({ causa: 'tms_rechazo', hallazgos: 1, ubicaciones: ['Mercancias!22!Fracción Arancelaria'] });
    expect(JSON.stringify(estado.eventos)).not.toContain(VALOR_SECRETO);

    // Sin corregir ese campo NO se reaprueba: el bloqueo del TMS sigue vivo aunque la validación propia esté limpia.
    await expect(aprobarDocumento(A, id, doc(id).version, ACTOR)).rejects.toThrow(DatoInvalido);
    // Corregir OTRO campo tampoco lo levanta.
    await corregirCampos(A, id, doc(id).version, [{ campo: 'descripcion', renglon: 0, valor: 'Carga sintetica corregida' }], ACTOR.id);
    expect(doc(id).validacion!.hallazgos.some((h) => h.origen === 'tms')).toBe(true);

    // Corregir la fracción lo levanta; reaprobar sube la versión ⇒ llave nueva ⇒ envío nuevo.
    await corregirCampos(A, id, doc(id).version, [{ campo: 'fraccion_arancelaria', renglon: 0, valor: '12345678' }], ACTOR.id);
    expect(doc(id).validacion!.hallazgos.some((h) => h.origen === 'tms')).toBe(false);
    const re = await aprobarDocumento(A, id, doc(id).version, ACTOR);
    expect(re.envio).toMatchObject({ ok: true, creado: true });
    expect(estado.envios).toHaveLength(2);
    expect(estado.envios[1]).toMatchObject({ estado: 'pendiente_prechequeo', versionDoc: doc(id).version });
    expect(estado.envios[1].idempotencyKey).not.toBe(envioViejo.idempotencyKey);
    expect(estado.envios[0].estado).toBe('rechazado_tms'); // el rechazo viejo queda como estaba
    expect(tipos(id)).toEqual(expect.arrayContaining(['aprobado', 'reabierto', 'campo_corregido', 'envio_preparado']));
  });

  it('un segundo rechazo REEMPLAZA los hallazgos del anterior (no se acumulan) y conserva los propios', async () => {
    const id = await aprobadoConEnvio();
    await reabrirPorRechazoTms(A, id, doc(id).version, traducirErroresTms([FRACCION], { mercancias: 1 }).hallazgos);
    await corregirCampos(A, id, doc(id).version, [{ campo: 'fraccion_arancelaria', renglon: 0, valor: '12345678' }], ACTOR.id);
    const ap = await aprobarDocumento(A, id, doc(id).version, ACTOR);
    expect(ap.documento.estado).toBe('aprobado');
    await reabrirPorRechazoTms(A, id, doc(id).version, [hallazgoGenerico('Otra vez.')]);
    expect(doc(id).validacion!.hallazgos.filter((h) => h.origen === 'tms')).toHaveLength(1);
    expect(doc(id).validacion!.bloqueos).toBe(1);
  });

  it('si el documento cambió entre el envío y el rechazo (otra versión) no se toca: ConflictoDeVersion', async () => {
    const id = await aprobadoConEnvio();
    await expect(reabrirPorRechazoTms(A, id, doc(id).version - 1, [hallazgoGenerico('x')])).rejects.toThrow(DatoInvalido);
    expect(doc(id).estado).toBe('aprobado');
  });
});
