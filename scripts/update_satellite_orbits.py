"""Refresh only the five tracked satellites; fail safely on provider errors."""
import datetime as dt
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

IDS = [25544, 48274, 20580, 25994, 27424]
MAX_FALLBACK_AGE_SECONDS = 48 * 3600
TRANSIENT_HTTP_ERRORS = {500, 502, 503, 504}
FIELDS = ["MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE",
          "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"]

def validate(row, catalog_id, now, max_age_seconds=7 * 86400):
    import math
    if row.get("NORAD_CAT_ID") != catalog_id:
        raise ValueError("Wrong satellite in response")
    epoch = dt.datetime.fromisoformat(row["EPOCH"]).replace(tzinfo=dt.timezone.utc)
    if not -86400 <= (now - epoch).total_seconds() <= max_age_seconds:
        raise ValueError("Orbit data is stale or future-dated")
    if any(type(row.get(key)) not in (int, float) or not math.isfinite(row[key]) for key in FIELDS):
        raise ValueError("Malformed orbit")
    if not (0 < row["MEAN_MOTION"] <= 18 and 0 <= row["ECCENTRICITY"] < 1 and 0 <= row["INCLINATION"] <= 180):
        raise ValueError("Invalid orbital elements")
    return row

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Provider redirected the request; review the feed URL")

def fetch_orbits(now):
    opener = urllib.request.build_opener(NoRedirect())
    rows = []
    for index, catalog_id in enumerate(IDS):
        if index:
            time.sleep(2)
        url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={catalog_id}&FORMAT=JSON"
        request = urllib.request.Request(url, headers={"User-Agent": "Gregle-Satellite-Tracker/1.0"})
        with opener.open(request, timeout=25) as response:
            if response.status != 200:
                raise urllib.error.HTTPError(url, response.status, "Provider returned non-200; stopping", response.headers, None)
            payload = json.load(response)
        if not isinstance(payload, list) or len(payload) != 1:
            raise ValueError("Expected one orbital record")
        rows.append(validate(payload[0], catalog_id, now))
    return rows

def usable_snapshot(target, now):
    """Allow a short outage only when every cached orbit is complete and recent."""
    try:
        snapshot = json.loads(target.read_text())
        if not isinstance(snapshot, dict):
            return False
        retrieved = dt.datetime.fromisoformat(snapshot["retrieved_at"])
        if retrieved.tzinfo is None or not 0 <= (now - retrieved).total_seconds() <= MAX_FALLBACK_AGE_SECONDS:
            return False
        rows = snapshot["satellites"]
        if not isinstance(rows, list) or len(rows) != len(IDS):
            return False
        for row, catalog_id in zip(rows, IDS):
            if not isinstance(row, dict):
                return False
            validate(row, catalog_id, now, MAX_FALLBACK_AGE_SECONDS)
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False

def main():
    now = dt.datetime.now(dt.timezone.utc)
    target = Path(__file__).resolve().parent.parent / "data" / "satellite-orbits.json"
    try:
        rows = fetch_orbits(now)
    except (urllib.error.URLError, TimeoutError) as error:
        # Stop all provider requests on error; the next scheduled run can try again.
        # HTTPError subclasses URLError, so never soften permanent HTTP errors.
        if isinstance(error, urllib.error.HTTPError) and error.code not in TRANSIENT_HTTP_ERRORS:
            raise
        if not usable_snapshot(target, now):
            raise
        reason = f"HTTP {error.code}" if isinstance(error, urllib.error.HTTPError) else "a network error"
        print(f"::warning::CelesTrak refresh stopped after {reason}. Keeping the complete, validated snapshot "
              "(retrieval and orbit ages within 48 hours) without changing its timestamps. "
              "The next scheduled refresh will try again.")
        return
    old = json.loads(target.read_text()) if target.exists() else {}
    if old.get("satellites") == rows:
        print("Orbit records unchanged")
        return
    output = {"source": "https://celestrak.org/NORAD/elements/gp.php",
              "retrieved_at": now.isoformat(), "satellites": rows}
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(output, indent=2) + "\n")
    temporary.replace(target)
    print("Updated five satellite orbits")

if __name__ == "__main__":
    main()
