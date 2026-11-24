
import time


class CrossingMonitor:

    def __init__(self, entry_ratio=0.30, exit_ratio=0.70):
        self.entry_ratio = entry_ratio
        self.exit_ratio = exit_ratio

        self.active_crossings = {}
        self.completed_events = []
        self.total_completed = 0

        self.diagnostics = {
            "tracks_seen": 0,
            "valid_tracks": 0,
            "entry_detections": 0,
            "exit_detections": 0,
            "wrong_direction": 0,
            "outside_vertical_area": 0
        }

        self.recent_positions = []

    def reset(self):
        self.active_crossings.clear()
        self.completed_events.clear()
        self.total_completed = 0

        self.diagnostics = {
            "tracks_seen": 0,
            "valid_tracks": 0,
            "entry_detections": 0,
            "exit_detections": 0,
            "wrong_direction": 0,
            "outside_vertical_area": 0
        }

        self.recent_positions.clear()

    def process(self, tracks, frame_width, frame_height):

        now = time.time()

        entry_x = int(frame_width * self.entry_ratio)
        exit_x = int(frame_width * self.exit_ratio)

        self.diagnostics = {
            "tracks_seen": len(tracks),
            "valid_tracks": 0,
            "entry_detections": 0,
            "exit_detections": 0,
            "wrong_direction": 0,
            "outside_vertical_area": 0
        }

        positions = []

        for track in tracks:

            track_id = track["id"]

            if track.get("disappeared_frames", 0) != 0:
                continue

            history = track.get("history", [])

            if len(history) < 2:
                continue

            previous_x = history[-2]["x"]
            current_x = history[-1]["x"]
            current_y = history[-1]["y"]

            positions.append({
                "track_id": track_id,
                "previous_x": round(previous_x, 1),
                "current_x": round(current_x, 1),
                "direction": (
                    "RIGHT" if current_x > previous_x
                    else "LEFT" if current_x < previous_x
                    else "STATIONARY"
                )
            })

            if not (
                frame_height * 0.10
                <= current_y
                <= frame_height * 0.90
            ):
                self.diagnostics["outside_vertical_area"] += 1
                continue

            self.diagnostics["valid_tracks"] += 1

            moving_right = current_x > previous_x

            crossed_entry = (
                previous_x < entry_x <= current_x
            )

            crossed_exit = (
                previous_x < exit_x <= current_x
            )

            # Register entry when the object crosses the entry
            # line, or when it is first observed moving inside
            # the crossing zone.
            if track_id not in self.active_crossings:

                inside_zone = (
                    entry_x <= current_x < exit_x
                )

                if crossed_entry or (inside_zone and moving_right):

                    self.active_crossings[track_id] = {
                        "track_id": track_id,
                        "entry_timestamp": now,
                        "entry_time": time.strftime(
                            "%Y-%m-%d %H:%M:%S",
                            time.localtime(now)
                        ),
                        "last_seen": now,
                        "entry_position_x": current_x,
                        "status": "crossing"
                    }

                    self.diagnostics["entry_detections"] += 1

            else:

                crossing = self.active_crossings[track_id]
                crossing["last_seen"] = now

                # Complete only after rightward movement reaches
                # the exit line.
                if crossed_exit and moving_right:

                    duration = now - crossing["entry_timestamp"]

                    event = {
                        "track_id": track_id,
                        "entry_time": crossing["entry_time"],
                        "exit_time": time.strftime(
                            "%Y-%m-%d %H:%M:%S",
                            time.localtime(now)
                        ),
                        "duration_seconds": round(duration, 2),
                        "entry_position_x": crossing["entry_position_x"],
                        "exit_position_x": current_x,
                        "status": "completed"
                    }

                    self.completed_events.append(event)
                    self.total_completed += 1

                    self.diagnostics["exit_detections"] += 1

                    del self.active_crossings[track_id]

                elif current_x < previous_x:
                    self.diagnostics["wrong_direction"] += 1

        self.recent_positions = positions[-20:]

        # Remove stale crossings.
        stale_ids = []

        for track_id, crossing in self.active_crossings.items():

            elapsed = now - crossing["entry_timestamp"]
            last_seen = now - crossing["last_seen"]

            if elapsed > 30 or last_seen > 5:
                stale_ids.append(track_id)

        for track_id in stale_ids:
            del self.active_crossings[track_id]

        self.completed_events = self.completed_events[-200:]

        return self.get_status(entry_x, exit_x)

    def get_status(self, entry_x=None, exit_x=None):

        return {
            "entry_line_x": entry_x,
            "exit_line_x": exit_x,
            "active_crossings": list(
                self.active_crossings.values()
            ),
            "completed_events": self.completed_events[-20:],
            "total_completed": self.total_completed,
            "diagnostics": self.diagnostics,
            "recent_positions": self.recent_positions
        }
