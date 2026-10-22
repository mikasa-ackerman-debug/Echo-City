import { sanitizeText } from "@echo/protocol";
import { ApiError } from "./manager";
import { newId } from "./crypto";
import type { Store } from "./store";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CardRoomStatus = "open" | "waiting" | "running" | "closed";

export interface RoomPlayer {
  userId: string;
  name: string;
  agentId?: string;
  joinedAt: string;
}

export interface DimensionWeights {
  logic: number;
  math: number;
  planning: number;
  memory: number;
  instruction: number;
  strategy: number;
}

export interface CardRoom {
  id: string;
  cardId: string;
  cardName: string;
  suit: "♦" | "♥" | "♣" | "♠" | "JOKER";
  rank: number;
  maxPlayers: number;
  hostId: string;
  hostName: string;
  dimensionWeights: DimensionWeights;
  players: RoomPlayer[];
  status: CardRoomStatus;
  scriptTitle?: string;
  scriptSummary?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Survivors (winner ids) after the game. */
  survivors: string[];
  /** All participant results. */
  results: Array<{ userId: string; name: string; passed: boolean; score?: number }>;
}

export interface RoundState {
  id: string;
  status: "active" | "joker" | "finished";
  /** Card id → room status. */
  cardStates: Record<string, { status: CardRoomStatus; roomId?: string; closedAt?: string }>;
  /** Survivors from all card games. */
  survivors: Array<{ userId: string; name: string; wins: number }>;
  jokerRoomId?: string;
  createdAt: string;
  finishedAt?: string;
  /** Trial record ids belonging to this round. */
  trialIds: string[];
  /** Cumulative score per agent. */
  scores: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Card registry                                                       */
/* ------------------------------------------------------------------ */

/** All 48 card ids from the compendium. */
export const ALL_CARDS: Array<{ id: string; name: string; suit: CardRoom["suit"]; rank: number; maxPlayers: number }> = [
  { id: "diamond-2", name: "档案室", suit: "♦", rank: 2, maxPlayers: 8 },
  { id: "diamond-3", name: "坏掉的电梯", suit: "♦", rank: 3, maxPlayers: 8 },
  { id: "diamond-4", name: "三段论", suit: "♦", rank: 4, maxPlayers: 8 },
  { id: "diamond-5", name: "交叉审讯", suit: "♦", rank: 5, maxPlayers: 6 },
  { id: "diamond-6", name: "密码走廊", suit: "♦", rank: 6, maxPlayers: 6 },
  { id: "diamond-7", name: "最优路径", suit: "♦", rank: 7, maxPlayers: 4 },
  { id: "diamond-8", name: "逻辑电路", suit: "♦", rank: 8, maxPlayers: 6 },
  { id: "diamond-9", name: "最后的配给", suit: "♦", rank: 9, maxPlayers: 6 },
  { id: "diamond-10", name: "ANANKE 的考卷", suit: "♦", rank: 10, maxPlayers: 8 },
  { id: "diamond-J", name: "零和棋局", suit: "♦", rank: 11, maxPlayers: 16 },
  { id: "diamond-Q", name: "逻辑套盒", suit: "♦", rank: 12, maxPlayers: 16 },
  { id: "diamond-K", name: "选美", suit: "♦", rank: 13, maxPlayers: 16 },
  { id: "heart-2", name: "盲信", suit: "♥", rank: 2, maxPlayers: 8 },
  { id: "heart-3", name: "交换日记", suit: "♥", rank: 3, maxPlayers: 8 },
  { id: "heart-4", name: "项圈之谜", suit: "♥", rank: 4, maxPlayers: 8 },
  { id: "heart-5", name: "谎言者游戏", suit: "♥", rank: 5, maxPlayers: 8 },
  { id: "heart-6", name: "共犯", suit: "♥", rank: 6, maxPlayers: 8 },
  { id: "heart-7", name: "囚徒的晚餐", suit: "♥", rank: 7, maxPlayers: 8 },
  { id: "heart-8", name: "沉默的代价", suit: "♥", rank: 8, maxPlayers: 8 },
  { id: "heart-9", name: "审判庭", suit: "♥", rank: 9, maxPlayers: 8 },
  { id: "heart-10", name: "镜像", suit: "♥", rank: 10, maxPlayers: 6 },
  { id: "heart-J", name: "狼人项圈", suit: "♥", rank: 11, maxPlayers: 16 },
  { id: "heart-Q", name: "温室", suit: "♥", rank: 12, maxPlayers: 16 },
  { id: "heart-K", name: "最后的审判", suit: "♥", rank: 13, maxPlayers: 16 },
  { id: "club-2", name: "传声筒", suit: "♣", rank: 2, maxPlayers: 6 },
  { id: "club-3", name: "共生电路", suit: "♣", rank: 3, maxPlayers: 4 },
  { id: "club-4", name: "拆弹", suit: "♣", rank: 4, maxPlayers: 6 },
  { id: "club-5", name: "脚手架", suit: "♣", rank: 5, maxPlayers: 6 },
  { id: "club-6", name: "密室", suit: "♣", rank: 6, maxPlayers: 6 },
  { id: "club-7", name: "齿轮组", suit: "♣", rank: 7, maxPlayers: 6 },
  { id: "club-8", name: "救生艇", suit: "♣", rank: 8, maxPlayers: 6 },
  { id: "club-9", name: "共享的草稿", suit: "♣", rank: 9, maxPlayers: 8 },
  { id: "club-10", name: "方舟清单", suit: "♣", rank: 10, maxPlayers: 8 },
  { id: "club-J", name: "信号官", suit: "♣", rank: 11, maxPlayers: 16 },
  { id: "club-Q", name: "断线", suit: "♣", rank: 12, maxPlayers: 16 },
  { id: "club-K", name: "最后的列车", suit: "♣", rank: 13, maxPlayers: 16 },
  { id: "spade-2", name: "无灯楼梯", suit: "♠", rank: 2, maxPlayers: 8 },
  { id: "spade-3", name: "闪避", suit: "♠", rank: 3, maxPlayers: 6 },
  { id: "spade-4", name: "搬运", suit: "♠", rank: 4, maxPlayers: 4 },
  { id: "spade-5", name: "猎犬", suit: "♠", rank: 5, maxPlayers: 8 },
  { id: "spade-6", name: "追猎", suit: "♠", rank: 6, maxPlayers: 6 },
  { id: "spade-7", name: "守夜", suit: "♠", rank: 7, maxPlayers: 4 },
  { id: "spade-8", name: "雾中", suit: "♠", rank: 8, maxPlayers: 6 },
  { id: "spade-9", name: "调度室", suit: "♠", rank: 9, maxPlayers: 8 },
  { id: "spade-10", name: "劫掠", suit: "♠", rank: 10, maxPlayers: 6 },
  { id: "spade-J", name: "哨兵", suit: "♠", rank: 11, maxPlayers: 16 },
  { id: "spade-Q", name: "猎场女王", suit: "♠", rank: 12, maxPlayers: 16 },
  { id: "spade-K", name: "终局猎场", suit: "♠", rank: 13, maxPlayers: 16 },
];

const CARD_MAP = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function getCardDef(cardId: string) {
  const c = CARD_MAP.get(cardId);
  if (!c) throw new ApiError(404, `未知卡片: ${cardId}`);
  return c;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class RoomService {
  constructor(private store: Store) {}

  /** Get or create the current active round. */
  currentRound(): RoundState {
    let round = this.store.db.rounds.find((r) => r.status !== "finished");
    if (!round) {
      round = {
        id: newId("rd"),
        status: "active",
        cardStates: Object.fromEntries(ALL_CARDS.map((c) => [c.id, { status: "open" as CardRoomStatus }])),
        survivors: [],
        createdAt: new Date().toISOString(),
        trialIds: [],
        scores: {},
      };
      this.store.db.rounds.push(round);
      this.store.flush();
    }
    return round;
  }

  /** Card states for the compendium page. */
  cardStates() {
    const round = this.currentRound();
    return ALL_CARDS.map((c) => ({
      ...c,
      state: round.cardStates[c.id] ?? { status: "open" as CardRoomStatus },
    }));
  }

  /** Create a room for a card. Only one room per card per round. */
  createRoom(userId: string, userName: string, input: {
    cardId: string;
    dimensionWeights?: Partial<DimensionWeights>;
    agentId?: string;
  }): CardRoom {
    const round = this.currentRound();
    const card = getCardDef(input.cardId);
    const state = round.cardStates[card.id];
    if (state && state.status !== "open") throw new ApiError(409, `${card.name} 已经${state.status === "closed" ? "关闭" : "被占用"}`);

    const existing = this.store.db.rooms.find((r) => r.cardId === card.id && r.status !== "closed");
    if (existing) throw new ApiError(409, `${card.name} 的房间已经存在`);

    const dw = input.dimensionWeights ?? {};
    const weights: DimensionWeights = {
      logic: dw.logic ?? 1,
      math: dw.math ?? 1,
      planning: dw.planning ?? 1,
      memory: dw.memory ?? 1,
      instruction: dw.instruction ?? 1,
      strategy: dw.strategy ?? 1,
    };

    const room: CardRoom = {
      id: newId("rm"),
      cardId: card.id,
      cardName: card.name,
      suit: card.suit,
      rank: card.rank,
      maxPlayers: card.maxPlayers,
      hostId: userId,
      hostName: userName,
      dimensionWeights: weights,
      players: [{ userId, name: userName, agentId: input.agentId, joinedAt: new Date().toISOString() }],
      status: "waiting",
      createdAt: new Date().toISOString(),
      survivors: [],
      results: [],
    };

    this.store.db.rooms.push(room);
    round.cardStates[card.id] = { status: "waiting", roomId: room.id };
    this.store.flush();
    return room;
  }

  /** Join a room. Auto-starts when full. */
  joinRoom(userId: string, userName: string, roomId: string, agentId?: string): CardRoom {
    const room = this.store.db.rooms.find((r) => r.id === roomId);
    if (!room) throw new ApiError(404, "房间不存在");
    if (room.status !== "waiting") throw new ApiError(409, "房间已开始或已结束");
    if (room.players.some((p) => p.userId === userId)) throw new ApiError(409, "你已经在这个房间里了");
    if (room.players.length >= room.maxPlayers) throw new ApiError(409, "房间已满");

    room.players.push({ userId, name: userName, agentId, joinedAt: new Date().toISOString() });

    // Auto-start when full
    if (room.players.length >= room.maxPlayers) {
      room.status = "running";
      room.startedAt = new Date().toISOString();
      const round = this.currentRound();
      round.cardStates[room.cardId] = { status: "running", roomId: room.id };
    }

    this.store.flush();
    return room;
  }

  /** Leave a room. If host leaves and room is empty, delete the room. */
  leaveRoom(userId: string, roomId: string): CardRoom | null {
    const room = this.store.db.rooms.find((r) => r.id === roomId);
    if (!room) throw new ApiError(404, "房间不存在");
    if (room.status !== "waiting") throw new ApiError(409, "游戏已开始，无法离开");

    room.players = room.players.filter((p) => p.userId !== userId);

    if (room.players.length === 0) {
      this.store.db.rooms = this.store.db.rooms.filter((r) => r.id !== roomId);
      const round = this.currentRound();
      round.cardStates[room.cardId] = { status: "open" };
      this.store.flush();
      return null;
    }

    this.store.flush();
    return room;
  }

  /** Finish a game and close the card. */
  finishGame(roomId: string, results: Array<{ userId: string; name: string; passed: boolean; score?: number }>): CardRoom {
    const room = this.store.db.rooms.find((r) => r.id === roomId);
    if (!room) throw new ApiError(404, "房间不存在");
    if (room.status === "closed") throw new ApiError(409, "游戏已结束");

    room.status = "closed";
    room.finishedAt = new Date().toISOString();
    room.results = results;
    room.survivors = results.filter((r) => r.passed).map((r) => r.userId);

    const round = this.currentRound();
    round.cardStates[room.cardId] = { status: "closed", roomId: room.id, closedAt: room.finishedAt };

    // Add survivors to round
    for (const r of results.filter((x) => x.passed)) {
      const existing = round.survivors.find((s) => s.userId === r.userId);
      if (existing) existing.wins++;
      else round.survivors.push({ userId: r.userId, name: r.name, wins: 1 });
    }

    // Check if all cards are closed → open Joker
    const allClosed = ALL_CARDS.every((c) => round.cardStates[c.id]?.status === "closed");
    if (allClosed && round.status === "active") {
      round.status = "joker";
    }

    this.store.flush();
    return room;
  }

  /** Open the Joker room. All survivors enter. */
  openJoker(userId: string, userName: string): CardRoom {
    const round = this.currentRound();
    if (round.status !== "joker") throw new ApiError(409, "还有卡片未关闭，Joker 尚未开放");

    const existing = this.store.db.rooms.find((r) => r.cardId === "JOKER" && r.status !== "closed");
    if (existing) throw new ApiError(409, "Joker 房间已存在");

    const room: CardRoom = {
      id: newId("rm"),
      cardId: "JOKER",
      cardName: "最后的门",
      suit: "JOKER",
      rank: 0,
      maxPlayers: 16,
      hostId: userId,
      hostName: userName,
      dimensionWeights: { logic: 1, math: 1, planning: 1, memory: 1, instruction: 1, strategy: 1 },
      players: [{ userId, name: userName, joinedAt: new Date().toISOString() }],
      status: "waiting",
      createdAt: new Date().toISOString(),
      survivors: [],
      results: [],
    };

    this.store.db.rooms.push(room);
    round.jokerRoomId = room.id;
    round.cardStates["JOKER"] = { status: "waiting", roomId: room.id };
    this.store.flush();
    return room;
  }

  /** List rooms. */
  listRooms(status?: string): CardRoom[] {
    let rooms = [...this.store.db.rooms];
    if (status) rooms = rooms.filter((r) => r.status === status);
    rooms.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rooms;
  }

  getRoom(id: string): CardRoom {
    const room = this.store.db.rooms.find((r) => r.id === id);
    if (!room) throw new ApiError(404, "房间不存在");
    return room;
  }

  /** Progress overview for the compendium page. */
  progress() {
    const round = this.currentRound();
    const closed = ALL_CARDS.filter((c) => round.cardStates[c.id]?.status === "closed").length;
    return {
      roundId: round.id,
      status: round.status,
      total: ALL_CARDS.length,
      closed,
      jokerOpen: round.status === "joker",
      survivors: round.survivors,
      cardStates: round.cardStates,
    };
  }
}

/** Default dimension weights (all equal). */
export const DEFAULT_WEIGHTS: DimensionWeights = { logic: 1, math: 1, planning: 1, memory: 1, instruction: 1, strategy: 1 };
