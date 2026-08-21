/**
 * デモ用サンプルCloudFormationテンプレート
 *
 * 1. multi-region-template: マルチリージョンWebアプリケーション構成
 * 2. encrypted-template: 暗号化対応構成
 */

/**
 * マルチリージョンWebアプリケーション構成
 *
 * - EC2 (us-east-1, ap-northeast-1)
 * - RDS with encryption (StorageEncrypted, KmsKeyId)
 * - S3 with BucketEncryption
 * - ALB (Application Load Balancer)
 * - Lambda with X-Ray TracingConfig
 * - DynamoDB with SSESpecification
 * - Mappings with multiple regions
 * - Tags on resources
 */
export const multiRegionTemplate = JSON.stringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'マルチリージョンWebアプリケーション - GameDayデモ用構成',
  Mappings: {
    RegionMap: {
      'us-east-1': { AMI: 'ami-0abcdef1234567890', Env: 'primary' },
      'ap-northeast-1': { AMI: 'ami-0fedcba0987654321', Env: 'secondary' },
    },
  },
  Resources: {
    WebServerPrimary: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: 't3.large',
        ImageId: { 'Fn::FindInMap': ['RegionMap', 'us-east-1', 'AMI'] },
        AvailabilityZone: 'us-east-1a',
        Tags: [
          { Key: 'Name', Value: 'WebServer-Primary' },
          { Key: 'Environment', Value: 'production' },
          { Key: 'Region', Value: 'us-east-1' },
        ],
      },
    },
    WebServerSecondary: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: 't3.large',
        ImageId: { 'Fn::FindInMap': ['RegionMap', 'ap-northeast-1', 'AMI'] },
        AvailabilityZone: 'ap-northeast-1a',
        Tags: [
          { Key: 'Name', Value: 'WebServer-Secondary' },
          { Key: 'Environment', Value: 'production' },
          { Key: 'Region', Value: 'ap-northeast-1' },
        ],
      },
    },
    ApplicationLoadBalancer: {
      Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
      Properties: {
        Name: 'gameday-demo-alb',
        Scheme: 'internet-facing',
        Type: 'application',
        Subnets: ['subnet-primary-1', 'subnet-primary-2'],
        Tags: [
          { Key: 'Name', Value: 'GameDay-Demo-ALB' },
          { Key: 'Environment', Value: 'production' },
        ],
      },
      DependsOn: ['WebServerPrimary'],
    },
    PrimaryDatabase: {
      Type: 'AWS::RDS::DBInstance',
      Properties: {
        DBInstanceClass: 'db.r6g.xlarge',
        Engine: 'aurora-mysql',
        MasterUsername: 'admin',
        MasterUserPassword: '{{resolve:secretsmanager:db-password}}',
        StorageEncrypted: true,
        KmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/demo-key-id',
        MultiAZ: true,
        BackupRetentionPeriod: 7,
        Tags: [
          { Key: 'Name', Value: 'PrimaryDB' },
          { Key: 'Environment', Value: 'production' },
        ],
      },
    },
    DataBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: {
        // アカウントID・リージョンを含めてグローバル一意にする (bucket squatting 対策)
        BucketName: { 'Fn::Sub': 'gameday-demo-data-bucket-${AWS::AccountId}-${AWS::Region}' },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
                KMSMasterKeyID: 'arn:aws:kms:us-east-1:123456789012:key/s3-key-id',
              },
            },
          ],
        },
        VersioningConfiguration: { Status: 'Enabled' },
        Tags: [
          { Key: 'Name', Value: 'DataBucket' },
          { Key: 'Environment', Value: 'production' },
        ],
      },
    },
    ApiFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        FunctionName: 'gameday-demo-api',
        Runtime: 'nodejs20.x',
        Handler: 'index.handler',
        MemorySize: 512,
        Timeout: 30,
        TracingConfig: { Mode: 'Active' },
        Environment: {
          Variables: {
            TABLE_NAME: { Ref: 'SessionTable' },
            BUCKET_NAME: { Ref: 'DataBucket' },
          },
        },
        Tags: [
          { Key: 'Name', Value: 'ApiFunction' },
          { Key: 'Environment', Value: 'production' },
        ],
      },
      DependsOn: ['SessionTable', 'DataBucket'],
    },
    SessionTable: {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: 'gameday-demo-sessions',
        AttributeDefinitions: [
          { AttributeName: 'sessionId', AttributeType: 'S' },
          { AttributeName: 'userId', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'sessionId', KeyType: 'HASH' },
          { AttributeName: 'userId', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        SSESpecification: {
          SSEEnabled: true,
          SSEType: 'KMS',
          KMSMasterKeyId: 'arn:aws:kms:us-east-1:123456789012:key/dynamo-key-id',
        },
        Tags: [
          { Key: 'Name', Value: 'SessionTable' },
          { Key: 'Environment', Value: 'production' },
        ],
      },
    },
  },
}, null, 2);

