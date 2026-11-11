import { cache } from 'react';
import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getAdquisicion } from '@/lib/admin/adquisicion';
import { listarCampanasConTotal, estadoIntegracionAds } from '@/lib/admin/campanas';
import { ControlCampanas } from './campanas';
import { accionPausarCampana, accionRefrescarGasto } from './acciones';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { contarProspectosPorEstado, ESTADOS_PROSPECTO, COMISION_PRIMER_MES, COMISION_RECURRENTE } from '@/lib/likida/vendedores';
import { getEmbudoActivacion, getCohortesUso } from '@/lib/admin/instrumentacion';
import { numero, fechaCorta, usd } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { AvisoCompacto, Aviso, Disclosure, FilaTarjetas, StatusChip, Tarjeta, TablaBase } from '../../ui-v2/componentes';
import { BarList, Columnas, TiraCifras } from '../../ui-v2/graficas';

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUES DE CRECIMIENTO (R9c): cada bloque es un componente de servidor async con su propia lectura, envuelto por `page.tsx` en su
// propio <Suspense> con un esqueleto compacto: un bloque lento ya no bloquea la página. Las lecturas son las MISMAS de antes (ninguna
// nueva); `cache()` las comparte entre bloques de una misma petición y cada una conserva su propio catch, o sea su propia leyenda honesta.
// ═══════════════════════════════════════════════════════════════════════════

const resumenNegocio = cache(() => getResumenNegocio().catch(() => null));
// El embudo de ADQUISICIÓN sí es real desde la 0105: cae por su lado a null y se DICE (un embudo vacío por base caída afirmaría que no hay pipeline).
const prospectosPorEstado = cache(() => contarProspectosPorEstado().catch(() => null));
// Costo por lead + alertas de adquisición (panel-de-adquisicion §2/§5): cae por su lado a null y se DICE.
const adquisicionAdmin = cache(() => getAdquisicion(ahoraMs()).catch(() => null));
// El control de campañas (0123, §4) — leer y pausar; jamás crear ni subir.
const campanasAdmin = cache(() => listarCampanasConTotal().catch(() => null));
// La mitad de PRODUCTO del funnel (0251): altas → activadas → de pago. null = no se pudo leer, y se dice.
const embudoActivacionAdmin = cache(() => getEmbudoActivacion().catch(() => null));
// Retención por cohortes sobre producto_evento (0251). Mes sin medición = null, jamás un 0% inventado.
const cohortesAdmin = cache(() => getCohortesUso().catch(() => null));

export async function BloqueIntro() {
  const r = await resumenNegocio();
  if (r === null) {
    return <Aviso tono="error" titulo="No se pudo leer el número de flotas">Esto NO significa que no haya ninguna: la base no respondió. Sin ese dato no se dice cuánto «crecimiento» hay que medir.</Aviso>;
  }
  // AUDITORÍA 10, ALTO — el título y el párrafo afirmaban una sola flota y "solo existe el tenant demo" como texto fijo: con la base en 0 tenants seguían afirmando que había una.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();
  const titulo = r.tenants === 0
    ? 'Sin flotas dadas de alta, todavía no hay "crecimiento" que medir'
    : `Con ${r.tenants} flota${r.tenants === 1 ? '' : 's'} dada${r.tenants === 1 ? '' : 's'} de alta, todavía no hay "crecimiento" que medir`;
  const historial = r.tenants === 0
    ? 'No hay ninguna flota dada de alta para graficar su historial de altas'
    : esSoloDemo ? 'No hay historial de altas de flota que graficar (solo existe la flota de demostración)' : 'No hay historial de altas de flota que graficar todavía';
  return (
    <AvisoCompacto
      tono="info"
      resumen={<><strong>{titulo}.</strong> {historial}, y Likida no tiene instrumentación de producto: ningún conteo de usuarios activos ni embudo de registro.</>}
      mas={`Con ${r.tenants === 0 ? 'cero flotas' : `n=${r.tenants}`} cualquier tendencia de crecimiento sería un número inventado, no una señal real.`}
    />
  );
}

