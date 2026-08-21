import { describe, it, expect } from 'vitest';
import { parse, detectFormat } from '../../src/parser/index.js';
import { InfraConfigSchema } from '../../src/types/index.js';

// ============================================================
// 有効なCFn JSON / YAMLの解析
// ============================================================

describe('parser: detectFormat', () => {
  it('{で始まる文字列はcfn-jsonと判定される', () => {
    expect(detectFormat('{"Resources": {}}')).toBe('cfn-json');
  });

  it('AWSTemplateFormatVersionで始まる文字列はcfn-yamlと判定される', () => {
    expect(detectFormat('AWSTemplateFormatVersion: "2010-09-09"\nResources: {}')).toBe('cfn-yaml');
  });

  it('Resources:で始まる文字列はcfn-yamlと判定される', () => {
    expect(detectFormat('Resources:\n  Foo:\n    Type: AWS::S3::Bucket')).toBe('cfn-yaml');
  });

  it('空文字列はcfn-jsonにフォールバックする', () => {
    expect(detectFormat('')).toBe('cfn-json');
  });

  it('CDK TypeScriptっぽいコードはcdk-typescriptと判定される', () => {
    const src = `import { Stack } from 'aws-cdk-lib';\nexport class MyStack extends Stack {}`;
    expect(detectFormat(src)).toBe('cdk-typescript');
  });

  it('CDK Pythonっぽいコードはcdk-pythonと判定される', () => {
    const src = `from aws_cdk import Stack\nclass MyStack(Stack):\n    pass`;
    expect(detectFormat(src)).toBe('cdk-python');
  });
});

