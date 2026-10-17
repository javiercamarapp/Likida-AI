# Agente 5 «Conductor» — Cohorte del piloto: unidades sin tableta ni macros

> Documento neutro (repo público): sin nombres de personas ni de empresas, sin cifras reales del cliente. Complementa a `agente-conductor-piloto.md` (cómo se enciende y se apaga el piloto) y a `agente-conductor.md` (qué hace el agente). **No contiene código de envío y no enciende nada**: solo fija a quién se invita primero y qué falta saber.

## 1. Idea

Hay unidades que ya no traen tableta, y por tanto no pueden mandar macros: su **único canal** con monitoreo es WhatsApp. Son la cohorte natural del piloto: para ellas el agente no sustituye un canal que ya usan, sino que ordena el único que tienen. La pregunta de la operación del cliente fue si esa podía ser «la oportunidad de migrar». Quien nombra la cohorte es operaciones; **quién la mapea** es el coordinador del proyecto del cliente junto con monitoreo (hoy no la tienen mapeada). El nombre exacto del esquema de estas unidades es dudoso en el audio: **no se inventa**; se pregunta (§5).

## 2. La marca de cohorte en la configuración

`cohortePiloto` en la configuración del Conductor (`config.ts`), con un catálogo cerrado:

| Valor | Quiénes entran |
|---|---|
| `sin_tableta_ni_macros` | Voluntarios de unidades sin tableta ni macros (WhatsApp es su único canal). |
| `voluntarios_abiertos` | Voluntarios de cualquier unidad (si el cliente prefiere no segmentar). |
| vacío / sin definir | **Sin cohorte: no se enciende nada.** |

- Un valor fuera del catálogo se **rechaza** al validar la configuración (no se corrige en silencio).
- El preflight «¿Está lista la flota?» tiene la comprobación **«Cohorte del piloto definida»**: en rojo mientras no haya cohorte, y con ella en rojo la señal de vida no se deja encender (mismo mecanismo que las otras ocho comprobaciones).
- Aún no hay columna propia (como las demás perillas de la fase 2): la marca se fija al armar la configuración. Persistirla desde el panel necesita un slot de migración A5 extra (0820–0829) que asigna la orquestadora; mientras tanto el panel la muestra como pendiente.
- El tope de voluntarios sigue siendo `piloto_max_voluntarios` (6 por flota por omisión).

## 3. Criterio de selección de voluntarios

1. **Voluntarios, nunca obligados**: el operador acepta por su costo-beneficio; no se le impone usar WhatsApp ni macros.
2. Unidades de la cohorte con **WhatsApp activo y teléfono alcanzable** (lo valida el preflight de voluntarios).
3. **GPS reciente** de la unidad (la geocerca registra llegadas y salidas sin que el operador escriba).
4. Preferir operadores en rutas con **sitio origen y destino** asignado, para medir hitos sin intervención.
5. Empezar con pocos (el tope de 6) y ampliar con datos, no con supuestos.
6. Un incentivo que el operador reconozca como propio (p. ej. no perder un bono por un registro que no pudo hacer) es **argumento de adopción, no regla del sistema**: no se calcula ni se promete ningún bono desde aquí.

## 4. Criterio de patios críticos

Un patio es crítico para el piloto cuando se cumple lo más posible de esto, ordenado por importancia:

1. Concentra unidades de la cohorte (§1).
2. Tiene **contacto de escalamiento de nivel 1** configurado.
3. Sus viajes traen **sitio** (geocerca) y la unidad reporta GPS continuo.
4. Es donde más se pierde tiempo en la llamada de seguimiento hoy (dato del cliente, pendiente: §5).

La lista concreta de patios y la fecha de arranque son decisión del cliente (ver T-A5-61, KPIs y fechas del piloto): hasta recibirlas quedan en blanco.

## 5. Preguntas pendientes al cliente

1. ¿Cuál es el **nombre exacto del esquema** de las unidades sin tableta? (el audio no es claro; no se asume).
2. ¿**Cuántas unidades** hay en esa situación?
3. ¿En **qué terminales o patios** están?
4. ¿Quién las **mapea** y para cuándo? (corresponde al coordinador del proyecto y a monitoreo).
5. ¿Cuántos operadores aceptarían ser **voluntarios** y qué condiciones piden (teléfono propio o de la empresa)?
6. Si se les da un celular de la empresa: ¿quién responde por él? (preocupación de operaciones: que no lo cuiden).
7. ¿Hay patios donde **no** conviene empezar?

## 6. Qué no hace este documento

- No manda mensajes ni plantillas a nadie. El piloto arranca **apagado** (módulo «Próximamente» en la fase 1) hasta la decisión de la fase 2.
- No asigna operadores ni unidades: eso es el alta de voluntarios del panel.
- No promete bonos, ahorros ni fechas.
