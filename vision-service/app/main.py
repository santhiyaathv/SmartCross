
import cv2
import json
import os
import time
import uuid
import numpy as np

from pathlib import Path
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(
    title="SmartCross Vision API",
    version="4.2.1",
    description="Pedestrian crossing monitoring and safety analysis"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+"
)


BASE_DIR = Path(__file__).resolve().parent
STORAGE_FILE = BASE_DIR / "locations.json"


# --------------------------------------------------
# CROSSING SETTINGS
# --------------------------------------------------

crossing_settings = {
    "road_width_m": 12.0,
    "walking_speed_mps": 1.0,
    "safety_buffer_seconds": 3.0,
    "allocated_signal_time_seconds": 12.0
}


class CrossingSettings(BaseModel):
    road_width_m: float = 12.0
    walking_speed_mps: float = 1.0
    safety_buffer_seconds: float = 3.0
    allocated_signal_time_seconds: float = 12.0


def calculate_time_deficit():
    road_width = crossing_settings["road_width_m"]
    walking_speed = crossing_settings["walking_speed_mps"]
    safety_buffer = crossing_settings["safety_buffer_seconds"]
    allocated_time = crossing_settings["allocated_signal_time_seconds"]

    walking_time = road_width / max(walking_speed, 0.1)
    required_time = walking_time + safety_buffer

    deficit = max(0, required_time - allocated_time)
    surplus = max(0, allocated_time - required_time)

    return {
        "road_width_m": road_width,
        "walking_speed_mps": walking_speed,
        "walking_time_seconds": round(walking_time, 2),
        "safety_buffer_seconds": safety_buffer,
        "required_crossing_time_seconds": round(required_time, 2),
        "allocated_signal_time_seconds": allocated_time,
        "time_deficit_seconds": round(deficit, 2),
        "time_surplus_seconds": round(surplus, 2),
        "safety_status": "INSUFFICIENT" if deficit > 0 else "SUFFICIENT",
        "calculation_type": "Estimated from configured road width and walking speed"
    }


# --------------------------------------------------
# MOTION DETECTION
# --------------------------------------------------

background_subtractor = cv2.createBackgroundSubtractorMOG2(
    history=500,
    varThreshold=40,
    detectShadows=True
)


def detect_motion(frame):
    foreground_mask = background_subtractor.apply(frame)

    kernel = np.ones((5, 5), np.uint8)

    foreground_mask = cv2.morphologyEx(
        foreground_mask,
        cv2.MORPH_OPEN,
        kernel
    )

    foreground_mask = cv2.morphologyEx(
        foreground_mask,
        cv2.MORPH_CLOSE,
        kernel
    )

    contours, _ = cv2.findContours(
        foreground_mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    detections = []

    for contour in contours:
        area = cv2.contourArea(contour)

        if area < 500:
            continue

        x, y, w, h = cv2.boundingRect(contour)

        detections.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "area": float(area)
        })

    return foreground_mask, detections


# --------------------------------------------------
# PEDESTRIAN DETECTION - HOG + SVM
# --------------------------------------------------

hog_detector = cv2.HOGDescriptor()
hog_detector.setSVMDetector(
    cv2.HOGDescriptor_getDefaultPeopleDetector()
)


def detect_pedestrians(frame):
    gray_frame = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY
    )

    # Correct OpenCV 4.10.0 parameter:
    # groupThreshold, NOT finalThreshold.
    boxes, weights = hog_detector.detectMultiScale(
        gray_frame,
        hitThreshold=0,
        winStride=(8, 8),
        padding=(8, 8),
        scale=1.05,
        groupThreshold=2
    )

    pedestrian_detections = []

    for box, weight in zip(boxes, weights):
        x, y, w, h = box

        pedestrian_detections.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "confidence": float(weight)
        })

    return pedestrian_detections


# --------------------------------------------------
# OBJECT TRACKING
# --------------------------------------------------

