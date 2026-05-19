const suits = [
  { key: "S", label: "♠", red: false },
  { key: "H", label: "♥", red: true },
  { key: "D", label: "♦", red: true },
  { key: "C", label: "♣", red: false },
];
const ranks = [
  { label: "2", value: 2 },
  { label: "3", value: 3 },
  { label: "4", value: 4 },
  { label: "5", value: 5 },
  { label: "6", value: 6 },
  { label: "7", value: 7 },
  { label: "8", value: 8 },
  { label: "9", value: 9 },
  { label: "10", value: 10 },
  { label: "J", value: 11 },
  { label: "Q", value: 12 },
  { label: "K", value: 13 },
  { label: "A", value: 14 },
];
const handNames = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
];
const phaseNames = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
};

const state = {
  handNumber: 0,
  deck: [],
  community: [],
  phase: "idle",
  pot: 0,
  baseBet: 20,
  autoTimer: null,
  players: [
    { id: "player", name: "你", chips: 1000, hand: [], folded: false, human: true },
    { id: "bot-1", name: "北座", chips: 1000, hand: [], folded: false, human: false },
    { id: "bot-2", name: "西座", chips: 1000, hand: [], folded: false, human: false },
    { id: "bot-3", name: "东座", chips: 1000, hand: [], folded: false, human: false },
  ],
};

const els = {
  handNumber: document.querySelector("#handNumber"),
  potValue: document.querySelector("#potValue"),
  centerPot: document.querySelector("#centerPot"),
  phaseName: document.querySelector("#phaseName"),
  community: document.querySelector("#communityCards"),
  message: document.querySelector("#message"),
  playerBest: document.querySelector("#playerBest"),
  countdown: document.querySelector("#countdown"),
  eventLog: document.querySelector("#eventLog"),
  dealBtn: document.querySelector("#dealBtn"),
  checkBtn: document.querySelector("#checkBtn"),
  raiseBtn: document.querySelector("#raiseBtn"),
  foldBtn: document.querySelector("#foldBtn"),
};

els.dealBtn.addEventListener("click", startHand);
els.checkBtn.addEventListener("click", () => advanceRound("你选择过牌/跟注。"));
els.raiseBtn.addEventListener("click", () => {
  takeBet(state.players[0], 20);
  botResponses(0.18);
  advanceRound("你加注 20。");
});
els.foldBtn.addEventListener("click", foldPlayer);

startHand();

function startHand() {
  clearTimeout(state.autoTimer);
  state.handNumber += 1;
  state.deck = shuffle(createDeck());
  state.community = [];
  state.phase = "preflop";
  state.pot = 0;
  els.countdown.textContent = "";

  for (const player of state.players) {
    if (player.chips < state.baseBet) player.chips = 1000;
    player.hand = [draw(), draw()];
    player.folded = false;
    takeBet(player, state.baseBet);
  }

  log(`第 ${state.handNumber} 局开始，每人下底注 ${state.baseBet}。`, true);
  setMessage("新局开始，先看手牌。");
  render();
  setControls(true);
}

function advanceRound(text) {
  log(text);
  botResponses(0.12);

  if (activePlayers().length <= 1) {
    finishHand(activePlayers()[0], "其他玩家都已弃牌。");
    return;
  }

  if (state.phase === "preflop") {
    state.community.push(draw(), draw(), draw());
    state.phase = "flop";
    setMessage("翻牌完成，继续行动。");
  } else if (state.phase === "flop") {
    state.community.push(draw());
    state.phase = "turn";
    setMessage("转牌发出。");
  } else if (state.phase === "turn") {
    state.community.push(draw());
    state.phase = "river";
    setMessage("河牌发出，准备最后行动。");
  } else {
    showdown();
    return;
  }

  render();
}

function foldPlayer() {
  state.players[0].folded = true;
  botResponses(0.05);
  const contenders = activePlayers();
  const winner = contenders[Math.floor(Math.random() * contenders.length)] || state.players[1];
  finishHand(winner, "你已弃牌，本局提前结算。");
}

