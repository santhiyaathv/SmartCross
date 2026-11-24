
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import time
import math

app = FastAPI(
    title="SmartCross Vision Service",
    description="Conventional computer vision motion detection and tracking",
    version="2.0.0"
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


class CentroidTracker:

    def __init__(self, max_disappeared=8, max_distance=120, history_size=30):
        self.next_object_id = 1
        self.objects = {}
        self.disappeared = {}
        self.boxes = {}
        self.histories = {}
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance
        self.history_size = history_size
        self.total_registered = 0
        self.total_lost = 0

    def register(self, centroid, box):
        object_id = self.next_object_id
        self.next_object_id += 1

        self.objects[object_id] = centroid
        self.disappeared[object_id] = 0
        self.boxes[object_id] = box
        self.histories[object_id] = [centroid]
        self.total_registered += 1

    def deregister(self, object_id):
        self.objects.pop(object_id, None)
        self.disappeared.pop(object_id, None)
        self.boxes.pop(object_id, None)
        self.histories.pop(object_id, None)
        self.total_lost += 1

    def update(self, rectangles):

        if len(rectangles) == 0:
            for object_id in list(self.disappeared.keys()):
                self.disappeared[object_id] += 1

                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)

            return self.get_tracks()

        input_centroids = []

        for x, y, width, height in rectangles:
            center_x = int(x + width / 2)
            center_y = int(y + height / 2)
            input_centroids.append((center_x, center_y))

        if len(self.objects) == 0:
            for centroid, box in zip(input_centroids, rectangles):
                self.register(centroid, box)

            return self.get_tracks()

        object_ids = list(self.objects.keys())
        object_centroids = list(self.objects.values())

        distances = np.zeros(
            (len(object_centroids), len(input_centroids)),
            dtype=float
        )

        for i, old_center in enumerate(object_centroids):
            for j, new_center in enumerate(input_centroids):
                distances[i, j] = math.dist(old_center, new_center)

        pairs = []

        for i in range(distances.shape[0]):
            for j in range(distances.shape[1]):
                pairs.append((distances[i, j], i, j))

        pairs.sort(key=lambda item: item[0])

        used_rows = set()
        used_columns = set()

        for distance, row, column in pairs:

            if row in used_rows or column in used_columns:
                continue

            if distance > self.max_distance:
                continue

            object_id = object_ids[row]
            centroid = input_centroids[column]

            self.objects[object_id] = centroid
            self.disappeared[object_id] = 0
            self.boxes[object_id] = rectangles[column]

            self.histories[object_id].append(centroid)

            if len(self.histories[object_id]) > self.history_size:
                self.histories[object_id] = (
                    self.histories[object_id][-self.history_size:]
                )

            used_rows.add(row)
            used_columns.add(column)

        unused_rows = set(range(distances.shape[0])) - used_rows
        unused_columns = set(range(distances.shape[1])) - used_columns

        for row in unused_rows:
            object_id = object_ids[row]
            self.disappeared[object_id] += 1

            if self.disappeared[object_id] > self.max_disappeared:
                self.deregister(object_id)

        for column in unused_columns:
            self.register(
                input_centroids[column],
                rectangles[column]
            )

        return self.get_tracks()

    def get_tracks(self):

        tracks = []

        for object_id, centroid in self.objects.items():

            history = self.histories[object_id]

            tracks.append({
                "id": int(object_id),
                "centroid": {
                    "x": int(centroid[0]),
                    "y": int(centroid[1])
                },
                "box": {
                    "x": int(self.boxes[object_id][0]),
                    "y": int(self.boxes[object_id][1]),
                    "width": int(self.boxes[object_id][2]),
                    "height": int(self.boxes[object_id][3])
                },
                "history": [
                    {"x": int(point[0]), "y": int(point[1])}
                    for point in history
                ],
                "disappeared_frames": int(
                    self.disappeared[object_id]
                )
            })

        return tracks


tracker = CentroidTracker(
    max_disappeared=8,
    max_distance=120,
    history_size=30
)


@app.get("/")
def home():
    return {
        "application": "SmartCross Vision Service",
        "status": "running",
        "version": "2.0.0"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "opencv",
        "version": cv2.__version__,
        "tracking": "enabled"
    }


@app.post("/reset")
def reset_detector():
    global background_subtractor, tracker

    background_subtractor = cv2.createBackgroundSubtractorMOG2(
        history=300,
        varThreshold=40,
        detectShadows=False
    )

    tracker = CentroidTracker(
        max_disappeared=8,
        max_distance=120,
        history_size=30
    )

    return {
        "success": True,
        "message": "Motion detector and tracker reset"
    }


@app.post("/analyze-frame")
async def analyze_frame(file: UploadFile = File(...)):

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Please upload an image frame"
        )

    image_bytes = await file.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded frame is empty"
        )

    image_array = np.frombuffer(
        image_bytes,
        dtype=np.uint8
    )

    frame = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR
    )

    if frame is None:
        raise HTTPException(
            status_code=400,
            detail="Unable to decode image"
        )

    height, width = frame.shape[:2]

    if width > 960:
        scale = 960 / width

        frame = cv2.resize(
            frame,
            (960, int(height * scale))
        )

        height, width = frame.shape[:2]

    gray = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY
    )

    gray = cv2.GaussianBlur(
        gray,
        (5, 5),
        0
    )

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

    rectangles = []

    for contour in contours:

        area = cv2.contourArea(contour)

        if area < 900:
            continue

        x, y, box_width, box_height = cv2.boundingRect(contour)

        rectangles.append((
            int(x),
            int(y),
            int(box_width),
            int(box_height)
        ))

    tracks = tracker.update(rectangles)

    detections = []

    for track in tracks:

        box = track["box"]

        detections.append({
            "x": box["x"],
            "y": box["y"],
            "width": box["width"],
            "height": box["height"],
            "id": track["id"],
            "centroid": track["centroid"],
            "history": track["history"],
            "disappeared_frames": track["disappeared_frames"]
        })

    return {
        "success": True,
        "frame_width": width,
        "frame_height": height,
        "motion_count": len(rectangles),
        "active_tracks": len(tracks),
        "total_registered": tracker.total_registered,
        "total_lost": tracker.total_lost,
        "detections": detections,
        "tracked_objects": tracks,
        "processing": "OpenCV background subtraction + centroid tracking",
        "timestamp": time.time()
    }
