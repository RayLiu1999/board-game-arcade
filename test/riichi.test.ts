import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import {
  RiichiSession,
  riichiChoices,
  handTiles,
  type RiichiChoice,
  type RiichiShoupai,
  type RiichiView,
} from "../lib/riichi-session.js";

interface MajiangRuntime {
  readonly Shoupai: {
    fromString(value: string): RiichiShoupai;
  };
}

const Majiang = createRequire(import.meta.url)(
  "@kobalab/majiang-core",
) as MajiangRuntime;

const register = (name: string, callback: () => void): void => {
  void test(name, callback);
};

function started(): RiichiSession {
  const s = new RiichiSession({ humans: [0, 1, 2, 3], auto: false, rounds: 0 });
  s.start();
  for (let i = 0; i < 10; i++) s.step();
  return s;
}

function hand(session: RiichiSession, value: string): void {
  session.game.model.shoupai[0] = Majiang.Shoupai.fromString(value);
}

function firstChoice(view: RiichiView): RiichiChoice {
  const choice = view.choices[0];
  if (!choice) throw new Error("測試沒有可用日麻操作");
  return choice;
}

register(
  "four private views expose only the requesting seat’s concealed tiles",
  () => {
    const s = started();
    for (let id = 0; id < 4; id++) {
      const v = s.view(id);
      assert.equal(v.hand.length, id === 0 ? 14 : 13);
      assert.deepEqual(v.hand, handTiles(s.game.model.shoupai[id]));
      assert.equal(v.seats.length, 4);
      for (const seat of v.seats) {
        assert.equal(seat.hand, undefined);
        assert.equal(seat.shoupai, undefined);
      }
      for (const key of [
        "_pai",
        "_bingpai",
        "shoupai",
        "paipu",
        "_fubaopai",
        "reply",
      ])
        assert(!JSON.stringify(v).includes('"' + key + '"'));
    }
    s.close();
  },
);

register("riichi actions are bound to a seat and cannot be replayed", () => {
  const s = started();
  const c = s.view(0).choices.find((choice) => choice.kind === "discard");
  assert.ok(c);
  assert.throws(() => {
    s.act(1, c.id);
  });
  assert.throws(() => {
    s.act(0, "invented");
  });
  s.act(0, c.id);
  assert.throws(() => {
    s.act(0, c.id);
  });
  for (let i = 0; i < 10; i++) s.step();
  const firstRiver = s.game.model.he[0];
  assert.ok(firstRiver);
  assert.equal(firstRiver._pai.length, 1);
  s.pause();
  if (s.pending.size) {
    const id = [...s.pending.keys()][0];
    if (id !== undefined) {
      assert.throws(() => {
        s.act(id, firstChoice(s.view(id)).id);
      });
    }
  }
  s.close();
});

register("winning hand requires yaku; dora alone is not a yaku", () => {
  const s = started();
  s.game._diyizimo = false;
  hand(s, "m123456p789s22,m1-23");
  assert.equal(s.game.allow_hule(), false);
  hand(s, "m123456p789z55,z555+");
  assert.equal(s.game.allow_hule(), true);
  const choices = riichiChoices(s.game, 0, "zimo");
  assert(choices.some((c) => c.kind === "tsumo"));
  s.close();
});

register(
  "riichi choices require a closed tenpai hand and enough points",
  () => {
    const s = started();
    s.game._diyizimo = false;
    hand(s, "m123456p123s123z12");
    const choices = riichiChoices(s.game, 0, "zimo");
    assert(choices.some((c) => c.kind === "riichi"));
    s.game.model.defen[0] = 900;
    assert(!riichiChoices(s.game, 0, "zimo").some((c) => c.kind === "riichi"));
    s.close();
  },
);