function botResponses(extraFoldChance) {
  for (const bot of state.players.filter((p) => !p.human && !p.folded)) {
    const score = quickStrength(bot);
    const foldChance = Math.max(0.03, 0.28 - score * 0.035 + extraFoldChance);
    if (Math.random() < foldChance && activePlayers().length > 2) {
      bot.folded = true;
      log(`${bot.name} 弃牌。`);
    } else if (Math.random() < 0.4) {
      takeBet(bot, 20);
      log(`${bot.name} 跟注 20。`);
    }
  }
}

function showdown() {
  state.phase = "showdown";
  const contenders = activePlayers();
  const ranked = contenders
    .map((player) => ({ player, value: evaluateBest([...player.hand, ...state.community]) }))
    .sort((a, b) => compareValues(b.value, a.value));
  const best = ranked[0].value;
  const winners = ranked.filter((entry) => compareValues(entry.value, best) === 0);
  const share = Math.floor(state.pot / winners.length);

  for (const entry of winners) {
    entry.player.chips += share;
  }

  const names = winners.map((entry) => entry.player.name).join("、");
  const result = winners.length > 1 ? `${names} 平分底池` : `${names} 赢得底池`;
  log(`摊牌：${result}，牌型 ${describeValue(best)}。`);
  setMessage(`${result}，下一局马上开始。`);
  render(winners.map((entry) => entry.player.id));
  queueNextHand();
}

function finishHand(winner, reason) {
  state.phase = "showdown";
  winner.chips += state.pot;
  log(`${reason}${winner.name} 赢得 ${state.pot}。`);
  setMessage(`${winner.name} 赢得本局，下一局马上开始。`);
  render([winner.id]);
  queueNextHand();
}

function queueNextHand() {
  setControls(false);
  let remaining = 2;
  els.countdown.textContent = `${remaining} 秒后自动开下一局`;
  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) {
      startHand();
    } else {
      els.countdown.textContent = `${remaining} 秒后自动开下一局`;
      state.autoTimer = setTimeout(tick, 1000);
    }
  };
  state.autoTimer = setTimeout(tick, 1000);
}

function createDeck() {
  return suits.flatMap((suit) =>
    ranks.map((rank) => ({
      suit: suit.key,
      suitLabel: suit.label,
      red: suit.red,
      rank: rank.label,
      value: rank.value,
    })),
  );
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function draw() {
  return state.deck.pop();
}

function takeBet(player, amount) {
  const paid = Math.min(player.chips, amount);
  player.chips -= paid;
  state.pot += paid;
}

function activePlayers() {
  return state.players.filter((player) => !player.folded);
}

function quickStrength(player) {
  const cards = [...player.hand, ...state.community];
  const values = cards.map((card) => card.value);
  const pairs = new Set(values.filter((value, index) => values.indexOf(value) !== index)).size;
  const high = Math.max(...values);
  return pairs * 2 + (high >= 12 ? 1 : 0) + state.community.length / 5;
}

function evaluateBest(cards) {
  const combos = combinations(cards, 5);
  return combos.map(evaluateFive).sort((a, b) => compareValues(b, a))[0];
}

function evaluateFive(cards) {
  const valuesDesc = cards.map((card) => card.value).sort((a, b) => b - a);
  const counts = countValues(valuesDesc);
  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = getStraightHigh(valuesDesc);

  if (flush && straightHigh) return { rank: 8, kickers: [straightHigh] };
  if (groups[0].count === 4) {
    return { rank: 7, kickers: [groups[0].value, ...valuesDesc.filter((v) => v !== groups[0].value)] };
  }
  if (groups[0].count === 3 && groups[1].count === 2) return { rank: 6, kickers: [groups[0].value, groups[1].value] };
  if (flush) return { rank: 5, kickers: valuesDesc };
  if (straightHigh) return { rank: 4, kickers: [straightHigh] };
  if (groups[0].count === 3) {
    return { rank: 3, kickers: [groups[0].value, ...valuesDesc.filter((v) => v !== groups[0].value)] };
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairValues = groups.filter((g) => g.count === 2).map((g) => g.value).sort((a, b) => b - a);
    const lone = valuesDesc.find((v) => !pairValues.includes(v));
    return { rank: 2, kickers: [...pairValues, lone] };
  }
  if (groups[0].count === 2) {
    return { rank: 1, kickers: [groups[0].value, ...valuesDesc.filter((v) => v !== groups[0].value)] };
  }
  return { rank: 0, kickers: valuesDesc };
}

function countValues(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getStraightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const run = unique.slice(i, i + 5);
    if (run[0] - run[4] === 4) return run[0];
  }
  return 0;
}

