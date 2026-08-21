import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { buildSync } from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lambda@Edge ハンドラ (lambda/auth-at-edge/index.ts) と一致させること
const AUTH_CONFIG_PARAM_NAME = '/gameday-plan-generator/auth-at-edge/config';

export class GameDayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ──
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });
    vpc.addFlowLog('FlowLog');

    // ── DynamoDB（セッション保存） ──
    const sessionTable = new dynamodb.Table(this, 'SessionTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── S3（出力ファイル） ──
    const outputBucket = new s3.Bucket(this, 'OutputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7), id: 'expire-7-day' }],
    });

    // ── Dockerイメージ ──
    const projectRoot = path.resolve(__dirname, '..', '..');
    const image = new ecrAssets.DockerImageAsset(this, 'AppImage', {
      directory: projectRoot,
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // ── ECS Cluster ──
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // ── ログ ──
    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Internal ALB ──
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ALBのアイドルタイムアウト（Bedrock呼び出しが長い、大きい構成図対応）
    alb.setAttribute('idle_timeout.timeout_seconds', '300');

    // ── ALB Listener ──
    // デフォルトアクションは addTargets で設定される（ターゲットグループへのforward）
    const listener = alb.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false, // SGはコード後段で明示的に許可
    });

    // ── Task Definition ──
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'gameday', logGroup }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        SESSION_STORE: 'dynamodb',
        SESSION_TABLE_NAME: sessionTable.tableName,
        JOB_STORE: 'dynamodb',
        OUTPUT_STORE: 's3',
        OUTPUT_BUCKET_NAME: outputBucket.bucketName,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
      },
    });

    // ── Fargate Service ──
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      minHealthyPercent: 100,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ── Target Group ──
    const targetGroup = listener.addTargets('ECS', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // ── IAM: DynamoDB権限 ──
    sessionTable.grantReadWriteData(taskDef.taskRole);

    // ── IAM: S3権限（最小権限で明示付与） ──
    // grantReadWrite はアクションのワイルドカード (s3:GetObject* 等) を含むため、
    // アプリが実際に使う操作だけを付与する
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${outputBucket.bucketArn}/*`],
      }),
    );
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [outputBucket.bucketArn],
      }),
    );

    // ── IAM: Bedrock権限 ──
    // モデル選択 (Opus 4.6 / 4.7 / 4.8) に対応するため、Claude Opus 4系を
    // ワイルドカードで許可する。特定バージョンに固定するとモデル切替時に
    // AccessDeniedExceptionでLLM呼び出しが静かに失敗する（症状: AI分析レポートが空）。
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:Converse', 'bedrock:ConverseStream'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-opus-4-*`,
        ],
      }),
    );

    // ── Cognito User Pool（認証基盤） ──
    // セルフサインアップは無効。利用者は管理者が admin-create-user で追加する。
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Hosted UI 用ドメイン（プレフィックスはアカウント内で衝突しないよう account ID を付与）
    const userPoolDomain = userPool.addDomain('UserPoolDomain', {
      cognitoDomain: { domainPrefix: `gameday-plan-gen-${this.account}` },
    });
    const userPoolDomainFqdn = `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;

    // ── Lambda@Edge: Cognito 認証 (awslabs/cognito-at-edge) ──
    // viewer-request で JWT クッキーを検証し、未認証は Hosted UI へリダイレクトする。
    // 設定値（User Pool ID 等）は SSM Parameter Store から実行時に取得する。
    const authFunction = new cloudfront.experimental.EdgeFunction(this, 'AuthAtEdge', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(bundleAuthAtEdge(this.region)),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      description: 'Cognito authentication at edge for GameDay Plan Generator',
    });
    authFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${AUTH_CONFIG_PARAM_NAME}`,
        ],
      }),
    );

    // ── CloudFront Distribution with VPC Origin ──
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
          // CloudFrontのreadTimeoutは標準で最大60秒。
          // 長時間処理は非同期化(SSE)してジョブ完了通知で対応する。
          readTimeout: cdk.Duration.seconds(60),
          keepaliveTimeout: cdk.Duration.seconds(60),
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        edgeLambdas: [
          {
            functionVersion: authFunction.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
          },
        ],
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      comment: 'GameDay Plan Generator (VPC Origin + Cognito Auth)',
    });

    // ── Cognito App Client ──
    // コールバック先は CloudFront ドメイン（cognito-at-edge は認証後にルートへ戻す）
    const appUrl = `https://${distribution.distributionDomainName}`;
    const userPoolClient = userPool.addClient('AppClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [appUrl],
        logoutUrls: [appUrl],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      // Lambda@Edge 側の cookieExpirationDays (30日) と合わせる
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ── SSM Parameter: Lambda@Edge が実行時に読む認証設定 ──
    // CloudFront ドメイン確定後に値を作るため、循環参照なしで設定を渡せる
    new ssm.StringParameter(this, 'AuthAtEdgeConfig', {
      parameterName: AUTH_CONFIG_PARAM_NAME,
      stringValue: cdk.Stack.of(this).toJsonString({
        region: this.region,
        userPoolId: userPool.userPoolId,
        userPoolAppId: userPoolClient.userPoolClientId,
        userPoolDomain: userPoolDomainFqdn,
        logoutRedirectUri: appUrl,
      }),
      description: 'Runtime configuration for GameDay Plan Generator auth-at-edge Lambda',
    });

    // ── ALB SG: VPC内 + CloudFront VPC Origin SG からのHTTP許可 ──
    // VPC OriginがALBに到達するには、CloudFront-VPCOrigins-Service-SGからの
    // 直接許可が必要（CIDR許可だけだとAWS内部経路でブロックされる場合がある）
    alb.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.HTTP,
      'Allow from within VPC',
    );

    // CloudFront VPC Origins Service SG はDistribution作成後に自動作成される
    // Custom Resource で動的に取得して許可ルールを追加
    const getVpcOriginsSg = new cr.AwsCustomResource(this, 'GetVpcOriginsSG', {
      onCreate: {
        service: 'ec2',
        action: 'describeSecurityGroups',
        parameters: {
          Filters: [
            { Name: 'vpc-id', Values: [vpc.vpcId] },
            { Name: 'group-name', Values: ['CloudFront-VPCOrigins-Service-SG'] },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('CloudFront-VPCOrigins-Service-SG'),
      },
      onUpdate: {
        service: 'ec2',
        action: 'describeSecurityGroups',
        parameters: {
          Filters: [
            { Name: 'vpc-id', Values: [vpc.vpcId] },
            { Name: 'group-name', Values: ['CloudFront-VPCOrigins-Service-SG'] },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('CloudFront-VPCOrigins-Service-SG'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false,
    });
    getVpcOriginsSg.node.addDependency(distribution);

    const vpcOriginsSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'VpcOriginsSg',
      getVpcOriginsSg.getResponseField('SecurityGroups.0.GroupId'),
    );
    alb.connections.allowFrom(
      vpcOriginsSg,
      ec2.Port.HTTP,
      'Allow from CloudFront VPC Origins Service SG',
    );

    // ── 出力 ──
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: appUrl,
      description: '公開URL（Cognito認証あり）',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID（ユーザー追加時に指定）',
    });
    new cdk.CfnOutput(this, 'CreateUserCommand', {
      value:
        `aws cognito-idp admin-create-user --user-pool-id ${userPool.userPoolId} ` +
        `--username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true`,
      description: '利用ユーザーを追加するコマンド例',
    });
    new cdk.CfnOutput(this, 'SessionTableName', {
      value: sessionTable.tableName,
    });
    new cdk.CfnOutput(this, 'OutputBucketName', {
      value: outputBucket.bucketName,
    });

    // ── cdk-nag: 根拠付きの指摘サプレス ──
    // 「リスクを認識した上で、このサンプルの用途では許容する」判断の記録。
    // 各IDは synth 時の cdk-nag レポートの Acknowledge 文字列と一致させる必要がある。
    const nagAcknowledgments: Record<string, string> = {
      // CloudFront
      'AwsSolutions::AwsSolutions-CFR1':
        '地理的制限は不要（グローバルに利用可能なサンプルアプリケーション）',
      'AwsSolutions::AwsSolutions-CFR2':
        'WAF はオプションの強化ポイントとして README に記載。全リクエストは Cognito 認証必須のため、サンプル用途では未導入を許容',
      'AwsSolutions::AwsSolutions-CFR3':
        'アクセスログはサンプル用途では未設定を許容（コスト最小化。必要ならログバケットを追加）',
      'AwsSolutions::AwsSolutions-CFR4':
        'CloudFront デフォルト証明書を使用しており、TLS 最低バージョンの引き上げにはカスタムドメイン+ACM 証明書が必要。サンプルではデフォルトドメインを使用',
      // Cognito
      'AwsSolutions::AwsSolutions-COG2':
        '管理者が作成する少数ユーザーのデモ用途。強力なパスワードポリシー(12文字+複合)を設定済み。MFA は本番運用時の強化ポイントとして README に記載',
      'AwsSolutions::AwsSolutions-COG8':
        'Cognito Plus ティア（脅威保護）はデモ用途ではコスト過剰。セルフサインアップ無効+管理者作成ユーザーのみで攻撃面を限定',
      // DynamoDB / S3 / ELB / ECS / EC2
      'AwsSolutions::AwsSolutions-DDB3':
        'セッションデータは TTL 7日の一時データであり、ポイントインタイムリカバリは不要',
      'AwsSolutions::AwsSolutions-S1':
        '出力バケットは lifecycle 7日の一時成果物のみ格納。サーバーアクセスログは不要',
      'AwsSolutions::AwsSolutions-ELB2':
        '内部 ALB（CloudFront VPC Origin 経由のみ到達可能）。アクセスログはサンプル用途では未設定を許容',
      'AwsSolutions::AwsSolutions-ECS2':
        '環境変数は秘密情報を含まない構成値のみ（テーブル名・バケット名・モデルID等）。秘密情報は使用していない',
      'AwsSolutions::AwsSolutions-EC23':
        'ALB は内部配置で、インバウンド許可は VPC CIDR と CloudFront VPC Origins Service SG のみ。インターネットから直接到達不可',
      // IAM (CDKマネージド/粒度別)
      'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]':
        'CDK が生成する Lambda 実行ロール（Custom Resource / Lambda@Edge）の CloudWatch Logs 書き込み用マネージドポリシー。ログ出力のみの標準権限',
      'AwsSolutions-IAM5[Resource::*]':
        'ECS ExecutionRole の ecr:GetAuthorizationToken と、Custom Resource の ec2:DescribeSecurityGroups はリソースレベル制限をサポートしないため * が必要',
      'AwsSolutions-IAM5[Resource::<OutputBucket7114EB27.Arn>/*]':
        '単一の出力バケット配下のオブジェクト操作に必要な資源ワイルドカード。バケット自体は限定済み',
      [`AwsSolutions-IAM5[Resource::arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-opus-4-*]`]:
        'UI で Claude Opus 4系のモデルを切り替えられるようにするための限定ワイルドカード（4系以外は不可）',
      'AwsSolutions-IAM5[Resource::arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-*]':
        'UI で Claude Opus 4系のモデルを切り替えられるようにするための限定ワイルドカード（4系以外は不可）',
    };
    for (const [id, reason] of Object.entries(nagAcknowledgments)) {
      acknowledgeRule(this, id, reason);
    }
  }
}

/**
 * cdk-nag の指摘を根拠付きで抑止する。
 *
 * `Validations.of().acknowledge()` は '::' を複数含むルールID
 * （IAM4/IAM5 の粒度別IDなど）を受け付けないため、
 * 同等の公開メタデータキーに直接記録する。
 * 抑止はルールID単位でアプリ全体に適用される点に注意。
 */
function acknowledgeRule(scope: Construct, id: string, reason: string): void {
  scope.node.addMetadata(cdk.Validations.ACKNOWLEDGED_RULES_METADATA_KEY, { [id]: reason });
}

/**
 * Lambda@Edge ハンドラ (lambda/auth-at-edge) を esbuild でバンドルし、
 * 生成物ディレクトリのパスを返す。
 *
 * Lambda@Edge は環境変数を利用できないため、SSM パラメータのリージョンは
 * `__CONFIG_REGION__` としてビルド時に埋め込む。
 */
function bundleAuthAtEdge(configRegion: string): string {
  const baseDir = path.join(__dirname, '..', 'lambda', 'auth-at-edge');
  const outDir = path.join(baseDir, 'dist');
  buildSync({
    entryPoints: [path.join(baseDir, 'index.ts')],
    bundle: true,
    minify: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(outDir, 'index.js'),
    define: { __CONFIG_REGION__: JSON.stringify(configRegion) },
    // AWS SDK v3 は Lambda ランタイム同梱のためバンドルから除外（サイズ削減）
    external: ['@aws-sdk/*'],
  });
  return outDir;
}
