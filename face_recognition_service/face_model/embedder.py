import numpy as np
import onnxruntime as ort
import cv2
import time

class FaceEmbedder:
    def __init__(self, model_path="models/mobilefacenet.onnx"):
        self.session = ort.InferenceSession(model_path)
        self.input_name = self.session.get_inputs()[0].name

    def preprocess(self, img: np.ndarray):
        img = cv2.resize(img, (112, 112))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = img.astype(np.float32) / 255.0
        img = (img - 0.5) / 0.5
        return np.transpose(img, (2, 0, 1))[np.newaxis, :]

    def get_embedding(self, face_img: np.ndarray) -> np.ndarray:
        start = time.time()
        input_tensor = self.preprocess(face_img)
        output = self.session.run(None, {self.input_name: input_tensor})[0]
        norm = np.linalg.norm(output)
        print(f"⏱ Embedding fetch took {time.time() - start:.2f}s")        
        return output[0] / norm
