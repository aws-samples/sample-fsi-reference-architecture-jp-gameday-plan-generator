#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { GameDayStack } from '../lib/gameday-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new GameDayStack(app, 'GameDayPlanGenerator', {
  env,
  description: 'GameDay Plan Generator - Public-facing web app with Bedrock integration',
});

// Lambda@Edge のクロスリージョンサポートスタック (us-east-1) に対する cdk-nag サプレス。
// サポートスタックはメインスタックと別ツリーで検証されるため、App ルートに記録する。
app.node.addMetadata(cdk.Validations.ACKNOWLEDGED_RULES_METADATA_KEY, {
  'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]':
    'CDK が生成する Lambda@Edge 実行ロールの CloudWatch Logs 書き込み用マネージドポリシー。ログ出力のみの標準権限',
});

// cdk-nag: AWS Solutions ルールで synth 時に静的検査する
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
