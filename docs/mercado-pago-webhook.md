# Webhook Mercado Pago -> Supabase

Esta integración activa accesos en `public.progreso_alumnos` cuando Mercado Pago confirma un pago aprobado.

## URL final del webhook

Usar esta URL en Mercado Pago:

```text
https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook
```

La función está configurada con `verify_jwt = false` porque Mercado Pago no envía un JWT de Supabase. La seguridad del flujo se basa en consultar el pago real con `MERCADO_PAGO_ACCESS_TOKEN` antes de activar accesos.

## Variables de entorno necesarias

Configurar en Supabase:

```bash
supabase secrets set MERCADO_PAGO_ACCESS_TOKEN="APP_USR_xxx"
supabase secrets set SUPABASE_URL="https://yfdiejyrhaaziceyeiuc.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="ey..."
```

`SUPABASE_SERVICE_ROLE_KEY` nunca debe exponerse en frontend.

## Deploy de la función

```bash
supabase functions deploy mercado-pago-webhook --project-ref yfdiejyrhaaziceyeiuc --no-verify-jwt
```

## SQL recomendado para idempotencia

La función usa `upsert` con conflicto por `user_email,curso`. Para que eso funcione sin duplicados, ejecutar una vez en Supabase SQL Editor:

```sql
create unique index if not exists progreso_alumnos_user_email_curso_key
on public.progreso_alumnos (user_email, curso);
```

Si ya existen duplicados, limpiar duplicados antes de crear el índice.

## Mapeo de planes

La función acepta estos valores en `external_reference` o `metadata.plan`:

| Plan Mercado Pago | Filas insertadas en `progreso_alumnos` |
| --- | --- |
| `pack_completo` | `personal`, `nutricion`, `hiit`, `musculacion` |
| `personal_trainer` | `personal` |
| `nutricion` | `nutricion` |
| `funcional_hiit` | `hiit` |
| `musculacion` | `musculacion` |

Cada fila se crea con:

```text
user_email = payer.email
curso = curso correspondiente
clase_actual = 1
updated_at = fecha actual
```

## Configuración necesaria en Mercado Pago

Los botones actuales del frontend apuntan a links abreviados `mpago.la` / `mpago.li`. Desde el frontend estático no se puede agregar `external_reference` o `metadata` a esos links ya generados.

Para que la activación automática funcione, cada link/preferencia de Mercado Pago debe tener configurado uno de estos campos:

```json
{
  "external_reference": "personal_trainer",
  "metadata": {
    "plan": "personal_trainer"
  },
  "notification_url": "https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook"
}
```

Valores a usar por botón:

| Botón actual | `external_reference` o `metadata.plan` |
| --- | --- |
| Personal Trainer pago único | `personal_trainer` |
| Personal Trainer 3 cuotas | `personal_trainer` |
| Personal Trainer 6 cuotas | `personal_trainer` |
| Nutrición pago único | `nutricion` |
| Funcional & HIIT pago único | `funcional_hiit` |
| Musculación pago único | `musculacion` |
| Pack Completo pago único | `pack_completo` |
| Pack Completo 3 cuotas | `pack_completo` |
| Pack Completo 6 cuotas | `pack_completo` |

Si Mercado Pago no permite editar esos campos en los links actuales, hay que recrear los links/preferencias desde Checkout Pro o desde la API de preferencias con `external_reference`, `metadata.plan` y `notification_url`, y luego reemplazar los `href` de `planes.html` por los nuevos links.

## Configuración de Webhooks en Mercado Pago

1. Entrar a Mercado Pago Developers.
2. Abrir la aplicación productiva.
3. Ir a Webhooks/Notificaciones.
4. Agregar la URL:

```text
https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook
```

5. Activar el evento de pagos: `payment`.
6. Guardar.

## Cómo probar con pago real

1. Crear o editar un link de pago de prueba productivo con:
   - `external_reference = personal_trainer`
   - o `metadata.plan = personal_trainer`
   - `notification_url` apuntando al webhook.
2. Registrarse en la plataforma con el mismo email que se usará para pagar.
3. Pagar el link.
4. Esperar la notificación de Mercado Pago.
5. Verificar en Supabase:

```sql
select *
from public.progreso_alumnos
where user_email = 'email-del-comprador@dominio.com'
order by curso;
```

Para Pack Completo deben aparecer cuatro filas:

```text
personal
nutricion
hiit
musculacion
```

## Verificación en campus

Después de aprobado el pago y creada la fila en `progreso_alumnos`:

1. El alumno inicia sesión.
2. Entra a `campus.html`.
3. Debe ver el curso habilitado.
4. Entra a `modulo.html`.
5. Debe ver el contenido del curso comprado.

La activación manual sigue funcionando como backup: si se carga una fila manualmente en `progreso_alumnos`, el campus la sigue reconociendo.
