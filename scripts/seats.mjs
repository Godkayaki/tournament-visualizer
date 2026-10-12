// Seat results of one tournament, from the rounds TopDeck returns (POST /v2/tournaments with `rounds`).
// TopDeck lists the players of a table in seat order (seat 1 = first to play), and says who won in `winner_id`
// ("Draw" for a draw, null while unfinished). Only completed 4-player pods count, in every round (Swiss and top cut).
//
// Returns [games, wins of seat 1, seat 2, seat 3, seat 4], or null when there is nothing usable (no rounds, team events).
// Draws count as games with no seat win, so  seat wins / games + draw rate = 100%.
export function seatStats(t) {
  if (t.isTeamEvent || !Array.isArray(t.rounds)) return null;
  let games = 0;
  const wins = [0, 0, 0, 0];
  for (const round of t.rounds) {
    for (const table of round?.tables || []) {
      const players = table?.players;
      if (!Array.isArray(players) || players.length !== 4) continue; // byes and 3-player pods are left out
      if (table.status && table.status !== 'Completed') continue;
      const id = table.winner_id ?? null;
      if (id === null && !table.winner) continue; // unfinished
      games++;
      if (id === 'Draw') continue;
      const seat = players.findIndex((p) => (id !== null ? p?.id === id : p?.name === table.winner));
      if (seat >= 0) wins[seat]++;
    }
  }
  return games ? [games, ...wins] : null;
}
