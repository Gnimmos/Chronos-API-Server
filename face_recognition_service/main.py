from fastapi import FastAPI, Query
from face_model.embedder import FaceEmbedder
from face_model.db import load_faces_for_company

app = FastAPI()
embedder = FaceEmbedder()

@app.get("/api/face/embeddings")
def get_embeddings(companyId: int):
    print(f"📥 Request for embeddings: companyId={companyId}")

    faces = load_faces_for_company(companyId)
    print(f"🔍 Found {len(faces)} face(s)")

    data = []
    for label, img in faces:
        print(f"🧠 Embedding for label: {label}, image shape: {img.shape}")
        emb = embedder.get_embedding(img)
        data.append({
            "label": label,
            "embedding": emb.tolist()
        })

    return {"success": True, "companyId": companyId, "data": data}
