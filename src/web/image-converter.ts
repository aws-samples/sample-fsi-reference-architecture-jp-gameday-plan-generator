/**
 * 構成図 → CloudFormation JSON 変換モジュール
 *
 * Amazon Bedrock Converse API (Claude Opus 4.x) を使用して
 * 構成図画像を解析し、CloudFormation JSONテンプレートに変換する。
 *
 * Bedrock連携が失敗した場合は明示的にエラーを返す。
 * （以前はモックデータへの無警告フォールバックがあったが、アップロードした
 * 構成図と無関係な計画が生成され利用者が気づけないため v1.0.1 で廃止した）
 */

import { invokeLLM, extractJSON, type ImageFormat } from '../llm/bedrock-client.js';

type ConvertResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const SYSTEM_PROMPT = `あなたはAWSアーキテクチャの専門家です。
ユーザーがアップロードした構成図（アーキテクチャダイアグラム）を解析し、
その構成をCloudFormation JSONテンプレートとして出力してください。

ルール:
- 出力はCloudFormation JSON形式のみ（説明文は不要）
- AWSTemplateFormatVersion: "2010-09-09" を含める
- Description に構成の概要を記載
- 図に含まれるすべてのAWSリソースをResourcesセクションに定義
- VPC、サブネット、セキュリティグループなどのネットワーク構成も含める
- DependsOn で依存関係を明示
- 暗号化設定がある場合は StorageEncrypted, KmsKeyId 等を設定
- タグ（Name, Environment等）を付与
- 出力はJSON形式のみ。マークダウンのコードブロックで囲まないこと
- 不明な部分は一般的なベストプラクティスに基づいて補完`;

/**
 * 構成図画像をCloudFormation JSONに変換する
 *
 * Bedrock Converse API（選択モデル）で画像解析を行う。
 * 失敗時はエラーを返す（モック等へのフォールバックは行わない）。
 */
export async function convertImageToCfn(
  imageBuffer: Buffer,
  fileName: string,
  modelKey?: string,
): Promise<ConvertResult> {
  console.log(`    📐 画像サイズ: ${(imageBuffer.length / 1024).toFixed(1)}KB (${fileName})`);

  try {
    console.log(`    🤖 Amazon Bedrock Converse API (${modelKey ?? 'default'}) で構成図を解析中...`);
    const result = await invokeBedrockConverse(imageBuffer, fileName, modelKey);
    if (result.ok) {
      console.log('    ✅ Bedrock解析完了');
      return result;
    }
    console.log(`    ❌ Bedrock解析失敗: ${result.error}`);
    return {
      ok: false,
      error: `${result.error}\nBedrock（Claude Opus）へのアクセス権限とモデルアクセス有効化、AWS_REGION の設定を確認してください。`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`    ❌ Bedrock接続エラー: ${msg}`);
    return {
      ok: false,
      error: `Bedrock接続エラー: ${msg}\nAWS認証情報とAWS_REGION の設定を確認してください。`,
    };
  }
}

/**
 * Bedrock Converse API で画像を解析
 */
async function invokeBedrockConverse(
  imageBuffer: Buffer,
  fileName: string,
  modelKey?: string,
): Promise<ConvertResult> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'png';
  const formatMap: Record<string, ImageFormat> = {
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    gif: 'gif',
    webp: 'webp',
  };
  const format = formatMap[ext] ?? 'png';

  const result = await invokeLLM({
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', format, data: imageBuffer },
          { type: 'text', text: 'この構成図をCloudFormation JSONテンプレートに変換してください。JSONのみを出力してください。' },
        ],
      },
    ],
    maxTokens: 16384,
    temperature: 0.2,
    model: modelKey,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  console.log(`    📊 トークン使用量: 入力=${result.usage.inputTokens}, 出力=${result.usage.outputTokens}`);

  const cfnJson = extractJSON(result.text);

  // JSONとして有効か検証
  try {
    JSON.parse(cfnJson);
  } catch {
    return { ok: false, error: '生成されたテンプレートが有効なJSONではありません' };
  }

  return { ok: true, value: cfnJson };
}
