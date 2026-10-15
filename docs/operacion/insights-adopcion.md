# Adopción de insights por agente

Contrato de entrega para los cinco agentes (A1 liquidación, A2 peajes, A3 carta porte, A4 vigía, A5 conductor).
Cada pantalla de agente muestra **qué pasó · qué significa · qué hacer** con reglas deterministas (ver `insights-texto-llano.md`).
El patrón ejecutable está en `src/lib/likida/insights/ejemplo_referencia.test.ts`: una regla por agente, con datos sintéticos.
Esas cinco reglas son solo el molde; no son la regla definitiva de ningún agente.

## Tabla agente → métricas → fuente → disparo → texto base → tipo

El ID de regla (`INS-Ax-nn`) es el que debe llevar el insight en su campo `id`. «Tipo» es `dato` o `candidato`.
Las fuentes son nombres lógicos de la tabla o del cálculo; cada frente pone la real al implementar su regla.

| ID de regla | Agente | Métrica | Fuente | Regla de disparo | Texto base (qué pasó) | Tipo |
|---|---|---|---|---|---|---|
| INS-A1-01 | A1 | Desgloses generados vs enviados | desgloses del periodo | generados > enviados | «Se generaron N desgloses y se enviaron M.» | dato |
| INS-A1-02 | A1 | Desgloses sin captura manual | desgloses del periodo | siempre que haya desgloses | «N de M desgloses salieron sin captura manual.» | dato |
| INS-A1-03 | A1 | Rebotes de correo | envíos del periodo | rebotes > 0 | «N correos rebotaron.» | dato |
| INS-A1-04 | A1 | Bitácoras sin póliza | bitácoras del periodo | sin póliza > 0 | «N bitácoras no tienen póliza.» | dato |
| INS-A1-05 | A1 | Hora de entrega del desglose | envíos del periodo | entrega fuera de la hora acordada | «El desglose salió a las HH:MM.» | dato |
| INS-A1-06 | A1 | Diferencia entre litros cargados y lectura, y rendimiento contra el esperado | liquidación (uso interno) | diferencia fuera de tolerancia | solo en la pantalla interna de liquidación | dato |
| INS-A2-01 | A2 | Cruces candidatos por categoría, con monto y estado de reclamo | cruces del periodo + tarifario | candidatos > 0 | «N cruces son candidatos a revisar por $X.» | candidato |
| INS-A2-02 | A2 | Porcentaje de cruces revisados | cruces del periodo | revisados < umbral del frente | «Se revisó el N % de los cruces.» | dato |
| INS-A2-03 | A2 | Plazo de 3 meses para reclamar | fecha del cruce | quedan pocos días | «N cruces vencen en D días.» | dato |
| INS-A2-04 | A2 | Recuperado contra reclamado | reclamos del periodo | reclamado > 0 | «Se reclamaron $X y se recuperaron $Y.» | dato |
| INS-A3-01 | A3 | Porcentaje de cartas porte sin tocar | cartas del periodo | siempre que haya cartas | «N % de las cartas salió sin ayuda.» | dato |
| INS-A3-02 | A3 | Rechazos y causa de «no se liga» | cartas rechazadas del periodo | rechazos > 0 | «N cartas no se ligaron: falta requerimiento, cliente o caja.» | dato |
| INS-A3-03 | A3 | Calidad por formato y por cliente | cartas del periodo, por formato | un formato con más fallas que el resto | «El formato F falla en N de M cartas.» | dato |
| INS-A4-01 | A4 | Horas ahorradas en datos de viaje | avisos enviados + línea base del cliente | solo con línea base capturada | «Se ahorraron N horas contra la línea base.» | dato |
| INS-A4-02 | A4 | Avisos enviados a tiempo | avisos del periodo | a tiempo < total | «N de M avisos salieron a tiempo.» | dato |
| INS-A4-03 | A4 | Primera respuesta | mensajes del periodo | tiempo de respuesta sobre el umbral | «La primera respuesta tardó N minutos.» | dato |
| INS-A4-04 | A4 | Mensajes priorizados | mensajes del periodo | priorizados > 0 | «N mensajes quedaron como prioritarios.» | dato |
| INS-A5-01 | A5 | Hitos sin intervención | hitos del periodo | siempre que haya hitos | «N de M hitos se registraron solos.» | dato |
| INS-A5-02 | A5 | Minutos entre el evento y el registro | hitos del periodo | demora sobre el umbral | «Entre el evento y el registro pasaron N minutos.» | dato |
| INS-A5-03 | A5 | Llamadas evitadas | hitos del periodo + línea base del cliente | solo con línea base capturada | «Se evitaron N llamadas contra la línea base.» | dato |

## Reglas de adopción

1. **Una regla, un ID.** Cada regla del frente usa un ID de esta tabla; si el frente necesita una métrica nueva, la agrega aquí primero.
2. **Sin features nuevas.** El insight resume lo que el agente ya hace; no agrega pantallas, tablas ni envíos.
3. **Dato interno de liquidación.** La diferencia entre litros cargados y lectura, y el rendimiento contra el esperado, son **solo dato INTERNO de la liquidación**.
   El desglose que recibe el operador no lleva litros, kilómetros ni rendimiento, así que `INS-A1-06` se queda en la pantalla interna o en stand-by, y nunca en el desglose.
4. **Cifras de ahorro.** `INS-A4-01` e `INS-A5-03` no muestran cifra sin una línea base capturada del cliente.
   Sin línea base el insight no aplica y la pantalla usa el vacío en lenguaje llano.

## Checklist de adopción (por pantalla)

- [ ] La pantalla usa `PanelInsights` y no arma sus propias tarjetas.
- [ ] Cada número del texto trae su `fuente` con periodo y `n`.
- [ ] Los candidatos dicen «candidato» y piden validar antes de reclamar.
- [ ] El estado vacío está en lenguaje llano y sin jerga.
- [ ] Los textos pasan `revisarInsight` sin hallazgos.
- [ ] Los datos de ejemplo llevan su rótulo (real, ejemplo o simulado).
- [ ] No hay features nuevas ni métricas fuera de la tabla.
