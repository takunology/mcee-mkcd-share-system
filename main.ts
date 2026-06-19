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
        type: string;        // "move" | "turn" | "repeat"
        direction: string;   // move / turn 用
        blocks: number;      // move 用
        times: number;       // repeat 用
        children: Command[]; // repeat 用
        constructor(type: string) {
            this.type = type;
            this.direction = "";
            this.blocks = 0;
            this.times = 0;
            this.children = [];
        }
    }

    let program: Command[] = [];
    let containerStack: Command[][] = [];
    let recording = false;
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
     * 記録した JSON をチャットへ分割出力する(可視出力 MVP)
     */
    function emit(): void {
        const json = serializeProgram();
        const chunkSize = 200;
        const total = Math.ceil(json.length / chunkSize);
        player.say("PZL_BEGIN total=" + total);
        for (let i = 0; i < total; i++) {
            const part = json.substr(i * chunkSize, chunkSize);
            player.say("PZL " + (i + 1) + "/" + total + " " + part);
        }
        player.say("PZL_END");
    }

    /**
     * チャットコマンドを実行したときに、中のエージェント操作を実行する。
     * 実行後、行ったプログラムを JSON でチャットに出力する。
     * @param command チャットコマンド 例: "go"
     * @param handler 実行するエージェント操作
     */
    //% block="チャットコマンド %command を実行したとき"
    //% blockId=agentOnChatCommand
    //% weight=100
    export function onChatCommand(command: string, handler: () => void): void {
        player.onChat(command, function () {
            // プログラム開始: バッファをリセットして記録を有効化
            program = [];
            containerStack = [program];
            currentCommand = command;
            recording = true;

            handler();

            // プログラム終了: 記録を止めて JSON 出力
            recording = false;
            emit();
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
        agent.move(dirToSix(direction), blocks);
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
        agent.turn(direction == AgentTurn.Right ? TurnDirection.Right : TurnDirection.Left);
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
            for (let i = 0; i < times; i++) handler();
            return;
        }

        const node = new Command("repeat");
        node.times = times;
        currentContainer().push(node);

        for (let i = 0; i < times; i++) {
            if (i == 0) {
                // 最初の 1 回だけ構造を記録する
                containerStack.push(node.children);
                handler();
                containerStack.pop();
            } else {
                // 2 回目以降はエージェントを動かすが記録しない
                recording = false;
                handler();
                recording = true;
            }
        }
    }
}
