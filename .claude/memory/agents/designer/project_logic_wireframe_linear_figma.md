# Logic ワイヤフレーム Figma — Linear 路線（ダークテーマ）

2026-05-27 制作。高忠実度モバイルワイヤフレームを Figma に作り込んだ案件の1つ（3路線中の Linear 担当）。

## ファイル / ページ
- file key: Lw5xVErPxc4FR0fjP1NfB3
- ページ「② Linear 路線」id=1:2
- 見た目の正解 HTML: https://keitaurano-del.github.io/logic/wireframes/linear.html
- 他に Notion 路線 / Stripe 路線ページが同ファイルに存在（別担当）

## 作ったもの
- Design System frame（id 3:2, x=120）: カラースウォッチ17色（hexラベル付）+ タイプスケール + コンポーネント見本
- モバイル9画面（各390px幅, y=120, x間隔48px）: 01 Home / 02 Lessons / 03 Lesson Reading / 04 Fermi / 05 Journal / 06 Ranking / 07 Profile / 08 Custom Course / 09 Premium
- 各フレーム上に画面名ラベル（y=88, ink-2グレー）

## Linear トークン（ダーク）
canvas #010102 / surface #0c0d0e / surface-2 #18191a / surface-3 #1f2123 / featパネル #141516。
ink #f7f8f8 / ink-2 #d0d6e0 / ink-3 #8a8f98。hairline #23252a / strong #34343a。
アクセントはラベンダー青 #5e6ad2 の1色だけ（CTA・進捗・アクティブ・focus）。brand-ink #aeb6ff / brand-soft #1b2036。
good #6fcf86(bg#0f1611) / bad #e08a9a(bg#1a1012) / gold #d9b85a(pill bg#2a2410) / done緑 #27a644 / check #8fe6a4。
角丸: ボタン8 / カード12 / 画像16。影ゼロ（面の重ね+ヘアラインで階層）。見出しは weight600 letter-spacing -0.8px、本文16px行間1.7-1.75。

## use_figma で効いた実装パターン（再利用可）
- 毎回冒頭: `const p=await figma.getNodeByIdAsync("1:2"); await figma.setCurrentPageAsync(p);`
- フォントは Inter の Regular/Medium/Semi Bold/Bold を loadFontAsync（"Semi Bold" スペース有）
- 色は0-1。hex→rgb ヘルパを各スクリプト冒頭で再定義（スクリプト間で状態は持ち越せない）
- auto-layout: `frame()` ヘルパで layoutMode/padding/fill/radius/stroke をまとめて設定
- FILL は必ず「親に append してから」`child.layoutSizingHorizontal="FILL"`。append前に呼ぶと InputValidationError
- スペーサは layoutGrow=1 の空フレーム
- 進捗バー/コールアウト左ボーダーは createRectangle を子に入れて layoutSizingVertical="FILL"
- NG: `removeChild`（存在しない）/ `layoutSizingHorizontal=undefined`（バリデーション落ち）。エラーでトランザクションごとロールバックされる（partial nodeは残らない）
- 1スクリプト≒1画面で刻み、毎回 get_screenshot で検証。screenshot は URL を curl→Read で目視

## 学び
- ダーク背景なので絵文字(🔥🦉🥉)はそのまま置きつつ全体は無彩色寄り。明るいパステルは使わない
- 良い例/悪い例は「暗い面＋色文字」で表現（色面で塗らない）
- スウォッチwrapグリッドは HORIZONTAL+layoutWrap WRAP、counterAxisSizingMode を AUTO にして高さhug
