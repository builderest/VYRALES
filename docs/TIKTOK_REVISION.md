# TikTok: publicar directo con etiqueta de IA (Direct Post) — guía de envío

Estado: el código ya está (panel "Post to TikTok", etiqueta de IA `is_aigc`, grabador del demo).
Falta lo que solo puedes hacer tú en developers.tiktok.com.

## Paso 1 — Sandbox (YA EXISTE)
HECHO (oct-8): el TIKTOK_CLIENT_KEY del .env empieza con "sb" → VYRALES ya usa la app **Sandbox**
(Login Kit + redirect `https://vyrales.app/auth/tiktok/callback` ya configurados). Solo falta, en ese Sandbox:
1. Content Posting API → activar **Direct Post**.
2. Scopes → agregar **`video.publish`** (además de `user.info.basic` y `video.upload`).
3. Sandbox settings → **Target users**: confirmar que tu cuenta de TikTok está ahí.
4. **Apply changes**.

## Paso 2 — Activar Direct Post en VYRALES
En el `.env` de la PC **y** en Netlify (Environment variables) agrega una línea:
```
TIKTOK_DIRECT=1
```
En Netlify: Deploys → **Trigger deploy → Deploy site**. (No hace falta TIKTOK_SANDBOX: las llaves actuales ya son las del Sandbox.)

## Paso 3 — Grabar el demo (lo hago yo; tú solo inicias sesión)
1. Siéntate en la PC (Cronix). En vyrales.app → **Terminal** → **Grabar demo para TikTok**.
2. Se abre Edge/Chrome solo y empieza a grabar. Cuando llegue a TikTok: **inicia sesión y dale "Authorize"**. No toques nada más.
3. El resto lo hace solo (unos 4–6 min). El video queda en:
   `E:\VYRALES_videos\tiktok_demo\vyrales_tiktok_demo.mp4` (debe pesar menos de 50 MB).
4. El demo publica el video de curiosidades en tu TikTok como **"Only me"** (privado). Puedes borrarlo después desde la app.

## Paso 4 — Enviar la revisión
Vuelve a la app **de producción** (no Sandbox) → agrega lo mismo que en el Sandbox (Content Posting API + Direct Post + `video.publish`) → **Submit for review**. Pega estos textos:

**App description**
```
VYRALES (https://vyrales.app) is a web app for a single creator who produces short vertical educational videos (science and history curiosities) with AI tools and publishes them to their own social accounts. The creator connects their TikTok account with Login Kit, reviews each finished video in the VYRALES publish panel, chooses the TikTok settings (privacy, comments/duet/stitch, commercial content disclosure, AI-generated label) and clicks Post. VYRALES never posts without that explicit action and only posts to the account the creator authorized.
```

**Login Kit — user.info.basic**
```
Used to show the creator which TikTok account is connected (display name) in the VYRALES "Social accounts" window and in the post screen, so they always know where a video will be published.
```

**Content Posting API — video.upload**
```
Used to send a finished video to the creator's TikTok inbox as a draft when they prefer to finish and publish it inside the TikTok app.
```

**Content Posting API — video.publish (Direct Post)**
```
Used to publish the creator's own finished video directly to their TikTok profile from the VYRALES post screen. Before posting we call creator_info and show the account nickname/avatar, a video preview, an editable title, a privacy selector with no default value built from privacy_level_options, Comment/Duet/Stitch options off by default (disabled when the creator turned them off), the commercial content disclosure (Your brand / Branded content, with the required labels and branded content not allowed as private), the "Creator labeled as AI-generated" option (is_aigc, on because our videos are made with AI), and the Music Usage Confirmation / Branded Content Policy declaration. The creator must click Post; we then tell them processing can take a few minutes and show the result.
```

**Notes for the reviewer**
```
The demo video was recorded in our Sandbox app with a sandbox target user, so every post is "Only me". Timeline: 0:00 VYRALES app · connect TikTok · TikTok login and authorization screen · back in VYRALES with the account connected · post screen (account, preview, title, privacy, interactions, AI label, disclosure, declaration) · Post · result and the video on the creator's TikTok profile. Website: https://vyrales.app · Privacy policy: https://vyrales.app/privacidad.html · Terms: https://vyrales.app/terminos.html
```
Sube `vyrales_tiktok_demo.mp4` como demo video.

## Paso 5 — Después de que aprueben la app
1. En `.env` y Netlify: cambia TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET por las llaves de **producción** (deja `TIKTOK_DIRECT=1`) → redeploy.
2. Redes → TikTok → Desconectar → Conectar TikTok (ahora pide `video.publish`).
3. Mientras TikTok no haga la **auditoría de Direct Post**, todo sale "Only me". Para quitar esa restricción:
   Content Posting API → **Direct Post audit / "Apply for audit"** con el mismo video demo y los mismos textos.
   Cuando la aprueben, "Everyone" funciona y la etiqueta de IA sale sola en cada video.

## Volver atrás
Sin `TIKTOK_DIRECT`, VYRALES sigue mandando borradores como hasta hoy.
