# Personalizar el logo de la aplicación

Para que puedas subir tu logo sin tocar componentes ni SVGs, define la ruta del archivo que quieras usar como predeterminado:

1. Copia tu archivo de imagen en `public/branding/logo.png`. Al estar en la carpeta `public`, quedará disponible en la ruta relativa `/branding/logo.png` dentro de la aplicación.
2. En tu `.env.local`, agrega la variable
   
   ```env
   NEXT_PUBLIC_DEFAULT_LOGO_PATH=/branding/logo.png
   ```

Con esto, el componente `ClientLogo` usará tu archivo como logo por defecto tanto en el menú lateral como en el inicio y la pantalla de login cuando no haya un logo configurado en Firebase Storage. Si prefieres usar un archivo alojado en Storage, indica aquí la URL pública que te devuelve la subida.
