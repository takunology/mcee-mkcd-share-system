/**
 * エージェント操作プログラム エクスポート拡張
 *
 * 生徒は専用ブロックでエージェントの動きをプログラムする。
 * チャットコマンドを実行すると、エージェントが実際に動き、
 * 同時に「実行したプログラム構造」を JSON として記録し、チャットに可視出力する(MVP)。
 *
 * 設計方針:
 *  - move / turn は本物の agent API を呼んでエージェントを動かす。
 *  - 同時にコマンドをバッファ(program ツリー)へ記録する。
 *  - くりかえしは {times, children} の入れ子構造として記録する。
 *    エージェントは実際に N 回動かすが、記録は構造を 1 回だけ残す。
 *  - static TS で確実に動くよう、JSON.stringify ではなく文字列連結で組み立てる。
 */

/**
 * エージェントを動かす方向
 */
enum AgentDir {
    //% block="まえ"
    Forward,
    //% block="うしろ"
    Back,
    //% block="みぎ"
    Right,
    //% block="ひだり"
    Left,
    //% block="うえ"
    Up,
    //% block="した"
    Down
}

/**
 * エージェントの向きを変える方向
 */
enum AgentTurn {
    //% block="みぎ"
    Right,
    //% block="ひだり"
    Left
}

//% weight=100 color=#A05A2C icon="" block="エージェント"
namespace agentControl {
    class Command {
        type: string;        // "move" | "turn" | "repeat" | "setItem" | "place"
        direction: string;   // move / turn / place 用
        blocks: number;      // move 用
        times: number;       // repeat 用
        children: Command[]; // repeat 用
        item: number;        // setItem 用(ブロック/アイテム ID)
        count: number;       // setItem 用(個数)
        slot: number;        // setItem 用(スロット番号)
        constructor(type: string) {
            this.type = type;
            this.direction = "";
            this.blocks = 0;
            this.times = 0;
            this.children = [];
            this.item = 0;
            this.count = 0;
            this.slot = 0;
        }
    }

    let program: Command[] = [];
    let containerStack: Command[][] = [];
    let recording = false;
    let executing = true; // false の場合はエージェントを動かさず記録だけ行う
    let currentCommand = "";

    function currentContainer(): Command[] {
        return containerStack[containerStack.length - 1];
    }

    function record(cmd: Command): void {
        if (recording) currentContainer().push(cmd);
    }

    function dirToSix(direction: AgentDir): SixDirection {
        switch (direction) {
            case AgentDir.Forward: return SixDirection.Forward;
            case AgentDir.Back: return SixDirection.Back;
            case AgentDir.Right: return SixDirection.Right;
            case AgentDir.Left: return SixDirection.Left;
            case AgentDir.Up: return SixDirection.Up;
            case AgentDir.Down: return SixDirection.Down;
            default: return SixDirection.Forward;
        }
    }

    function dirToString(direction: AgentDir): string {
        switch (direction) {
            case AgentDir.Forward: return "forward";
            case AgentDir.Back: return "back";
            case AgentDir.Right: return "right";
            case AgentDir.Left: return "left";
            case AgentDir.Up: return "up";
            case AgentDir.Down: return "down";
            default: return "forward";
        }
    }

    function turnToString(direction: AgentTurn): string {
        return direction == AgentTurn.Right ? "right" : "left";
    }

