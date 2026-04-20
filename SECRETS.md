# Política de Secretos y Guía de Rotación

Este documento define cómo gestionar, rotar y proteger los secretos de la plataforma.
Seguirlo evita exposición accidental de claves en logs, repositorios y CI.

---

## Variables críticas

| Variable | Tipo | Rotación recomendada |
|---|---|---|
| `JWT_SECRET` | Token hex 64 chars | Cada 90 días o ante sospecha de compromiso |
| `DATABASE_URL` | Credencial DB | Ante cambio de personal o incidente |
| `OPENAI_API_KEY` | Clave de API | Ante sospecha; monitorear uso en dashboard OpenAI |
| `ELEVENLABS_API_KEY` | Clave de API | Ante sospecha; monitorear uso en dashboard ElevenLabs |
| `MAIL_PASSWORD` | Contraseña de app | Ante cambio de cuenta o incidente |
| `GEMINI_API_KEY` | Clave de API | Ante sospecha |

## Reglas generales

1. **Nunca commites `.env`**. El `.gitignore` lo excluye. Si lo hiciste por error, ver sección "Si una clave quedó en el historial de git".
2. **Nunca imprimas secretos en logs**. Los logs van a consola y pueden almacenarse.
3. **Usa `.env.example` como plantilla**. Solo valores de ejemplo, nunca reales.
4. **En producción, usa el gestor de secretos de tu proveedor** (Railway, Render, AWS Secrets Manager, GCP Secret Manager, etc.) en vez de un archivo `.env`.
5. **Rotación inmediata** si hay sospecha de exposición — no esperes confirmación.

---

## Generar un JWT_SECRET seguro

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

El resultado es una cadena de 64 caracteres hexadecimales. Cópiala directamente al gestor de secretos o al `.env` local.

---

## Rotación de claves OpenAI

1. Ir a [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Crear nueva clave → copiarla
3. Actualizar en el gestor de secretos de producción
4. Reiniciar el servidor backend (`uvicorn` / Railway redeploy)
5. Verificar que el servidor arranca sin errores de `startup_check`
6. Revocar la clave anterior desde el panel de OpenAI
7. Registrar la rotación en el canal de operaciones del equipo

## Rotación de claves ElevenLabs

1. Ir a [elevenlabs.io/app/account](https://elevenlabs.io/app/account)
2. Generar nueva API key → copiarla
3. Mismos pasos 3–7 del procedimiento OpenAI

## Rotación de JWT_SECRET

> **Efecto colateral:** todos los tokens JWT activos quedan invalidados.
> Los usuarios deberán iniciar sesión de nuevo.

1. Generar nuevo secreto: `python -c "import secrets; print(secrets.token_hex(32))"`
2. Actualizar en el gestor de secretos de producción
3. Reiniciar el servidor backend
4. Notificar al equipo que las sesiones activas se cerrarán

## Rotación de contraseña de correo (Gmail App Password)

1. Ir a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Revocar la contraseña de aplicación actual
3. Crear una nueva → copiarla
4. Actualizar `MAIL_PASSWORD` en producción y reiniciar

---

## Si una clave quedó en el historial de git

**Paso 1 — Rota la clave inmediatamente** (ver procedimientos arriba). No esperes a limpiar el historial.

**Paso 2 — Elimina del historial** con `git filter-repo`:

```bash
# Instalar
pip install git-filter-repo

# Remover todas las menciones del valor exacto (reemplaza VALOR_REAL)
git filter-repo --replace-text <(echo "VALOR_REAL==>REDACTED")

# Forzar push (requiere acceso de admin al repo)
git push origin --force --all
git push origin --force --tags
```

**Paso 3 — Notificar a colaboradores** que deben hacer `git clone` fresco. Los clones existentes tienen el historial contaminado.

**Paso 4 — Verificar** con `git log -S "VALOR_REAL" --all` que no queda traza.

---

## Configuración local (nuevo colaborador)

```bash
# Backend
cp backend/.env.example backend/.env
# Editar backend/.env con los valores reales (pedirlos al líder técnico)

# Frontend
cp frontend/.env.example frontend/.env.local
# Editar VITE_API_URL si tu backend no corre en localhost:8000
```

Los valores reales se comparten **de forma segura** (1Password, Bitwarden, canal privado cifrado). Nunca por email ni Slack público.

---

## CI/CD — GitHub Actions

Los tests de CI usan `SKIP_STARTUP_CHECK=true` y claves vacías/dummy.
Las claves de producción van en **GitHub → Settings → Secrets and variables → Actions**:

| Secret de GitHub | Variable de entorno |
|---|---|
| `OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` |
| `DATABASE_URL` | `DATABASE_URL` |
| `JWT_SECRET` | `JWT_SECRET` |

Para deploy automático, el workflow de CD lee estos secrets e inyecta en el entorno del servidor.

---

## Detección de secretos en PRs (Gitleaks)

El workflow `.github/workflows/ci.yml` incluye un job `secret-scan` con [Gitleaks](https://github.com/gitleaks/gitleaks). Bloquea el merge si detecta patrones de claves reales en el código o historial del PR.

Para ignorar un falso positivo, agregar al archivo `.gitleaks.toml`:

```toml
[[allowlist.commits]]
description = "falso positivo en test fixture"
commits = ["SHA_DEL_COMMIT"]
```

---

## Checklist de seguridad antes de cada release

- [ ] `git ls-files | xargs grep -l "sk-proj\|sk_\|AKIA\|AIza"` → resultado vacío
- [ ] `backend/.env` no aparece en `git status` ni `git ls-files`
- [ ] Gitleaks job en verde en la PR
- [ ] Secretos de producción rotados si hay cambio de personal en el último ciclo
- [ ] `JWT_SECRET` ≥ 32 chars en producción
- [ ] `SKIP_STARTUP_CHECK` no está en el entorno de producción (ni en `.env` de prod)
