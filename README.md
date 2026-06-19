# MakeCode エージェントプログラム共有システム

Minecraft Education で、生徒が **MakeCode のブロックで組んだエージェント操作プログラム**を、先生が**ゲーム内のメニュー（ブレイズロッド）から一覧・閲覧**できるようにする仕組みです。

生徒は MakeCode で普段どおりプログラムを組むだけ。起動すると裏側で設計図が自動送信され、先生はワールド内でブレイズロッドを使うだけで、各生徒のプログラムを **MakeCode のブロック文言そのままの手順リスト**として確認できます。

## 全体構成

```
生徒の MakeCode 拡張 (puzzle-export)
  ├ エージェント操作ブロックでプログラムを作成
  ├ 起動時に「動かさず」設計図を自動送信(裏側トレース)
  └ チャットコマンド実行時はエージェントを動かし、再送信
        │  /scriptevent puzzle:submit ...
        ▼
先生アドオン teacher-addon (ビヘイビアパック / Script API)
  ├ scriptevent を受信し、プレイヤー名×コマンド名で保持
  └ ブレイズロッド使用 → ActionFormData でメニュー表示
        │
        ▼
resource-pack (リソースパック / JSON UI)
  └ メニューダイアログのサイズを調整(読みやすさ向上)
```

3 つのコンポーネントで構成されます。

| コンポーネント | 種別 | 役割 |
| --- | --- | --- |
| ルート直下 (`pxt.json` / `main.ts`) | MakeCode 拡張 | 生徒がプログラムを作成・送信 |
| [teacher-addon/](teacher-addon/) | ビヘイビアパック | 先生がプログラムを集約・閲覧 |
| [resource-pack/](resource-pack/) | リソースパック | 先生メニューのダイアログ拡大 |

---

## 1. MakeCode 拡張（生徒側）

### ブロック一覧（namespace「エージェント」）

| ブロック | 動作 |
| --- | --- |
| `チャットコマンド %command を実行したとき` | エントリ。起動時に設計図を自動送信し、コマンド実行時はエージェントを動かす |
| `エージェントを %direction に %blocks ブロック移動させる` | `agent.move`。方向は まえ/うしろ/みぎ/ひだり/うえ/した |
| `エージェントの向きを %direction にかえる` | `agent.turn`。方向は みぎ/ひだり |
| `くりかえし %times 回` | 中の操作を指定回数くりかえす（入れ子可） |
| `エージェントに %item を %count コ スロット %slot 番に設定させる` | `agent.setItem`。ブロックはアイテムピッカーで選択 |
| `エージェントに %direction へ置かせる` | `agent.place`。方向 6 種 |

### 動作の仕組み

- ブロックを**実行してその構造をバッファに記録**する方式（MakeCode はエディタ上のブロック構造を直接読めないため）。
- `チャットコマンド … を実行したとき` は2つの役割を持つ：
  1. **起動の約2秒後**に、エージェントを**動かさず**中身をなぞって設計図を送信（裏側トレース）。生徒はこのブロック1つを置くだけでよい。
  2. **チャットコマンド実行時**は、エージェントを実際に動かしつつ最新の設計図を再送信。
- `くりかえし` は、実行時はエージェントを N 回動かすが、記録は `{ "times": N, "children": [...] }` の入れ子構造として **1 回だけ**残す。

### 送信フォーマット（JSON）

```json
{
  "command": "run",
  "program": [
    { "type": "move", "direction": "forward", "blocks": 3 },
    { "type": "turn", "direction": "right" },
    {
      "type": "repeat",
      "times": 4,
      "children": [
        { "type": "setItem", "item": 17, "count": 1, "slot": 1 },
        { "type": "place", "direction": "forward" },
        { "type": "move", "direction": "right", "blocks": 1 }
      ]
    }
  ]
}
```

コマンド種別: `move` / `turn` / `repeat` / `setItem` / `place`。

### 送信経路（scriptevent）

JSON を 200 文字ごとに分割し、次の形式で `/scriptevent` を発行する：

```
scriptevent puzzle:submit me|<part>/<total>|<JSONチャンク>
```

- 生徒名はプレースホルダ `me` を送り、アドオン側が**実行プレイヤー名（`sourceEntity`）**に置き換える。
- アドオンは全チャンクを連結して元の JSON に復元する。

### ビルド

```sh
npx --yes --package makecode mkc build -j
```

---

## 2. teacher-addon（先生側 / ビヘイビアパック）

- `system.afterEvents.scriptEventReceive` で `puzzle:submit` を受信し、**プレイヤー名 → コマンド名**ごとに JSON を保持（1 人が複数プログラムを持てる。同名コマンドは最新で上書き）。
- `world.afterEvents.itemUse` で**ブレイズロッド使用**を検知し、`ActionFormData` で先生メニューを表示。
  - 一覧：接続中の全プレイヤー（`world.getAllPlayers()`）＋受信済みキーを統合。各人に受信件数を表示。
  - 詳細：選んだ生徒の全プログラムを**かたまりごとに空白行で区切って**表示。
- 表示は **MakeCode のブロック文言と完全一致**。入れ子は `| ` でインデントし、`+--` で閉じる。
- ブロック ID は日本語ブロック名に変換（未収録 ID は `id:N`）。
- フォームが使えない環境ではチャット出力にフォールバック。

表示例：

```
チャットコマンド run を実行したとき
くりかえし 4 回
| エージェントに 原木 を 1 コ スロット 1 番に設定させる
| エージェントに まえ へ置かせる
| エージェントを みぎ に 1 ブロック移動させる
+--
```

---

## 3. resource-pack（リソースパック / JSON UI）

- `ui/server_form.json` を上書きし、先生メニューのダイアログ（`long_form` / `custom_form`）のサイズを調整（文字の見切れ・折り返し軽減）。
- teacher-addon はこのリソースパックに**依存**しているため、ビヘイビアパックを適用すると自動で一緒に適用される。

---

## 導入方法（Minecraft Education）

### MakeCode 拡張
1. MakeCode (Minecraft) を開く
2. 歯車 → **拡張機能** → `https://github.com/takunology/mcee-mkcd-share-system` を貼り付け
3. 取り込んだブロックでプログラムを作成

### アドオン（先生用）
1. `teacher-addon` を `development_behavior_packs` に配置（または `.mcpack` 化してインポート）
2. ワールド設定の**ビヘイビアパック**で適用（依存により**リソースパックも自動適用**）
3. ブレイズロッドを持って右クリック → 先生メニュー

> リソースパックを手動配置する場合は `resource-pack` を `development_resource_packs` へ。
> 他に `server_form.json` を上書きするリソースパックがある場合は、本パックを適用順の上位にすること。

---

## 動作確認済み環境

- Minecraft Education `1.21.13302.0`
- `@minecraft/server` `1.13.0` / `@minecraft/server-ui` `1.2.0`
- 実機マルチプレイで、複数生徒のプログラムを名前別・コマンド別に集約・閲覧できることを確認。

## バージョン / リリース

正式リリース **v1.0.0**（MakeCode 拡張・teacher-addon・resource-pack を `1.0.0` に統一）。
リリース時点のスナップショットは `release/v1.0.0` ブランチに保存。
