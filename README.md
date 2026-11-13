# Cook County AHSAP Map

Jekyll site mapping parcels in the Cook County Assessor's Affordable Housing Special Assessment Program (AHSAP).

## Run locally

```sh
docker compose up --build
```

Then open http://localhost:4000. Edits reload automatically.

## Deploy

Pushing to `main` builds and deploys the site to GitHub Pages via [.github/workflows/pages.yml](.github/workflows/pages.yml). One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow sets `baseurl` automatically, so the site works at `https://<user>.github.io/<repo>/` or on a custom domain.

## Layout

- `index.html`: page markup
- `_layouts/default.html`: HTML shell (head, fonts, Leaflet)
- `assets/css/map.css`, `assets/js/map.js`: styles and map logic
- `assets/data/ahsap.json`: parcels, projects, and township/municipality boundaries, loaded by `map.js`
- `build/`: Python data pipeline (not published)

## Updating the data

1. Run `build/build_data.py`, then `build/muni.py`.
2. Drop the `twpGeo` key from the resulting `*_muni.json` (the site does not draw township boundaries).
3. Split Chicago into community areas, writing the site data file. This needs shapely, so it runs in Docker:

   ```sh
   docker run --rm -v "$PWD":/w -w /w python:3.12-slim sh -c "pip install -q shapely && \
     python build/community_areas.py <muni.json> build/inputs/community_areas.geojson assets/data/ahsap.json"
   ```

   Community area boundaries come from the City of Chicago Data Portal (dataset `igwz-8jzy`).
