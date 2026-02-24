import os
from ultralytics import YOLO

def export_models():
    # Define models to process
    model_names = [
        "yolo26n-pose.pt",
        "yolo26s-pose.pt",
        "yolo26m-pose.pt",
        "yolo26l-pose.pt",
        "yolo26x-pose.pt",
        "yolo26n-seg.pt",
        "yolo26s-seg.pt",
        "yolo26m-seg.pt",
        "yolo26l-seg.pt",
        "yolo26x-seg.pt"
    ]
    
    # Destination directory for the web app
    target_dir = os.path.join(os.path.dirname(__file__), "..", "public", "models", "yolo26")
    os.makedirs(target_dir, exist_ok=True)
    
    print(f"Exporting models to {target_dir}...")
    
    for model_name in model_names:
        print(f"\nProcessing {model_name}...")
        try:
            if not os.path.exists(model_name):
                print(f"Skipping {model_name}: file not found.")
                continue

            # Load the model
            model = YOLO(model_name)
            
            # Export to ONNX
            # - imgsz=640 is standard
            # - format='onnx'
            # - simplify=True helps remove redundant nodes, better for ONNX Runtime Web
            # - dynamic=False (CRITICAL: WebGPU handles dynamic shapes terribly; this must be False)
            # - half=True (HIGHLY RECOMMENDED: Export in FP16 for Apple Silicon)
            # - opset=12 (Opset 12 or 17 has the best WebGPU operator coverage)
            exported_path = model.export(
                format="onnx", 
                imgsz=640, 
                simplify=True,
                dynamic=False,
                half=True,
                opset=17   # opset 17 rewrote the Resize op with full WebGPU JSEP support
            )
            
            # Move the exported .onnx file to the target directory
            onnx_filename = model_name.replace(".pt", ".onnx")
            final_path = os.path.join(target_dir, onnx_filename)
            
            # If the export saved it to the current dir, move it
            if os.path.exists(exported_path):
                os.rename(exported_path, final_path)
                print(f"Successfully exported {onnx_filename} to {final_path}")
            else:
                print(f"Warning: Expected exported file at {exported_path} but not found.")
                
        except Exception as e:
            print(f"Error exporting {model_name}: {e}")

if __name__ == "__main__":
    export_models()
    print("\nExport process complete.")
