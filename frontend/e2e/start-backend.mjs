// Levanta el backend para E2E contra una SQLite desechable, sin claves reales.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend')
const venvPython = process.platform === 'win32'
  ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
  : path.join(backendDir, '.venv', 'bin', 'python')
const python = existsSync(venvPython) ? venvPython : 'python'
const port = process.env.E2E_BACKEND_PORT ?? '8002'

// Si ya hay un backend escuchando en el puerto, no se re-siembra la base: hacerlo
// vaciaría los datos de ese servidor en marcha (comparten el mismo archivo SQLite).
const portInUse = await new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port: Number(port) })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})
if (portInUse) {
  console.error(`start-backend: el puerto ${port} ya está en uso; no se toca la base de E2E.`)
  process.exit(1)
}

const env = {
  ...process.env,
  DATABASE_URL: 'sqlite:///./e2e.db',
  JWT_SECRET: 'e2e-secret-not-for-production-0123456789abcdef',
  SKIP_STARTUP_CHECK: 'true',
  FRONTEND_URL: `http://localhost:${process.env.E2E_FRONTEND_PORT ?? '5174'}`,
  // Vacías o falsas: load_dotenv() nunca sobrescribe variables ya definidas,
  // así las claves reales de backend/.env no se usan en las pruebas.
  OPENAI_API_KEY: 'sk-e2e-fake',
  // Puerto cerrado: el LLM falla al instante y se prueba la degradación sin tráfico externo.
  OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
  GEMINI_API_KEY: '',
  ELEVENLABS_API_KEY: '',
  MAIL_USER: '',
  MAIL_PASSWORD: '',
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
  CLOUDFLARE_TUNNEL_TOKEN: '',
  VOICE_AGENT_TOOL_TOKEN: 'e2e-voice-tool-token',
  // La suite inicia sesión muchas veces desde 127.0.0.1; los límites se prueban en pytest.
  RATE_LIMIT_AUTH_PER_MINUTE: '1000',
  RATE_LIMIT_IP_PER_MINUTE: '5000',
  TEXT_AGENTS_SECRET_KEY: 'e2e-text-agents-secret-key-0123456789',
  PYTHONUNBUFFERED: '1',
}

const seed = spawnSync(python, ['scripts/seed_e2e.py'], { cwd: backendDir, env, stdio: 'inherit' })
if (seed.status !== 0) process.exit(seed.status ?? 1)

const server = spawn(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', port],
  { cwd: backendDir, env, stdio: 'inherit' },
)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill())
server.on('exit', (code) => process.exit(code ?? 0))
