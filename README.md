# Firebase Studio

This is a NextJS starter in Firebase Studio.

## Configuración de Firebase

1. Crea un proyecto  en Firebase y registra una app Web para obtener las credenciales.
2. Copia `.env.example` a `.env.local` y pega allí los valores de Firebase:

```bash
cp .env.example .env.local
```

3. Asegúrate de agregar los dominios que vas a usar (por ejemplo `localhost`, `127.0.0.1`, tu dominio de preview o producción) en **Authentication → Settings → Authorized domains** dentro de Firebase.
4. Ejecuta el proyecto con los envs cargados:

```bash
npm install
npm run dev
```

Si ves el mensaje “No se pudo conectar con Firebase”, revisa que todas las variables `NEXT_PUBLIC_FIREBASE_*` estén definidas y que el dominio actual esté autorizado en Firebase Auth.

### Variables en Firebase App Hosting

Cuando despliegues en Firebase App Hosting, define las mismas variables `NEXT_PUBLIC_FIREBASE_*` en el backend correspondiente (staging o producción) desde **App Hosting → Environment variables** y vuelve a desplegar para que apliquen.

### Resend en App Hosting (secrets)

`GitHub Secrets` y `Firebase App Hosting` no comparten secretos automáticamente.
Si el backend de App Hosting usa `secret: RESEND_API_KEY` / `secret: RESEND_FROM` en `apphosting.yaml`, esos secretos deben existir en **Firebase Secret Manager** dentro del proyecto y el backend debe tener acceso concedido.

Pasos mínimos (proyecto `studio-4350140400-a3f8f`):

```bash
# 1) Crear/actualizar secretos en Firebase Secret Manager
firebase apphosting:secrets:set RESEND_API_KEY --project studio-4350140400-a3f8f
firebase apphosting:secrets:set RESEND_FROM --project studio-4350140400-a3f8f

# 2) Conceder acceso al backend de App Hosting
firebase apphosting:secrets:grantaccess RESEND_API_KEY --project studio-4350140400-a3f8f
firebase apphosting:secrets:grantaccess RESEND_FROM --project studio-4350140400-a3f8f
```

Si no vas a gestionar secretos en App Hosting, no declares variables con `secret:` en `apphosting.yaml` para evitar errores de deploy como:
`Error resolving secret version ... /secrets/RESEND_API_KEY/versions/latest`.
