// 先生用ビューア アドオン (behavior pack / Script API)
//
// 役割:
//  1. 生徒の MakeCode から /scriptevent で送られる JSON を集約・保存する。
//  2. 先生がブレイズロッドを使う(右クリック)と、生徒一覧メニューを表示し、
//     選んだ生徒のプログラム(JSON)を見られるようにする。
//
// 注意:
//  - Minecraft Education では @minecraft/server-ui のフォーム表示が制限される場合がある。
//    フォームが出せない場合はチャット出力にフォールバックする。
//  - dependencies のバージョンは、お使いの MEE が提供する Script API に合わせて
//    manifest.json 側を調整する必要がある場合がある。

import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// 生徒名 -> (コマンド名 -> 完成した JSON 文字列)
// 1 人の生徒が複数のチャットコマンド/トリガーを持てるよう、コマンド別に保持する。
const submissions = new Map();

// 生徒名 -> 受信途中のチャンク { total, parts: Map<part, chunk> }
const buffers = new Map();

// ------------------------------------------------------------------
// プレイヤー検知: 参加したら通知する
// ------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn && ev.player) {
        world.sendMessage(`[検知] ${ev.player.name} が参加しました`);
    }
});

// ------------------------------------------------------------------
// 受信: /scriptevent puzzle:submit <student>|<part>/<total>|<chunk>
//   例: scriptevent puzzle:submit ゆうき|1/2|{"command":"run",...
// ------------------------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "puzzle:submit") return;

    // sourceEntity があればそれを正とし、無ければメッセージ先頭の名前を使う
    const srcName = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player"
        ? ev.sourceEntity.name
        : null;

    const segs = ev.message.split("|");
    if (segs.length < 3) return;

    const student = srcName || segs[0];

    const [partStr, totalStr] = segs[1].split("/");
    const part = parseInt(partStr, 10);
    const total = parseInt(totalStr, 10);
    const chunk = segs.slice(2).join("|");
    if (!part || !total) return;

    let buf = buffers.get(student);
    if (!buf || buf.total !== total) {
        buf = { total: total, parts: new Map() };
        buffers.set(student, buf);
    }
    buf.parts.set(part, chunk);

    if (buf.parts.size === total) {
        let json = "";
        for (let i = 1; i <= total; i++) json += buf.parts.get(i) || "";
        buffers.delete(student);

        // JSON 内の command(パズル名)をキーにして、コマンド別に保存する
        let command = "";
        try { command = JSON.parse(json).command || ""; } catch (e) { command = ""; }

        let byCmd = submissions.get(student);
        if (!byCmd) { byCmd = new Map(); submissions.set(student, byCmd); }
        byCmd.set(command, json);

        world.sendMessage(`[受信] ${student} の「${command}」を更新しました`);
    }
});

// ------------------------------------------------------------------
// 表示: ブレイズロッド使用で先生メニュー
// ------------------------------------------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
    if (!ev.itemStack || ev.itemStack.typeId !== "minecraft:blaze_rod") return;
    const player = ev.source;
    if (!player || player.typeId !== "minecraft:player") return;
    // フォームは event tick 内で直接 show できないため system.run で遅延する
    system.run(() => openMenu(player));
});

// UserBusy(チャット等が開いている)の場合に少しリトライする
function showWithRetry(form, player, attempt) {
    return form.show(player).then((res) => {
        if (res.canceled && res.cancelationReason === "UserBusy" && attempt < 20) {
            return new Promise((resolve) => {
                system.runTimeout(() => resolve(showWithRetry(form, player, attempt + 1)), 10);
            });
        }
        return res;
    });
}

function openMenu(player) {
    // マルチプレイ内の実プレイヤー + 受信済みキー を統合して一覧化する
    // (名前解決に失敗して "me" 等で保存された提出も拾えるようにする)
    const set = new Set();
    for (const p of world.getAllPlayers()) set.add(p.name);
    for (const key of submissions.keys()) set.add(key);
    const names = Array.from(set);

    if (names.length === 0) {
        player.sendMessage("[先生メニュー] プレイヤーが見つかりません");
        return;
    }

    const menu = new ActionFormData()
        .title("先生メニュー: プレイヤー")
        .body(`接続中 ${names.length} 人\n数字 = 受信したプログラム数 / [未] = 未受信`);
    for (const name of names) {
        const byCmd = submissions.get(name);
        const count = byCmd ? byCmd.size : 0;
        menu.button(count > 0 ? `${name}  [${count}件]` : `${name}  [未]`);
    }

    showWithRetry(menu, player, 0)
        .then((res) => {
            if (res.canceled) return;
            showDetail(player, names[res.selection]);
        })
        .catch(() => {
            // フォームが使えない環境ではチャットにフォールバック
            chatFallback(player, names);
        });
}

// 方向コードを日本語ラベルへ
function dirLabel(d) {
    switch (d) {
        case "forward": return "まえ";
        case "back": return "うしろ";
        case "right": return "みぎ";
        case "left": return "ひだり";
        case "up": return "うえ";
        case "down": return "した";
        default: return d;
    }
}