    /**
     * JSON 用に文字列をエスケープする(static TS には JSON.stringify がない前提)
     */
    function jsonString(s: string): string {
        let out = "\"";
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i);
            if (c == "\"") out += "\\\"";
            else if (c == "\\") out += "\\\\";
            else if (c == "\n") out += "\\n";
            else if (c == "\r") out += "\\r";
            else if (c == "\t") out += "\\t";
            else out += c;
        }
        out += "\"";
        return out;
    }

    function serializeCommand(c: Command): string {
        let s = "{" + jsonString("type") + ":" + jsonString(c.type);
        if (c.type == "move") {
            s += "," + jsonString("direction") + ":" + jsonString(c.direction);
            s += "," + jsonString("blocks") + ":" + c.blocks;
        } else if (c.type == "turn") {
            s += "," + jsonString("direction") + ":" + jsonString(c.direction);
        } else if (c.type == "repeat") {
            s += "," + jsonString("times") + ":" + c.times;
            s += "," + jsonString("children") + ":" + serializeList(c.children);
        } else if (c.type == "setItem") {
            s += "," + jsonString("item") + ":" + c.item;
            s += "," + jsonString("count") + ":" + c.count;
            s += "," + jsonString("slot") + ":" + c.slot;
        } else if (c.type == "place") {
            s += "," + jsonString("direction") + ":" + jsonString(c.direction);
        }
        s += "}";
        return s;
    }

    function serializeList(cmds: Command[]): string {
        let s = "[";
        for (let i = 0; i < cmds.length; i++) {
            if (i > 0) s += ",";
            s += serializeCommand(cmds[i]);
        }
        s += "]";
        return s;
    }

    function serializeProgram(): string {
        let json = "{";
        json += jsonString("command") + ":" + jsonString(currentCommand) + ",";
        json += jsonString("program") + ":" + serializeList(program);
        json += "}";
        return json;
    }

    /**
     * JSON を /scriptevent でアドオンへ送る(チャンク分割)。
     *   scriptevent puzzle:submit <名前>|<part>/<total>|<chunk>
     * 名前はプレースホルダ "me" を送り、アドオン側で実行プレイヤー名に置き換える。
     */
    function sendViaScriptEvent(json: string): void {
        const chunkSize = 200;
        const total = Math.ceil(json.length / chunkSize);
        for (let i = 0; i < total; i++) {
            const part = json.substr(i * chunkSize, chunkSize);
            player.execute("scriptevent puzzle:submit me|" + (i + 1) + "/" + total + "|" + part);
        }
    }

    /**
     * プログラム本体を走らせ、記録・送信を行う。
     * @param doExecute true ならエージェントを実際に動かす。false なら記録のみ。
     */
    function runProgram(command: string, handler: () => void, doExecute: boolean): void {
        // プログラム開始: バッファをリセットして記録を有効化
        program = [];
        containerStack = [program];
        currentCommand = command;
        recording = true;
        executing = doExecute;

        handler();

        // プログラム終了: 記録を止めて アドオン送信
        recording = false;
        executing = true;
        sendViaScriptEvent(serializeProgram());
    }

    /**
     * チャットコマンドを実行したときに、中のエージェント操作を実行する。
     *
     * MakeCode 起動時(=最初だけのタイミング)に一度、エージェントを動かさず
     * 中身を「なぞって」設計図を送信する(裏側トレース)。
     * その後、チャットコマンドが実行されたら実際にエージェントを動かす。
     * これにより生徒はこのブロック 1 つだけ使えばよい(送信用ブロックは不要)。
     *
     * @param command チャットコマンド 例: "go"
     * @param handler 実行するエージェント操作
     */
    //% block="チャットコマンド %command を実行したとき"
    //% blockId=agentOnChatCommand
    //% weight=100
    export function onChatCommand(command: string, handler: () => void): void {
        // 起動時: 動かさずに設計図を送信
        runProgram(command, handler, false);
        // コマンド実行時: 実際にエージェントを動かす
        player.onChat(command, function () {
            runProgram(command, handler, true);
        });
    }

    /**
     * エージェントを指定した方向へブロック分だけ移動させる
     * @param direction 動かす方向
     * @param blocks 移動するブロック数
     */
    //% block="エージェントを %direction に %blocks ブロック移動させる"
    //% blocks.defl=1
    //% weight=90
    export function move(direction: AgentDir, blocks: number = 1): void {
        if (executing) agent.move(dirToSix(direction), blocks);
        const cmd = new Command("move");
        cmd.direction = dirToString(direction);
        cmd.blocks = blocks;
        record(cmd);
    }

    /**
     * エージェントの向きを左右に変える
     * @param direction 向きを変える方向
     */
    //% block="エージェントの向きを %direction にかえる"
    //% weight=85
    export function turn(direction: AgentTurn): void {
        if (executing) agent.turn(direction == AgentTurn.Right ? TurnDirection.Right : TurnDirection.Left);
        const cmd = new Command("turn");
        cmd.direction = turnToString(direction);
        record(cmd);
    }

    /**
     * 中の操作を指定回数くりかえす
     * @param times くりかえす回数
     * @param handler くりかえす操作
     */
    //% block="くりかえし %times 回"
    //% blockId=agentRepeat
    //% times.defl=4
    //% handlerStatement=true
    //% weight=80
    export function repeatTimes(times: number, handler: () => void): void {
        // 記録していない(外側ループの 2 回目以降など)ときは実行のみ
        if (!recording) {
            if (executing) for (let i = 0; i < times; i++) handler();
            return;
        }

        const node = new Command("repeat");
        node.times = times;
        currentContainer().push(node);

        // 構造は 1 回だけ記録する
        containerStack.push(node.children);
        handler();
        containerStack.pop();

        // 実行する場合のみ、残り回数ぶんエージェントを動かす(記録はしない)
        if (executing) {
            for (let i = 1; i < times; i++) {
                recording = false;
                handler();
                recording = true;
            }
        }
    }

    /**
     * エージェントの持ち物スロットに、選んだブロックを指定個数セットする。
     * @param item セットするブロック/アイテム
     * @param count 個数
     * @param slot スロット番号(1 から)
     */
    //% block="エージェントに %item を %count コ スロット %slot 番に設定させる"
    //% item.shadow=minecraftBlock
    //% count.defl=1 slot.defl=1
    //% blockId=agentSetItem
    //% weight=75
    export function setAgentItem(item: number, count: number, slot: number): void {
        if (executing) agent.setItem(item, count, slot);
        const cmd = new Command("setItem");
        cmd.item = item;
        cmd.count = count;
        cmd.slot = slot;
        record(cmd);
    }

    /**
     * エージェントが、選択中スロットのブロックを指定方向に置く。
     * @param direction 置く方向
     */
    //% block="エージェントに %direction へ置かせる"
    //% blockId=agentPlace
    //% weight=70
    export function placeBlock(direction: AgentDir): void {
        if (executing) agent.place(dirToSix(direction));
        const cmd = new Command("place");
        cmd.direction = dirToString(direction);
        record(cmd);
    }
}