class CentroidTracker:

    def __init__(self, max_missing=15, max_distance=80):
        self.next_id = 1
        self.objects = {}
        self.missing = {}
        self.history = {}
        self.max_missing = max_missing
        self.max_distance = max_distance

    def register(self, center):
        object_id = self.next_id
        self.next_id += 1

        self.objects[object_id] = center
        self.missing[object_id] = 0
        self.history[object_id] = [center]

    def deregister(self, object_id):
        self.objects.pop(object_id, None)
        self.missing.pop(object_id, None)
        self.history.pop(object_id, None)

    def update(self, detections):

        centers = []

        for detection in detections:
            x = detection["x"]
            y = detection["y"]
            w = detection["width"]
            h = detection["height"]

            centers.append((
                int(x + w / 2),
                int(y + h / 2)
            ))

        if len(centers) == 0:
            for object_id in list(self.missing):
                self.missing[object_id] += 1

                if self.missing[object_id] > self.max_missing:
                    self.deregister(object_id)

            return self.get_tracked_objects()

        if len(self.objects) == 0:
            for center in centers:
                self.register(center)

            return self.get_tracked_objects()

        object_ids = list(self.objects.keys())
        existing_centers = list(self.objects.values())

        distances = []

        for object_id in object_ids:
            row = []

            for center in centers:
                old_center = self.objects[object_id]

                distance = np.linalg.norm(
                    np.array(old_center) - np.array(center)
                )

                row.append(distance)

            distances.append(row)

        distances = np.array(distances)

        used_objects = set()
        used_detections = set()

        while distances.size > 0:
            row, col = np.unravel_index(
                np.argmin(distances),
                distances.shape
            )

            if distances[row, col] > self.max_distance:
                break

            object_id = object_ids[row]
            center = centers[col]

            self.objects[object_id] = center
            self.missing[object_id] = 0
            self.history[object_id].append(center)

            used_objects.add(object_id)
            used_detections.add(col)

            distances[row, :] = float("inf")
            distances[:, col] = float("inf")

            if not np.isfinite(distances).any():
                break

        for object_id in object_ids:
            if object_id not in used_objects:
                self.missing[object_id] += 1

                if self.missing[object_id] > self.max_missing:
                    self.deregister(object_id)

        for index, center in enumerate(centers):
            if index not in used_detections:
                self.register(center)

        return self.get_tracked_objects()

    def get_tracked_objects(self):
        result = []

        for object_id, center in self.objects.items():
            result.append({
                "track_id": object_id,
                "position": {
                    "x": center[0],
                    "y": center[1]
                },
                "history_points": len(
                    self.history.get(object_id, [])
                ),
                "missing_frames": self.missing.get(object_id, 0)
            })

        return result


tracker = CentroidTracker()


# --------------------------------------------------
# CROSSING MONITOR
# --------------------------------------------------

class CrossingMonitor:

    def __init__(self):
        self.events = []
        self.active_crossings = {}
        self.total_completed = 0

    def update(self, tracked_objects, frame_height):

        current_ids = set()

        for obj in tracked_objects:
            track_id = obj["track_id"]
            current_ids.add(track_id)

            y = obj["position"]["y"]

            if track_id not in self.active_crossings:
                self.active_crossings[track_id] = {
                    "start_time": time.time(),
                    "start_y": y
                }

            else:
                self.active_crossings[track_id]["last_y"] = y

        completed_ids = []

        for track_id in list(self.active_crossings):

            if track_id not in current_ids:
                crossing = self.active_crossings[track_id]

                duration = time.time() - crossing["start_time"]

                self.events.append({
                    "id": str(uuid.uuid4()),
                    "track_id": track_id,
                    "duration_seconds": round(duration, 2),
                    "start_y": crossing["start_y"],
                    "end_y": crossing.get(
                        "last_y",
                        crossing["start_y"]
                    ),
                    "timestamp": datetime.now().isoformat(),
                    "status": "COMPLETED"
                })

                self.total_completed += 1
                completed_ids.append(track_id)

        for track_id in completed_ids:
            self.active_crossings.pop(track_id, None)

        return self.get_summary()

    def get_summary(self):
        return {
            "total_completed_crossings": self.total_completed,
            "active_crossings": len(self.active_crossings),
            "crossing_events": self.events
        }

    def reset(self):
        self.events.clear()
        self.active_crossings.clear()
        self.total_completed = 0


crossing_monitor = CrossingMonitor()


# --------------------------------------------------
# PERSISTENT MAP LOCATIONS
# --------------------------------------------------

def load_locations():
    if not STORAGE_FILE.exists():
        return []

    try:
        with open(STORAGE_FILE, "r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError):
        return []


def save_locations(locations):
    with open(STORAGE_FILE, "w", encoding="utf-8") as file:
        json.dump(locations, file, indent=4)


locations = load_locations()


# --------------------------------------------------
# BASIC ENDPOINTS
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "SmartCross Vision API is running",
        "version": "4.2.1"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "opencv_connected": True,
        "motion_detection": "MOG2 Background Subtraction",
        "pedestrian_detection": "HOG + SVM",
        "version": "4.2.1"
    }


