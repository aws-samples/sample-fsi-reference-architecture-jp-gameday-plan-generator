# GameDay Plan Generator — アーキテクチャ

このドキュメントは GameDay Plan Generator の **構成** と **内部処理フロー** を 1 か所にまとめたものです。

- 「これ何？どう使う？」 → ルート [`README.md`](../README.md)
- 「なぜこの構成？どう繋がってる？」 → このドキュメント
- 「デプロイ手順は？」 → [`infra/README.md`](../infra/README.md)

---

## 1. 全体像

GameDay Plan Generator は、**CloudFormation テンプレート** または **構成図画像** から、AWS GameDay（障害対応訓練）の実施計画を自動生成する Web アプリケーションです。

主要な役割:
- 構成解析 (CFn JSON/YAML パース、画像 → CFn 変換)
- 障害シナリオの提案（ルールベース + LLM 強化）
- 計画策定（タイムライン、役割分担、容量制約適用）
- AWS FIS 実験テンプレート生成（CFn 形式）
- 観測ポイント・評価基準の自動生成
- ダッシュボード HTML 出力 + 対話型編集

---

## 2. インフラ構成（本番デプロイ）

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓ HTTPS
┌─────────────────────────────────────────────────────────────────┐
│  CloudFront Distribution                                        │
│  • Cognito 認証 (Lambda@Edge viewer-request,                    │
│    awslabs/cognito-at-edge) → 未認証は Hosted UI へリダイレクト │
│  • 設定は SSM Parameter Store から実行時取得                    │
│  • CACHING_DISABLED / ALL_VIEWER policy                         │
│  • SECURITY_HEADERS                                             │
└──────────────────────────┬──────────────────────────────────────┘
        ↑ 認証                                                     
   Cognito User Pool (Hosted UI / セルフサインアップ無効)          
                           ↓ VPC Origin (HTTP 60s readTimeout)
┌─────────────────────────────────────────────────────────────────┐
│  VPC (2 AZ, 1 NAT)                                              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ALB (internal)                                          │    │
│  │ • idle_timeout: 300s                                    │    │
│  │ • SG: VPC CIDR + CloudFront-VPCOrigins-Service-SG 許可  │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           ↓ HTTP / health: /health              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ECS Fargate Service (desiredCount=1, 1vCPU/2GB)         │    │
│  │ • Node.js 20 + Express + tsx                            │    │
│  │ • 並行アクセスを許容するため EventEmitter で SSE 配信   │    │
│  │ • circuitBreaker: rollback 有効                         │    │
│  └─────┬──────────────┬─────────────┬─────────────┬────────┘    │
└────────┼──────────────┼─────────────┼─────────────┼─────────────┘
         ↓              ↓             ↓             ↓
   DynamoDB        S3 Bucket    Bedrock         CloudWatch
   SessionTable    OutputBucket Claude Opus     Logs (1週間)
   • PAY_PER_REQ.  • lifecycle  4.6 / 4.7/4.8   ContainerInsightsV2
   • TTL: 7日      • 7日で削除  • Cross-region
   • SSE有効       • SSE有効    inference profile
```

### 主要設計判断

| 領域 | 判断 | 理由 |
|---|---|---|
| **VPC Origin** | CloudFront → 内部 ALB | パブリック ALB を持たない (公開面を CloudFront に集約)。認証＋セキュリティヘッダを CloudFront で完結させたい |
| **Cognito 認証** | Lambda@Edge + [awslabs/cognito-at-edge](https://github.com/awslabs/cognito-at-edge) | CloudFront + 内部 ALB 構成での標準的な認証パターン。User Pool はセルフサインアップ無効とし、管理者がユーザーを追加する。ALB の authenticate-cognito は内部 ALB に HTTPS リスナー（証明書・ドメイン）が必要になるため不採用 |
| **認証設定の受け渡し** | SSM Parameter Store | Lambda@Edge は環境変数不可。User Pool ID / Client ID / ドメインを SSM に格納し、コールドスタート時に取得・キャッシュ（TTL 5分） |
| **idle_timeout 300s** | ALB | Bedrock 呼び出し（特に大きい構成図解析）が長い |
| **CloudFront readTimeout 60s** | 上限なので守る | 60s 超は **非同期ジョブ + SSE** で逃がしている (`/jobs/:jobId/stream`) |
| **SessionTable TTL 7日** | DynamoDB | 展示後も数日は履歴が見えるように。同期して S3 lifecycle も 7日 |
| **JobStore** | プロセスメモリ (EventEmitter) | 単一タスク前提。スケールアウトする時は要再設計 |
| **Bedrock IAM** | Claude Opus 4.x をワイルドカード許可 | UI でモデル切替ができるようにするため。固定すると AccessDenied で AI レポートが静かに空になる |

---

## 3. データの流れ（リクエスト〜ダッシュボード表示まで）

```
[ユーザー]
    │
    │ ① CFn JSON/YAML or 構成図 PNG/JPG をアップロード
    ▼