/**
 * 暗号化対応構成
 *
 * - RDS with KMS encryption
 * - S3 with server-side encryption
 * - Lambda with X-Ray tracing
 * - DynamoDB with encryption
 */
export const encryptedTemplate = JSON.stringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: '暗号化対応構成 - GameDayデモ用（PQC移行検証向け）',
  Resources: {
    EncryptedDatabase: {
      Type: 'AWS::RDS::DBInstance',
      Properties: {
        DBInstanceClass: 'db.r6g.large',
        Engine: 'aurora-postgresql',
        MasterUsername: 'admin',
        MasterUserPassword: '{{resolve:secretsmanager:enc-db-password}}',
        StorageEncrypted: true,
        KmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/rds-enc-key',
        Tags: [
          { Key: 'Name', Value: 'EncryptedDB' },
          { Key: 'Compliance', Value: 'pqc-ready' },
        ],
      },
    },
    EncryptedBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: {
        // アカウントID・リージョンを含めてグローバル一意にする (bucket squatting 対策)
        BucketName: { 'Fn::Sub': 'gameday-encrypted-storage-${AWS::AccountId}-${AWS::Region}' },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
                KMSMasterKeyID: 'arn:aws:kms:us-east-1:123456789012:key/s3-enc-key',
              },
            },
          ],
        },
        Tags: [
          { Key: 'Name', Value: 'EncryptedBucket' },
          { Key: 'Compliance', Value: 'pqc-ready' },
        ],
      },
    },
    ProcessorFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        FunctionName: 'gameday-encrypted-processor',
        Runtime: 'nodejs20.x',
        Handler: 'index.handler',
        MemorySize: 256,
        Timeout: 60,
        TracingConfig: { Mode: 'Active' },
        Tags: [
          { Key: 'Name', Value: 'ProcessorFunction' },
          { Key: 'Compliance', Value: 'pqc-ready' },
        ],
      },
    },
    EncryptedTable: {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: 'gameday-encrypted-data',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        SSESpecification: {
          SSEEnabled: true,
          SSEType: 'KMS',
          KMSMasterKeyId: 'arn:aws:kms:us-east-1:123456789012:key/dynamo-enc-key',
        },
        Tags: [
          { Key: 'Name', Value: 'EncryptedTable' },
          { Key: 'Compliance', Value: 'pqc-ready' },
        ],
      },
    },
  },
}, null, 2);

/**
 * デモシナリオの説明テキスト
 */
export const demoScenarioDescriptions = {
  pqcMigration: {
    title: 'PQC（ポスト量子暗号）移行シナリオ',
    description:
      '量子コンピュータの実用化に備え、現在の暗号化方式からポスト量子暗号への移行を検証します。' +
      'KMS鍵のローテーション、暗号化アルゴリズムの切り替え、データ再暗号化の手順を確認します。',
  },
  ransomware: {
    title: 'ランサムウェア対策シナリオ',
    description:
      'ランサムウェア感染を想定し、データの暗号化被害からの復旧手順を検証します。' +
      'S3バージョニングからの復元、RDSスナップショットからのリストア、' +
      'IAMアクセスキーの無効化とローテーションを実施します。',
  },
  multiRegionFailover: {
    title: 'マルチリージョンフェイルオーバーシナリオ',
    description:
      'プライマリリージョン（us-east-1）の障害を想定し、' +
      'セカンダリリージョン（ap-northeast-1）へのフェイルオーバーを検証します。' +
      'DNS切り替え、データベースレプリカの昇格、ALBの再構成を実施します。',
  },
};
