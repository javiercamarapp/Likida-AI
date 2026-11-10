import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getConsumoPorAgente, getPresupuestoPorProposito, type Insight, type GastoProposito } from '@/lib/admin/consumo';
import { avisosDeTopeEncendidos, DIAS_SIN_REGISTRO_AVISO, diasSinRegistroIa, leerEstadoCreditoIa, type EstadoCreditoIa } from '@/lib/admin/estado-ia';
import { listarAlertasTopeRecientes, type FilaAlertaTope } from '@/lib/llm/repo';
import { ahoraMs } from '@/lib/saludo';
import { hoyMx, numero, usd } from '@/lib/formato';
import { Aviso, BotonEnlace, Disclosure, EstadoError, FilaTarjetas, MarcoPagina, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, Columnas, TiraCifras } from '@/app/ui-v2/graficas';

import '../dinero.css';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/consumo — A DÓNDE Y POR QUÉ SE VA EL DINERO DE IA. Por agente, por flota, por modelo y por fase, con la serie diaria, los
// insights deterministas (cada uno una regla con su dato, jamás un LLM opinando) y, arriba, lo que hace que TODA la IA se detenga:
// el crédito del proveedor (402) y los avisos de 80 % y 100 % del techo diario. Cada lectura cae por su lado: lo que no se pudo medir
// se dice, nunca se pinta como cero.
// ═══════════════════════════════════════════════════════════════════════════

const TONO_INSIGHT: Record<Insight['tipo'], { tono: TonoEstado; rotulo: string }> = {
  problema: { tono: 'bad', rotulo: 'Problema' },
  recomendacion: { tono: 'warn', rotulo: 'Recomendación' },
  insight: { tono: 'neutral', rotulo: 'Dato' },
};

/** Cuántos días hacia atrás se listan los avisos de tope. */
const DIAS_AVISOS_TOPE = 7;

const FASE_ROTULO: Record<string, string> = {
  ocr: 'Lectura de comprobantes', cuadre: 'Cuadre', escalacion: 'Escalación', chat: 'Chat', router: 'Enrutador', whatsapp: 'WhatsApp',
};

/** Texto del estado del crédito: qué pasa, qué consecuencia tiene y qué hacer. Sin variables de entorno ni jerga. */
function textoCredito(c: EstadoCreditoIa): { tono: 'error' | 'warn' | null; titulo: string; texto: string } {
  switch (c.clave) {
    case 'sin_saldo':
      return { tono: 'error', titulo: 'Crédito de IA agotado (402)', texto: 'El proveedor rechaza toda llamada: la IA está caída, el cuadre se degrada y las fotos esperan. Recarga el saldo en OpenRouter.' };
    case 'llave_invalida':
      return { tono: 'error', titulo: 'El proveedor rechazó la llave de IA (401)', texto: 'Toda la IA está caída. Hay que rotar o reponer la llave del proveedor.' };
    case 'sin_llave':
      return { tono: 'error', titulo: 'No hay llave de IA configurada', texto: 'Sin llave no hay IA: el cuadre se degrada y las fotos esperan. Falta configurarla en el entorno de producción.' };
    case 'sin_permiso':
      return { tono: 'warn', titulo: 'El proveedor negó una petición (403)', texto: 'Puede ser un modelo no permitido o moderación. Si se repite en todas las llamadas, revisa la llave.' };
    case 'inalcanzable':
      return { tono: 'warn', titulo: 'No se pudo comprobar el crédito de IA', texto: 'El proveedor no contestó la prueba. No se sabe si hay saldo; vuelve a intentarlo en un momento.' };
    case 'sin_dato':
      return { tono: 'warn', titulo: 'No se pudo comprobar el crédito de IA', texto: 'La prueba de la llave no terminó a tiempo. No se sabe si hay saldo; vuelve a intentarlo en un momento.' };
    default:
      return { tono: null, titulo: '', texto: '' };
  }
}

