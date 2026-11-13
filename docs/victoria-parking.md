# Victoria parking layer

The supplied parking-map image informed the five-colour key and numbered City parkade symbols. Geometry uses the City's OpenData_Parking MapServer, queried on 2026-11-13 with output SR 4326 and ordered/paginated OBJECTID queries. The photo is schematic and is not stretched over geographic tiles.

`data/victoria-parking.json` is a published snapshot, not a live availability feed. The optional layer loads it once and draws only visible features; on-street points appear from zoom 15. It retains the selected state in copied links and pauses behind external embedded maps or 3D navigation. The existing OpenFreeMap 3D bridge can display its points.

Sources:

- https://maps.victoria.ca/server/rest/services/OpenData/OpenData_Parking/MapServer/6 — active metered spaces. Include BLUE/GREEN/ORANGE/PINK/PURPLE general-rate spaces whose first quoted Mon–Sat rate matches their category; omit accessible, loading, small-vehicle, short-stay and other special-use spaces.
- `/2` of the same service — five City parkade locations. Display the current City names Yates Street and Centennial Square where the GIS retains older names.
- `/5` of the same service — surface-lot pay stations. Group WH1/WH2 for Wharf Street, RAP EAST/WEST for Royal Athletic Park, and RT for Royal Theatre, using the mean station position for each lot marker. Do not include private lots or infer availability.
- https://www.victoria.ca/getting-around/parking/street-parking — rates, general time limits and payment hours, checked 2026-11-13.
- https://www.victoria.ca/getting-around/parking/parkades-surface-lots — facility names, ownership and payment rules, checked 2026-11-13.
- https://opendata.victoria.ca/pages/open-data-licence — Open Government Licence – City of Victoria.

MapSymbol colours are *not* copied literally: their names differ from the public fact-sheet colours. The public key maps Zone 1 to light blue, 2 to teal, 3 to rose, 4 to navy and 5 to yellow. Zone 4's public rate table currently says 4 hours, whereas the supplied image and individual GIS records say 3 hours. Both the key and point popup disclose this discrepancy and direct visitors to posted signs. GIS HoursInEffect fields also retain older hours, so those strings are not presented as current rules.

To update, repeat the complete queries and category filtering, verify the current City rate table and surface-lot ownership, update the snapshot's checked date and key/popup disclosures, and run `node --test tests/maps-parking.test.cjs tests/maps-layers.test.cjs`. Keep source attribution and the distinctions between general street rules and facility-specific rules.

The bundled Leaflet rotation renderer has two small Gregle patches: Canvas invokes its super onAdd without the map parameter, so fall back to this._map; limit Canvas rotation padding to avoid allocating a very large backing store on in-car browsers.
