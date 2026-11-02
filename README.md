# Digital Equity Map

Research prototype for exploring public computer centers, Connected Communities locations, and Digital Investment Districts in New York City.

## Open the map

The repository root is a static website. To preview it locally:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8767/>. GitHub Pages must be enabled separately for an online map URL.

## Data shown

- 534 public computer centers from [NYC Open Data's 2024 file](https://data.cityofnewyork.us/Social-Services/Citywide-Public-Computer-Centers/sejx-2gn3). Resource and accessibility fields are reported in that file and have not been independently checked for this map.
- 106 mapped Connected Communities locations from a project-supplied list. Another five mobile service listings have no permanent map points. A location appearing in both center lists is drawn once.
- 79 high- or very-high-need Digital Investment District [2020 Neighborhood Tabulation Areas](https://www.nyc.gov/content/planning/pages/resources/datasets/neighborhood-tabulation), identified in a project-supplied list. The list does not contain numeric need scores or the underlying indicators.

The generated `centers.json`, `connected_extra.json`, and `nta.geojson` files contain the project-supplied Connected Communities and district classifications. This repository is public, so those generated classifications are publicly readable if the release is pushed here. The raw project CSVs and local matching and geocoding review files are not included.
