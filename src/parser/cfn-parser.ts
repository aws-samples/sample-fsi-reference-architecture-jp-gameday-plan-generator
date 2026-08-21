import yaml from 'js-yaml';
import type {
  InfraConfig,
  AWSResource,
  ResourceDependency,
  ConfigMetadata,
  EncryptionConfig,
  InputFormat,
  ParseError,
  Result,
} from '../types/index.js';

// ============================================================
// CloudFormation テンプレート解析用の内部型
// ============================================================

interface CfnTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Parameters?: Record<string, unknown>;
  Mappings?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
  Resources?: Record<string, CfnResource>;
  Outputs?: Record<string, unknown>;
}

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
  DependsOn?: string | string[];
  Condition?: string;
}

// ============================================================
// 暗号化検出用のプロパティキー
// ============================================================

const ENCRYPTION_PROPERTY_KEYS = [
  'KmsKeyId',
  'KmsMasterKeyId',
  'SSESpecification',
  'StorageEncrypted',
  'EncryptionConfiguration',
  'ServerSideEncryptionConfiguration',
  'BucketEncryption',
  'EncryptionAtRestOptions',
  'KmsKeyArn',
  'EncryptionType',
  'KMSMasterKeyID',
] as const;

// ============================================================
// X-Ray検出用のプロパティキー
// ============================================================

const XRAY_PROPERTY_KEYS = [
  'TracingConfig',
  'XRayEnabled',
  'XrayEnabled',
  'Tracing',
  'TracingConfiguration',
] as const;

// ============================================================
// パーサー本体
// ============================================================

/**
 * CloudFormation JSON テンプレートを解析して InfraConfig に変換する
 */
export function parseCfnJson(
  input: string,
  sourceFile: string = 'template.json',
): Result<InfraConfig, ParseError> {
  return parseCfnTemplate(input, 'cfn-json', sourceFile, parseJson);
}

/**
 * CloudFormation YAML テンプレートを解析して InfraConfig に変換する
 */
export function parseCfnYaml(
  input: string,
  sourceFile: string = 'template.yaml',
): Result<InfraConfig, ParseError> {
  return parseCfnTemplate(input, 'cfn-yaml', sourceFile, parseYaml);
}

// ============================================================
// 内部実装
// ============================================================

function parseCfnTemplate(
  input: string,
  format: InputFormat,
  sourceFile: string,
  parser: (input: string) => Result<unknown, ParseError>,
): Result<InfraConfig, ParseError> {
  // Step 1: パース
  const parseResult = parser(input);
  if (!parseResult.ok) {
    return parseResult;
  }

  const raw = parseResult.value;

  // Step 2: CloudFormation テンプレートとしてのバリデーション
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        line: 1,
        column: 1,
        message: 'テンプレートはオブジェクト形式である必要があります',
        source: input.slice(0, 100),
      },
    };
  }

  const template = raw as CfnTemplate;

  if (!template.Resources || typeof template.Resources !== 'object') {
    return {
      ok: false,
      error: {
        line: 1,
        column: 1,
        message: 'CloudFormationテンプレートにResourcesセクションが見つかりません',
        source: input.slice(0, 100),
      },
    };
  }

  // Step 3: リソース抽出
  const resources = extractResources(template);
  const dependencies = extractDependencies(template);
  const regions = detectRegions(template, resources);
  const hasEncryption = resources.some((r) => r.encryption?.enabled === true);
  const hasXRayTracing = detectXRayTracing(template);

  const metadata: ConfigMetadata = {
    parsedAt: new Date().toISOString(),
    sourceFile,
    resourceCount: resources.length,
    isMultiRegion: regions.length > 1,
    hasEncryption,
    hasXRayTracing,
  };

  const config: InfraConfig = {
    id: crypto.randomUUID(),
    name: template.Description || sourceFile.replace(/\.(json|ya?ml)$/i, ''),
    sourceFormat: format,
    regions,
    resources,
    dependencies,
    metadata,
  };

  return { ok: true, value: config };
}

// ============================================================
// JSON / YAML パーサー
// ============================================================

function parseJson(input: string): Result<unknown, ParseError> {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (e) {
    const err = e as SyntaxError;
    const { line, column } = extractJsonErrorPosition(err.message, input);
    return {
      ok: false,
      error: {
        line,
        column,
        message: `JSON解析エラー: ${err.message}`,
        source: input.slice(0, 100),
      },
    };
  }
}

