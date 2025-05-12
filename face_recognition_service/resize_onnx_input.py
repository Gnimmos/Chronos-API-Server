import onnx

# Load the model
model_path = "models/mobilefacenet.onnx"
model = onnx.load(model_path)

# Update the input shape
model.graph.input[0].type.tensor_type.shape.dim[2].dim_value = 224  # Height
model.graph.input[0].type.tensor_type.shape.dim[3].dim_value = 224  # Width

# Save the updated model
updated_model_path = "models/mobilefacenet_224.onnx"
onnx.save(model, updated_model_path)

print(f"✅ Updated model saved as: {updated_model_path}")
