import LogoV2 from '../shell/logo-v2';

/**
 * El símbolo de Likida junto a la respuesta del agente. Con `pensando` RESPIRA (opacidad .35→1, escala .985→1: la misma
 * respiración del logo de carga, ESTILO §9); con movimiento reducido queda quieto al 60 % y el anillo de `data-estado` sigue
 * distinguiendo «trabajando» de «en reposo» sin necesidad de moverse. Sin giros: la paleta y el movimiento de Likida no tienen spinners.
 */
export default function MarcaLikida({ alto = 16, pensando = false }: { alto?: number; pensando?: boolean }) {
  return (
    <span className="rv-chat__marca" data-estado={pensando ? 'pensando' : 'reposo'}>
      <LogoV2 variante="simbolo" alto={alto} decorativo />
    </span>
  );
}
