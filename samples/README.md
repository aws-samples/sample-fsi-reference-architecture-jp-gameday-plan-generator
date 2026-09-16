# サンプル入力ファイル

GameDay Plan Generator の動作確認・ハンズオン用のサンプル入力です。Web GUI にアップロードするか、CLI の入力として使用できます。

## CloudFormation テンプレート

| ファイル | 構成 |
|---|---|
| [`simple-web-template.json`](./simple-web-template.json) | 3層Webアプリケーション（ALB + EC2×2 + RDS MySQL Multi-AZ + S3）。`web-3tier-architecture.png` と同じ構成 |

```bash
# CLI での使用例
npx tsx src/cli.ts generate samples/simple-web-template.json
```

## 構成図（画像アップロード用）

構成図の解析には Amazon Bedrock へのアクセスが必要です（README「動作要件」参照）。

| ファイル | 構成 |
|---|---|
| [`web-3tier-architecture.png`](./web-3tier-architecture.png) | 3層Webアプリケーション（ALB + EC2×2 + RDS Multi-AZ + S3） |
| [`serverless-api-architecture.png`](./serverless-api-architecture.png) | サーバーレスAPI（API Gateway + Lambda×2 + DynamoDB + SQS） |
| [`multi-region-dr-architecture.png`](./multi-region-dr-architecture.png) | マルチリージョンDR構成（Route 53 + 東京/大阪 + Aurora Global Database） |
