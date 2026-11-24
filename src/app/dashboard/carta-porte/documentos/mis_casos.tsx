import { numero } from '@/lib/formato';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import type { CasoRevisor, FuenteFaltante, MedicionRevisor } from '@/lib/likida/carta_porte_docs/mis_casos';
import { BotonEnlace, Tarjeta } from '@/app/ui-v2/componentes';

/**
 * «MIS CASOS» — lo que le toca revisar a ESTA persona y cómo va su revisión.
 *
 * Pura props. Cada cifra dice de dónde sale; lo que no se puede medir lo dice («aún no medible: falta …») y NUNCA se pinta
 * como un 0. Los casos son los documentos «por revisar» asignados a la persona; la medición es de los que ella aprobó.
 * No muestra porcentajes de acierto: los del conjunto sintético de evaluación no son de documentos reales y no van aquí.
 */

const MAX_PROBLEMAS_VISIBLES = 5;

/** «hace 3 h» / «hace 2 días»; sin fecha válida no se inventa una antigüedad. */
export function antiguedadTexto(horas: number | null, tr: Tr = trEs): string {
  if (horas === null) return tr('cartaPorte.documentos.misCasos.sinFecha');
  if (horas < 1) return tr('cartaPorte.documentos.misCasos.haceMenosDeUnaHora');
  if (horas < 48) return tr('cartaPorte.documentos.misCasos.haceHoras', { n: numero(Math.floor(horas)) });
  return tr('cartaPorte.documentos.misCasos.haceDias', { n: numero(Math.floor(horas / 24)) });
}

const fuenteTexto = (f: FuenteFaltante, tr: Tr): string => ({
  aprobados_de_la_persona: tr('cartaPorte.documentos.misCasos.faltaAprobados'),
  marca_de_apertura: tr('cartaPorte.documentos.misCasos.faltaApertura'),
  correcciones_del_periodo: tr('cartaPorte.documentos.misCasos.faltaCorrecciones'),
})[f];

function Medida({ etiqueta, valor, nota, falta, tr }: { etiqueta: string; valor: string | null; nota: string | null; falta: FuenteFaltante | null; tr: Tr }) {
  return (
    <div className="rv-doc__cifra" data-medible={valor === null ? 'no' : 'si'}>
      <dt>{etiqueta}</dt>
      <dd className="rv-doc__cifra-valor">{valor ?? '—'}</dd>
      <dd className="rv-doc__sub">
        {valor === null && falta !== null ? tr('cartaPorte.documentos.misCasos.aunNoMedible', { fuente: fuenteTexto(falta, tr) }) : nota}
      </dd>
    </div>
  );
}

function Resumen({ m, parcial, tr }: { m: MedicionRevisor; parcial?: { leidos: number; total: number }; tr: Tr }) {
  return (
    <div>
      <dl className="rv-doc__cifras" aria-label={tr('cartaPorte.documentos.misCasos.tuMedicion')}>
        <Medida tr={tr} etiqueta={tr('cartaPorte.documentos.misCasos.casosRevisados')}
          valor={m.casosRevisados === null ? null : numero(m.casosRevisados)} falta={m.faltaCasos}
          nota={tr('cartaPorte.documentos.misCasos.notaCasos')} />
        <Medida tr={tr} etiqueta={tr('cartaPorte.documentos.misCasos.tiempoMedio')}
          valor={m.minutosPromedio === null ? null : `${numero(m.minutosPromedio)} min`} falta={m.faltaTiempo}
          nota={tr('cartaPorte.documentos.misCasos.notaTiempo', { v: numero(m.conTiempoMedido), v2: numero(m.casosRevisados ?? 0) })} />
        <Medida tr={tr} etiqueta={tr('cartaPorte.documentos.misCasos.camposCorregidos')}
          valor={m.camposCorregidos === null ? null : numero(m.camposCorregidos)} falta={m.faltaCorrecciones}
          nota={tr('cartaPorte.documentos.misCasos.notaCorregidos')} />
      </dl>
      {parcial && (
        <p className="rv-doc__nota">{tr('cartaPorte.documentos.misCasos.parcial', { v: numero(parcial.leidos), v2: numero(parcial.total) })}</p>
      )}
    </div>
  );
}

