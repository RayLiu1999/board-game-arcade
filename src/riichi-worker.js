import { RiichiSession } from "../lib/riichi-session.js";
let session,
  seat = 0,
  mode = "ai",
  handoff = null;
function publish() {
  if (!session) return;
  if (mode === "local" && session.pending.size && !session.pending.has(seat)) {
    seat = [...session.pending.keys()][0];
    handoff = seat;
  }
  self.postMessage({ type: "state", state: session.view(seat), handoff });
}
self.onmessage = ({ data }) => {
  try {
    if (data.type === "start") {
      session?.close();
      mode = data.mode;
      seat = 0;
      handoff = mode === "local" ? 0 : null;
      session = new RiichiSession({
        humans: mode === "local" ? [0, 1, 2, 3] : [0],
        rounds: data.rounds,
        names:
          mode === "local"
            ? ["玩家 1", "玩家 2", "玩家 3", "玩家 4"]
            : ["你", "AI 南", "AI 西", "AI 北"],
        onChange: publish,
        onError: (e) => self.postMessage({ type: "error", message: e.message }),
      });
      session.start();
    } else if (data.type === "action") session.act(seat, data.id);
    else if (data.type === "ready") {
      handoff = null;
      publish();
    } else if (data.type === "close") {
      session?.close();
      session = null;
    }
  } catch (e) {
    self.postMessage({ type: "error", message: e.message });
  }
};