register(
  "chi only available from the player on the left; pon and kan exposed legally",
  () => {
    const s = started();
    s.game.model.lunban = 0;
    s.game._dapai = "m3";
    s.game.model.shoupai[1] = Majiang.Shoupai.fromString("m123345p678s123z1");
    s.game.model.shoupai[2] = Majiang.Shoupai.fromString("m123345p678s123z1");
    const next = riichiChoices(s.game, 1, "dapai"),
      opposite = riichiChoices(s.game, 2, "dapai");
    assert(next.some((c) => c.kind === "chi"));
    assert(!opposite.some((c) => c.kind === "chi"));
    assert(next.some((c) => c.kind === "pon"));
    s.game.model.shoupai[1] = Majiang.Shoupai.fromString("m333p123456s123z1");
    assert(riichiChoices(s.game, 1, "dapai").some((c) => c.kind === "kan"));
    s.close();
  },
);

register("furiten suppresses ron while self draw remains available", () => {
  const s = started();
  s.game.model.lunban = 0;
  s.game._dapai = "z1";
  s.game.model.shoupai[1] = Majiang.Shoupai.fromString("m123456p123s123z1");
  s.game._neng_rong[1] = false;
  assert(!riichiChoices(s.game, 1, "dapai").some((c) => c.kind === "ron"));
  s.game._neng_rong[1] = true;
  assert(riichiChoices(s.game, 1, "dapai").some((c) => c.kind === "ron"));
  s.close();
});

register(
  "a single-hand game reaches scored results and a final ranking",
  () => {
    const s = started();
    let results = 0;
    for (let n = 0; n < 1000 && !s.done; n++) {
      if (s.pending.size) {
        for (const id of [...s.pending.keys()]) {
          const v = s.view(id);
          const c =
            v.choices.find((c) => ["tsumo", "ron"].includes(c.kind)) ||
            v.choices.find((c) => c.kind === "discard") ||
            v.choices.find((c) => c.kind === "pass") ||
            firstChoice(v);
          if (c.kind === "continue") results++;
          s.act(id, c.id);
        }
      } else s.step();
    }
    assert(s.done);
    assert(results >= 4);
    const result = s.view(0).result;
    assert.ok(result);
    assert.ok(result.rank);
    assert.ok(result.scores);
    assert.equal(result.rank.length, 4);
    assert.equal(result.log, undefined);
    assert.equal(
      result.scores.reduce((a, b) => a + b, 0),
      100000,
    );
    s.close();
  },
);

register(
  "AI opponents progress without seeing another player’s private messages",
  () => {
    const s = new RiichiSession({ humans: [0], auto: false, rounds: 0 });
    s.start();
    for (let n = 0; n < 30; n++) {
      if (s.pending.size) {
        const v = s.view(0);
        const c =
          v.choices.find((c) => c.kind === "discard") ||
          v.choices.find((c) => c.kind === "pass") ||
          firstChoice(v);
        s.act(0, c.id);
      } else s.step();
    }
    assert(s.revision > 7);
    assert.equal(s.view(0).seats.filter((p) => p.bot).length, 3);
    s.close();
  },
);

register(
  "seven pairs tsumo pays correct fu, han, dealer points and final scores",
  () => {
    const s = started();
    s.game._diyizimo = false;
    const shan = s.game.model.shan;
    assert.ok(shan);
    shan._baopai.splice(0, shan._baopai.length, "z7");
    hand(s, "m2244p3355s6677z11");
    s.game.hule();
    const result = s.view(0).result;
    assert.ok(result);
    assert.equal(result.fu, 25);
    assert.equal(result.fanshu, 3);
    assert.equal(result.defen, 4800);
    assert.deepEqual(result.fenpei, [4800, -1600, -1600, -1600]);
    for (const id of [...s.pending.keys()]) {
      s.act(id, firstChoice(s.view(id)).id);
    }
    for (let i = 0; i < 10; i++) s.step();
    assert(s.done);
    const finalResult = s.view(0).result;
    assert.ok(finalResult);
    assert.deepEqual(finalResult.scores, [29800, 23400, 23400, 23400]);
    s.close();
  },
);
