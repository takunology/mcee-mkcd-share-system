# MakeCode Puzzle Export / Teacher Viewer Idea

## Summary

Minecraft Education の MakeCode を、リアルタイム共同編集エディタとして改造するのではなく、生徒がブロックで作った「パズルの設計図」を外部へ送信する入力装置として扱う案。

生徒は MakeCode の拡張ブロックでパズルを作る。開始ボタンや提出ボタンを押したタイミングで、パズルの種類、ピース、接続、条件などを構造化データとして送信する。先生は Minecraft 内に限らず、外部の Web UI やエディタでその情報を任意のタイミングで閲覧、復元、比較、採点できる。

Codex は実装作業に使い、Claude AI には設計相談、仕様整理、UX 案、データ構造レビューなどを相談したい。

## Goal

- 生徒が MakeCode ブロックで作ったパズル構造を取り出す。
- 先生が任意のタイミングで各生徒の提出状態を見られるようにする。
- Minecraft 内だけで完結させず、外部 Web アプリや外部エディタでデコード・再現できるようにする。
- 最初から完全な共同編集を目指さず、「作品の状態をリアルタイム提出する MakeCode」を目指す。

## Core Hypothesis

MakeCode 拡張機能はエディタ全体の Blockly workspace を直接読むためのものではないが、自作ブロックの実行時引数は取れる。

そのため、任意の MakeCode プロジェクト全体を解析するのではなく、パズル作成用の専用ブロックを DSL として設計する。

例:

```text
パズルを開始する
ピース A を カギ にする
ピース B を ドア にする
A から B へ つなぐ
条件 A を押したら B を開く
開始ボタンが押されたら送信する
```

各ブロックが内部の配列や状態に `piece`, `link`, `condition` を積んでいき、最後の送信ブロックで JSON などの形にまとめる。

## What We Can Probably Capture

- 自作ブロックに渡された値
- 自作ブロックが呼ばれた順番
- enum / dropdown / grid picker で選ばれた種類
- ピースの ID、種類、配置情報
- ピース同士の接続
- 条件とアクションの対応
- 生徒名、プロジェクト名、提出時刻などのメタ情報

## What Is Probably Hard

- MakeCode エディタ上に置かれた全ブロックの接続構造を、普通の拡張から直接読むこと
- 組み込みの `if` や `loops` の中身を AST として吸い出すこと
- ブロックを置いた瞬間の完全リアルタイム同期
- GitHub 拡張だけで Blockly workspace や MakeCode editor 内部 API に触ること
- MakeCode の標準共同編集機能を作ること

## Candidate Architecture

```text
Student MakeCode
  |
  | custom puzzle blocks
  v
Puzzle definition buffer
  |
  | submit/start button
  v
Encoded payload
  |
  +--> Minecraft command / chat / scriptevent
  |
  +--> addon Script API bridge
  |
  +--> external WebSocket/server if /connect path works
  v
Teacher viewer / external editor
```

## Data Shape

First prototype can use readable JSON:

```json
{
  "student": "playerName",
  "project": "puzzle-001",
  "submittedAt": 1781790000000,
  "pieces": [
    { "id": "A", "type": "key", "x": 0, "y": 0 },
    { "id": "B", "type": "door", "x": 1, "y": 0 }
  ],
  "links": [
    { "from": "A", "to": "B", "kind": "opens" }
  ],
  "conditions": [
    { "when": "A.pressed", "then": "B.open" }
  ]
}
```

If command length becomes a problem, switch to a compact format:

```text
pzl|student=playerName|project=puzzle-001|pieces=A:key:0:0,B:door:1:0|links=A>B:opens|conds=A.pressed>B.open
```

For larger payloads, split into chunks:

```text
pzl|session=abc123|part=1|total=3|payload=...
pzl|session=abc123|part=2|total=3|payload=...
pzl|session=abc123|part=3|total=3|payload=...
```

The teacher server reassembles chunks by `session`, then decodes the payload.

## Transport Options

### Option A: MakeCode to Addon via `/scriptevent`

MakeCode sends data into Minecraft through a command or event-like bridge. The behavior pack Script API receives it and stores or forwards it.

Pros:

