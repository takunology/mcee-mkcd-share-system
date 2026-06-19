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

// 生徒名 -> 完成した JSON 文字列
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
        submissions.set(student, json);
        buffers.delete(student);
        world.sendMessage(`[受信] ${student} のプログラムを更新しました`);
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
        .body(`接続中 ${names.length} 人。✔=プログラム受信済み / —=未受信`);
    for (const name of names) {
        menu.button(submissions.has(name) ? `${name}  ✔` : `${name}  —`);
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

function showDetail(player, name) {
    const json = submissions.get(name);
    if (!json) {
        const empty = new ActionFormData().title(name).body("(まだ受信していません)").button("もどる");
        showWithRetry(empty, player, 0)
            .then((res) => { if (!res.canceled && res.selection === 0) openMenu(player); })
            .catch(() => player.sendMessage(`${name}: (まだ受信していません)`));
        return;
    }

    const info = describe(json);
    const detail = new ActionFormData()
        .title(info.title || name) // パズル名(command)をタイトルに
        .body(`生徒: ${name}\n\n${info.body}`)
        .button("もどる");

    showWithRetry(detail, player, 0)
        .then((res) => {
            // 「もどる」または閉じたら一覧へ戻る
            if (!res.canceled && res.selection === 0) openMenu(player);
        })
        .catch(() => {
            player.sendMessage(`=== ${info.title || name}（${name}）===`);
            for (const line of info.body.split("\n")) player.sendMessage(line);
        });
}

function chatFallback(player, names) {
    player.sendMessage("[先生メニュー] フォームを表示できないためチャット表示します");
    for (const name of names) {
        const json = submissions.get(name);
        if (!json) {
            player.sendMessage(`--- ${name} : (まだ受信していません) ---`);
            continue;
        }
        const info = describe(json);
        player.sendMessage(`--- ${info.title || name}（${name}）---`);
        for (const line of info.body.split("\n")) player.sendMessage(line);
    }
}
