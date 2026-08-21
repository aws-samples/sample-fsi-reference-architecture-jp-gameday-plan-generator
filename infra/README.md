# GameDay Plan Generator - CDK Infra

CloudFront (Cognito 認証) + Internal ALB (VPC Origin) + ECS Fargate + DynamoDB + S3 構成の AWS デプロイ。

> 全体アーキテクチャと内部処理フローは [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) を参照。

## アーキテクチャ概要

```
Internet
  ↓ HTTPS + Cognito認証 (Lambda@Edge, awslabs/cognito-at-edge)
CloudFront Distribution ←─ 未認証は Cognito Hosted UI へリダイレクト
  ↓ VPC Origin (HTTP)
Internal ALB
  ↓ HTTP / health: /health
ECS Fargate (Node.js + Bedrock連携)
  ├→ DynamoDB  (SessionTable, TTL 7日)
  ├→ S3        (OutputBucket, lifecycle 7日)
  └→ Bedrock   (Claude Opus 4.x, us.cross-region inference profile)
```

認証まわりの構成:

- **Cognito User Pool** — セルフサインアップ無効。利用者は管理者が追加する
- **Lambda@Edge (viewer-request)** — [awslabs/cognito-at-edge](https://github.com/awslabs/cognito-at-edge) で JWT クッキーを検証し、未認証リクエストを Cognito Hosted UI へリダイレクト
- **SSM Parameter Store** — Lambda@Edge が実行時に読む設定（User Pool ID など）を格納。Lambda@Edge は環境変数を使えないための措置
- `/signout` にアクセスするとログアウト

## 前提

- AWS CLI 設定済み
- Node.js 20+
- Docker（イメージビルド用）
- AWS アカウントで Bedrock Claude Opus 4.x が有効化済み
- CDK bootstrap 実施済み（初回のみ）: `npx cdk bootstrap`

## デプロイ

```bash
cd infra
npm install
npm run synth   # 合成確認
npm run deploy  # デプロイ（Lambda@Edge 用スタックが us-east-1 に併せて作成されます）
```

デプロイ完了後、`CloudFrontUrl` が出力されます。初回アクセス前に、Cognito にユーザーを追加してください（出力 `CreateUserCommand` にコマンド例が表示されます）:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId 出力値> \
  --username <メールアドレス> \
  --user-attributes Name=email,Value=<メールアドレス> Name=email_verified,Value=true
```

ユーザーには仮パスワードがメール送信され、初回サインイン時に本パスワードを設定します。`CloudFrontUrl` にアクセスすると Cognito Hosted UI のサインイン画面へリダイレクトされます。

## 破棄

```bash
npm run destroy
```

## 環境変数（コンテナ側）

CDK が自動で設定:
- `SESSION_STORE=dynamodb`
- `SESSION_TABLE_NAME=<動的>`
- `OUTPUT_STORE=s3`
- `OUTPUT_BUCKET_NAME=<動的>`
- `BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-6-v1`（デフォルト。Web UIでは 4.6 / 4.7 / 4.8 を選択可）

## コスト目安（月額）

- ECS Fargate 1 タスク（1vCPU, 2GB）常時稼働: ~$30
- ALB: ~$20
- CloudFront: アクセス量次第だが低トラフィックなら ~$1
- DynamoDB: オンデマンド（ほぼ無料）
- S3: lifecycle 7日で削除、ほぼ無料
- Cognito / Lambda@Edge: 少人数利用なら実質無料
- Bedrock: Claude Opus 4.x（入力 $15/M tokens、出力 $75/M tokens）

短期デモ用途であれば、Bedrock 呼び出しが支配的なコスト要因になります。

## カスタマイズポイント

- 短期間のみ稼働したい → `desiredCount: 0` にしておき、利用時に CLI で起動
- 認証強化 → CloudFront に WAF を追加 / Cognito の MFA 有効化
- ログ永続化 → LogGroup の retention を ONE_MONTH など
