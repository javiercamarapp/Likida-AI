// ─────────────────────────────────────────────────────────────────────────────
// LEG-C19-C1 (auditoría 32, continuación 19) — la constancia del art. 16
// LFPDPPP escrita en falso por los dos caminos HUMANOS del Vigía.
//
// La c18 cerró `LEG-C18-C1` para el camino del MODELO: `guardiaDePulido`
// (`redactor.ts:438`) rechaza un pulido que se coma el pie, derivando el
// invariante de `MARCA_AVISO`/`MARCA_BAJA` para no tener dos listas que
// mantener sincronizadas.
//
// Pero la escritura de la constancia no vive en el redactor: vive en
// `enviarSaliente` (`servicio.ts:505`) y se dispara por el ÉXITO DEL ENVÍO,
// sea quien sea el autor del texto:
//
//     if (!e.contacto.avisoPrivacidadEn) await repo.marcarAvisoPrivacidad(...)
//
// Y hay dos caminos que llegan ahí con texto que NO pasó por el redactor:
//   · `responderComoHumano` (`servicio.ts:858`) — el gerente teclea de cero.
//   · `aprobarMensaje` con `textoEditado` (`servicio.ts:794`) — el gerente
//     reescribe el borrador y puede quitarle el pie.
//
// El pie se agrega en UN solo lugar, `redactor.ts:320`, y sólo cuando
// `primerContacto`. `enviarAlCliente` (`enviar.ts:62-86`) hace `trim()` y
// manda: no agrega nada. Así que por los caminos humanos sale texto sin pie y
// la base afirma que se entregó el aviso — con un update write-once
// (`repo.ts:744`, `.is('aviso_privacidad_en', null)`), así que nunca se corrige
// y ese contacto no vuelve a recibir el pie jamás.
//
// El invariante correcto no es «hubo envío», es «salió el pie». Se deriva de
// las mismas dos marcas, igual que la guardia del pulido.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atenderMensajeCliente, responderComoHumano, tomarConversacion, type MensajeEntrante } from './servicio';
import { MARCA_AVISO, MARCA_BAJA } from './redactor';
import { escenario, RepoEnMemoria } from './repo.fixture';
import { AHORA, T1 } from './datos.fixture';
import type { DepsVigia } from './puertos';
import type { EntradaEnvioCliente, ResultadoEnvioCliente } from './enviar';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function armar(repo: RepoEnMemoria) {
  const alCliente: EntradaEnvioCliente[] = [];
  const deps: DepsVigia = {
    repo,
    ahora: () => AHORA,
    enviarCliente: async (e): Promise<ResultadoEnvioCliente> => {
      alCliente.push(e);
      return { ok: true, via: 'texto', id: 'wamid.CLI', ventana: 'abierta' };
    },
    enviar: (async () => ({ ok: true, via: 'botones', id: 'wamid.GER', motivo: 'ventana_abierta', ventana: 'abierta' })) as unknown as DepsVigia['enviar'],
  };
  return { deps, alCliente };
}

let n = 0;
const msg = (texto: string): MensajeEntrante => {
  n += 1;
  return { from: '525511110001', type: 'text', text: texto, waMessageId: `wamid.${n}`, timestampMs: AHORA.getTime() };
};

beforeEach(() => { n = 0; });

describe('LEG-C19-C1 · la constancia del art. 16 sólo se escribe si salió el pie', () => {
  it('el gerente responde de cero a un contacto sin aviso: el texto NO lleva pie, así que la base NO puede afirmar que se entregó', async () => {
    const { repo, contacto } = escenario();
    const { deps, alCliente } = armar(repo);
    await atenderMensajeCliente(msg('hola'), deps);
    const conv = [...repo.conversaciones.values()][0];
    await tomarConversacion({ tenantId: T1, userId: 'u-gerente' }, conv.id, deps);

    // El contacto llega a este punto SIN constancia: es el caso que importa.
    contacto.avisoPrivacidadEn = null;

    const texto = 'Hola María, soy Luis, te marco en 5 minutos.';
    const r = await responderComoHumano({ tenantId: T1, userId: 'u-gerente' }, conv.id, texto, deps);
    expect(r.ok).toBe(true);

    // Lo que DE VERDAD salió: el texto del gerente, sin una palabra del pie.
    const salido = alCliente.at(-1)!.texto;
    expect(salido).toBe(texto);
    expect(salido).not.toContain(MARCA_AVISO);
    expect(salido).not.toContain(MARCA_BAJA);

    // Y por lo tanto la constancia no existe. Antes del arreglo, aquí había
    // una fecha: irreversible, y ese contacto no volvía a recibir el pie.
    expect(contacto.avisoPrivacidadEn).toBeNull();
  });

  it('si el texto que sale SÍ lleva las dos marcas del pie, la constancia se escribe (el camino legítimo no se rompe)', async () => {
    const { repo, contacto } = escenario();
    const { deps, alCliente } = armar(repo);
    await atenderMensajeCliente(msg('hola'), deps);
    const conv = [...repo.conversaciones.values()][0];
    await tomarConversacion({ tenantId: T1, userId: 'u-gerente' }, conv.id, deps);
    contacto.avisoPrivacidadEn = null;

    const conPie = `Hola María, te marco en 5 minutos.\n\nTus mensajes se atienden con apoyo de un asistente automatizado de Transportes del Norte. ${MARCA_AVISO} https://x.mx/p. ${MARCA_BAJA}.`;
    expect((await responderComoHumano({ tenantId: T1, userId: 'u-gerente' }, conv.id, conPie, deps)).ok).toBe(true);
    expect(alCliente.at(-1)!.texto).toContain(MARCA_BAJA);
    expect(contacto.avisoPrivacidadEn).toBe(AHORA.toISOString());
  });
});
