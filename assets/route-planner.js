// Shared by the fuel and EV calculators. Manual estimates work without the map library.
function initialiseRoutePlanner(onDistance) {
  const startLocationInput = document.getElementById("startLocation");
  const endLocationInput = document.getElementById("endLocation");
  const routeButton = document.getElementById("routeButton");
  const clearRouteButton = document.getElementById("clearRouteButton");
  const statusBox = document.getElementById("statusBox");
  function setStatus(message, isWarn = false) {
    statusBox.textContent = message;
    statusBox.className = isWarn ? "status warn" : "status";
  }
  if (typeof L === "undefined") {
    setStatus("The map is unavailable. Enter your distance above to calculate the trip cost.", true);
    routeButton.disabled = true;
    clearRouteButton.disabled = true;
    return;
  }
  const map = L.map("map").setView([48.4284, -123.3656], 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  let startMarker = null;
  let endMarker = null;
  let routeLine = null;
  let clickStage = "start";
  let startPoint = null;
  let endPoint = null;
  let routeRequestId = 0;

  function invalidateRoute() {
    routeRequestId++;
    routeButton.disabled = false;
    routeButton.textContent = "Calculate route distance";
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
  }

  function clearRouteVisuals() {
    invalidateRoute();
    if (startMarker) {
      map.removeLayer(startMarker);
      startMarker = null;
    }
    if (endMarker) {
      map.removeLayer(endMarker);
      endMarker = null;
    }
    startPoint = null;
    endPoint = null;
    startLocationInput.value = "";
    endLocationInput.value = "";
    clickStage = "start";
  }

  function popupText(label) {
    const element = document.createElement("span");
    element.textContent = label;
    return element;
  }

  function setStartPoint(lat, lon, label = "Start point") {
    if (startMarker) {
      map.removeLayer(startMarker);
    }
    startMarker = L.marker([lat, lon]).addTo(map).bindPopup(popupText(label));
  }

  function setEndPoint(lat, lon, label = "End point") {
    if (endMarker) {
      map.removeLayer(endMarker);
    }
    endMarker = L.marker([lat, lon]).addTo(map).bindPopup(popupText(label));
  }

  async function geocodePlace(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error("Location search failed.");
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`No result found for "${query}".`);
    }

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      label: data[0].display_name
    };
  }

  async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error("Reverse lookup failed.");
    }

    const data = await response.json();
    return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  async function fetchRoute(start, end) {
    const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error("Routing request failed.");
    }

    const data = await response.json();

    if (!data.routes || !data.routes.length) {
      throw new Error("No drivable route found.");
    }

    return data.routes[0];
  }

  function drawRoute(route) {
    if (routeLine) {
      map.removeLayer(routeLine);
    }

    routeLine = L.geoJSON(route.geometry).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  }

  async function calculateRouteDistance() {
    const startText = startLocationInput.value.trim();
    const endText = endLocationInput.value.trim();

    if (!startText || !endText) {
      setStatus("Please enter both a start and an end location, or use two clicks on the map.", true);
      return;
    }

    const requestId = ++routeRequestId;
    try {
      routeButton.disabled = true;
      routeButton.textContent = "Calculating…";
      setStatus("Looking up locations and route…");

      const [start, end] = await Promise.all([
        startPoint && startPoint.inputText === startText
          ? startPoint : geocodePlace(startText).then(point => ({ ...point, inputText: startText })),
        endPoint && endPoint.inputText === endText
          ? endPoint : geocodePlace(endText).then(point => ({ ...point, inputText: endText }))
      ]);
      if (requestId !== routeRequestId) return;

      startPoint = start;
      endPoint = end;
      setStartPoint(start.lat, start.lon, start.label);
      setEndPoint(end.lat, end.lon, end.label);

      const route = await fetchRoute(start, end);
      if (requestId !== routeRequestId) return;
      drawRoute(route);

      const km = route.distance / 1000;
      onDistance(km);

      setStatus(
        `Route found from ${start.label} to ${end.label}. One-way distance: ${km.toFixed(1)} km. Your estimate has been updated.`
      );
    } catch (error) {
      if (requestId === routeRequestId) {
        setStatus(error.message || "Could not calculate the route.", true);
      }
    } finally {
      if (requestId === routeRequestId) {
        routeButton.disabled = false;
        routeButton.textContent = "Calculate route distance";
      }
    }
  }

  async function labelMapPoint(point, isStart) {
    try {
      const label = await reverseGeocode(point.lat, point.lon);
      const current = isStart ? startPoint : endPoint;
      const input = isStart ? startLocationInput : endLocationInput;
      if (current !== point || input.value !== point.inputText) return;
      point.label = label;
      point.inputText = label;
      input.value = label;
      const marker = isStart ? startMarker : endMarker;
      if (marker) marker.bindPopup(popupText(label));
    } catch (_) {} // Coordinates remain usable when address lookup fails.
  }

  map.on("click", (event) => {
    const { lat, lng } = event.latlng;
    const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const point = { lat, lon: lng, label, inputText: label };

    if (clickStage === "start") {
      clearRouteVisuals();
      startPoint = point;
      startLocationInput.value = label;
      setStartPoint(lat, lng, label);
      clickStage = "end";
      void labelMapPoint(point, true);
      setStatus("Start point set. Click the map again to choose the end point.");
    } else {
      invalidateRoute();
      endPoint = point;
      endLocationInput.value = label;
      setEndPoint(lat, lng, label);
      clickStage = "start";
      void labelMapPoint(point, false);
      return calculateRouteDistance();
    }
  });

  startLocationInput.addEventListener("input", () => {
    startPoint = null;
    invalidateRoute();
  });
  endLocationInput.addEventListener("input", () => {
    endPoint = null;
    invalidateRoute();
  });

  routeButton.addEventListener("click", calculateRouteDistance);

  clearRouteButton.addEventListener("click", () => {
    clearRouteVisuals();
    setStatus("Route cleared. Enter two places or click two points on the map.");
  });

}
