# GameDay Plan Generator

クラウド環境の構成情報（CloudFormationテンプレート or 構成図）から、GameDay（障害対応訓練）実施計画を自動生成するツール。Amazon Bedrock（Claude Opus 4.x）連携でシナリオを強化します。

> **免責事項**: 本リポジトリはデモンストレーションおよび教育目的のサンプルコードです。本番環境での利用を想定した十分なテスト・セキュリティ強化は行われていません。本番環境へ適用する場合は、利用者自身の責任で追加のセキュリティテストと評価を実施してください。
>
> **Disclaimer**: This is sample code, for non-production usage. You should work with your security and legal teams to meet your organizational security, regulatory and compliance requirements before deployment.

## 機能

- **入力**: CloudFormation JSON/YAML または 構成図（PNG/JPG）
- **出力**:
  - GameDay実施計画（Markdown）
  - AWS FIS実験テンプレート（FIS API形式 JSON + デプロイ可能な CloudFormation 形式）
  - 観測ポイント定義（CloudWatch / CloudFormation JSON）
  - 評価基準定義（検知・復旧・影響把握・コミュニケーションの4軸）
  - HTMLダッシュボード（シナリオ一覧・タイムライン・FIS実験タブ・チャット編集）
  - **AI分析レポート**（構成分析に基づく実施方針コメント）

## 動作要件

- Node.js 20+
- AWS認証情報（Bedrock利用時、`AWS_REGION` も推奨）

## セットアップ

```bash
npm install
```

## 実行方法

用途に応じて3通りの動かし方があります。本番・共有用途は **AWSデプロイ** が基本です。

### 1. AWSデプロイ（本番 / 共有用）

