import { chooseMove } from "./ai.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      move: chooseMove(data.state, data.difficulty),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
