# RDB Club — subir a host gratuito (Render)

## 1. Sube el código a GitHub (desde esta carpeta)
```bash
git init
git add .
git commit -m "RDB Club"
# crea un repo vacío en github.com (sin README) y luego:
git remote add origin https://github.com/TU_USUARIO/rdb-club.git
git push -u origin main  # o master, según te diga git
```
Te pedirá tu cuenta de GitHub (mejor con token, no contraseña).

## 2. Crea el servicio en Render (gratis)
1. Entra en **render.com** → New → **Web Service** → conecta tu repo `rdb-club`.
2. Render detecta solo el `render.yaml` (plan free, `npm install` / `npm start`).
3. En **Environment**, rellena:
   - `ADMIN_EMAILS`: tu email (serás dueño/admin directo).
   - `ADMIN_PASS`: se genera sola; cópiala (vale para borrar desde API).
   - SMTP (`SMTP_HOST/PORT/USER/PASS/FROM`) para que lleguen los emails de validación.
     Sin esto, nadie podrá validar su cuenta en online → **imprescindible en producción**.
     Gmail: `smtp.gmail.com:587` + contraseña de aplicación.
4. Deploy. Te da URL tipo `https://rdb-club.onrender.com`.

## 3. Avisos del plan gratis
- Se duerme tras ~15 min sin visitas (despierta al entrar, tarda ~30 s).
- **Los MP3 y la base de datos se borran** al reiniciar/redesplegar (disco efímero).
  Para conservarlos: disco persistente de pago o Cloudinary/S3.
- Sin SMTP no hay registro posible en online: los enlaces solo salen en consola.
