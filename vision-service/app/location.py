
from pathlib import Path
import json
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

STORAGE_FILE = Path(__file__).resolve().parent.parent / "locations.json"


class LocationCreate(BaseModel):
    name: str = Field(default="Crossing location", min_length=1, max_length=100)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


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


@router.get("/locations")
def get_locations():
    return {"locations": load_locations()}


@router.post("/locations")
def add_location(location: LocationCreate):
    locations = load_locations()

    new_location = {
        "id": str(uuid.uuid4()),
        "name": location.name,
        "latitude": location.latitude,
        "longitude": location.longitude
    }

    locations.append(new_location)
    save_locations(locations)

    return {
        "message": "Location saved successfully",
        "location": new_location
    }


@router.delete("/locations/{location_id}")
def delete_location(location_id: str):
    locations = load_locations()

    updated_locations = [
        location for location in locations
        if location["id"] != location_id
    ]

    if len(updated_locations) == len(locations):
        raise HTTPException(status_code=404, detail="Location not found")

    save_locations(updated_locations)

    return {
        "message": "Location deleted successfully",
        "locations": updated_locations
    }
