// shogi.ts

// =====================
// 基本型
// =====================

export type Player = "SENTE" | "GOTE";
export const opposite = (p: Player): Player => (p === "SENTE" ? "GOTE" : "SENTE");

// 盤上座標: file=1..9, rank=1..9（将棋表記に寄せる）
// 例: (file=7, rank=7) が "7七" 相当
export type Square = Readonly<{ file: number; rank: number }>;

export function sq(file: number, rank: number): Square {
    if (file < 1 || file > 9 || rank < 1 || rank > 9) throw new Error("Square out of range");
    return { file, rank };
}

export enum PieceType {
    FU = "FU",
    KY = "KY",
    KE = "KE",
    GI = "GI",
    KI = "KI",
    KA = "KA",
    HI = "HI",
    OU = "OU",
}

// 成駒も PieceType は元のまま、promoted フラグで表現
export class Piece {
    constructor(
        public readonly owner: Player,
        public readonly type: PieceType,
        public readonly promoted: boolean = false
    ) { }

    withOwner(owner: Player): Piece {
        return new Piece(owner, this.type, this.promoted);
    }
    promote(): Piece {
        if (!Rules.canPromoteType(this.type)) return this;
        return new Piece(this.owner, this.type, true);
    }
    unpromote(): Piece {
        return new Piece(this.owner, this.type, false);
    }
}

// =====================
// 指し手
// =====================

export type Move =
    | {
        kind: "MOVE";
        from: Square;
        to: Square;
        promote?: boolean; // 成る宣言
    }
    | {
        kind: "DROP";
        pieceType: PieceType; // 打つ駒の種類（持ち駒から出す）
        to: Square;
    };

export function move(from: Square, to: Square, promote: boolean = false): Move {
    return { kind: "MOVE", from, to, promote: promote || undefined };
}
export function drop(pieceType: PieceType, to: Square): Move {
    return { kind: "DROP", pieceType, to };
}

// =====================
// 盤面
// =====================

export class Board {
    // key: "f,r" 例 "7,7"
    private cells = new Map<string, Piece>();

    private key(s: Square): string {
        return `${s.file},${s.rank}`;
    }

    get(s: Square): Piece | undefined {
        return this.cells.get(this.key(s));
    }

    set(s: Square, p: Piece | undefined): void {
        const k = this.key(s);
        if (p) this.cells.set(k, p);
        else this.cells.delete(k);
    }

    clone(): Board {
        const b = new Board();
        for (const [k, v] of this.cells.entries()) b.cells.set(k, v);
        return b;
    }

    // 盤上の全駒を列挙
    entries(): Array<{ square: Square; piece: Piece }> {
        const out: Array<{ square: Square; piece: Piece }> = [];
        for (const [k, p] of this.cells.entries()) {
            const [f, r] = k.split(",").map(Number);
            out.push({ square: { file: f, rank: r }, piece: p });
        }
        return out;
    }

    isInside(s: Square): boolean {
        return s.file >= 1 && s.file <= 9 && s.rank >= 1 && s.rank <= 9;
    }
}

// =====================
// 持ち駒
// =====================

export class Hand {
    // ownerごとに駒数を保持
    private counts: Record<Player, Record<PieceType, number>> = {
        SENTE: Hand.emptyCounts(),
        GOTE: Hand.emptyCounts(),
    };

    static emptyCounts(): Record<PieceType, number> {
        return {
            [PieceType.FU]: 0,
            [PieceType.KY]: 0,
            [PieceType.KE]: 0,
            [PieceType.GI]: 0,
            [PieceType.KI]: 0,
            [PieceType.KA]: 0,
            [PieceType.HI]: 0,
            [PieceType.OU]: 0, // 王は持ち駒にならないが、型としては入れておく
        };
    }

    get(owner: Player, type: PieceType): number {
        return this.counts[owner][type] ?? 0;
    }

    add(owner: Player, type: PieceType, n: number = 1): void {
        if (type === PieceType.OU) throw new Error("OU cannot be in hand");
        this.counts[owner][type] = (this.counts[owner][type] ?? 0) + n;
    }

    remove(owner: Player, type: PieceType, n: number = 1): void {
        const cur = this.get(owner, type);
        if (cur < n) throw new Error("Not enough pieces in hand");
        this.counts[owner][type] = cur - n;
    }

