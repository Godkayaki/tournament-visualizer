// Shared state. ES modules cannot reassign each other's `let` exports, so whatever several modules read or
// write lives on this one object. (State that only one module uses stays inside that module.)

export const state = {
  minPlayers: 30, // filter defaults; must match the .on buttons in index.html
  months: 6,
  all: [],        // tournaments that passed the name filter (see filters.js)
  countries: [],  // country polygons (GeoJSON features): drawn as borders and used to name areas
  tier: -1,       // current zoom tier (see globe.js)
};