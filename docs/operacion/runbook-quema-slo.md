# Runbook: quema del presupuesto de error

Cuándo suena: la guardia (cada 5 min) evalúa los objetivos de servicio de `lib/admin/slo-quema.ts` en dos ventanas.
Página (S2) con quema 14.4 (1 h y 5 min) o quema 6 (6 h y 30 min); ticket (sin aviso) con quema 1 (3 d y 6 h).
Todos los umbrales son iniciales, a calibrar con datos reales.

## Quema del presupuesto de error

1. Abre Salud del sistema o el Centro de Mando (bloque «Plataforma y qué cambió»): ahí se ve el objetivo, la regla disparada y el presupuesto restante.
2. Mira «último cambio visto» del aviso (despliegue o palanca movida): si coincide con el inicio de la quema, sospecha de él primero.
3. Abre Escalaciones y Corridas: ¿qué agente falla y con qué error? El diagnóstico de solo lectura (si la bandera está encendida) deja una propuesta en Aprobaciones.
4. Si el presupuesto de 30 días se agotó: no se promueve autonomía ni se publican cambios de prompt o modelo hasta pasar el examen dorado.
5. «Sin medir» NO es verde: significa que no hay al menos 5 eventos por ventana. No hay nada que arreglar, solo esperar muestra.

## Qué NO hacer

- No subir el objetivo para que deje de sonar. Los cambios de umbral los decide el dueño.
- No apagar la guardia.