function parseYaml(input: string): Result<unknown, ParseError> {
  try {
    const result = yaml.load(input);
    return { ok: true, value: result };
  } catch (e) {
    const err = e as yaml.YAMLException;
    return {
      ok: false,
      error: {
        line: err.mark?.line != null ? err.mark.line + 1 : 1,
        column: err.mark?.column != null ? err.mark.column + 1 : 1,
        message: `YAML解析エラー: ${err.message}`,
        source: input.slice(0, 100),
      },
    };
  }
}

function extractJsonErrorPosition(
  message: string,
  input: string,
): { line: number; column: number } {
  // JSON.parse error messages often contain "at position N"
  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    return offsetToLineColumn(input, pos);
  }
  return { line: 1, column: 1 };
}

function offsetToLineColumn(
  input: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < Math.min(offset, input.length); i++) {
    if (input[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// ============================================================
// リソース抽出
// ============================================================

function extractResources(template: CfnTemplate): AWSResource[] {
  const resources: AWSResource[] = [];

  if (!template.Resources) return resources;

  for (const [logicalId, resource] of Object.entries(template.Resources)) {
    if (!resource || typeof resource !== 'object' || !resource.Type) continue;

    const properties = (resource.Properties as Record<string, unknown>) ?? {};
    const encryption = detectEncryption(properties);
    const tags = extractTags(properties);

    resources.push({
      logicalId,
      type: resource.Type,
      properties,
      region: 'us-east-1', // デフォルト。detectRegionsで上書きされる可能性あり
      tags: Object.keys(tags).length > 0 ? tags : undefined,
      encryption: encryption.enabled ? encryption : undefined,
    });
  }

  return resources;
}

// ============================================================
// 依存関係抽出
// ============================================================

function extractDependencies(template: CfnTemplate): ResourceDependency[] {
  const deps: ResourceDependency[] = [];
  const seen = new Set<string>();

  if (!template.Resources) return deps;

  for (const [logicalId, resource] of Object.entries(template.Resources)) {
    if (!resource) continue;

    // DependsOn (hard dependency)
    if (resource.DependsOn) {
      const dependsOn = Array.isArray(resource.DependsOn)
        ? resource.DependsOn
        : [resource.DependsOn];
      for (const target of dependsOn) {
        const key = `${logicalId}->${target}:hard`;
        if (!seen.has(key)) {
          seen.add(key);
          deps.push({ source: logicalId, target, type: 'hard' });
        }
      }
    }

    // Ref and Fn::GetAtt in properties (soft dependency)
    if (resource.Properties) {
      const refs = extractReferences(resource.Properties);
      for (const target of refs) {
        if (target === logicalId) continue; // 自己参照をスキップ
        if (!template.Resources[target]) continue; // 存在しないリソースをスキップ
        const key = `${logicalId}->${target}:soft`;
        if (!seen.has(key)) {
          seen.add(key);
          deps.push({ source: logicalId, target, type: 'soft' });
        }
      }
    }
  }

  return deps;
}

/**
 * オブジェクトツリーから Ref と Fn::GetAtt の参照先を再帰的に抽出する
 */
function extractReferences(obj: unknown): string[] {
  const refs: string[] = [];

  if (obj === null || obj === undefined) return refs;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      refs.push(...extractReferences(item));
    }
    return refs;
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;

    // { "Ref": "LogicalId" }
    if (typeof record['Ref'] === 'string') {
      refs.push(record['Ref']);
    }

    // { "Fn::GetAtt": ["LogicalId", "Attribute"] }
    if (Array.isArray(record['Fn::GetAtt']) && record['Fn::GetAtt'].length >= 1) {
      const target = record['Fn::GetAtt'][0];
      if (typeof target === 'string') {
        refs.push(target);
      }
    }

    // { "Fn::GetAtt": "LogicalId.Attribute" } (短縮形)
    if (typeof record['Fn::GetAtt'] === 'string') {
      const parts = record['Fn::GetAtt'].split('.');
      if (parts.length >= 1) {
        refs.push(parts[0]);
      }
    }

    // 再帰的に探索
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'Ref' && key !== 'Fn::GetAtt') {
        refs.push(...extractReferences(value));
      }
    }
  }

  return refs;
}