function cifraCredito(c: EstadoCreditoIa) {
  const t = textoCredito(c);
  if (c.clave === 'ok') {
    return c.restanteUsd === null
      ? { valor: 'Con crédito', nota: 'El proveedor no reporta un saldo restante para esta llave.', tono: 'ok' as const }
      : { valor: usd(c.restanteUsd), nota: 'Saldo restante que reporta el proveedor.', tono: c.restanteUsd < 5 ? ('warn' as const) : ('ok' as const) };
  }
  const caido = c.clave === 'sin_saldo' || c.clave === 'llave_invalida' || c.clave === 'sin_llave';
  return { valor: caido ? 'IA caída' : null, nota: t.titulo, tono: caido ? ('bad' as const) : ('warn' as const) };
}

const dia = (aaaammdd: string) => {
  const [y, m, d] = aaaammdd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : aaaammdd;
};

export default async function ConsumoPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const hoy = hoyMx();
  const desdeAvisos = (() => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (DIAS_AVISOS_TOPE - 1)); return d.toISOString().slice(0, 10); })();
  // Resiliencia POR SECCIÓN: el gasto del producto y el del back office caen por su lado; lo que no cargó LO DICE.
  const [r, consumo, proposito, credito, avisos] = await Promise.all([
    getResumenNegocio().catch(() => null),
    getConsumoPorAgente(ahoraMs()).catch(() => null),
    getPresupuestoPorProposito().catch(() => null),
    leerEstadoCreditoIa(),
    listarAlertasTopeRecientes(desdeAvisos).catch(() => null),
  ]);
  const todoCaido = r === null && consumo === null;

  const textoCred = textoCredito(credito);
  const cifraCred = cifraCredito(credito);
  const problemas = (consumo?.insights ?? []).filter((i) => i.tipo === 'problema');
  const resto = (consumo?.insights ?? []).filter((i) => i.tipo !== 'problema');
  const diasSin = r ? diasSinRegistroIa(r.porDia, hoy) : null;
  const avisosEncendidos = avisosDeTopeEncendidos();
  const costoPorViaje = r && r.viajesProcesados > 0 ? r.costoIaUsd / r.viajesProcesados : null;
  const corridas = consumo ? consumo.agentes.reduce((s, a) => s + a.corridas30d, 0) : null;
  const fallos = consumo ? consumo.agentes.reduce((s, a) => s + a.fallos30d, 0) : null;
  const gastoAgentes = consumo ? consumo.agentes.reduce((s, a) => s + a.gastado30dUsd, 0) : null;

  return (
    <MarcoPagina titulo="Consumo de IA" apoyo="A dónde se va el dinero de IA, con el estado del crédito y los avisos de tope.">
      {todoCaido ? <EstadoError reintentar>No se pudo leer el consumo: la base no respondió. Esto NO significa que la IA salga gratis.</EstadoError> : <>
      {textoCred.tono ? <Aviso tono={textoCred.tono} titulo={textoCred.titulo}>{textoCred.texto}</Aviso> : null}
      {!avisosEncendidos ? (
        <Aviso tono="warn" titulo="Los avisos de tope están apagados">
          Una flota puede llegar al 80 % o al 100 % de su techo diario sin que nadie reciba el aviso. Encenderlos es decisión del dueño.
        </Aviso>
      ) : null}
      {diasSin !== null && diasSin >= DIAS_SIN_REGISTRO_AVISO ? (
        <Aviso tono="warn" titulo={`Sin llamadas de IA registradas desde hace ${numero(diasSin)} días`}>
          Puede ser que no haya habido tráfico, o que la IA haya estado caída: revisa el crédito del proveedor y la llave.
        </Aviso>
      ) : null}
      {problemas.map((i) => <Aviso key={i.titulo} tono="error" titulo={i.titulo}>{i.detalle}</Aviso>)}

      <TiraCifras etiqueta="Gasto de IA" items={[
        r
          ? { etiqueta: 'Gastado en IA, histórico', valor: r.costoIaUsd, formato: 'usd', deltaPct: r.tendenciaCosto === null ? null : { pct: r.tendenciaCosto, bueno: r.tendenciaCosto < 0 }, deltaNota: 'últimos 7 días vs los 7 anteriores' }
          : { etiqueta: 'Gastado en IA, histórico', valor: null, estado: 'error', reintentar: true },
        r
          ? { etiqueta: 'Costo por viaje procesado', valor: costoPorViaje, formato: 'usd', nota: costoPorViaje === null ? 'Aún no hay viajes procesados para estimarlo.' : 'Estimado: gasto total de IA entre viajes procesados.', tipo: 'estimado' }
          : { etiqueta: 'Costo por viaje procesado', valor: null, estado: 'error', reintentar: true },
        consumo
          ? { etiqueta: 'Agentes, últimos 30 días', valor: gastoAgentes, formato: 'usd', nota: `${numero(corridas ?? 0)} corridas, ${numero(fallos ?? 0)} en fallo.` }
          : { etiqueta: 'Agentes, últimos 30 días', valor: null, estado: 'error', mensaje: 'La medición por agente no se pudo leer ahora.', reintentar: true },
        { etiqueta: 'Crédito del proveedor', valor: cifraCred.valor, nota: cifraCred.nota, tono: cifraCred.tono, estado: cifraCred.valor === null ? 'vacio' : 'ok', mensaje: 'No se pudo comprobar' },
      ]} />

      <FilaTarjetas variante="8-4">
        <Tarjeta titulo="Gasto de IA por día" estado={r && r.porDia.length > 1 ? 'ok' : r ? 'vacio' : 'error'} contenida={!!r && r.porDia.length <= 1} mensaje={r ? 'Sin historial suficiente' : undefined} detalle="Hacen falta al menos dos días con registro para dibujar la serie." reintentar>
          {r ? (
            <>
              <Columnas etiqueta="Gasto de IA por día" datos={r.porDia.map((d) => ({ etiqueta: d.dia.slice(5), largo: dia(d.dia), valor: d.costoUsd }))} formato="usd" vacio="Sin gasto registrado" />
              <p className="adm-din-nota">Tokens usados, histórico: {numero(r.tokensIn)} de entrada y {numero(r.tokensOut)} de salida.</p>
            </>
          ) : null}
        </Tarjeta>
        <AvisosDeTope avisos={avisos} encendidos={avisosEncendidos} />
      </FilaTarjetas>

      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="Por modelo" estado={!r ? 'error' : r.porModelo.length === 0 ? 'vacio' : 'ok'} mensaje={r ? 'Sin llamadas registradas' : 'No se pudo leer'} detalle="Aparece en cuanto el producto haga su primera llamada de IA." reintentar
          acciones={<BotonEnlace href="/admin/costos-facturacion" variante="ghost" tamano="sm">Ver cobro</BotonEnlace>}>
          {r ? <BarList etiqueta="Gasto por modelo" items={r.porModelo.slice(0, 8).map((m) => ({ clave: m.modelo, etiqueta: m.modelo, valor: m.costoUsd, texto: usd(m.costoUsd), nota: `${numero(m.n)} llamadas` }))} formato={usd} /> : null}
        </Tarjeta>
        <Tarjeta titulo="Por fase" estado={!r ? 'error' : r.porFase.length === 0 ? 'vacio' : 'ok'} mensaje={r ? 'Sin llamadas registradas' : 'No se pudo leer'} detalle="Muestra en qué trabajo se gasta: lectura, cuadre, chat." reintentar>
          {r ? <BarList etiqueta="Gasto por fase" items={r.porFase.slice(0, 8).map((f) => ({ clave: f.fase, etiqueta: FASE_ROTULO[f.fase] ?? f.fase, valor: f.costoUsd, texto: usd(f.costoUsd), nota: `${numero(f.n)} llamadas` }))} formato={usd} /> : null}
        </Tarjeta>
      </FilaTarjetas>

      <Tarjeta titulo="Por agente, gasto medido contra su techo" estado={consumo ? 'ok' : 'error'} mensaje="La medición por agente no se pudo leer" reintentar>
        {consumo ? (
          <TablaBase
            etiqueta="Consumo por agente en 30 días" idFila={(a) => a.agente} tarjetaMovil densa
            vacio={{ titulo: 'Sin agentes con registro', texto: 'Aparecen cuando un agente corre y deja su costo.' }}
            filas={consumo.agentes}
            columnas={[
              { id: 'agente', titulo: 'Agente', principal: true, celda: (a) => <>{a.agente} <StatusChip tono={a.estado === 'vivo' ? 'ok' : 'neutral'}>{a.estado}{a.runnerHabilitado ? ' · automático' : ''}</StatusChip></> },
              { id: 'corridas', titulo: 'Corridas 30 d', alinear: 'der', celda: (a) => numero(a.corridas30d) },
              { id: 'fallos', titulo: 'Fallos', alinear: 'der', celda: (a) => (a.fallos30d > 0 ? <StatusChip tono="bad">{numero(a.fallos30d)}</StatusChip> : numero(a.fallos30d)) },
              { id: 'gasto', titulo: 'Gasto 30 d', alinear: 'der', celda: (a) => usd(a.gastado30dUsd) },
              { id: 'techo', titulo: 'Hoy contra su techo', alinear: 'der', celda: (a) => (a.techoDiaUsd === null ? 'Sin techo declarado' : `${numero(a.pctTechoHoy ?? 0)} % de ${usd(a.techoDiaUsd)}`) },
            ]}
          />
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="Por flota, costo de IA histórico" estado={!r ? 'error' : r.flotas.length === 0 ? 'vacio' : 'ok'} mensaje={r ? 'Sin flotas dadas de alta' : 'No se pudo leer el costo por flota'} detalle="Cada flota aparece aquí en cuanto se da de alta." reintentar>
        {r ? (
          <TablaBase
            etiqueta="Costo de IA por flota" idFila={(f) => f.id} tarjetaMovil densa
            filas={[...r.flotas].sort((a, b) => b.costoIaUsd - a.costoIaUsd)}
            columnas={[
              { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.nombre },
              { id: 'viajes', titulo: 'Viajes', alinear: 'der', celda: (f) => numero(f.viajes) },
              { id: 'costo', titulo: 'Costo de IA, todo el tiempo', alinear: 'der', celda: (f) => usd(f.costoIaUsd) },
            ]}
          />
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="Presupuesto por propósito, hoy" estado={proposito ? (proposito.filas.length === 0 ? 'vacio' : 'ok') : 'error'} mensaje={proposito ? 'Hoy nadie ha gastado todavía' : 'No se pudo leer el gasto por propósito'} detalle="Día de México. Aparece con la primera llamada de IA de hoy." reintentar>
        {proposito ? (
          <>
            <p className="adm-din-nota">
              Techo diario por flota: {usd(proposito.topeTenantDiaUsd)}. Reserva del camino interactivo (chofer y chats): {usd(proposito.reservaInteractivoUsd)} ({Math.round(proposito.fraccionReserva * 100)} %).
              El trabajo de fondo (lectura de lote y agentes) solo llega a {usd(proposito.topeTenantDiaUsd - proposito.reservaInteractivoUsd)}.
            </p>
            <TablaBase
              etiqueta="Gasto de hoy por flota y propósito" idFila={(f: GastoProposito) => `${f.tenantId}-${f.proposito}`} tarjetaMovil densa
              filas={proposito.filas}
              columnas={[
                { id: 'flota', titulo: 'Flota', principal: true, celda: (f: GastoProposito) => f.tenantNombre },
                { id: 'prop', titulo: 'Propósito', celda: (f: GastoProposito) => f.proposito },
                { id: 'n', titulo: 'Llamadas', alinear: 'der', celda: (f: GastoProposito) => numero(f.n) },
                { id: 'liq', titulo: 'Liquidado hoy', alinear: 'der', celda: (f: GastoProposito) => usd(f.liquidadoUsd) },
                { id: 'res', titulo: 'Reservado vivo', alinear: 'der', celda: (f: GastoProposito) => usd(f.reservadoVivoUsd) },
                {
                  id: 'techo', titulo: 'Contra su techo', alinear: 'der',
                  celda: (f: GastoProposito) => {
                    // El techo del propósito: el fondo tiene (tope − reserva); el interactivo, el tope completo.
                    const techo = f.proposito === 'interactivo' ? proposito.topeTenantDiaUsd : proposito.topeTenantDiaUsd - proposito.reservaInteractivoUsd;
                    const pct = techo > 0 ? Math.min(100, Math.round(((f.liquidadoUsd + f.reservadoVivoUsd) / techo) * 100)) : 100;
                    return <StatusChip tono={pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok'}>{pct} % de {usd(techo)}</StatusChip>;
                  },
                },
              ]}
            />
          </>
        ) : null}
      </Tarjeta>

      {resto.length > 0 ? (
        <Tarjeta titulo="Recomendaciones, reglas con su dato">
          <ul className="adm-din-lista">
            {resto.map((i) => (
              <li key={i.titulo}>
                <StatusChip tono={TONO_INSIGHT[i.tipo].tono}>{TONO_INSIGHT[i.tipo].rotulo}</StatusChip>
                <strong>{i.titulo}</strong> <span>{i.detalle}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}

      <Disclosure titulo="Cómo se mide y qué no se mide">
        <p className="adm-din-nota">
          El gasto del producto sale del registro de cada llamada de IA; el de los agentes de Likida, del costo que deja cada corrida. El crédito se
          comprueba con una consulta al proveedor que no genera tokens ni cuesta. Un dato que no se pudo leer se dice como «sin dato»: nunca es cero.
        </p>
      </Disclosure>
      </>}
    </MarcoPagina>
  );
}

function AvisosDeTope({ avisos, encendidos }: { avisos: FilaAlertaTope[] | null; encendidos: boolean }) {
  const titulo = `Avisos de tope, últimos ${DIAS_AVISOS_TOPE} días`;
  if (avisos === null) return <Tarjeta titulo={titulo} estado="error" mensaje="No se pudieron leer los avisos de tope" reintentar />;
  if (avisos.length === 0) {
    return (
      <Tarjeta
        titulo={titulo} estado="vacio" contenida mensaje="Ningún aviso registrado"
        detalle={encendidos ? 'Ninguna flota cruzó el 80 % de su techo diario en estos días.' : 'Los avisos están apagados: no se sabe si alguna flota cruzó su techo.'}
        accionVacio={<BotonEnlace href="/admin/techo-ia" variante="secondary" tamano="sm">Ver techos</BotonEnlace>}
      />
    );
  }
  return (
    <Tarjeta titulo={titulo} acciones={<BotonEnlace href="/admin/techo-ia" variante="ghost" tamano="sm">Ver techos</BotonEnlace>}>
      <TablaBase
        etiqueta="Avisos de tope de IA" idFila={(a) => `${a.tenantId}-${a.dia}-${a.nivel}`} densa tarjetaMovil
        filas={avisos}
        columnas={[
          { id: 'flota', titulo: 'Flota', principal: true, celda: (a) => a.tenantNombre },
          { id: 'nivel', titulo: 'Nivel', celda: (a) => <StatusChip tono={a.nivel === 100 ? 'bad' : 'warn'}>{a.nivel} %</StatusChip> },
          { id: 'dia', titulo: 'Día', celda: (a) => dia(a.dia) },
          { id: 'uso', titulo: 'Uso de su techo', alinear: 'der', celda: (a) => `${usd(a.usoUsd)} de ${usd(a.topeUsd)}` },
        ]}
      />
    </Tarjeta>
  );
}

export const metadata: Metadata = { title: 'Consumo de IA' };