    clone(): Hand {
        const h = new Hand();
        for (const pl of ["SENTE", "GOTE"] as const) {
            for (const t of Object.values(PieceType)) {
                h.counts[pl][t as PieceType] = this.counts[pl][t as PieceType] ?? 0;
            }
        }
        return h;
    }
}

// =====================
// 局面
// =====================

export class Position {
    constructor(
        public readonly board: Board,
        public readonly hand: Hand,
        public readonly turn: Player
    ) { }

    clone(): Position {
        return new Position(this.board.clone(), this.hand.clone(), this.turn);
    }
}

// =====================
// ルール（まずは骨格）
// =====================

// Rules に追記（または置換）してください

export class Rules {
    // --- 既存 ---
    static canPromoteType(t: PieceType): boolean {
        return (
            t === PieceType.FU ||
            t === PieceType.KY ||
            t === PieceType.KE ||
            t === PieceType.GI ||
            t === PieceType.KA ||
            t === PieceType.HI
        );
    }

    static isPromotionZone(owner: Player, rank: number): boolean {
        return owner === "SENTE" ? rank <= 3 : rank >= 7;
    }

    // =========================
    // 合法手生成（入口）
    // =========================
    static generateLegalMoves(pos: Position): Move[] {
        const pseudo = this.generatePseudoLegalMoves(pos);
        // 自玉が王手になる手を除外（王手放置禁止）
        const legal: Move[] = [];
        for (const mv of pseudo) {
            const next = Game.applyMove(pos, mv);
            if (!this.isKingInCheck(next, opposite(next.turn))) {
                // next.turn は手番交代後なので、チェック対象は「指した側」= opposite(next.turn)
                legal.push(mv);
            }
        }
        return legal;
    }

    // “今は簡易合法”だった isLegal も、生成した手を使えば一致させられます
    static isLegal(pos: Position, mv: Move): boolean {
        return this.generateLegalMoves(pos).some((m) => this.sameMove(m, mv));
    }

    private static sameMove(a: Move, b: Move): boolean {
        if (a.kind !== b.kind) return false;
        if (a.kind === "MOVE" && b.kind === "MOVE") {
            return (
                a.from.file === b.from.file &&
                a.from.rank === b.from.rank &&
                a.to.file === b.to.file &&
                a.to.rank === b.to.rank &&
                !!a.promote === !!b.promote
            );
        }
        if (a.kind === "DROP" && b.kind === "DROP") {
            return a.pieceType === b.pieceType && a.to.file === b.to.file && a.to.rank === b.to.rank;
        }
        return false;
    }

    // =========================
    // 擬似合法手（王手放置は未除外）
    // =========================
    static generatePseudoLegalMoves(pos: Position): Move[] {
        const moves: Move[] = [];
        const b = pos.board;

        // 盤上の指し手（移動）
        for (const { square: from, piece } of b.entries()) {
            if (piece.owner !== pos.turn) continue;
            const tos = this.generateDestinationsForPiece(pos, from, piece);
            for (const to of tos) {
                // 取れない自駒はここでは弾いてある前提（生成関数内）
                // 成りの選択肢を付けて Move を作る
                for (const mv of this.wrapWithPromotionOptions(pos, from, to, piece)) {
                    moves.push(mv);
                }
            }
        }

        // 打ち（持ち駒）
        for (const t of Object.values(PieceType)) {
            if (t === PieceType.OU) continue;
            const n = pos.hand.get(pos.turn, t);
            if (n <= 0) continue;

            for (let file = 1; file <= 9; file++) {
                for (let rank = 1; rank <= 9; rank++) {
                    const to = { file, rank };
                    if (b.get(to)) continue; // 空マスのみ

                    // 行き所なし打ち禁止
                    if (!this.isDropAllowedByRank(pos.turn, t, rank)) continue;

                    // 二歩禁止
                    if (t === PieceType.FU && this.hasPawnOnFile(pos, pos.turn, file)) continue;

                    // TODO: 打ち歩詰め（禁止）判定
                    // generatePseudoLegalMoves() の DROP 生成内

                    // 二歩禁止
                    if (t === PieceType.FU && this.hasPawnOnFile(pos, pos.turn, file)) continue;

                    // 打ち歩詰め禁止（追加）
                    if (t === PieceType.FU && this.isUchiFuZume(pos, { kind: "DROP", pieceType: PieceType.FU, to })) continue;

                    moves.push({ kind: "DROP", pieceType: t, to });
                }
            }
        }

        return moves;
    }

