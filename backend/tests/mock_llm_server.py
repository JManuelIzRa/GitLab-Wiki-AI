"""
Mock de un servidor OpenAI-compatible local (como llama.cpp server o vLLM sirviendo
qwen2.5-3b-instruct-q4_k_m.gguf), para validar WikiGenerator sin depender de la red
192.168.0.100 del usuario ni de un modelo real.
"""

import time

import uvicorn
from fastapi import FastAPI

app = FastAPI()


@app.post("/v1/chat/completions")
async def chat_completions(body: dict):
    messages = body["messages"]
    user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), "")

    # IMPORTANTE: chequear el marcador más específico primero. Un prompt RAG real incluye
    # tanto el resumen del wiki (que puede contener literalmente la palabra "Overview")
    # como el bloque de fragmentos de código, así que el orden de estas condiciones importa.
    if "FRAGMENTOS DE CÓDIGO" in user_msg:
        fake_answer = "Según el código en `src/utils/userStore.js`, los usuarios se guardan en un Map en memoria."
    elif "Overview" in user_msg:
        fake_answer = "## Resumen\nProyecto demo en Node.js/Express."
    elif "Arquitectura" in user_msg:
        fake_answer = "## Arquitectura\n```mermaid\nflowchart TD\nA-->B\n```"
    else:
        fake_answer = f"Respuesta genérica (system_len={len(system_msg)})"

    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.get("model", "unknown"),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": fake_answer},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9200)