function turnLabel(d) {
    return d === "right" ? "みぎ" : "ひだり";
}

// MakeCode の minecraftBlock ピッカーが返す旧式数値ブロック ID -> 日本語名。
// よく使うブロックを中心に対応。未収録は id:N のまま表示する。
const BLOCK_NAMES = {
    1: "石", 2: "草ブロック", 3: "土", 4: "丸石", 5: "板材", 7: "岩盤",
    12: "砂", 13: "砂利", 14: "金鉱石", 15: "鉄鉱石", 16: "石炭鉱石",
    17: "原木", 18: "葉", 19: "スポンジ", 20: "ガラス", 24: "砂岩",
    35: "羊毛", 41: "金ブロック", 42: "鉄ブロック", 45: "レンガ", 46: "TNT",
    47: "本棚", 48: "苔石", 49: "黒曜石", 50: "たいまつ", 54: "チェスト",
    56: "ダイヤモンド鉱石", 57: "ダイヤモンドブロック", 58: "作業台",
    79: "氷", 80: "雪ブロック", 81: "サボテン", 82: "粘土", 85: "フェンス",
    87: "ネザーラック", 89: "グロウストーン", 98: "石レンガ", 102: "板ガラス",
    103: "スイカ", 112: "ネザーレンガ", 121: "エンドストーン",
    133: "エメラルドブロック", 155: "クォーツブロック", 159: "テラコッタ"
};

function blockName(id) {
    return BLOCK_NAMES[id] || `id:${id}`;
}

// プログラムを手順の行配列に変換する。
// 入れ子(くりかえし等)の中身は階層ごとに先頭へ "| " を足して左側を囲い、
// 中身の後ろに "+--" を出して閉じる。
function formatSteps(program, depth, lines) {
    const pad = "| ".repeat(depth); // depth 0 は "" / 入れ子で "| ", "| | " と増える
    for (const c of program) {
        if (c.type === "move") {
            lines.push(`${pad}${dirLabel(c.direction)}に ${c.blocks} ブロック移動`);
        } else if (c.type === "turn") {
            lines.push(`${pad}むきを ${turnLabel(c.direction)} にかえる`);
        } else if (c.type === "setItem") {
            lines.push(`${pad}${blockName(c.item)} を ${c.count} コ スロット ${c.slot} 番にセット`);
        } else if (c.type === "place") {
            lines.push(`${pad}${dirLabel(c.direction)} へ ブロックを置く`);
        } else if (c.type === "repeat") {
            lines.push(`${pad}くりかえし ${c.times} 回:`);
            formatSteps(c.children || [], depth + 1, lines);
            lines.push(`${pad}+--`); // ループの閉じ線(角)
        }
    }
}

// 保存 JSON を { title(パズル名), body(手順テキスト) } に変換する
function describe(json) {
    let data;
    try {
        data = JSON.parse(json);
    } catch (e) {
        return { title: "", body: json };
    }
    const lines = [];
    // 先頭にチャットコマンド行(MakeCode のエントリブロックに対応)
    lines.push(`チャットコマンド「${data.command || ""}」を実行したとき`);
    formatSteps(data.program || [], 0, lines);
    if (lines.length === 1) lines.push("(手順なし)");
    return {
        title: data.command || "",
        body: lines.join("\n")
    };
}

// 生徒の全プログラムを、かたまりごとに空白行で区切った 1 つのテキストにまとめる
function buildDetailBody(name) {
    const byCmd = submissions.get(name);
    if (!byCmd || byCmd.size === 0) return null;
    const blocks = [];
    for (const json of byCmd.values()) {
        blocks.push(describe(json).body);
    }
    // プログラムのかたまりの間を空白行(空行)で区切る
    return `生徒: ${name}（${byCmd.size}件）\n\n` + blocks.join("\n\n");
}

function showDetail(player, name) {
    const body = buildDetailBody(name);
    if (!body) {
        const empty = new ActionFormData().title(name).body("(まだ受信していません)").button("もどる");
        showWithRetry(empty, player, 0)
            .then((res) => { if (!res.canceled && res.selection === 0) openMenu(player); })
            .catch(() => player.sendMessage(`${name}: (まだ受信していません)`));
        return;
    }

    const detail = new ActionFormData()
        .title(`${name} のプログラム`)
        .body(body)
        .button("もどる");

    showWithRetry(detail, player, 0)
        .then((res) => {
            // 「もどる」または閉じたら一覧へ戻る
            if (!res.canceled && res.selection === 0) openMenu(player);
        })
        .catch(() => {
            for (const line of body.split("\n")) player.sendMessage(line);
        });
}

function chatFallback(player, names) {
    player.sendMessage("[先生メニュー] フォームを表示できないためチャット表示します");
    for (const name of names) {
        const body = buildDetailBody(name);
        if (!body) {
            player.sendMessage(`--- ${name} : (まだ受信していません) ---`);
            continue;
        }
        player.sendMessage(`=== ${name} ===`);
        for (const line of body.split("\n")) player.sendMessage(line);
    }
}