    private static isUchiFuZume(pos: Position, mv: Move): boolean {
        // 歩打ち以外は対象外
        if (mv.kind !== "DROP" || mv.pieceType !== PieceType.FU) return false;

        // まず打ってみる（手番は相手に移る）
        const next = Game.applyMove(pos, mv);

        // 打った結果、相手玉（next.turn）が王手でなければ打ち歩詰めではない
        if (!this.isKingInCheck(next, next.turn)) return false;

        // 相手に合法手が1つでもあれば詰みではない
        const replies = this.generateLegalMoves(next);
        return replies.length === 0; // 0なら「歩打ちで即詰み」= 反則
    }

    // =========================
    // 駒別の移動先生成（盤上）
    // =========================
    private static generateDestinationsForPiece(pos: Position, from: Square, piece: Piece): Square[] {
        const b = pos.board;
        const res: Square[] = [];

        const dir = piece.owner === "SENTE" ? -1 : 1; // “前”方向のrank増減
        const addStep = (df: number, dr: number) => {
            const to = { file: from.file + df, rank: from.rank + dr };
            if (!b.isInside(to)) return;
            const dst = b.get(to);
            if (dst && dst.owner === piece.owner) return; // 自駒は不可
            res.push(to);
        };

        const addRay = (df: number, dr: number) => {
            let f = from.file + df;
            let r = from.rank + dr;
            while (true) {
                const to = { file: f, rank: r };
                if (!b.isInside(to)) break;
                const dst = b.get(to);
                if (!dst) {
                    res.push(to);
                } else {
                    if (dst.owner !== piece.owner) res.push(to); // 相手駒は取れる
                    break; // 駒で遮断
                }
                f += df;
                r += dr;
            }
        };

        // 成り駒の扱い（と金等）
        const isGoldLike =
            piece.type === PieceType.KI ||
            (piece.promoted &&
                (piece.type === PieceType.FU ||
                    piece.type === PieceType.KY ||
                    piece.type === PieceType.KE ||
                    piece.type === PieceType.GI));

        if (piece.type === PieceType.OU) {
            // 王：8方向1歩
            for (const [df, dr] of [
                [-1, -1],
                [0, -1],
                [1, -1],
                [-1, 0],
                [1, 0],
                [-1, 1],
                [0, 1],
                [1, 1],
            ] as const) addStep(df, dr);
            return res;
        }

        if (isGoldLike) {
            // 金（＋と金類）：前3方向 + 横2 + 後ろ直
            addStep(-1, dir);
            addStep(0, dir);
            addStep(1, dir);
            addStep(-1, 0);
            addStep(1, 0);
            addStep(0, -dir);
            return res;
        }

        // 未成り銀
        if (piece.type === PieceType.GI) {
            addStep(-1, dir);
            addStep(0, dir);
            addStep(1, dir);
            addStep(-1, -dir);
            addStep(1, -dir);
            return res;
        }

        // 歩
        if (piece.type === PieceType.FU) {
            addStep(0, dir);
            return res;
        }

        // 桂（“前に2、左右に1”）
        if (piece.type === PieceType.KE) {
            addStep(-1, 2 * dir);
            addStep(1, 2 * dir);
            return res;
        }

        // 香（前方向レイ）
        if (piece.type === PieceType.KY) {
            addRay(0, dir);
            return res;
        }

        // 角
        if (piece.type === PieceType.KA) {
            addRay(-1, -1);
            addRay(1, -1);
            addRay(-1, 1);
            addRay(1, 1);
            if (piece.promoted) {
                // 馬：角 + 王の縦横1歩
                addStep(0, -1);
                addStep(0, 1);
                addStep(-1, 0);
                addStep(1, 0);
            }
            return res;
        }

        // 飛
        if (piece.type === PieceType.HI) {
            addRay(0, -1);
            addRay(0, 1);
            addRay(-1, 0);
            addRay(1, 0);
            if (piece.promoted) {
                // 龍：飛 + 王の斜め1歩
                addStep(-1, -1);
                addStep(1, -1);
                addStep(-1, 1);
                addStep(1, 1);
            }
            return res;
        }

        return res;
    }

