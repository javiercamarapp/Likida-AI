# Encender la guía de onboarding para una flota

Estado: preparado, NO ejecutado. Nada de esto toca producción hasta que Javier lo corra (regla 5 del carril: ninguna migración ni sentencia contra una base remota).

## Qué cuesta

- Builds de Vercel: 0. El interruptor vive en la tabla `onboarding_tenant` (0983), no en una variable de entorno.
- Las migraciones 0983 y 0984 deben estar aplicadas antes. Sin ellas el código cae al respaldo local y el interruptor por flota no tiene efecto (la variable global `ONBOARDING_INVITACION=1` sigue valiendo).

## Antes de encender (lista de verificación)

1. 0983 y 0984 aplicadas con respaldo previo (`supabase/APLICAR-EN-PRODUCCION.md`, una por una).
2. Textos aprobados: ningún paso de `docs/guia/TEXTOS-REVISION-LIKIDA.md` en `borrador` que se quiera publicar. Con todo en borrador solo se ve el recorrido de siempre.
3. La invitación solo se muestra a quien tiene el panel v2 y nunca con «ver como».
4. Los eventos de aprendizaje siguen apagados (constante `GUIA_EVENTOS` en `src/lib/likida/guia/eventos.ts`) hasta que el aviso de privacidad mencione la medición (decisión D-OB-8).

## Encender (una flota)

```sql
insert into public.onboarding_tenant (tenant_id, invitacion)
values ('<id-de-la-flota>', true)
on conflict (tenant_id) do update set invitacion = true, actualizado_en = now();
```

Con `supabase db query --linked -f encender.sql` desde la carpeta ligada.

## Apagar (reversa inmediata)

```sql
update public.onboarding_tenant set invitacion = false, actualizado_en = now() where tenant_id = '<id-de-la-flota>';
```

## Qué ve la persona

- Una invitación («Te enseño Likida en pocos minutos») una vez por usuario y flota. Nunca arranca sola.
- Su avance se guarda en el servidor: abre en el último paso no hecho desde cualquier equipo.
- Lo que Likida mide se marca «Hecho»; lo que la persona confirma queda como «confirmado por ti» y no cuenta como medido.

## Medir el efecto

`scripts/guia/reporte-aprendizaje.sql` (solo lectura). Mientras `GUIA_EVENTOS` esté apagado sale vacío.
