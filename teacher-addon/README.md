# Puzzle Teacher Viewer (ビヘイビアパック / アドオン)

生徒の MakeCode から送られたエージェントプログラム(JSON)を集約し、先生がブレイズロッドで閲覧するためのアドオンです。

MakeCode 拡張(リポジトリ直下)が「生徒の作成・送信」を担当し、このアドオンが「先生の集約・閲覧」を担当します。

## できること(現状の雛形)

- **デモ用ダミーデータ**を内蔵(`ゆうき` / `さくら`)。MakeCode 連携が未配線でもメニューを試せます。
- **ブレイズロッド使用(右クリック)** → `ActionFormData` で生徒一覧メニュー → 選択でその生徒の JSON を表示。
- `/scriptevent puzzle:submit ...` の**受信・チャンク再結合・保存**。
- フォームが使えない環境(MEE の制限など)では**チャット表示にフォールバック**。

## 受信プロトコル(MakeCode 側が送る形)

チャンクごとに次の `/scriptevent` を送る想定です(JSON にスペース・`|` は含まれない前提)。

```
scriptevent puzzle:submit <生徒名>|<part>/<total>|<JSONチャンク>
```

例:

```
scriptevent puzzle:submit ゆうき|1/2|{"command":"run","program":[{"type":"move",...
scriptevent puzzle:submit ゆうき|2/2|...,"direction":"right"}]}
```

- 全 `part` がそろうと結合して保存し、`[受信] <生徒名> のプログラムを保存しました` を表示。
- プレイヤーが実行した場合は `sourceEntity` の名前を優先(なりすまし防止)。先頭の `<生徒名>` はフォールバック用。

> MakeCode 拡張側はまだこの送信に未対応です。次のステップで「scriptevent で送信する」ブロック/分岐を追加します。

## 導入方法(MEE)

1. `teacher-addon` フォルダを `.mcpack` 化(フォルダを zip にして拡張子を `.mcpack`)するか、開発フォルダに配置。
2. ワールドのビヘイビアパックとして適用。
3. ワールド設定で必要に応じて実験的機能を有効化。

## 既知の不確実点(要・実機検証)

- **`@minecraft/server-ui` のフォーム**が MEE で表示できるか(できない場合はチャットにフォールバック)。
- **`/scriptevent`** がお使いの MEE バージョンで使えるか(Bedrock 1.19.50+ 相当が必要)。
- `manifest.json` の `min_engine_version` と各モジュールの `version` は、お使いの MEE が提供する Script API に**合わせて調整が必要**な場合があります。読み込めない場合はここを疑ってください。
