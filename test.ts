/**
 * ローカル検証用テスト。
 *
 * `npx --yes --package makecode mkc build -j` でコンパイルが通ることを確認する。
 * 実機/シミュレータで実行し、チャットに "go" と入力すると:
 *   - エージェントが実際に動く
 *   - 実行したプログラムが JSON でチャットに出力される
 */

// チャットコマンド "go" を実行したとき:
//   エージェントを まえ に 3 ブロック移動させる
//   エージェントの向きを みぎ にかえる
//   くりかえし 4 回:
//     エージェントを まえ に 2 ブロック移動させる
//     エージェントの向きを みぎ にかえる
agentControl.onChatCommand("go", function () {
    agentControl.move(AgentDir.Forward, 3);
    agentControl.turn(AgentTurn.Right);
    agentControl.repeatTimes(4, function () {
        agentControl.move(AgentDir.Forward, 2);
        agentControl.turn(AgentTurn.Right);
    });
});
