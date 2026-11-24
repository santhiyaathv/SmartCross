
class CrossingTimeCalculator:

    def __init__(
        self,
        road_width=12.0,
        walking_speed=1.0,
        safety_buffer=3.0,
        allocated_time=15.0
    ):
        self.configure(
            road_width,
            walking_speed,
            safety_buffer,
            allocated_time
        )

    def configure(
        self,
        road_width,
        walking_speed,
        safety_buffer,
        allocated_time
    ):
        if road_width <= 0:
            raise ValueError("Road width must be greater than zero")

        if walking_speed <= 0:
            raise ValueError("Walking speed must be greater than zero")

        if safety_buffer < 0:
            raise ValueError("Safety buffer cannot be negative")

        if allocated_time < 0:
            raise ValueError("Allocated time cannot be negative")

        self.road_width = float(road_width)
        self.walking_speed = float(walking_speed)
        self.safety_buffer = float(safety_buffer)
        self.allocated_time = float(allocated_time)

    def calculate(self):

        walking_time = self.road_width / self.walking_speed

        required_time = walking_time + self.safety_buffer

        deficit = max(
            0.0,
            required_time - self.allocated_time
        )

        sufficient = deficit == 0

        return {
            "road_width_m": round(self.road_width, 2),
            "walking_speed_mps": round(self.walking_speed, 2),
            "walking_time_seconds": round(walking_time, 2),
            "safety_buffer_seconds": round(self.safety_buffer, 2),
            "required_crossing_time_seconds": round(required_time, 2),
            "allocated_signal_time_seconds": round(self.allocated_time, 2),
            "crossing_time_deficit_seconds": round(deficit, 2),
            "time_sufficient": sufficient,
            "status": "SUFFICIENT" if sufficient else "TIME DEFICIT",
            "calculation_method": "Road width / walking speed + safety buffer"
        }

    def analyze_actual_crossing(self, actual_duration):

        if actual_duration < 0:
            raise ValueError("Actual duration cannot be negative")

        result = self.calculate()

        result["actual_crossing_duration_seconds"] = round(
            float(actual_duration), 2
        )

        result["actual_vs_required"] = round(
            float(actual_duration)
            - result["required_crossing_time_seconds"],
            2
        )

        result["actual_crossing_sufficient"] = (
            actual_duration >= result["required_crossing_time_seconds"]
        )

        return result