function Caso({ c, nombreCliente, sufijo, tr }: { c: CasoRevisor; nombreCliente: string | null; sufijo: string; tr: Tr }) {
  const visibles = c.problemas.slice(0, MAX_PROBLEMAS_VISIBLES);
  const resto = c.problemas.length - visibles.length;
  return (
    <li className="rv-doc__caso" data-testid="mis-casos-caso">
      <div className="rv-doc__caso-cabeza">
        <div>
          <span className="rv-doc__archivo">{c.nombreArchivo}</span>
          <span className="rv-doc__sub">{nombreCliente ? `${nombreCliente} · ` : ''}{antiguedadTexto(c.antiguedadHoras, tr)}</span>
        </div>
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/carta-porte/documentos/${c.id}${sufijo}`}>{tr('cartaPorte.documentos.vista.revisar')}</BotonEnlace>
      </div>
      {!c.conLectura ? (
        <p className="rv-doc__sub">{tr('cartaPorte.documentos.misCasos.sinLectura')}</p>
      ) : (
        <>
          <p className="rv-doc__marcas" aria-label={tr('cartaPorte.documentos.misCasos.estadoPorCampo')}>
            <span data-tono="ok" title={tr('cartaPorte.documentos.misCasos.marcaOk')}>✔ {numero(c.ok)}</span>
            <span data-tono="warn" title={tr('cartaPorte.documentos.misCasos.marcaConfirmar')}>◐ {numero(c.porConfirmar)}</span>
            <span data-tono="bad" title={tr('cartaPorte.documentos.misCasos.marcaBloqueo')}>✗ {numero(c.bloqueados)}</span>
          </p>
          {visibles.length > 0 && (
            <ul className="rv-doc__detalles">
              {visibles.map((p, i) => (
                <li key={`${p.rotulo}-${i}`}>
                  <strong data-tono={p.marca === '✗' ? 'bad' : 'warn'}>{p.marca} {p.rotulo}</strong>
                  {p.conflicto ? ` · ${tr('cartaPorte.documentos.misCasos.enConflicto')}` : ''} — {p.motivo}
                </li>
              ))}
              {resto > 0 && <li className="rv-doc__sub">{tr('cartaPorte.documentos.misCasos.yMas', { n: numero(resto) })}</li>}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function MisCasos({ casos, medicion, clientes, parcial, sufijo = '', tr = trEs }: {
  casos: CasoRevisor[]; medicion: MedicionRevisor | null; clientes: Array<{ id: string; nombre: string }>;
  parcial?: { leidos: number; total: number }; sufijo?: string; tr?: Tr;
}) {
  const nombre = new Map(clientes.map((c) => [c.id, c.nombre]));
  return (
    <Tarjeta titulo={tr('cartaPorte.documentos.vista.misCasos')}>
      <div className="rv-doc__forma">
        {medicion === null
          ? <p className="rv-doc__nota">{tr('cartaPorte.documentos.misCasos.medicionNoDisponible')}</p>
          : <Resumen m={medicion} parcial={parcial} tr={tr} />}
        {/* Sin casos no se pinta una lista vacía: la bandeja de abajo ya dice qué falta y qué le toca a todos. */}
        {casos.length > 0 && (
          <ul className="rv-doc__lista-casos" aria-label={tr('cartaPorte.documentos.misCasos.casosPorRevisar')}>
            {casos.map((c) => <Caso key={c.id} c={c} nombreCliente={c.clienteId ? nombre.get(c.clienteId) ?? null : null} sufijo={sufijo} tr={tr} />)}
          </ul>
        )}
      </div>
    </Tarjeta>
  );
}
