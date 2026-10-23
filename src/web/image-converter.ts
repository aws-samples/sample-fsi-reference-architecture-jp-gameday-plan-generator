/**
 * 構成図 → CloudFormation JSON 変換モジュール
 *
 * Amazon Bedrock Converse API（GPT-5.6 / Claude 5.5）を使用して
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
- 不明な部分は一般的なベストプラクティスに基づいて補完
- 簡潔さを優先: 各リソースは構成の把握に必要な主要プロパティのみ記述し、
  省略可能なプロパティ（詳細なパラメータ群、冗長なポリシー文、コメント的な記述）は書かないこと。
  このテンプレートは障害シナリオ分析の入力であり、デプロイ可能性の完全性は求めない`;

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
    // API エラー（権限・リージョン起因）のときだけ設定確認を促す。
    // 出力打ち切りや JSON 不正はモデル出力の問題なので、設定確認の案内は誤誘導になる。
    const hint = result.error.startsWith('Bedrock API エラー')
      ? '\nBedrock へのアクセス権限、選択モデルのモデルアクセス有効化、AWS_REGION の設定を確認してください。'
      : '';
    return { ok: false, error: `${result.error}${hint}` };
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
    // 詳細に記述するモデル（Claude Opus 5.5 等）が 16K で打ち切られた実績があるため余裕を持たせる。
    // 実際の上限は bedrock-client 側でモデルごとにクランプされる。
    maxTokens: 32768,
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