export async function BloqueEmbudoAdquisicion() {
  const prospectos = await prospectosPorEstado();
  // El embudo de ADQUISICIÓN — real desde la 0105. Los prospectos del censo por estado del kanban. Es pipeline de PROSPECTOS, no de usuarios:
  // la conversión que se muestra es cerrados/total, y con cero cerrados se dice "sin cierres todavía" — jamás un 0% con cara de medición.
  if (prospectos === null) {
    return <Tarjeta titulo="Embudo de adquisición" estado="error" mensaje="No se pudo leer el pipeline. Esto NO significa que no haya prospectos." reintentar />;
  }
  if (prospectos.total === 0) {
    return <Tarjeta titulo="Embudo de adquisición" estado="vacio" mensaje="Sin prospectos en el censo" detalle="Aparecen cuando el Cerebro de ventas entrega los primeros." contenida />;
  }
  const { porEstado } = prospectos;
  const embudo = ESTADOS_PROSPECTO.filter((e) => e.valor !== 'lost').map((e) => ({ clave: e.valor, etiqueta: e.rotulo, valor: porEstado[e.valor], texto: numero(porEstado[e.valor]) }));
  return (
    <Tarjeta titulo={`Embudo de adquisición, ${numero(prospectos.total)} prospectos del censo`}>
      <BarList etiqueta="Prospectos por estado" items={embudo} formato={numero} />
      <p className="adm-din-nota">
        {porEstado.won > 0 ? `Conversión a cierre: ${porEstado.won} de ${numero(prospectos.total)}.` : 'Sin cierres todavía: la conversión no se inventa con cero cerrados.'}
        {porEstado.lost > 0 && ` ${numero(porEstado.lost)} perdidos.`}
        {' '}El detalle por vendedor vive en <Link href="/admin/vendedores">Vendedores</Link>; lo que espera tu aprobación, en <Link href="/admin/aprobaciones">Aprobaciones</Link>.
      </p>
    </Tarjeta>
  );
}

export async function BloqueCostoYCampanas() {
  const [adquisicion, campanas] = await Promise.all([adquisicionAdmin(), campanasAdmin()]);
  const integracionAds = estadoIntegracionAds();
  // Costo por lead + alertas (panel-de-adquisicion §2 y §5). La regla del §2: costo real solo donde es $0 POR DISEÑO; donde falta la
  // integración de gasto se dice, jamás un $0 de encuadre. Las alertas heredan sus umbrales de los documentos que ya los fijaron.
  if (adquisicion === null) {
    return <Tarjeta titulo="Costo por lead y alertas de adquisición" estado="error" mensaje="No se pudo leer la adquisición. Esto NO significa que no haya alertas." reintentar />;
  }
  return (
    <>
      {adquisicion.alertas.map((a) => <Aviso key={`${a.id}-${a.titulo}`} tono="warn" titulo={a.titulo}>{a.detalle}</Aviso>)}
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="Costo por lead, por fuente" estado={adquisicion.porFuente.length === 0 ? 'vacio' : 'ok'} mensaje="Sin leads capturados" detalle="Aparece en cuanto entra el primer lead de alguna fuente.">
          <TablaBase
            etiqueta="Costo por lead, por fuente" idFila={(f) => f.fuente} tarjetaMovil densa filas={adquisicion.porFuente}
            columnas={[
              { id: 'fuente', titulo: 'Fuente', principal: true, celda: (f) => f.fuente },
              { id: 'leads', titulo: 'Leads', alinear: 'der', celda: (f) => numero(f.leads) },
              { id: 'ultimo', titulo: 'Último', alinear: 'der', celda: (f) => (f.ultimoCapturado ? fechaCorta(f.ultimoCapturado) : '—') },
              {
                id: 'costo', titulo: 'Costo por lead', alinear: 'der',
                celda: (f) => (
                  <>
                    {f.costo ? usd(f.costo.usd) : 'no disponible'}
                    <span className="adm-din-sub">{f.costoNota}</span>
                  </>
                ),
              },
            ]}
          />
          {adquisicion.sinFuenteDeDatos.length > 0 ? (
            <p className="adm-din-nota">Alertas del plan sin fuente de datos todavía: {adquisicion.sinFuenteDeDatos.map((s) => `${s.alerta} (${s.falta})`).join(' · ')}.</p>
          ) : null}
        </Tarjeta>

        <Tarjeta titulo="Control de campañas" estado={campanas === null ? 'error' : 'ok'} mensaje="No se pudieron leer las campañas. Esto NO significa que no haya." reintentar>
          {campanas !== null ? (
            <>
              <ControlCampanas
                campanas={campanas.campanas}
                integracion={{ metaConfigurada: integracionAds.metaConfigurada }}
                leadsAds={adquisicion.porFuente.filter((f) => f.fuente === 'ads' || f.fuente === 'ads-meta' || f.fuente === 'ads-google').reduce((n, f) => n + f.leads, 0)}
                pausar={accionPausarCampana}
                refrescar={accionRefrescarGasto}
              />
              {campanas.total > campanas.campanas.length ? (
                <Aviso tono="warn">Se muestran las {campanas.campanas.length} campañas más recientes de {campanas.total}. «Actualizar gasto desde Meta» sí cubre todas las de Meta.</Aviso>
              ) : null}
            </>
          ) : null}
        </Tarjeta>
      </FilaTarjetas>
    </>
  );
}

