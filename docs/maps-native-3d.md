# Regular OpenFreeMap 3D

The regular 3D basemap uses MapLibre GL JS 5.6.2 in the Gregle page (`assets/maps-native-3d.js`). It loads OpenFreeMap Liberty directly, without an iframe, API key, MapTiler account or Mapbox token. Liberty includes extruded buildings at zoom 14 and above.

Leaflet remains the shared model for Gregle UI, search, navigation and links. Camera position/zoom synchronise in both directions with a reentrancy guard. Leaflet clockwise map rotation is the negative of MapLibre camera bearing. Existing zoom and compass controls operate on that model; regular 3D/2D switches preserve the map view and selection. Car-mode 3D still starts the separate Mapbox navigation view.

MapLibre mouse actions forward geographic coordinates into Gregle context menus and measurement handlers. Context-menu placement uses MapLibre projection. Touch gestures use the existing double-tap/hold helper, with controls and the selected pin excluded. Selected pins forward clicks to their original handler, including the second-touch context menu. Pins, GPS dots, route geometry and measurements mirror into 3D; fitBounds and mobile point-reveal account for the 3D camera.

Extra data providers pause in regular 3D; saved selections resume on return to 2D. This avoids maintaining two independently interactive sets of data overlays. The other embedded base maps keep their existing behaviour. The older standalone 3D page remains available for existing links.

MapLibre and CSS load only on first use. Exiting destroys the WebGL map. Startup, cancellation and page lifecycle are bounded; a failed startup returns to the street map. Tile failures do not immediately destroy an otherwise working view. Tesla uses one worker, a lower initial pitch and a bounded tile cache; there are no continuous camera animations or overlay polling loops.

Sources: https://openfreemap.org/quick_start/ and https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/
