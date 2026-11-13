# Cook County AHSAP Map

Jekyll site mapping parcels in the Cook County Assessor's Affordable Housing Special Assessment Program (AHSAP).

## Run locally

```sh
docker compose up --build
```

Then open http://localhost:4000. Edits reload automatically.

## Layout

- `index.html`: page markup
- `_layouts/default.html`: HTML shell (head, fonts, Leaflet)
- `assets/css/style.css`, `assets/js/map.js`: styles and map logic
- `assets/data/ahsap.json`: parcels, projects, and township/municipality boundaries, loaded by `map.js`
- `build/`: Python data pipeline (not published)

## Updating the data

Run `build/build_data.py` and then `build/muni.py`. Copy the resulting `*_muni.json` to `assets/data/ahsap.json`, dropping its `twpGeo` key (the site does not draw township boundaries).
