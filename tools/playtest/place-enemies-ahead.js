// Page snippet for flight-shots.mjs --eval: park every enemy 450-700 m ahead
// of the player, same heading and speed, so HUD/target/tracer shots are
// reproducible. Usage: --eval "$(cat tools/playtest/place-enemies-ahead.js)"
(() => {
  const s = window.__rb2.session;
  const p = s.player;
  const f = new p.state.position.constructor(0, 0, -1).applyQuaternion(p.state.orientation);
  let i = 0;
  for (const a of s.world.aircraft) {
    if (a.side === p.side) continue;
    a.state.position.copy(p.state.position).addScaledVector(f, 450 + i * 120);
    a.state.position.x += (i - 1) * 60;
    a.state.position.y += 20 + i * 15;
    a.state.orientation.copy(p.state.orientation);
    a.state.velocity.copy(p.state.velocity);
    i++;
  }
})();