// ============================================================
// リージョン検出
// ============================================================

function detectRegions(template: CfnTemplate, resources: AWSResource[]): string[] {
  const regions = new Set<string>();

  // デフォルトリージョン
  regions.add('us-east-1');

  // Mappings内のリージョン参照を検出
  if (template.Mappings) {
    const mappingsStr = JSON.stringify(template.Mappings);
    const regionPattern = /(?:us|eu|ap|sa|ca|me|af)-(?:east|west|north|south|central|northeast|southeast|northwest|southwest)-\d/g;
    const matches = mappingsStr.match(regionPattern);
    if (matches) {
      for (const region of matches) {
        regions.add(region);
      }
    }
  }

  // Conditions内のリージョン参照を検出
  if (template.Conditions) {
    const conditionsStr = JSON.stringify(template.Conditions);
    const regionPattern = /(?:us|eu|ap|sa|ca|me|af)-(?:east|west|north|south|central|northeast|southeast|northwest|southwest)-\d/g;
    const matches = conditionsStr.match(regionPattern);
    if (matches) {
      for (const region of matches) {
        regions.add(region);
      }
    }
  }

  // AWS::Region 疑似パラメータの使用を検出
  if (template.Resources) {
    const resourcesStr = JSON.stringify(template.Resources);
    if (resourcesStr.includes('AWS::Region')) {
      // AWS::Region が使われている場合、マルチリージョンの可能性がある
      // ただし、具体的なリージョンが特定できない場合はデフォルトのまま
    }

    // リソースプロパティ内の明示的なリージョン参照
    const regionPattern = /(?:us|eu|ap|sa|ca|me|af)-(?:east|west|north|south|central|northeast|southeast|northwest|southwest)-\d/g;
    const matches = resourcesStr.match(regionPattern);
    if (matches) {
      for (const region of matches) {
        regions.add(region);
      }
    }
  }

  return [...regions];
}

// ============================================================
// 暗号化検出
// ============================================================

function detectEncryption(properties: Record<string, unknown>): EncryptionConfig {
  const config: EncryptionConfig = { enabled: false };

  for (const key of ENCRYPTION_PROPERTY_KEYS) {
    if (key in properties) {
      const value = properties[key];

      if (typeof value === 'boolean') {
        config.enabled = value;
      } else if (typeof value === 'string') {
        config.enabled = true;
        config.kmsKeyId = value;
      } else if (typeof value === 'object' && value !== null) {
        config.enabled = true;
        // SSESpecification や BucketEncryption などのネストされた設定
        const nested = value as Record<string, unknown>;
        if (typeof nested['KMSMasterKeyID'] === 'string') {
          config.kmsKeyId = nested['KMSMasterKeyID'];
        }
        if (typeof nested['SSEEnabled'] === 'boolean') {
          config.enabled = nested['SSEEnabled'];
        }
        if (typeof nested['KmsKeyId'] === 'string') {
          config.kmsKeyId = nested['KmsKeyId'];
        }
      }

      if (config.enabled) break;
    }
  }

  // KmsKeyId がある場合はアルゴリズムを推定
  if (config.kmsKeyId) {
    config.algorithm = 'aws:kms';
  }

  return config;
}

// ============================================================
// X-Ray トレーシング検出
// ============================================================

function detectXRayTracing(template: CfnTemplate): boolean {
  if (!template.Resources) return false;

  const resourcesStr = JSON.stringify(template.Resources);

  for (const key of XRAY_PROPERTY_KEYS) {
    if (resourcesStr.includes(key)) {
      return true;
    }
  }

  return false;
}

// ============================================================
// タグ抽出
// ============================================================

function extractTags(properties: Record<string, unknown>): Record<string, string> {
  const tags: Record<string, string> = {};

  if (!Array.isArray(properties['Tags'])) return tags;

  for (const tag of properties['Tags']) {
    if (
      typeof tag === 'object' &&
      tag !== null &&
      typeof (tag as Record<string, unknown>)['Key'] === 'string' &&
      typeof (tag as Record<string, unknown>)['Value'] === 'string'
    ) {
      tags[(tag as Record<string, string>)['Key']] = (tag as Record<string, string>)['Value'];
    }
  }

  return tags;
}
