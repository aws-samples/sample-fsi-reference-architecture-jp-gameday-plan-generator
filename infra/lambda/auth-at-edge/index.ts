/**
 * Cognito 認証 Lambda@Edge ハンドラ (viewer-request)
 *
 * awslabs/cognito-at-edge を利用して、CloudFront への全リクエストを
 * Cognito User Pool (Hosted UI) で認証する。
 *
 * Lambda@Edge は環境変数を利用できないため、User Pool ID などの設定値は
 * us-east-1 の SSM Parameter Store (CONFIG_PARAM_NAME) から取得する。
 * 設定はコールドスタート時に読み込み、CONFIG_TTL_MS の間キャッシュする。
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Authenticator } from 'cognito-at-edge';
import type { CloudFrontRequestEvent } from 'aws-lambda';

// CDK スタック側 (lib/gameday-stack.ts) と一致させること
const CONFIG_PARAM_NAME = '/gameday-plan-generator/auth-at-edge/config';
// SSM パラメータのあるリージョン。esbuild の define でビルド時に注入される
// （Lambda@Edge は環境変数を利用できないため）
declare const __CONFIG_REGION__: string | undefined;
const CONFIG_REGION = typeof __CONFIG_REGION__ !== 'undefined' ? __CONFIG_REGION__ : 'us-east-1';
// 設定キャッシュの有効期間（5分）。設定変更はコンテナ再利用後に反映される
const CONFIG_TTL_MS = 5 * 60 * 1000;

interface AuthConfig {
  region: string;
  userPoolId: string;
  userPoolAppId: string;
  userPoolDomain: string;
  logoutRedirectUri: string;
}

let cachedAuthenticator: Authenticator | undefined;
let cachedAt = 0;

async function getAuthenticator(): Promise<Authenticator> {
  const now = Date.now();
  if (cachedAuthenticator && now - cachedAt < CONFIG_TTL_MS) {
    return cachedAuthenticator;
  }
  const ssm = new SSMClient({ region: CONFIG_REGION });
  const res = await ssm.send(new GetParameterCommand({ Name: CONFIG_PARAM_NAME }));
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${CONFIG_PARAM_NAME} is empty or missing`);
  }
  const config = JSON.parse(value) as AuthConfig;
  cachedAuthenticator = new Authenticator({
    region: config.region,
    userPoolId: config.userPoolId,
    userPoolAppId: config.userPoolAppId,
    userPoolDomain: config.userPoolDomain,
    // refresh token の有効期限 (30日) に合わせる
    cookieExpirationDays: 30,
    // XSS でのトークン窃取を防ぐ
    httpOnly: true,
    sameSite: 'Lax',
    logoutConfiguration: {
      logoutUri: '/signout',
      logoutRedirectUri: config.logoutRedirectUri,
    },
  });
  cachedAt = now;
  return cachedAuthenticator;
}

export const handler = async (event: CloudFrontRequestEvent) => {
  const authenticator = await getAuthenticator();
  return authenticator.handle(event);
};