- Fits the existing MakeCode extension + addon pattern.
- Minecraft world can validate or enrich data with player identity.
- Teacher can also inspect inside Minecraft if useful.

Risks:

- Need to verify exact MakeCode command API available in Minecraft Education.
- Need to verify payload size limits.
- Direct outbound HTTP/WebSocket from Script API may not be available or may be restricted.

### Option B: Minecraft `/connect` or `/wsserver` to External WebSocket

Minecraft connects to an external WebSocket server. The server receives events or commands and forwards data to a teacher UI.

Pros:

- External tool can own storage, decoding, visualization, and teacher dashboard.
- Minecraft does not need to be the final UI.
- Could connect to an external editor that reconstructs the puzzle.

Risks:

- Need to verify whether Code Builder / MakeCode connection and `/connect` WebSocket can coexist.
- WebSocket behavior is not a stable, well-documented public API.
- Cheats and permissions are required.
- School network restrictions may block local or remote WebSocket connections.

### Option C: Export Through Share/GitHub/Project Files

After a project is created, collect `main.ts` or shared project files externally and parse them.

Pros:

- Good for offline review and after-class analysis.
- Avoids WebSocket uncertainty.

Risks:

- Not real-time.
- Requires project collection workflow.
- Parsing generated TypeScript or block XML may be more brittle than explicit submit blocks.

## MVP Proposal

Build the smallest possible loop first:

1. Add MakeCode extension blocks:
   - `パズルを開始する`
   - `ピース $id を $type にする`
   - `$from から $to へ $kind でつなぐ`
   - `条件 $when なら $then`
   - `パズルを送信する`

2. Store puzzle data in arrays inside the extension runtime.

3. Serialize the puzzle to a string.

4. Send the string through the simplest available channel:
   - first attempt: chat/message/command output for visibility
   - second attempt: `/scriptevent`
   - third attempt: external WebSocket via `/connect`

5. Build a tiny Node.js teacher receiver:
   - receives payloads
   - stores latest submission per student
   - serves a simple browser dashboard
   - decodes and visualizes nodes and edges

6. Verify with one student client and one teacher browser.

## Teacher Viewer Idea

The teacher viewer does not need to be fancy at first.

Useful first screen:

- Student list
- Last submitted time
- Puzzle name
- Number of pieces
- Number of links
- Validation status
- Click to open reconstructed graph

Graph view:

- Pieces as nodes
- Links as arrows
- Conditions as labels
- Raw payload panel for debugging

## Open Questions for Claude

- Is the DSL shape understandable for students?
- Should the MakeCode blocks describe a puzzle as graph data, grid data, or rule data?
- What is the smallest set of block types that still feels expressive?
- Should the payload be JSON, compact custom text, or both?
- How should teacher feedback be represented?
- Should the teacher viewer show diffs between submissions?
- How much validation should happen in MakeCode vs server vs addon?
- Can this become collaborative by merging multiple students' puzzle fragments?

## Open Technical Questions for Codex / Implementation

- Which Minecraft MakeCode APIs can execute commands or emit data reliably?
- Can MakeCode call `/scriptevent` directly in Minecraft Education?
- What is the max practical payload length?
- Can `/connect` run while Code Builder / MakeCode is active?
- Can an external WebSocket server receive enough information to identify the player?
- Does Script API in the target Minecraft Education version allow outbound network access?
- What is the safest fallback if WebSocket is blocked?

## Suggested Implementation Order

1. Prototype the MakeCode DSL blocks locally in `main.ts`.
2. Add a local `serializePuzzle()` function and test it with `test.ts`.
3. Validate with `npx --yes --package makecode mkc build -j`.
4. Try a visible output path first so payload shape can be inspected.
5. Add `/scriptevent` or command bridge if available.
6. Build a tiny Node receiver and teacher dashboard.
7. Test `/connect` only after the local DSL and serialization are stable.

## Working Mental Model

Do not try to read arbitrary MakeCode blocks.

Instead, create blocks that intentionally produce a portable puzzle definition.

This makes MakeCode the student-friendly authoring surface, Minecraft the runtime bridge, and the external teacher tool the place where submissions are decoded, stored, and reviewed.
