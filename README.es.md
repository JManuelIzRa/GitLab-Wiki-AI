# DeepWiki for GitLab

> [English](README.md) · Español

Réplica funcional de [DeepWiki](https://deepwiki.com) para repositorios de **GitLab** (self-hosted o gitlab.com). Indexa un proyecto, analiza su estructura real (lenguajes, dependencias, módulos) y genera un wiki navegable con páginas escritas por IA a partir del código fuente real — overview, arquitectura con diagramas, una página por módulo principal, y una guía de instalación/ejecución.

```
backend/    API en FastAPI: cliente GitLab, análisis estático, generación con IA, persistencia
frontend/   SPA en React + Vite: formulario de conexión, progreso de indexado, lector del wiki
```

### Cómo funciona

1. **Conectas** un proyecto GitLab dando la URL de la instancia, la ruta del proyecto (`grupo/proyecto`) y un Personal Access Token.
2. El backend **clona la metadata y el árbol de archivos** vía la API REST v4 de GitLab (no hace `git clone` real, lee archivos individuales vía API — funciona igual en self-hosted que en gitlab.com).
3. Un **analizador estático** (sin IA) detecta lenguajes, gestores de dependencias (package.json, requirements.txt, pom.xml, go.mod, etc.), agrupa archivos en módulos por carpeta y detecta puntos de entrada.
4. Un **LLM** (cualquier servidor OpenAI-compatible: llama.cpp, vLLM, LM Studio con un modelo local, o la API de OpenAI/Anthropic vía proxy) recibe ese contexto estructurado más el contenido real de los archivos relevantes y genera cada página del wiki en Markdown, incluyendo diagramas Mermaid cuando aplica.
5. Todo se persiste en SQLite. El **frontend recibe el progreso del job en tiempo real vía Server-Sent Events** y, al terminar, muestra el wiki con sidebar de navegación, render de Markdown/Mermaid/código, chat multi-turno y búsqueda semántica sobre el código.

### Requisitos

- Python 3.11+
- Node.js 20.19+, 22.13+ o 24+
- [uv](https://docs.astral.sh/uv/) para gestionar las dependencias Python bloqueadas
- Un servidor LLM compatible con la API de OpenAI para generación de wiki y chat RAG
- Un Personal Access Token de GitLab con scopes `read_api` y `read_repository`

### Arranque rápido — Docker Compose (recomendado)

```bash
cp backend/.env.example backend/.env
# Edita backend/.env — configura OPENAI_URL, EMBEDDING_URL y OPENAI_API_KEY

docker compose up --build
```

Abre **http://localhost:5173**. El LLM y el servicio de embeddings son externos; configura sus URLs en `.env`.

### Configuración manual

Ver la sección en inglés para la tabla completa de variables de entorno — las mismas aplican aquí.

### Variables de entorno clave

| Variable | Descripción | Default |
|---|---|---|
| `OPENAI_URL` | URL base del servidor LLM | `http://localhost:8000/` |
| `OPENAI_CHAT_MODEL` | Nombre del modelo | `qwen2.5-3b-instruct-q4_k_m.gguf` |
| `EMBEDDING_URL` | URL del servicio de embeddings | `http://localhost:8080/embed` |
| `WIKI_LANGUAGE` | Código ISO del idioma del wiki | `es` |

### Probar sin GitLab real

```bash
cd backend
python3 tests/mock_gitlab_server.py   # escucha en http://127.0.0.1:9000
```

En el formulario: URL `http://127.0.0.1:9000`, ruta `demo-group/demo-project`, token `test-token-123`.

### Decisiones de diseño relevantes

- **Sin `git clone` real**: se lee el árbol y el contenido de archivos vía la API REST de GitLab. Evita gestionar disco, autenticación de Git y limpieza de workspaces.
- **Análisis estático separado de la IA**: la detección de lenguajes, dependencias y módulos es pura heurística sin IA. Abarata el indexado y le da a los prompts contexto ya estructurado.
- **Presupuesto de contexto explícito**: cada llamada a IA recorta el contenido de archivos a un límite de caracteres configurable.
- **Progreso real, no simulado**: el `IndexJob` se actualiza en cada etapa real del pipeline; si falla, el mensaje de error específico queda visible.
- **Chat multi-turno**: el panel de preguntas mantiene el historial de la conversación y lo envía al LLM en cada turno, permitiendo preguntas de seguimiento.
- **CORS sin credenciales**: la autenticación es por cabecera (token de GitLab), no por cookie, evitando el rechazo de navegadores con `Allow-Origin: *` + credenciales.
