'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Lock, Plus, Ban } from 'lucide-react';
import { TZ_MX } from '@/lib/formato';
import { ROTULO_PROCEDENCIA, type Asiento, type JornadaCompuesta } from '@/lib/likida/jornada/modelo';
import type { RiesgoDia, PoliticaFlota } from '@/lib/likida/jornada/riesgo';
import { AvisoResultado, Boton as BotonDs, Campo, Casilla, CampoSelect, CampoTexto, Disclosure, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import './jornada.css';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

// ═══════════════════════════════════════════════════════════════════════════
// LAS CORRECCIONES DEL CONTRALOR — y por qué ninguna sobreescribe una hora.
//
// No hay en este archivo un solo formulario que edite un `momento`. Corregir
// una marca son DOS actos, en este orden:
//
//   1. ANULARLA, con un motivo escrito. La marca se queda en el expediente,
//      con quién la anuló y cuándo.
//   2. CAPTURAR la correcta, que queda con procedencia `capturado_contralor`,
//      el correo de quien la capturó y la hora en que lo hizo.
//
// La alternativa —un campo de hora que se guarda encima— es más cómoda y
// destruye el documento: un registro laboral que se puede editar sin dejar
// rastro no solo deja de probar lo que dice, prueba que se toca. Y el art. 805
// de la LFT convierte el desaseo de este expediente en una presunción a favor
// de quien demanda.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccion = { ok: boolean; mensaje?: string; error?: string };
export type AccionJornada = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

const VACIO: ResultadoAccion = { ok: true };

function Boton({ texto, cargando, icono }: { texto: string; cargando: string; icono?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <BotonDs type="submit" variante="primary" loading={pending} icono={icono}>
      {pending ? cargando : texto}
    </BotonDs>
  );
}

/** El aviso del resultado: el UNICO del panel (`admin/ui/aviso-resultado`). El error
 *  del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX,
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

const ROTULO_TIPO: Record<string, string> = {
  inicio_jornada: 'Inicio de jornada',
  fin_jornada: 'Fin de jornada',
  inicio_descanso: 'Inicio de descanso',
  fin_descanso: 'Fin de descanso',
};

export interface FilaAbierta {
  jornadaId: string;
  operadorNombre: string;
  dia: string;
  estado: 'abierto' | 'cerrado';
  cerradoPorEmail: string | null;
  conformeOperadorEn: string | null;
  jornada: JornadaCompuesta;
  riesgo: RiesgoDia;
}

export function FormasJornada({
  fila, puedeCorregir, anularMarca, capturarMarca, cerrarElDia,
}: {
  fila: FilaAbierta;
  puedeCorregir: boolean;
  anularMarca: AccionJornada;
  capturarMarca: AccionJornada;
  cerrarElDia: AccionJornada;
}) {
  const { t } = useT('operacion', operacionEs);
  // `sueltos` VA EN LA LISTA. Son marcas vivas que no encajaron (un regreso de
  // descanso sin salida, típicamente). Dejarlas fuera las volvería invisibles e
  // imposibles de anular desde aquí: seguirían en la base, fuera del documento
  // que el contralor revisa, y saldrían el día que alguien exporte la tabla
  // cruda en un juicio.
  const vivos = [
    ...(fila.jornada.inicio ? [fila.jornada.inicio] : []),
    ...fila.jornada.descansos.flatMap((d) => [d.inicio, ...(d.fin ? [d.fin] : [])]),
    ...fila.jornada.sueltos,
    ...(fila.jornada.fin ? [fila.jornada.fin] : []),
  ];

  return (
    <Tarjeta titulo={`${fila.operadorNombre} · ${fila.dia}`} info="jornada.registro">
      <div className="rv-jn__bloque">
        <p className="rv-jn__nota">
          {fila.estado === 'cerrado'
            ? t('jor.f.cerrado', { quien: fila.cerradoPorEmail ?? t('jor.f.cerrado.sinfirma') })
            : t('jor.f.abierto')}
          {' '}
          {fila.conformeOperadorEn
            ? t('jor.f.confirmo')
            : t('jor.f.noconfirmo')}
        </p>

        {/* LO QUE EL MOTOR VIO, CON SU ARTÍCULO. Cada señal trae su fundamento para que el contralor pueda ir a leerlo, no para adornar. */}
        {(fila.riesgo.senales.length > 0 || fila.jornada.huecos.length > 0) && (
          <ul className="rv-jn__senales">
            {fila.jornada.huecos.map((h) => (
              <li key={h.clase} data-tono="warn">{h.dice}</li>
            ))}
            {fila.riesgo.senales.map((s, i) => (
              <li key={`${s.clase}-${i}`} data-tono={s.esExceso ? 'bad' : undefined}>
                {s.dice}
                {s.fundamento && <span className="rv-jn__tenue">{s.fundamento}</span>}
              </li>
            ))}
            {fila.riesgo.noEvaluado.map((n) => (
              <li key={n} data-tono="tenue">{n}</li>
            ))}
          </ul>
        )}

        <MarcasDelDia
          vivos={vivos}
          anulados={fila.jornada.anulados}
          jornadaId={fila.jornadaId}
          puedeCorregir={puedeCorregir}
          anularMarca={anularMarca}
        />

        {puedeCorregir && (
          <>
            <FormaCaptura
              jornadaId={fila.jornadaId}
              dia={fila.dia}
              anulados={fila.jornada.anulados}
              capturarMarca={capturarMarca}
            />
            {fila.estado === 'abierto' && (
              <FormaCierre jornadaId={fila.jornadaId} cerrarElDia={cerrarElDia} />
            )}
          </>
        )}
      </div>
    </Tarjeta>
  );
}

