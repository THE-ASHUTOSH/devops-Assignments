// Kept separate from server.js so tests don't need to bind a port.
let visits = 0;

function recordVisit() {
  visits += 1;
  return visits;
}

function getVisits() {
  return visits;
}

function health() {
  return { status: "ok", visits };
}

module.exports = { recordVisit, getVisits, health };