export async function BloqueActivacion() {
  const embudoActivacion = await embudoActivacionAdmin();
  // El embudo de ACTIVACIÓN — la mitad de producto (0251), contado en la base: altas → con al menos una liquidación → con suscripción de pago
  // activa. Con null se dice «no se pudo leer»; con ceros se dicen los ceros — son conteos reales, no encuadre.
  if (embudoActivacion === null) {
    return <Tarjeta titulo="Embudo de activación" estado="error" mensaje="No se pudo leer el embudo de activación. Esto NO significa que haya cero flotas." reintentar />;
  }
  return (
    <Tarjeta titulo="Embudo de activación, de alta a de pago">
      <BarList
        etiqueta="Flotas por etapa de activación"
        items={[
          { clave: 'altas', etiqueta: 'Flotas dadas de alta', valor: embudoActivacion.altas, texto: numero(embudoActivacion.altas) },
          { clave: 'activadas', etiqueta: 'Activadas (con al menos una liquidación)', valor: embudoActivacion.activadas, texto: numero(embudoActivacion.activadas) },
          { clave: 'pago', etiqueta: 'De pago (suscripción activa)', valor: embudoActivacion.dePago, texto: numero(embudoActivacion.dePago) },
        ]}
        formato={numero}
      />
      <p className="adm-din-nota">
        Contado en la base sobre flotas, liquidaciones y suscripciones; las altas incluyen la flota de demostración.
        {embudoActivacion.dePago === 0 && ' El cero de «de pago» es un conteo real: ninguna suscripción está en estado activo todavía.'}
      </p>
    </Tarjeta>
  );
}

export async function BloqueCohortes() {
  const cohortes = await cohortesAdmin();
  // Retención por COHORTES — producto_evento (0251). La regla de honestidad vive en construirCohortes(): un mes anterior al primer evento
  // registrado es «no medido» (null), jamás un 0% — pintarle churn a los meses pre-medición sería inventar.
  if (cohortes === null) {
    return <Tarjeta titulo="Retención por cohortes" estado="error" mensaje="No se pudieron leer las cohortes. Esto NO significa que no haya uso." reintentar />;
  }
  return (
    <Tarjeta titulo="Retención por cohortes, uso del panel por mes de alta" estado={cohortes.filas.length === 0 ? 'vacio' : 'ok'} mensaje="Sin flotas dadas de alta" detalle="No hay cohorte que armar hasta que haya al menos una flota.">
      <TablaBase
        etiqueta="Cohortes por mes de alta" idFila={(f) => f.cohorte} tarjetaMovil densa filas={cohortes.filas}
        columnas={[
          { id: 'cohorte', titulo: 'Cohorte (mes de alta)', principal: true, celda: (f) => f.cohorte },
          { id: 'flotas', titulo: 'Flotas', alinear: 'der', celda: (f) => numero(f.flotas) },
          {
            id: 'meses', titulo: 'Flotas con uso, mes a mes',
            celda: (f) => (
              <span className="adm-din-acciones">
                {f.celdas.map((c) => (
                  <StatusChip key={c.mes} tono={c.activas === null ? 'muted' : 'neutral'} title={c.mes}>
                    {c.mes.slice(5)}{' · '}{c.activas === null ? 'no medido' : `${numero(c.activas)}/${numero(f.flotas)}`}{c.enCurso && c.activas !== null ? ' (en curso)' : ''}
                  </StatusChip>
                ))}
              </span>
            ),
          },
        ]}
      />
      <p className="adm-din-nota">
        {cohortes.desdeMedicion === null
          ? 'La medición de uso todavía no registra un solo evento: cada celda dice «no medido», que no es un 0 %. La matriz se llena sola conforme el panel se use.'
          : `La medición empezó en ${cohortes.desdeMedicion}; los meses anteriores se pintan «no medido», nunca 0. El mes en curso está incompleto por definición.`}
        {' '}Con pocas flotas la cohorte describe, no concluye: necesita más de 1 cliente real para decir algo general.
      </p>
    </Tarjeta>
  );
}

