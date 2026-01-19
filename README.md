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