describe('parser: parseCfnJson', () => {
  it('有効なCFn JSONを解析してInfraConfigを返す', () => {
    const input = JSON.stringify({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'Test Template',
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [{ SSEAlgorithm: 'AES256' }],
            },
          },
        },
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          DependsOn: 'MyBucket',
          Properties: { InstanceType: 't3.micro' },
        },
      },
    });

    const result = parse(input, 'cfn-json', 'test.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Zodスキーマに適合する
    const schemaResult = InfraConfigSchema.safeParse(result.value);
    expect(schemaResult.success).toBe(true);

    // リソースが2つ抽出される
    expect(result.value.resources).toHaveLength(2);
    expect(result.value.resources.map((r) => r.logicalId)).toContain('MyBucket');
    expect(result.value.resources.map((r) => r.logicalId)).toContain('MyInstance');

    // 暗号化が検出される
    expect(result.value.metadata.hasEncryption).toBe(true);

    // DependsOnがhard依存として抽出される
    const hardDep = result.value.dependencies.find((d) => d.type === 'hard');
    expect(hardDep).toBeDefined();
    expect(hardDep?.source).toBe('MyInstance');
    expect(hardDep?.target).toBe('MyBucket');

    // ソースフォーマットとメタデータ
    expect(result.value.sourceFormat).toBe('cfn-json');
    expect(result.value.metadata.sourceFile).toBe('test.json');
    expect(result.value.metadata.resourceCount).toBe(2);
  });

  it('有効なCFn YAMLを解析してInfraConfigを返す', () => {
    const input = `AWSTemplateFormatVersion: "2010-09-09"
Description: YAML Test
Resources:
  MyFunc:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: test-fn
      TracingConfig:
        Mode: Active`;

    const result = parse(input, 'cfn-yaml', 'test.yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resources).toHaveLength(1);
    expect(result.value.resources[0].type).toBe('AWS::Lambda::Function');
    // TracingConfigからX-Rayが検出される
    expect(result.value.metadata.hasXRayTracing).toBe(true);
  });

  it('Ref参照からsoft依存が抽出される', () => {
    const input = JSON.stringify({
      Resources: {
        MyBucket: { Type: 'AWS::S3::Bucket', Properties: {} },
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            UserData: { Ref: 'MyBucket' },
          },
        },
      },
    });

    const result = parse(input, 'cfn-json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const softDeps = result.value.dependencies.filter((d) => d.type === 'soft');
    expect(softDeps.length).toBeGreaterThanOrEqual(1);
    expect(softDeps.some((d) => d.source === 'MyInstance' && d.target === 'MyBucket')).toBe(true);
  });

  it('Fn::GetAtt参照からsoft依存が抽出される', () => {
    const input = JSON.stringify({
      Resources: {
        MyBucket: { Type: 'AWS::S3::Bucket', Properties: {} },
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            Arn: { 'Fn::GetAtt': ['MyBucket', 'Arn'] },
          },
        },
      },
    });

    const result = parse(input, 'cfn-json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const softDeps = result.value.dependencies.filter((d) => d.type === 'soft');
    expect(softDeps.some((d) => d.source === 'MyInstance' && d.target === 'MyBucket')).toBe(true);
  });

  it('マルチリージョン（Mappings内にリージョン記述あり）を検出する', () => {
    const input = JSON.stringify({
      Mappings: {
        RegionMap: {
          'us-east-1': { AMI: 'ami-abc' },
          'eu-west-1': { AMI: 'ami-def' },
        },
      },
      Resources: {
        MyInstance: { Type: 'AWS::EC2::Instance', Properties: {} },
      },
    });

    const result = parse(input, 'cfn-json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.metadata.isMultiRegion).toBe(true);
    expect(result.value.regions.length).toBeGreaterThan(1);
  });

  it('単一リージョンではisMultiRegionがfalse', () => {
    const input = JSON.stringify({
      Resources: { MyBucket: { Type: 'AWS::S3::Bucket', Properties: {} } },
    });

    const result = parse(input, 'cfn-json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.metadata.isMultiRegion).toBe(false);
    expect(result.value.regions).toEqual(['us-east-1']);
  });

  it('KmsKeyId付きリソースの暗号化が検出される', () => {
    const input = JSON.stringify({
      Resources: {
        MyDB: {
          Type: 'AWS::RDS::DBInstance',
          Properties: { KmsKeyId: 'arn:aws:kms:us-east-1:123:key/abc', StorageEncrypted: true },
        },
      },
    });

    const result = parse(input, 'cfn-json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.metadata.hasEncryption).toBe(true);
    const db = result.value.resources[0];
    expect(db.encryption?.enabled).toBe(true);
  });
});

// ============================================================
// エラーハンドリング
// ============================================================

describe('parser: エラーハンドリング', () => {
  it('不正なJSONではParseError構造のエラーを返す', () => {
    const result = parse('{ this is not json }', 'cfn-json');
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toHaveProperty('line');
    expect(result.error).toHaveProperty('column');
    expect(result.error).toHaveProperty('message');
    expect(result.error).toHaveProperty('source');
    expect(result.error.message).toContain('JSON');
  });

  it('Resourcesセクションが無いJSONではエラー', () => {
    const result = parse('{"Description": "no resources"}', 'cfn-json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Resources');
  });

  it('空文字列ではエラー（JSON解析失敗）', () => {
    const result = parse('', 'cfn-json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBeDefined();
  });

  it('配列のみのJSONではエラー（オブジェクトが必要）', () => {
    const result = parse('[1, 2, 3]', 'cfn-json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('オブジェクト');
  });

  it('CDK TypeScriptは未対応エラーを返す', () => {
    const result = parse('import { Stack } from "aws-cdk-lib";', 'cdk-typescript');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('CDK');
  });

  it('CDK Pythonは未対応エラーを返す', () => {
    const result = parse('from aws_cdk import Stack', 'cdk-python');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('CDK');
  });

  it('不正なYAMLではParseError構造のエラーを返す', () => {
    const result = parse('Resources:\n  Foo: [unclosed', 'cfn-yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('line');
    expect(result.error).toHaveProperty('column');
    expect(result.error.message).toContain('YAML');
  });
});