export async function BloqueUso() {
  const r = await resumenNegocio();
  if (r === null) {
    return <Tarjeta titulo="Uso de la plataforma en el tiempo" estado="error" mensaje="No se pudo leer el uso de la plataforma. Esto NO significa que no se use." reintentar />;
  }
  const serieTokens = r.porDia.slice(-8).map((d) => d.tokens);
  return (
    <>
      <Tarjeta titulo="Uso de la plataforma en el tiempo" estado={r.porDia.length > 1 ? 'ok' : 'vacio'} mensaje="Sin historial suficiente" detalle="Hacen falta al menos dos días con registro para dibujar la serie.">
        <p className="adm-din-nota">No es una métrica de usuarios: es el gasto real de IA por día, el proxy más honesto que existe hoy de cuánto se está usando Likida.</p>
        <Columnas etiqueta="Gasto de IA por día" datos={r.porDia.map((d) => ({ etiqueta: d.dia.slice(5), largo: d.dia, valor: d.costoUsd }))} formato="usd" vacio="Sin gasto registrado" />
      </Tarjeta>
      <TiraCifras etiqueta="Uso de la plataforma" items={[
        { etiqueta: 'Viajes procesados', valor: r.viajesProcesados, formato: 'entero' },
        { etiqueta: 'Tokens usados', valor: r.tokensIn + r.tokensOut, formato: 'numero', delta: r.tendenciaTokens === null ? null : { texto: `${Math.abs(r.tendenciaTokens)} % vs los 7 días anteriores`, dir: r.tendenciaTokens > 0 ? 'sube' : r.tendenciaTokens < 0 ? 'baja' : 'igual' }, serie: serieTokens },
      ]} />
    </>
  );
}

export function BloqueSinInstrumentacion() {
  // El embudo activados → de pago y la retención por cohortes SALIERON de esta lista (0251): ya se miden. Lo que queda tiene cada uno su razón.
  const sinInstrumentacion = [
    'Usuarios activos por día, semana y mes: el registro de uso guarda a propósito solo la FLOTA, nunca al usuario (minimización de datos); contarlos exigiría una dimensión que se decidió no recolectar.',
    'NPS: necesita encuestas que no existen.',
    'Adopción por función: se mide qué pantalla se abre, no qué se completa; eso necesita acciones de grano fino que aún no se emiten.',
  ];
  return (
    <>
      <Tarjeta titulo="Comisiones de vendedores" estado="vacio" mensaje="Falta: aún no hay base para calcularlas"
        detalle={`El esquema solo existe como regla (${Math.round(COMISION_PRIMER_MES * 100)} % el primer mes y ${Math.round(COMISION_RECURRENTE * 100)} % recurrente): no hay registro de comisiones ni liga de prospecto a flota y a factura pagada. Calcularlas hoy sería inventar una cifra.`}
        contenida />
      <Disclosure titulo="Lo que esta página todavía no puede mostrar" resumen={`${sinInstrumentacion.length} cosas, cada una con su razón`}>
        <ul className="adm-din-lista">
          {sinInstrumentacion.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="adm-din-nota">Cada renglón dice su propia razón; el embudo de activación y las cohortes se miden arriba.</p>
      </Disclosure>
    </>
  );
}
