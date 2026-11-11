'use client';

import { KeyRound } from 'lucide-react';
import { useActionState, useId } from 'react';
import { Boton, Drawer, Icono, useAbrirPorUrl } from '@/app/ui-v2/componentes';
import type { OpcionArea } from '@/lib/auth/llave-api-escritura';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { FormaEmision, type AccionForma } from './forma';

/** «Emitir llave» en CAJÓN (Rovaq: el alta vive en un cajón de 420, no en una tarjeta al pie). El cajón NO se cierra al emitir: el secreto de la
 *  llave existe solo en esa respuesta (`SecretoUnaVez`) y cerrarlo lo tiraría antes de que se copie. Se abre con el botón o con `?abrir=emitir-llave`.
 *  La acción primaria va en el PIE del cajón (Rovaq `overlay-foot`, a la derecha), como en el cajón del ticket; apunta a la forma con `form=`
 *  y se deshabilita mientras corre (emitir no es idempotente: el doble clic daría dos llaves). */
export function CajonEmitirLlave({ titulo, disparador, descripcion, abiertoInicial = false, accion, areas, vigencias, vigenciaDefault }: {
  titulo: string;
  disparador: string;
  descripcion?: string;
  abiertoInicial?: boolean;
  accion: AccionForma;
  areas: ReadonlyArray<OpcionArea>;
  vigencias: ReadonlyArray<{ valor: string; rotulo: string }>;
  vigenciaDefault: string;
}) {
  const { t } = useT('resto', restoEs);
  const idForma = useId();
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id: 'emitir-llave', abiertoInicial });
  const [estado, despachar, pendiente] = useActionState(accion, null);
  return (
    <div className="rv-lla__barra">
      <Boton variante="primary" tamano="sm" aria-haspopup="dialog" icono={<Icono icono={KeyRound} />} onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion} tamano="m" cierraConFondo={false}
        pie={<Boton type="submit" form={idForma} variante="primary" tamano="sm" loading={pendiente} icono={<Icono icono={KeyRound} />}>{pendiente ? t('llaves.emitiendo') : t('llaves.emitir_llave')}</Boton>}>
        <FormaEmision estado={estado} despachar={despachar} idForma={idForma} areas={areas} vigencias={vigencias} vigenciaDefault={vigenciaDefault} />
      </Drawer>
    </div>
  );
}
