# キャラクター仕様: Dr. Meera (博士ミーアキャット)

このファイルは脚本生成と動画生成プロンプトの両方で読み込まれる single source of truth。
キャラの一貫性はこの文書で担保する。書き換えるとキャラが変わるので慎重に。

## アイデンティティ

- 名前: ドクター・ミーア / 英: Dr. Meera
- 種: ミーアキャット (Suricata suricatta) を擬人化
- 専門: 働き方・生産性に関する社会科学の研究紹介

## 外見（プロンプト固定句）

```
A friendly anthropomorphic meerkat scientist standing upright on hind legs,
wearing a slightly oversized white lab coat, round gold-rimmed glasses,
holding a small clipboard or rolled paper. Sandy-tan fur with the
characteristic dark eye-mask of a meerkat. Round black curious eyes,
expressive eyebrows, small pink nose, gentle smile. Pixar / Disney style
3D render, soft rim lighting, shallow depth of field, photorealistic
everyday backgrounds (modern office, bedroom, coffee shop, commuter train).
```

この英文ブロックを毎回先頭に貼り付けることで Sora 2 Pro のキャラ揺れを抑える。

## ポーズ・演技

- 二足直立がデフォルト。前足（手）でジェスチャー、指差し、書類を掲げる
- 興奮シーン: 目を見開き、口を小さく開けて「！」となるリアクション
- 説明シーン: クリップボードや小さなホワイトボードを使って数字を見せる

## 仲間キャラ（任意）

- 聞き手役: メガネなし・白衣なしの普通のミーアキャット (1〜2匹)
- 相づち、驚き、共感のリアクション担当
- 群れシーン（複数体）にすると画面に動きが出る

## 声・口調

- 日本語ネイティブ、知的だが親しみのあるトーン、軽く驚きを含む
- 「ねぇ知ってた？」「衝撃の研究があるんだ！」「明日から試せるよ」
- 専門用語は必ず一拍置いて噛み砕く
- TTSは固定の日本語ボイスを1つ選んで使い回す（運用ノートで管理）

## NG リスト

- 怖い表情・歯を剥き出す
- ミーアキャットを四足獣として描く（必ず立たせる）
- 暗すぎる照明、ホラー演出
- 実在ブランド・ロゴ・実在人物
- 医療行為・投薬の演出
- 子供向けに見える過度なデフォルメ（落ち着いた知的さを残す）

## キャラ参照画像セット

`cxo character init` で以下5枚を生成し `data/character/` に保存。動画プロンプトに添付できないモデルでも、目視確認用に使う。

1. `front.png` 正面・微笑み・指差し
2. `side.png` 横顔・クリップボードを見ている
3. `surprise.png` 驚き顔・「！」リアクション
4. `explain.png` ホワイトボードで数字を指している
5. `with_friends.png` 仲間ミーアキャット2匹と並ぶ