    // =========================
    // 成りのオプション（可否/必須）
    // =========================
    private static wrapWithPromotionOptions(pos: Position, from: Square, to: Square, piece: Piece): Move[] {
        const canPromote = this.canPromoteType(piece.type);
        if (!canPromote) return [{ kind: "MOVE", from, to }];

        // すでに成っているなら、これ以上成れない（成りは維持）
        if (piece.promoted) return [{ kind: "MOVE", from, to }];

        const inZone =
            this.isPromotionZone(piece.owner, from.rank) || this.isPromotionZone(piece.owner, to.rank);

        // 成り必須（行き所なし）
        const mustPromote = this.isPromotionMandatory(piece.owner, piece.type, to.rank);

        if (!inZone) {
            // ゾーン外は成れない。ただし必須は起きないはず（toが端でゾーン外は存在しない）
            return [{ kind: "MOVE", from, to }];
        }

        if (mustPromote) {
            return [{ kind: "MOVE", from, to, promote: true }];
        }

        // 成る/成らない両方を生成
        return [
            { kind: "MOVE", from, to },
            { kind: "MOVE", from, to, promote: true },
        ];
    }

    private static isPromotionMandatory(owner: Player, type: PieceType, toRank: number): boolean {
        // 先手: 1段目が最前、後手: 9段目が最前
        // 歩/香：最前段に到達したら必須
        // 桂：最前2段（先手:1-2, 後手:8-9）で必須
        if (type !== PieceType.FU && type !== PieceType.KY && type !== PieceType.KE) return false;
        if (owner === "SENTE") {
            if (type === PieceType.KE) return toRank <= 2;
            return toRank <= 1;
        } else {
            if (type === PieceType.KE) return toRank >= 8;
            return toRank >= 9;
        }
    }

    // =========================
    // 打ちの行き所なし禁止
    // =========================
    private static isDropAllowedByRank(owner: Player, type: PieceType, rank: number): boolean {
        if (type === PieceType.KI || type === PieceType.GI || type === PieceType.KA || type === PieceType.HI)
            return true;
        if (type === PieceType.FU || type === PieceType.KY) {
            return owner === "SENTE" ? rank >= 2 : rank <= 8;
        }
        if (type === PieceType.KE) {
            return owner === "SENTE" ? rank >= 3 : rank <= 7;
        }
        return true;
    }

    private static hasPawnOnFile(pos: Position, owner: Player, file: number): boolean {
        for (const { square, piece } of pos.board.entries()) {
            if (square.file !== file) continue;
            if (piece.owner !== owner) continue;
            if (piece.type === PieceType.FU && !piece.promoted) return true; // 未成り歩のみ
        }
        return false;
    }

    // =========================
    // 王手判定（攻撃されているか）
    // =========================
    static isKingInCheck(pos: Position, kingOwner: Player): boolean {
        const kingSq = this.findKing(pos, kingOwner);
        if (!kingSq) throw new Error("King not found");
        return this.isSquareAttacked(pos, kingSq, opposite(kingOwner));
    }

    private static findKing(pos: Position, owner: Player): Square | null {
        for (const { square, piece } of pos.board.entries()) {
            if (piece.owner === owner && piece.type === PieceType.OU) return square;
        }
        return null;
    }

    private static isSquareAttacked(pos: Position, target: Square, attacker: Player): boolean {
        // attacker 側の全駒が target を取れるか（擬似的に判定）
        // ここは「駒の移動生成」を流用して OK（王も含む）
        for (const { square: from, piece } of pos.board.entries()) {
            if (piece.owner !== attacker) continue;
            const tos = this.generateDestinationsForPiece(pos, from, piece);
            if (tos.some((to) => to.file === target.file && to.rank === target.rank)) {
                // ただし、相手の王が王に近接して攻撃判定するのは OK（将棋の王手判定として正しい）
                return true;
            }
        }
        return false;
    }
}


// =====================
// ゲーム進行
// =====================

export type GameResult =
    | { kind: "ONGOING" }
    | { kind: "RESIGN"; winner: Player }
    | { kind: "CHECKMATE"; winner: Player }
    | { kind: "ILLEGAL_MOVE"; loser: Player; reason: string };

export class Game {
    private history: Move[] = [];
    private result: GameResult = { kind: "ONGOING" };