# --------------------------------------------------
# CROSSING SETTINGS ENDPOINTS
# --------------------------------------------------

@app.get("/crossing-settings")
def get_crossing_settings():
    return crossing_settings


@app.put("/crossing-settings")
def update_crossing_settings(settings: CrossingSettings):

    if settings.road_width_m <= 0:
        raise HTTPException(400, "Road width must be greater than zero")

    if settings.walking_speed_mps <= 0:
        raise HTTPException(400, "Walking speed must be greater than zero")

    if settings.safety_buffer_seconds < 0:
        raise HTTPException(400, "Safety buffer cannot be negative")

    if settings.allocated_signal_time_seconds < 0:
        raise HTTPException(400, "Signal time cannot be negative")

    crossing_settings.update(settings.model_dump())

    return {
        "message": "Crossing settings updated",
        "settings": crossing_settings,
        "time_analysis": calculate_time_deficit()
    }


@app.get("/time-analysis")
def get_time_analysis():
    return calculate_time_deficit()


# --------------------------------------------------
# RESET ENDPOINT
# --------------------------------------------------

@app.post("/reset")
def reset_system():

    global background_subtractor
    global tracker
    global crossing_monitor

    background_subtractor = cv2.createBackgroundSubtractorMOG2(
        history=500,
        varThreshold=40,
        detectShadows=True
    )

    tracker = CentroidTracker()
    crossing_monitor = CrossingMonitor()

    return {
        "message": "SmartCross monitoring reset successfully"
    }


# --------------------------------------------------
# ANALYZE FRAME
# --------------------------------------------------

@app.post("/analyze-frame")
async def analyze_frame(file: UploadFile = File(...)):

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Please upload a valid image")

    contents = await file.read()

    if not contents:
        raise HTTPException(400, "Uploaded image is empty")

    image_array = np.frombuffer(
        contents,
        dtype=np.uint8
    )

    frame = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR
    )

    if frame is None:
        raise HTTPException(400, "Could not decode uploaded image")

    foreground_mask, motion_detections = detect_motion(frame)

    pedestrian_detections = detect_pedestrians(frame)

    tracked_objects = tracker.update(motion_detections)

    crossing_summary = crossing_monitor.update(
        tracked_objects,
        frame.shape[0]
    )

    return {
        "status": "success",
        "camera_connected": True,
        "opencv_connected": True,
        "frames_processed": 1,
        "motion_regions_detected": len(motion_detections),
        "detections": motion_detections,
        "tracked_objects": tracked_objects,
        "active_tracks": len(tracked_objects),
        "total_registered": tracker.next_id - 1,
        "total_lost": tracker.next_id - 1 - len(tracked_objects),
        "detection_method": "Background subtraction (MOG2)",
        "tracking_method": "Centroid tracking",
        "pedestrian_identification": "Enabled",
        "pedestrian_detection_method": "HOG + SVM",
        "pedestrian_count": len(pedestrian_detections),
        "pedestrian_detections": pedestrian_detections,
        "crossing_summary": crossing_summary,
        "foreground_mask_pixels": int(
            cv2.countNonZero(foreground_mask)
        )
    }


# --------------------------------------------------
# CROSSING EVENTS
# --------------------------------------------------

@app.get("/crossing-events")
def get_crossing_events():
    return crossing_monitor.events


@app.post("/crossing-reset")
def reset_crossings():
    crossing_monitor.reset()

    return {
        "message": "Crossing records reset successfully"
    }


@app.get("/crossing-summary")
def get_crossing_summary():
    return crossing_monitor.get_summary()


# --------------------------------------------------
# MAP LOCATIONS
# --------------------------------------------------

@app.get("/locations")
def get_locations():
    return locations


@app.post("/locations")
def add_location(location: dict):

    required_fields = ["name", "latitude", "longitude"]

    for field in required_fields:
        if field not in location:
            raise HTTPException(
                400,
                f"Missing required field: {field}"
            )

    new_location = {
        **location,
        "id": str(uuid.uuid4())
    }

    locations.append(new_location)
    save_locations(locations)

    return {
        "message": "Location added successfully",
        "location": new_location
    }


@app.delete("/locations/{location_id}")
def delete_location(location_id: str):

    global locations

    original_count = len(locations)

    locations = [
        location
        for location in locations
        if str(location.get("id")) != location_id
    ]

    if len(locations) == original_count:
        raise HTTPException(404, "Location not found")

    save_locations(locations)

    return {
        "message": "Location deleted successfully"
    }
