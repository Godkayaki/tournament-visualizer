// Seat results from the rounds TopDeck returns (POST /v2/tournaments with `rounds`).
// TopDeck lists the players of a table in seat order (seat 1 = first to play), and says who won in `winner_id`
// ("Draw" for a draw, null while unfinished). Only completed 4-player pods count, in every round (Swiss and top cut).

// Every usable game of a tournament as { seats: [playerId x4], winner: seat index 0-3, or -1 for a draw }.
function* games(t) {
  if (t.isTeamEvent || !Array.isArray(t.rounds)) return;
  for (const round of t.rounds) {
    for (const table of round?.tables || []) {
      const players = table?.players;
      if (!Array.isArray(players) || players.length !== 4) continue; // byes and 3-player pods are left out
      if (table.status && table.status !== 'Completed') continue;
      const id = table.winner_id ?? null;
      if (id === null && !table.winner) continue; // unfinished
      const winner = id === 'Draw' ? -1 : players.findIndex((p) => (id !== null ? p?.id === id : p?.name === table.winner));
      yield { seats: players.map((p) => p?.id), winner };
    }
  }
}

// [games, wins of seat 1, seat 2, seat 3, seat 4] for the whole tournament, or null when there is nothing usable.
// Draws count as games with no seat win, so  seat wins / games + draw rate = 100%.
export function seatStats(t) {
  let n = 0;
  const wins = [0, 0, 0, 0];
  for (const g of games(t)) { n++; if (g.winner >= 0) wins[g.winner]++; }
  return n ? [n, ...wins] : null;
}

// Per player id: [games at seat 1..4, wins at seat 1..4]. null when there is nothing usable.
// (build-meta.mjs adds these up per commander, so a commander's seat win rate can be shown for any set of tournaments.)
export function playerSeats(t) {
  const per = new Map();
  for (const g of games(t)) {
    g.seats.forEach((id, seat) => {
      if (id == null) return;
      const a = per.get(id) || per.set(id, [0, 0, 0, 0, 0, 0, 0, 0]).get(id);
      a[seat]++;
      if (g.winner === seat) a[4 + seat]++;
    });
  }
  return per.size ? per : null;
}
