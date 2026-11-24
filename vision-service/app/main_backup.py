
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import time

app = FastAPI(
    title="SmartCross Vision Service",
    description="Conventional computer vision motion analysis",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

background_subtractor = cv2.createBackgroundSubtractorMOG2(
    history=300,
    varThreshold=40,
    detectShadows=False
)


@app.get("/")
def home():
    return {
        "application": "SmartCross Vision Service",
        "status": "running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "opencv",
        "version": cv2.__version__
    }


@app.post("/reset")
def reset_detector():
    global background_subtractor

    background_subtractor = cv2.createBackgroundSubtractorMOG2(
        history=300,
        varThreshold=40,
        detectShadows=False
    )

    return {
        "success": True,
        "message": "Motion detector reset"
    }


@app.post("/analyze-frame")
async def analyze_frame(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image frame")

    image_bytes = await file.read()

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded frame is empty")

    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(status_code=400, detail="Unable to decode image")

    height, width = frame.shape[:2]

    if width > 960:
        scale = 960 / width
        frame = cv2.resize(frame, (960, int(height * scale)))
        height, width = frame.shape[:2]

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    foreground_mask = background_subtractor.apply(gray)
    kernel = np.ones((5, 5), np.uint8)

    foreground_mask = cv2.morphologyEx(
        foreground_mask,
        cv2.MORPH_OPEN,
        kernel
    )

    foreground_mask = cv2.dilate(
        foreground_mask,
        kernel,
        iterations=2
    )

    contours, _ = cv2.findContours(
        foreground_mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    detections = []

    for contour in contours:
        area = cv2.contourArea(contour)

        if area < 900:
            continue

        x, y, box_width, box_height = cv2.boundingRect(contour)

        detections.append({
            "x": int(x),
            "y": int(y),
            "width": int(box_width),
            "height": int(box_height),
            "area": int(area),
            "aspect_ratio": round(float(box_height / max(box_width, 1)), 2)
        })

    return {
        "success": True,
        "frame_width": width,
        "frame_height": height,
        "motion_count": len(detections),
        "detections": detections,
        "processing": "OpenCV background subtraction",
        "timestamp": time.time()
    }
