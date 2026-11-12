'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './conocimiento.css';
import { buscarNormas, PUEDE_AFIRMARSE, JERARQUIA_ROTULO, type Norma } from '@/lib/likida/normas/tipos';
import { Aviso, BotonEnlace, Chip, CampoTexto, Icono, MarcoPagina, SegmentedControl, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

type FiltroEstado = 'todas' | 'afirmables' | 'sin_verificar';

/**
 * CONOCIMIENTO NORMATIVO — de dónde saca Likida el fundamento, y de dónde saca la duda.
 *
 * El contador de una flota necesita saber con qué texto legal se calculó el estímulo de su liquidación: en un producto que emite
 * una opinión con consecuencias económicas, es justo lo que debe poder auditar. La pantalla enseña el ESTADO DE VERIFICACIÓN al
 * mismo nivel que el título: una ficha `sin_verificar` es una sobre la que Likida NO afirma nada, y quien la lea se entera antes
 * de decidir con ella (por eso el estado va en un `StatusChip` con texto, y el filtro «Sin verificar» existe).
 */
export function VistaConocimiento({ normas }: { normas: readonly Norma[] }) {
  const { t } = useT('resto', restoEs);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('todas');

  const porEstado = (n: Norma) => {
    if (estado === 'todas') return true;
    const puede = PUEDE_AFIRMARSE[n.estado_verificacion]?.puede === true;
    return estado === 'afirmables' ? puede : !puede;
  };

  const lista = useMemo(() => {
    const t = q.trim();
    // Sin búsqueda: por jerarquía (la ley primero) y luego por instrumento.
    const base = t === ''
      ? [...normas].sort((a, b) => (a.jerarquia - b.jerarquia) || a.instrumento.localeCompare(b.instrumento, 'es'))
      : buscarNormas(normas, t);
    return base.filter(porEstado);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `porEstado` solo depende de `estado`.
  }, [normas, q, estado]);

  const buscando = q.trim() !== '';
  const conteo = (f: FiltroEstado) =>
    f === 'todas' ? normas.length : normas.filter((n) => (PUEDE_AFIRMARSE[n.estado_verificacion]?.puede === true) === (f === 'afirmables')).length;

  return (
    <MarcoPagina titulo={t('cfg.conocimiento_normativo')} apoyo={t('cfg.las_fichas_de_las_que_depende')}>
      <Aviso tono="info">{t('cfg.esto_es_de_donde_sale_el')}</Aviso>

      <div className="rv-conocimiento__filtros">
        <CampoTexto
          tipo="search"
          id="norma-q"
          etiqueta={t('cfg.buscar_una_norma')}
          etiquetaOculta
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('cfg.peaje_20_a_diesel_carta_porte')}
        />
        <SegmentedControl<FiltroEstado>
          etiqueta={t('cfg.estado_de_verificacion')}
          valor={estado}
          onChange={setEstado}
          opciones={[
            { valor: 'todas', etiqueta: t('cfg.todas'), conteo: conteo('todas') },
            { valor: 'afirmables', etiqueta: t('cfg.se_puede_afirmar'), conteo: conteo('afirmables') },
            { valor: 'sin_verificar', etiqueta: t('cfg.sin_verificar'), conteo: conteo('sin_verificar') },
          ]}
        />
      </div>

      {lista.length === 0 ? (
        <Tarjeta titulo={t('cfg.fichas')} info="conocimiento.ficha" estado="vacio" mensaje={buscando ? t('cfg.ninguna_ficha_habla_de_eso') : t('cfg.no_hay_fichas_con_ese_estado')}
          detalle={buscando
            ? t('cfg.no_se_muestra_la_mas_parecida')
            : t('cfg.prueba_con_otro_estado_de_verificacion')} />
      ) : (
        lista.map((n) => {
          const v = PUEDE_AFIRMARSE[n.estado_verificacion];
          return (
            <Tarjeta
              key={n.id}
              titulo={n.titulo ?? n.instrumento}
              info="conocimiento.ficha"
              acciones={
                <>
                  <Chip>{JERARQUIA_ROTULO[n.jerarquia] ?? `Nivel ${n.jerarquia}`}</Chip>
                  <StatusChip tono={v?.puede ? 'ok' : 'warn'}>{v?.rotulo ?? n.estado_verificacion}</StatusChip>
                </>
              }
            >
              <p className="rv-conocimiento__instrumento">
                {n.instrumento}
                {n.articulo_o_regla ? ` · Art./regla ${n.articulo_o_regla}` : ''}
              </p>
              {v ? <p className="rv-conocimiento__nota" data-puede={v.puede || undefined}>{v.nota}</p> : null}
              {n.citasEnCodigo.length > 0 ? <p className="rv-conocimiento__nota">{t('cfg.se_aplica_como')}{' '}{n.citasEnCodigo.join(' · ')}</p> : null}
              <div className="rv-conocimiento__pie">
                {n.fuente_url ? (
                  <BotonEnlace href={n.fuente_url} tamano="sm" variante="secondary" target="_blank" rel="noopener noreferrer">{t('cfg.leer_la_fuente')}{' '}<Icono icono={ExternalLink} tam={14} />
                  </BotonEnlace>
                ) : null}
                {n.verificado_el ? <span className="rv-conocimiento__nota">{t('cfg.revisada_el')}{' '}{n.verificado_el}</span> : null}
              </div>
            </Tarjeta>
          );
        })
      )}
    </MarcoPagina>
  );
}
