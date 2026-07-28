# Super prompt — cuota del diésel

El que dispara la routine de los viernes. Autocontenido: funciona aunque la skill no cargue.

```
Baja la cuota semanal disminuida del estímulo de IEPS al diésel publicada hoy en el DOF
y regístrala en este repo. Invoca la skill `cuota-diesel` y sigue sus reglas.

POR QUÉ IMPORTA. El estímulo del LIF 2026 art. 20-A es cuota semanal × litros. La cuota
pasó de $6.2858 el 27-jun a $2.0925/L el 25-jul: 3x en cinco semanas. Sobre 10,000 litros
son ~$40,000 de diferencia en la cifra que el contralor mira primero. Un valor viejo se ve
idéntico a uno correcto.

## 1. Baja el índice del día — LAS TRES EDICIONES

    GET https://sidofqa.segob.gob.mx/dof/sidof/notas/{DD-MM-AAAA}

JSON sin auth. El acuerdo sale en la edición VESPERTINA: los 10 verificados salieron ahí.
Filtra títulos que contengan "cuotas disminuidas" y "combustibles".

## 2. Si no aparece, distingue vacío de caído

El SIDOF devuelve HTTP 200 con arrays vacíos tanto si no hubo DOF como si falló. Cruza:

    GET https://sidofqa.segob.gob.mx/dof/sidof/diarios/porFecha/{DD-MM-AAAA}

Si diarios dice que SÍ hubo vespertina y notas viene vacío → es fallo de API. Reporta
INFRA, no "sin cambios". Reintenta una vez con 60s de espera.

Si de verdad no se publicó: se han publicado 10 de 10 viernes seguidos, así que la
ausencia es alarma. Abre PR con estado `FALTA CUOTA` listando las fechas descubiertas —
a partir del sábado hay liquidaciones que el motor no va a poder calcular.

## 3. Extrae la cifra

    GET https://sidofqa.segob.gob.mx/dof/sidof/notas/nota/{codNota}

El HTML íntegro viene en `cadenaContenido`. Regex `Di[ée]sel\s+\$([\d.]+)`.

## 4. Verifica el número antes de creerle

Un regex no se cree hasta compararlo. Tres chequeos:
- Rango sano: entre $0 y ~$8/L. Fuera de ahí agarraste otra cifra del documento.
- Contra la anterior: salto >2x se marca DESTACADO en el PR, no se bloquea (el salto de
  junio a julio fue real), pero alguien tiene que mirarlo.
- Vigencia empalmada: `vigencia_desde` = día siguiente del `vigencia_hasta` anterior.
  Un hueco significa un viernes perdido, y hay que decirlo.

## 5. Escribe

`normas/cuota-ieps-diesel.yaml`, AGREGANDO una entrada — nunca sobrescribiendo. El
histórico es lo que permite liquidar un viaje de hace tres semanas con la cuota que
estaba vigente ese día. Campos: cuota, vigencia_desde, vigencia_hasta (sábado a viernes),
cod_nota, fecha_publicacion, url, extraido_el.

## 6. Entrega

Si la cuota es nueva: rama `claude/cuota-diesel-<AAAA-MM-DD>`, commit, PR contra master
con la cuota, el codNota, el enlace al DOF y la comparación contra la semana pasada.
La rama DEBE llevar prefijo `claude/` o el push rebota.

Si ya estaba registrada: NO abras PR. Escribe el latido y termina.

## 7. Cierra

Escribe siempre `normas/.latido-cuota-diesel` con una línea:
`OK <cuota> <vigencia>` · `SIN CAMBIOS` · `FALTA CUOTA <fechas>` · `INFRA <qué falló>`.
Si ese archivo no existe el lunes, la corrida murió sin cerrar — información distinta
de "no hubo publicación".

Cierra tu mensaje con: qué cuota encontraste y de qué nota, la salida real del curl que
lo prueba, qué NO pudiste verificar, y el link del PR salido de `gh pr list` — no de tu
memoria. Hay casos documentados de agentes reportando PRs que no existían.
```