┌────────────────────────────┐
│ POST /generate             │
│ • multer で uploads/ に保存 │
│ • createJob() で jobId 発行 │
│ • 即座にレスポンス返す      │
│ • バックグラウンドで実行    │
└────────────────────────────┘
    │
    ├──→ クライアントは /jobs/:jobId/stream (SSE) を購読
    │     進捗を 0% → 100% で表示
    │
    ▼
┌──── processGenerateJob (バックグラウンド) ──────────────────────┐
│ Step 1: ファイル読み込み                            (~5%)        │
│   • 画像なら convertImageToCfn (Bedrock Vision)    (~15%)        │
│ Step 2: parse(cfnContent) → InfraConfig            (~30%)        │
│   src/parser/cfn-parser.ts                                       │
│ Step 3: generateScenarios(config) → FailureScenario[]            │
│   • カテゴリ別 (infra/network/data/security/operation)           │
│   • Enricher (multi-region, pqc)                                 │
│   • annotateExecutability で FIS 対応可否を自動判定              │
│ Step 4: LLM 強化 (並列, Promise.allSettled)         (~55%)       │
│   • generateLLMScenarios — 追加シナリオ + executability         │
│   • generateAdvice — AI 分析レポート                             │
│ Step 4.5: generateRationales — 各シナリオの理由付与 (~68%)      │
│ Step 5: buildArtifacts                              (~75%)       │
│   • generatePlan (重大度ソート + partitionByCapacity)           │
│   • buildFIS / buildFISCfn                                       │
│   • generateObservationPoints (CloudWatch メトリクス)            │
│   • generateEvaluationCriteria (4 軸)                            │
│   • generateDashboard (HTML)                                     │
│ Step 6: saveSession → DynamoDB                      (~90%)       │
│ Step 7: 出力ファイル書き出し → S3                   (~95%)       │
│   • gameday-plan.md / dashboard.html / scenarios.json            │
│   • fis-templates/*.json / fis-cfn/*.cfn.json                    │
│   • observation-cfn.json                                         │
│ completeJob(jobId, sessionId)                       (100%)       │
└──────────────────────────────────────────────────────────────────┘
    │
    │ ② SSE で completed イベント受信
    │   → クライアントが /dashboard/:sessionId へ遷移
    ▼
┌────────────────────────────┐
│ GET /dashboard/:sessionId  │
│ • DynamoDB から Session 取得│
│ • FIS テンプレを毎回再生成   │
│ • generateDashboard(...)    │
│ • HTML 返却                 │
└────────────────────────────┘
    │
    ▼
[ダッシュボード表示]
    │
    ├─ チャットで「半日にして」「ネットワーク系を外して」
    │   POST /chat/:sessionId
    │   • processChatMessage (Bedrock) でアクション抽出
    │   • applyActions でセッション更新
    │   • S3 出力ファイルも再生成
    │   • チャット履歴に追加
    │
    └─ 「📥 ZIP ダウンロード」
        GET /download/:sessionId
        • S3 からファイルを取得して archiver で zip 化
```

### キーポイント: ダッシュボードはオンザフライ生成

`/dashboard/:sessionId` は保存済み HTML を配信するのではなく、**毎回 `generateDashboard()` を呼んで HTML を再生成**しています。これにより:

- フロントエンドの修正（CSS/JS バグ、UI 改善）は **過去のセッションにも自動的に反映される**
- セッションデータ（DynamoDB）に持たせていないフィールド（例: `unscheduledScenarioIds`）は古いセッションでは defensive にスキップ

---

## 4. ソースコード構造

```
src/
├── cli.ts               # CLI エントリポイント (generate / demo コマンド)
├── parser/              # CloudFormation パーサー
│   └── cfn-parser.ts    # JSON/YAML → InfraConfig
├── scenario/            # シナリオ生成
│   ├── index.ts         # generateScenarios + annotateExecutability
│   ├── categories/      # カテゴリ別ジェネレータ
│   │   ├── infrastructure.ts
│   │   ├── network.ts
│   │   ├── data.ts
│   │   ├── security.ts
│   │   └── operation.ts
│   └── enrichers/       # 横断的な追加ロジック
│       ├── multi-region.ts
│       └── pqc.ts
├── plan/                # 実施計画策定
│   ├── index.ts         # generate (容量制約適用) / toMarkdown
│   ├── timeline.ts      # buildTimeline / partitionByCapacity / rationales
│   └── roles.ts         # 役割分担計算
├── fis/                 # AWS FIS 実験テンプレート
│   ├── index.ts         # build (Result 型で成否を返す)
│   ├── actions.ts       # FIS アクション辞書 + UNSUPPORTED_RESOURCES
│   ├── cfn-builder.ts   # FIS API → CloudFormation 変換
│   └── validator.ts     # FIS API スキーマ検証
├── observation/         # CloudWatch 観測ポイント生成
├── evaluation/          # 評価基準生成 (4 軸)
├── llm/                 # Bedrock 連携
│   ├── bedrock-client.ts       # Converse API ラッパー (モデル切替)
│   ├── scenario-enhancer.ts    # シナリオ追加 / アドバイス / rationale
│   └── chat-editor.ts          # ダッシュボードチャット用
├── dashboard/
│   ├── index.ts         # generate (~1100行のHTMLビルダー)
│   └── markdown.ts      # GFM → HTML
├── web/
│   ├── server.ts        # Express ルーティング
│   ├── pages/           # アップロード/履歴/エラー画面
│   ├── job-store.ts     # 非同期ジョブ管理 (EventEmitter)
│   ├── session-store*.ts        # DynamoDB / Memory バックエンド
│   ├── output-store*.ts         # S3 / FS バックエンド
│   └── image-converter.ts       # Bedrock Vision で画像 → CFn
├── demo/                # サンプル CFn を使ったデモモード
└── types/index.ts       # 全型定義 + Zod スキーマ
```

### 主要型 (`src/types/index.ts` 抜粋)

```ts
InfraConfig         // CFn パース結果（リソース、依存関係、メタデータ）
FailureScenario     // 障害シナリオ
                    // - executability: fis-supported | fis-alternative | reference-only
                    // - alternativeApproach (FIS 不可シナリオ用)
GameDayPlan         // 計画
                    // - unscheduledScenarioIds (容量超過で押し出されたシナリオ)
                    // - availableExecutionMinutes
ObservationPoint    // CloudWatch メトリクス/アラーム/ログフィルタ
EvaluationCriteria  // 4 軸の評価基準
FISExperimentTemplate  // FIS API 形式
DashboardData       // ダッシュボード入力一式
```

---

## 5. 実施可能性 (executability) の判定

シナリオごとに「実環境で再現できるか」を 3 段階で判定:

| 値 | 意味 | バッジ | 例 |
|---|---|---|---|
| `fis-supported` | AWS FIS でそのまま実施 | 🚀 FIS（一覧）| EC2 停止、RDS フェイルオーバー、ネットワーク遅延注入 |
| `fis-alternative` | FIS 直接対応なし、代替手段で実施可 | 🛠 代替手段 | S3 アクセス拒否、SQS パージ、SNS トピック停止 |
| `reference-only` | 実環境再現が現実的に困難 | 📚 参考 | ランサムウェア感染、災害、特定地域全停止 |

**判定経路:**

1. **ルールベース** — `src/scenario/index.ts` の `annotateExecutability()` が、シナリオの `affectedResources[0]` のリソース型を見て:
   - `isFISSupported(type)` → `fis-supported`
   - `getUnsupportedInfo(type)` で代替手段が見つかる → `fis-alternative` + `UNSUPPORTED_RESOURCES` の代替手段を `alternativeApproach` に流用
   - どちらでもない → 未指定 (デフォルト fis-supported 扱い)

2. **LLM** — `src/llm/scenario-enhancer.ts` のプロンプトで明示的に判定させる:
   - 完全再現困難系（ランサムウェア、災害、悪意のある内部脅威）→ `reference-only`
   - SSM Run Command などで代替できる → `fis-alternative` + 具体手段
   - その他 → `fis-supported`

ダッシュボード側 (`renderScenarios`) はこの値を使ってバッジ・専用ブロック表示を切り替えます。

---

## 6. 容量制約 (時間枠超過処理)

`PlanOptions.duration` ごとに「シナリオ実行に使える純枠」が決まっています:

| duration | 全体 | 準備 | 振り返り | 純実行枠 |
|---|---|---|---|---|
| half-day | 240分 | 30 | 30 | **180分** |
| full-day | 480分 | 45 | 45 | **390分** |
| two-day | 960分 | 45 | 60 | **855分** |

`partitionByCapacity()` が重大度順にソート済みのシナリオを順番に積み、純枠 + 想定休憩（2時間ごと 15分）を超えたら残りを `unscheduledScenarioIds` に分離します。

ダッシュボード表示:
- ヘッダ: ⚠️ 枠超過チップ
- 計画レポートタブ: 警告ボックス
- シナリオ一覧: 「⏰ 時間枠外」バッジ + 行を最下部に集約
- タイムラインタブ: 末尾に「未スケジュール」`<details>` (4件以上で折りたたみ)
- Markdown: 警告 + 「## 未スケジュールのシナリオ」表

---

## 7. デプロイ運用

### 認証（Cognito）とユーザー管理

`infra/lib/gameday-stack.ts` は Cognito User Pool + Lambda@Edge（awslabs/cognito-at-edge）で認証をかけています。認証情報はコードやデプロイパラメータに含まれず、ユーザーは Cognito 上で管理します。

- User Pool はセルフサインアップ無効。利用者の追加は管理者が行う:
  ```bash
  aws cognito-idp admin-create-user \
    --user-pool-id <UserPoolId 出力値> \
    --username <メールアドレス> \
    --user-attributes Name=email,Value=<メールアドレス> Name=email_verified,Value=true
  ```
- 仮パスワードがメール送信され、初回サインイン時に本パスワードを設定
- ログアウトは `/signout` パスへのアクセス
- Lambda@Edge は us-east-1 に自動デプロイされる（CDK の cross-region support stack）。設定値（User Pool ID 等）はアプリのリージョンの SSM Parameter `/gameday-plan-generator/auth-at-edge/config` から実行時に取得

### CloudShell からの再デプロイ手順例

事前に以下を用意:
- AWSアカウントID（環境変数 `AWS_ACCOUNT_ID` 等）
- 一時アップロード用の S3 バケット（例: `gameday-deploy-tmp-${AWS_ACCOUNT_ID}`）

ローカル側:
```bash
cd /path/to/GameDay\ Generator
tar --exclude=node_modules --exclude=dist --exclude=output \
    --exclude=output-web --exclude=uploads --exclude=.git \
    --exclude=.kiro --exclude=cdk.out --exclude='*.log' \
    --exclude='.DS_Store' --exclude=infra/node_modules \
    --exclude='infra/cdk.context.json' \
    -czf /tmp/gameday-src.tar.gz .
aws s3 cp /tmp/gameday-src.tar.gz \
    s3://gameday-deploy-tmp-${AWS_ACCOUNT_ID}/gameday-src.tar.gz
```

CloudShell 側:
```bash
export CDK_DEFAULT_REGION=us-west-2
export CDK_DEFAULT_ACCOUNT=${AWS_ACCOUNT_ID}

cd ~
aws s3 cp s3://gameday-deploy-tmp-${AWS_ACCOUNT_ID}/gameday-src.tar.gz .
rm -rf gameday && mkdir gameday && cd gameday
tar -xzf ~/gameday-src.tar.gz
npm install
cd infra && npm install
npx cdk deploy --all --require-approval never
```

### コスト目安（月額）

- ECS Fargate 1 タスク (1vCPU / 2GB) 常時: ~$30
- ALB: ~$20
- CloudFront: 低トラフィックなら ~$1
- DynamoDB: PAY_PER_REQUEST、ほぼ無料
- S3: 7日 lifecycle、ほぼ無料
- Bedrock: Claude Opus 4.x（入力 $15/M, 出力 $75/M トークン）

短期デモ用途であれば、Bedrock 呼び出しが支配的なコスト要因になります。

---

## 8. 既知の制約・将来検討

| 項目 | 現状 | 将来検討 |
|---|---|---|
| ジョブストア | プロセスメモリ (EventEmitter) | スケールアウト時は SQS / Step Functions |
| 認証 | Cognito User Pool + Lambda@Edge (cognito-at-edge) | MFA 有効化 / 外部 IdP (SAML・OIDC) フェデレーション |
| 本番ワンクリック Deploy | コンソールディープリンクのみ | STS AssumeRole + External ID + multi-tenant 設計が必要 |
| 計画 diff | 過去計画一覧で個別確認のみ | 2 つの計画を選んで差分表示 |

---

## 9. 関連ドキュメント

- ルート [`README.md`](../README.md) — 機能概要・利用方法
- [`infra/README.md`](../infra/README.md) — デプロイ手順・コスト
