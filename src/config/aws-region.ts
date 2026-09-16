/**
 * AWSリージョン解決の共通モジュール
 *
 * リージョンの既定値がモジュール間で食い違うのを防ぐため、
 * 解決ロジックをここに一本化する。
 *
 * 既定値が us-east-1 である理由:
 * 本ツールが使用する Bedrock の cross-region inference profile（us.* 系）は
 * USリージョンからの呼び出しが前提のため。日本国内などUS外の環境から実行する
 * 場合も `AWS_REGION=us-east-1` 等のUSリージョンを明示することを推奨する
 * （README「動作要件」参照）。
 */

export const DEFAULT_AWS_REGION = 'us-east-1';

/**
 * 実行時のAWSリージョンを解決する。
 * 環境変数 AWS_REGION が設定されていればそれを、なければ既定値を返す。
 */
export function getAwsRegion(): string {
  return process.env.AWS_REGION ?? DEFAULT_AWS_REGION;
}