CDKスタック（`infra/`）で CloudFront (Cognito認証) + ALB (VPC Origin) + ECS Fargate + DynamoDB + S3 構成をデプロイします。認証は Amazon Cognito User Pool + Lambda@Edge（[awslabs/cognito-at-edge](https://github.com/awslabs/cognito-at-edge)）で行い、利用者は管理者が Cognito にユーザー登録します（セルフサインアップ無効）。

```bash
cd infra
npm install
npm run deploy
```

デプロイ完了後、Cognito にユーザーを追加し（出力 `CreateUserCommand` にコマンド例）、出力される `CloudFrontUrl` にアクセスしてサインインします。詳細・コスト目安は [`infra/README.md`](./infra/README.md) を参照。

> **利用上の注意**
> - 本アプリはチーム内共同利用を前提としたシングルテナント設計です。**セッション履歴（アップロードした構成情報・生成結果）は全認証ユーザーで共有されます**。異なる組織や機密レベルの利用者を同一デプロイに同居させないでください。
> - Bedrock（Claude Opus）の呼び出しは従量課金です。AWS Budgets 等でのコスト監視の併用を推奨します。

### 2. ローカル Web GUI（開発 / お試し）

```bash
npx tsx src/web/server.ts
# または PORT=3001 npx tsx src/web/server.ts
```

ブラウザで http://localhost:3000 を開き、CFnテンプレートまたは構成図をアップロード。アップロード画面でAIモデル（Claude Opus 4.6 / 4.7 / 4.8）を選択できます。

### 3. CLI（バッチ / 自動化）

```bash
# 生成（AI強化はデフォルトで有効）
npx tsx src/cli.ts generate tests/simple-web-template.json

# AI強化を無効化（ルールベースのみ）
npx tsx src/cli.ts generate tests/simple-web-template.json --no-llm

# オプション: 実施時間・参加者数・AIモデル・出力先
npx tsx src/cli.ts generate template.json \
  --duration full-day \
  --participants 10 \
  --model claude-opus-4-8 \
  --output ./output

# デモモード
npx tsx src/cli.ts demo
```

選択可能なモデル: `claude-opus-4-6`（デフォルト）/ `claude-opus-4-7` / `claude-opus-4-8`

## AI強化（Bedrock連携）

> 上記いずれの実行方法でも共通の補足です。

CLIでは既定で有効（`--no-llm` で無効化）、Web GUI / AWSデプロイ環境ではアップロード画面でモデルを選択します。以下が並列実行されます：

1. **追加シナリオ生成** — ルールベースで拾えないカスケード障害やSPOFを分析して最大5件追加
2. **アドバイス生成** — システム構成の特徴・推奨フォーカス・注意リスクを自然言語で出力
3. **シナリオ別 rationale** — 「なぜこのシナリオが必要か」を各シナリオに付与

使用モデルは Bedrock の Claude Opus 4.x（4.6 / 4.7 / 4.8）から選択。Converse API + cross-region inference profile 経由で呼び出します。デフォルトモデルや model ID は環境変数 `BEDROCK_MODEL_ID` で上書き可能です。

失敗時はルールベース結果にフォールバックするので、Bedrockアクセスがなくても動作します。

## テスト

```bash
npx vitest --run
```

11ファイル・185テスト。FISテンプレート検証はAWS FIS APIスキーマ準拠を厳密にチェック。

## プロジェクト構造

```
src/
├── cli.ts               # CLIエントリポイント
├── parser/              # CloudFormationパーサー
├── scenario/            # シナリオ生成（ルールベース）
│   ├── categories/      # infrastructure/network/data/security/operation
│   └── enrichers/       # multi-region, pqc
├── plan/                # GameDay計画策定
├── fis/                 # FIS実験テンプレートビルダー + バリデーター
├── observation/         # 観測ポイント生成（CloudWatch）
├── evaluation/          # 評価基準生成
├── dashboard/           # HTMLダッシュボード生成
├── llm/                 # Bedrock連携（Claude Opus 4.x）
│   ├── bedrock-client.ts        # Converse APIラッパー（モデル切替）
│   └── scenario-enhancer.ts     # 追加シナリオ / アドバイス / rationale
├── web/                 # Web GUI（Express）
└── demo/                # デモモード
```

## ドキュメント

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — インフラ構成・内部処理フロー・主要設計判断
- [`infra/README.md`](./infra/README.md) — CDK デプロイ手順・コスト目安

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

### 本格活用時のセキュリティ上の考慮点

本サンプルは教育・デモ用途を前提に、コストと導入の容易さを優先した構成を採用している。継続的な業務利用や機密性の高いデータを扱う環境へ適用する場合は、以下の強化を検討すること。

| 項目 | 本サンプルの構成（理由） | 本格活用時の推奨 |
|---|---|---|
| S3 暗号化 | SSE-S3（格納データは 7 日で自動失効する生成物のみのため、鍵管理コストを優先） | SSE-KMS（カスタマーマネージドキー）に変更し、キーポリシーによるアクセス制御・監査を有効化 |
| S3 サーバーアクセスログ | 無効（一時成果物のみ格納のため） | 専用ログバケットを用意し server access logging を有効化 |
| S3 データ削除 | `removalPolicy: DESTROY` + `autoDeleteObjects`（検証環境の後片付けを容易にするため） | `RETAIN` へ変更し、ライフサイクル・バックアップ方針を整備 |

CDK 実装上は `infra/lib/gameday-stack.ts` の `OutputBucket` の `encryption` を `s3.BucketEncryption.KMS` に変更し、`serverAccessLogsBucket` を指定することで対応できる。

### Security considerations for production use

This sample prioritizes low cost and ease of deployment for educational/demo purposes. Before adopting it for sustained business use or environments handling sensitive data, consider the following hardening:

- **S3 encryption**: The output bucket uses SSE-S3 because it only stores generated artifacts that expire after 7 days. For production, switch to SSE-KMS with a customer managed key (`s3.BucketEncryption.KMS`) to gain key-policy-based access control and auditability.
- **S3 server access logging**: Disabled in this sample. For production, enable server access logging with a dedicated log bucket (`serverAccessLogsBucket`).
- **S3 data retention**: The bucket uses `removalPolicy: DESTROY` with `autoDeleteObjects` for easy cleanup. For production, use `RETAIN` and define lifecycle/backup policies.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