function combinations(items, size) {
  const result = [];
  const pick = (start, combo) => {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let i = start; i <= items.length - (size - combo.length); i += 1) {
      pick(i + 1, [...combo, items[i]]);
    }
  };
  pick(0, []);
  return result;
}

function compareValues(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i += 1) {
    if ((a.kickers[i] || 0) !== (b.kickers[i] || 0)) {
      return (a.kickers[i] || 0) - (b.kickers[i] || 0);
    }
  }
  return 0;
}

function describeValue(value) {
  return `${handNames[value.rank]} ${value.kickers.map(rankLabel).join(" ")}`;
}

function rankLabel(value) {
  return ranks.find((rank) => rank.value === value)?.label || String(value);
}

function render(winnerIds = []) {
  els.handNumber.textContent = state.handNumber;
  els.potValue.textContent = state.pot;
  els.centerPot.textContent = state.pot;
  els.phaseName.textContent = phaseNames[state.phase] || "准备";
  els.community.innerHTML = state.community.map(cardMarkup).join("");

  for (const player of state.players) {
    const root = document.querySelector(`#${player.id}`);
    root.classList.toggle("folded", player.folded);
    root.classList.toggle("winner", winnerIds.includes(player.id));
    const reveal = player.human || state.phase === "showdown";
    root.innerHTML = `
      <div class="player-meta">
        <p class="player-name">${player.name}</p>
        <b class="badge">${player.folded ? "已弃牌" : player.chips}</b>
        <span>筹码</span>
        <span>${player.human ? "玩家" : "电脑"}</span>
      </div>
      <div class="cards">${player.hand.map((card) => (reveal ? cardMarkup(card) : backCard())).join("")}</div>
    `;
  }

  const playerCards = [...state.players[0].hand, ...state.community];
  if (playerCards.length >= 5 && !state.players[0].folded) {
    els.playerBest.textContent = `当前牌型：${describeValue(evaluateBest(playerCards))}`;
  } else if (state.players[0].folded) {
    els.playerBest.textContent = "当前牌型：你已弃牌";
  } else {
    els.playerBest.textContent = "当前牌型：等待更多公共牌";
  }
}

function cardMarkup(card) {
  return `
    <div class="card ${card.red ? "red" : ""}" aria-label="${card.rank}${card.suitLabel}">
      <div class="rank">${card.rank}</div>
      <div class="suit">${card.suitLabel}</div>
      <div class="mini">${card.rank}</div>
    </div>
  `;
}

function backCard() {
  return `
    <div class="card back" aria-label="暗牌">
      <div class="rank">◆</div>
      <div class="suit">✦</div>
      <div class="mini">◆</div>
    </div>
  `;
}

function log(text, reset = false) {
  if (reset) els.eventLog.innerHTML = "";
  const item = document.createElement("li");
  item.textContent = text;
  els.eventLog.prepend(item);
  while (els.eventLog.children.length > 8) {
    els.eventLog.lastElementChild.remove();
  }
}

function setMessage(text) {
  els.message.textContent = text;
}

function setControls(active) {
  els.dealBtn.disabled = active;
  els.checkBtn.disabled = !active;
  els.raiseBtn.disabled = !active;
  els.foldBtn.disabled = !active;
}