    constructor(public pos: Position) { }

    getResult(): GameResult {
        return this.result;
    }

    getHistory(): readonly Move[] {
        return this.history;
    }

    resign(player: Player): void {
        if (this.result.kind !== "ONGOING") return;
        this.result = { kind: "RESIGN", winner: opposite(player) };
    }

    play(mv: Move): void {
        if (this.result.kind !== "ONGOING") return;

        if (!Rules.isLegal(this.pos, mv)) {
            this.result = { kind: "ILLEGAL_MOVE", loser: this.pos.turn, reason: "illegal by current rules" };
            return;
        }

        // 適用
        this.pos = Game.applyMove(this.pos, mv);
        this.history.push(mv);

        // TODO: 詰み判定などをここで実装
        // if (Rules.isCheckmate(this.pos)) ...
    }

    static applyMove(pos: Position, mv: Move): Position {
        const next = pos.clone();
        const b = next.board;

        if (mv.kind === "MOVE") {
            const p = b.get(mv.from);
            if (!p) throw new Error("MOVE from empty (should be checked)");

            const captured = b.get(mv.to);

            // 移動元を空に
            b.set(mv.from, undefined);

            // 取った駒は持ち駒へ（成りは戻す）
            if (captured) {
                const baseType = captured.unpromote().type;
                next.hand.add(pos.turn, baseType, 1);
            }

            // 成り
            let moved = p;
            const canPromote = Rules.canPromoteType(p.type);
            const inZone = Rules.isPromotionZone(p.owner, mv.from.rank) || Rules.isPromotionZone(p.owner, mv.to.rank);
            if (mv.promote && canPromote && inZone) moved = p.promote();

            // 移動先へ
            b.set(mv.to, moved);
        } else {
            // 打つ
            next.hand.remove(pos.turn, mv.pieceType, 1);
            b.set(mv.to, new Piece(pos.turn, mv.pieceType, false));
        }

        // 手番交代
        return new Position(next.board, next.hand, opposite(pos.turn));
    }
}

// =====================
// 初期局面生成（あとで配置を詰められるように）
// =====================

export class InitialSetup {
    static standard(): Position {
        const b = new Board();
        const h = new Hand();

        // 先手
        b.set(sq(5, 9), new Piece("SENTE", PieceType.OU));
        b.set(sq(4, 9), new Piece("SENTE", PieceType.KI));
        b.set(sq(6, 9), new Piece("SENTE", PieceType.KI));
        b.set(sq(3, 9), new Piece("SENTE", PieceType.GI));
        b.set(sq(7, 9), new Piece("SENTE", PieceType.GI));
        b.set(sq(2, 9), new Piece("SENTE", PieceType.KE));
        b.set(sq(8, 9), new Piece("SENTE", PieceType.KE));
        b.set(sq(1, 9), new Piece("SENTE", PieceType.KY));
        b.set(sq(9, 9), new Piece("SENTE", PieceType.KY));
        b.set(sq(2, 8), new Piece("SENTE", PieceType.HI));
        b.set(sq(8, 8), new Piece("SENTE", PieceType.KA));
        for (let f = 1; f <= 9; f++) b.set(sq(f, 7), new Piece("SENTE", PieceType.FU));

        // 後手
        b.set(sq(5, 1), new Piece("GOTE", PieceType.OU));
        b.set(sq(4, 1), new Piece("GOTE", PieceType.KI));
        b.set(sq(6, 1), new Piece("GOTE", PieceType.KI));
        b.set(sq(3, 1), new Piece("GOTE", PieceType.GI));
        b.set(sq(7, 1), new Piece("GOTE", PieceType.GI));
        b.set(sq(2, 1), new Piece("GOTE", PieceType.KE));
        b.set(sq(8, 1), new Piece("GOTE", PieceType.KE));
        b.set(sq(1, 1), new Piece("GOTE", PieceType.KY));
        b.set(sq(9, 1), new Piece("GOTE", PieceType.KY));
        b.set(sq(8, 2), new Piece("GOTE", PieceType.HI));
        b.set(sq(2, 2), new Piece("GOTE", PieceType.KA));
        for (let f = 1; f <= 9; f++) b.set(sq(f, 3), new Piece("GOTE", PieceType.FU));

        return new Position(b, h, "SENTE");
    }
}
