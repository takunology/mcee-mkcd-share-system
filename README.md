# エージェント操作プログラム エクスポート (MakeCode 拡張)

生徒が MakeCode のブロックでエージェントの動きをプログラムし、チャットコマンドで実行する拡張です。

チャットコマンドを実行すると、**エージェントが実際に動き**、同時に**実行したプログラム構造を JSON として記録**してチャットに出力します(MVP の可視出力)。先生は後でその JSON を集めて閲覧・採点に使えます。

## ブロック一覧

| ブロック | 説明 |
| --- | --- |
| チャットコマンド %command を実行したとき | エントリポイント。中の操作を実行し、終了後に JSON を出力 |
| エージェントを %direction に %blocks ブロック移動させる | エージェントを移動。方向は まえ/うしろ/みぎ/ひだり/うえ/した |
| エージェントの向きを %direction にかえる | 向きを変える。方向は みぎ/ひだり |
| くりかえし %times 回 | 中の操作を指定回数くりかえす(入れ子可) |

## 動作

- `move` / `turn` は本物の `agent.move` / `agent.turn` を呼び、エージェントを実際に動かします。
- `くりかえし` は実際に N 回エージェントを動かしますが、記録上は `{ "times": N, "children": [...] }` の入れ子構造として 1 回だけ残します。

## 出力フォーマット

`test.ts` の例(まえ3 → 右 → くりかえし4回[まえ2 → 右])の出力:

```json
{
  "command": "go",
  "program": [
    { "type": "move", "direction": "forward", "blocks": 3 },
    { "type": "turn", "direction": "right" },
    {
      "type": "repeat",
      "times": 4,
      "children": [
        { "type": "move", "direction": "forward", "blocks": 2 },
        { "type": "turn", "direction": "right" }
      ]
    }
  ]
}
```

### チャット出力(可視出力 MVP)

JSON を 200 文字ごとに分割し、次の形式でチャットへ出力します。受信側はこれを連結して元の JSON に復元します。

```
PZL_BEGIN total=N
PZL 1/N <payload chunk>
PZL 2/N <payload chunk>
...
PZL_END
```

## ビルド

```sh
npx --yes --package makecode mkc build -j
```

## 今後の拡張(未実装)

- `/scriptevent` ブリッジ経由でアドオンの Script API に渡す
- 外部 WebSocket(`/connect`)への送信
- 生徒名などメタ情報の付与
- Node.js 製の先生用受信サーバ + ダッシュボード(プログラム再生・比較)
