import os
import cv2

def load_faces_for_company(company_id: int):
    root = os.path.dirname(os.path.abspath(__file__))  # e.g. /face_model
    base_path = os.path.join(root, "..", "images", str(company_id))
    base_path = os.path.abspath(base_path)

    face_data = []
    if not os.path.exists(base_path):
        print(f"⚠️ Folder not found: {base_path}")
        return []

    for file in os.listdir(base_path):
        if file.endswith(".jpg"):
            label = file.split("_")[0]
            img = cv2.imread(os.path.join(base_path, file))
            if img is not None:
                face_data.append((label, img))

    return face_data