function MarcasDelDia({
  vivos, anulados, jornadaId, puedeCorregir, anularMarca,
}: {
  vivos: Asiento[];
  anulados: Asiento[];
  jornadaId: string;
  puedeCorregir: boolean;
  anularMarca: AccionJornada;
}) {
  const { t, tp } = useT('operacion', operacionEs);
  const [estado, accion] = useActionState(anularMarca, VACIO);

  return (
    <div className="rv-jn__bloque">
      {/* sin-info: subtítulo dentro del recuadro de la jornada del día */}
      <h3 className="rv-jn__sub">{t('jor.f.marcas')}</h3>
      {vivos.length === 0 && (
        <p className="rv-jn__nota">
          {t('jor.f.sinmarcas')}
        </p>
      )}
      <Aviso estado={estado} />
      <ul className="rv-jn__marcas">
        {vivos.map((a) => (
          <li key={a.id} className="rv-jn__marca">
            <div>
              <strong>{ROTULO_TIPO[a.tipo] ?? a.tipo}</strong> · {hora(a.momento)}
              <span className="rv-jn__tenue">
                {ROTULO_PROCEDENCIA[a.procedencia]}
                {a.registradoPorEmail ? ` · ${a.registradoPorEmail}` : ''}
                {a.nota ? ` · ${a.nota}` : ''}
                {a.corrigeA ? t('jor.f.corrige') : ''}
              </span>
            </div>
            {puedeCorregir && (
              <form action={accion} className="rv-forma__fila">
                <input type="hidden" name="asientoId" value={a.id} />
                <input type="hidden" name="jornadaId" value={jornadaId} />
                <CampoTexto name="motivo" etiqueta={t('jor.f.motivo')} minLength={5} obligatorio
                  placeholder={t('jor.f.motivo.ph')} className="rv-forma__crece" />
                <Boton texto={t('jor.f.anular')} cargando="Anulando…" icono={<Icono icono={Ban} />} />
              </form>
            )}
          </li>
        ))}
      </ul>

      {/* LAS ANULADAS SE ENSEÑAN. Esconderlas dejaría la pantalla más limpia y el expediente incompleto: la historia de las
          correcciones es parte de lo que hace creíble al documento. */}
      {anulados.length > 0 && (
        <Disclosure variante="linea" titulo={tp('jor.f.anuladas', anulados.length)}>
          <ul className="rv-jn__marcas">
            {anulados.map((a) => (
              <li key={a.id} className="rv-jn__anulada">
                <s>{ROTULO_TIPO[a.tipo] ?? a.tipo} · {hora(a.momento)}</s>
                <span className="rv-jn__tenue">
                  {t('jor.f.anuladapor')} {a.anuladoPorEmail ?? t('jor.f.sinfirma')}
                  {a.anuladoEn ? ` el ${hora(a.anuladoEn)}` : ''} · {a.anuladoMotivo}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function FormaCaptura({
  jornadaId, dia, anulados, capturarMarca,
}: {
  jornadaId: string;
  dia: string;
  anulados: Asiento[];
  capturarMarca: AccionJornada;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, accion] = useActionState(capturarMarca, VACIO);

  // Solo se ofrece corregir lo que YA está anulado. Una marca viva no se
  // «corrige»: se anula primero, con su motivo. El orden importa y por eso el
  // selector no puede ofrecer otra cosa.
  const corregibles = anulados;

  return (
    <form action={accion} className="rv-forma">
      {/* sin-info: subtítulo dentro del recuadro de la jornada del día */}
      <h3 className="rv-jn__sub">{t('jor.f.capturar.titulo')}</h3>
      <p className="rv-jn__nota">
        {t('jor.f.capturar.nota')}
      </p>
      <Aviso estado={estado} />
      <input type="hidden" name="jornadaId" value={jornadaId} />
      <div className="rv-forma__rejilla">
        <CampoSelect name="tipo" etiqueta={t('jor.f.que')} defaultValue="inicio_jornada">
          <option value="inicio_jornada">{t('jor.f.tipo.inicio')}</option>
          <option value="fin_jornada">{t('jor.f.tipo.fin')}</option>
          <option value="inicio_descanso">{t('jor.f.tipo.inidesc')}</option>
          <option value="fin_descanso">{t('jor.f.tipo.findesc')}</option>
        </CampoSelect>
        {/* A37-S19-02: SIN hora precargada. Una hora por omisión firmada sin mirar es una cifra inventada. */}
        <Campo etiqueta={t('jor.f.cuando', { dia })} obligatorio>
          <input name="momento" type="datetime-local" className="rv-ctl rv-ctl--fecha" />
        </Campo>
        {/* LA OTRA MITAD DE LA CORRECCIÓN. Anular deja el motivo y la firma; esto deja el VÍNCULO — `corrige_a` — que dice cuál de las
            marcas anuladas sustituye esta hora. Sin él, el expediente enseña una anulada y una nueva sin decir que son la misma marca
            corregida, y reconstruir la historia queda a criterio de quien la lea. */}
        {corregibles.length > 0 && (
          <CampoSelect name="corrigeA" etiqueta={t('jor.f.corrigeq')} defaultValue="">
            <option value="">{t('jor.f.nueva')}</option>
            {corregibles.map((a) => (
              <option key={a.id} value={a.id}>
                {ROTULO_TIPO[a.tipo] ?? a.tipo} · {hora(a.momento)}
              </option>
            ))}
          </CampoSelect>
        )}
        <CampoTexto name="nota" etiqueta={t('jor.f.nota')} obligatorio minLength={5} placeholder={t('jor.f.nota.ph')} />
      </div>
      <Boton texto={t('jor.f.capturar')} cargando="Guardando…" icono={<Icono icono={Plus} />} />
    </form>
  );
}

function FormaCierre({ jornadaId, cerrarElDia }: { jornadaId: string; cerrarElDia: AccionJornada }) {
  const { t } = useT('operacion', operacionEs);
  const [estado, accion] = useActionState(cerrarElDia, VACIO);
  return (
    <form action={accion} className="rv-forma">
      {/* sin-info: subtítulo dentro del recuadro de la jornada del día */}
      <h3 className="rv-jn__sub">{t('jor.f.cerrar.titulo')}</h3>
      <p className="rv-jn__nota">
        {t('jor.f.cerrar.nota')}
      </p>
      <Aviso estado={estado} />
      <input type="hidden" name="jornadaId" value={jornadaId} />
      <Boton texto={t('jor.f.cerrar')} cargando="Cerrando…" icono={<Icono icono={Lock} />} />
    </form>
  );
}

export function FormaPolitica({
  politica, declararPolitica,
}: {
  politica: PoliticaFlota | null;
  declararPolitica: AccionJornada;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, accion] = useActionState(declararPolitica, VACIO);
  return (
    <form action={accion} className="rv-forma">
      <Aviso estado={estado} />
      <div className="rv-forma__rejilla">
        <CampoTexto name="horasMaxJornada" tipo="number" etiqueta={t('jor.f.umbral.jornada')} step="0.25" min="0.25" max="24"
          defaultValue={politica?.horasMaxJornada ?? ''} placeholder={t('jor.f.sindeclarar')} />
        <CampoTexto name="minutosMinDescanso" tipo="number" etiqueta={t('jor.f.umbral.descanso')} step="1" min="0" max="1440"
          defaultValue={politica?.minutosMinDescanso ?? ''} placeholder={t('jor.f.sindeclarar')} />
        <CampoTexto name="horasMinEntreJornadas" tipo="number" etiqueta={t('jor.f.umbral.entre')} step="0.25" min="0" max="24"
          defaultValue={politica?.horasMinEntreJornadas ?? ''} placeholder={t('jor.f.sindeclarar')} />
        <CampoTexto name="fundamento" etiqueta={t('jor.f.fundamento')}
          defaultValue={politica?.fundamento ?? ''} placeholder={t('jor.f.fundamento.ph')} />
      </div>
      <Boton texto={t('jor.f.umbral.guardar')} cargando="Guardando…" />
    </form>
  );
}

/** Lo que la forma de la alerta de tope necesita saber de la configuración vigente. `null` = la flota no ha declarado nada
 *  (la alerta está apagada por omisión). */
export interface ConfigAlertaForma {
  activa: boolean;
  topeHoras: number | null;
  umbralAvisoPct: number;
  umbralCriticoPct: number;
  canalEncargado: 'whatsapp' | 'correo' | 'ambos' | 'ninguno';
  canalOperador: 'whatsapp' | 'ninguno';
  correoEncargado: string | null;
}

/**
 * LA ALERTA SALIENTE DE TOPE (0502): la configuración por flota. Apagada por omisión porque cada aviso es un mensaje
 * a una persona. El servidor valida todo otra vez (`guardarConfigAlerta`) y vuelve a comprobar que quien envía
 * administra la flota; esta forma solo ayuda a escribirlo bien.
 */
export function FormaAlertaTope({
  config, guardarAlerta,
}: {
  config: ConfigAlertaForma | null;
  guardarAlerta: AccionJornada;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, accion] = useActionState(guardarAlerta, VACIO);
  return (
    <form action={accion} className="rv-forma">
      <Aviso estado={estado} />
      <Casilla name="activa" etiqueta={t('jor.f.alerta.titulo')} defaultChecked={config?.activa ?? false} />
      <div className="rv-forma__rejilla">
        <CampoTexto name="topeHoras" tipo="number" etiqueta={t('jor.f.alerta.tope')} step="0.25" min="0.25" max="12"
          defaultValue={config?.topeHoras ?? ''} placeholder={t('jor.f.alerta.ley')} />
        <CampoTexto name="umbralAvisoPct" tipo="number" etiqueta={t('jor.f.alerta.aviso')} step="1" min="1" max="98" obligatorio
          defaultValue={config?.umbralAvisoPct ?? 80} />
        <CampoTexto name="umbralCriticoPct" tipo="number" etiqueta={t('jor.f.alerta.critico')} step="1" min="2" max="99" obligatorio
          defaultValue={config?.umbralCriticoPct ?? 95} />
        <CampoSelect name="canalEncargado" etiqueta={t('jor.f.alerta.encargado')} defaultValue={config?.canalEncargado ?? 'whatsapp'}>
          <option value="whatsapp">{t('jor.f.canal.wa')}</option>
          <option value="correo">{t('jor.f.canal.correo')}</option>
          <option value="ambos">{t('jor.f.canal.ambos')}</option>
          <option value="ninguno">{t('jor.f.canal.ninguno')}</option>
        </CampoSelect>
        <CampoSelect name="canalOperador" etiqueta={t('jor.f.alerta.operador')} defaultValue={config?.canalOperador ?? 'whatsapp'}>
          <option value="whatsapp">{t('jor.f.canal.wa')}</option>
          <option value="ninguno">{t('jor.f.canal.ninguno')}</option>
        </CampoSelect>
        <CampoTexto name="correoEncargado" tipo="email" etiqueta={t('jor.f.alerta.correo')} maxLength={254}
          defaultValue={config?.correoEncargado ?? ''} placeholder="encargado@tu-flota.mx" />
      </div>
      <Boton texto={t('jor.f.alerta.guardar')} cargando="Guardando…" />
    </form>
  );
}
