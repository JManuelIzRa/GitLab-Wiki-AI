"""
Mock del servicio de embeddings (formato OpenAI: {input, model} -> {data: [{embedding}]}),
para validar EmbeddingClient sin depender de la red 192.168.0.100 del usuario.
"""

import uvicorn
from fastapi import FastAPI

app = FastAPI()

FAKE_DIM = 8


def fake_embed(text: str) -> list[float]:
    keywords = ["user", "router", "find", "create", "map", "export", "require", "id"]
    text_lower = text.lower()
    return [float(text_lower.count(k)) for k in keywords]


@app.post("/embed")
async def embed(body: dict):
    inputs = body["input"]
    if isinstance(inputs, str):
        inputs = [inputs]
    return {
        "data": [{"embedding": fake_embed(t), "index": i} for i, t in enumerate(inputs)],
        "model": body.get("model", "unknown"),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9100)
