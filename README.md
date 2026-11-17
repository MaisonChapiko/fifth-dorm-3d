# 第五寮｜Rスイート浴室 実寸3Dビューア

添付の Stage2c_suites v1.1 に基づく、Rスイート浴室専用の静的Webアプリです。HTML・CSS・JavaScript・JSONで構成し、外部ライブラリ、CDN、バックエンド、閲覧者のChatGPT・Claudeアカウントは不要です。端末側でWebGLが使えるブラウザが必要です。

## GitHub Pagesに置く

1. ZIPを展開します。公開元フォルダの直下に `index.html` がくるよう、展開したファイルと `data/` をまとめてリポジトリに置きます。ルート公開なら、`.nojekyll` もルートへ入れます。
2. リポジトリで **Settings → Pages** を開き、**Build and deployment** の **Source** を **Deploy from a branch** にします。
3. ファイルを置いたブランチ（例 `main`）と **/(root)** を選んで **Save**。ルートの代わりに `docs/` に全体を置いた場合は **/docs** を選びます。
4. 公開処理が完了したら同じ画面の **Visit site** からURLを開きます。プロジェクトサイトのURL例は `https://USERNAME.github.io/REPOSITORY/` です。そのURLをiPhoneのSafariで開きます。サイトと一緒に浴室データJSONも配信されます。

[GitHub Docsの公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

PCでローカル確認する場合は、展開先で `python3 -m http.server 8000` を実行し、`http://localhost:8000/` を開きます。

## iPhoneでの操作

| 操作 | 動き |
|---|---|
| 3D領域を1本指でドラッグ | 俯瞰は浴室を回転、室内は定点から見回す |
| 3D領域で2本指を開く・閉じる | 拡大・縮小。画面右下の「＋」「−」でも操作可能 |
| 俯瞰・平面・室内 | 斜め上からの全体、真上で北を上に固定した平面、室内の高さからの表示を切替 |
| リセット | 初期の俯瞰・倍率・壁断面へ戻す |
| 壁 | 断面（0.85mで表示を切る）、全高、非表示 |
| 設備・名称・クリアランス | 個別に表示を切替。青緑の床面は正本で指定されたクリアランス |
| 対象をタップ／寸法・座標の一覧から選ぶ | 室・壁・開口・設備の数値を下の欄で確認 |

寸法欄へ移動するときは、3D領域の外でページをスクロールします。黄土色の床面は扉開口の位置と幅を示します。**扉2か所の高さ2.10mは、3D表示用の暫定値です。**

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html`、`styles.css` | 画面とレスポンシブ表示 |
| `viewer.js`、`render.js` | 操作・検査パネル・WebGL描画 |
| `model.js` | 壁芯矩形、壁、開口、設備からの3D形状計算 |
| `data/r-bath.json` | 元JSONから浴室の該当レコードを抽出したものと、独立した表示設定 |
| `VERIFICATION.md` | 数値照合、仮設定・未確定事項、動作確認の範囲 |

他室を追加する場合は部屋ごとにJSONを用意し、`viewer.js` で読込先、表示名、注記、初期カメラ、対象室固有の表示を設定します。形状計算と描画は再利用できます。窓のある室は窓ごとの上端と下端、扉は高さを確認してからデータを用意します。
