import type { InfraConfig, FailureScenario } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-network-${++counter}`;
}

/** Reset counter (for testing) */
export function resetNetworkCounter(): void {
  counter = 0;
}

/**
 * ネットワーク障害カテゴリのシナリオ生成
 * - レイテンシ増加
 * - パケットロス
 * - DNS障害
 * - メッセージ遅延（SQS）
 * - 配信障害（SNS）
 */
export function generateNetworkScenarios(config: InfraConfig): FailureScenario[] {
  const scenarios: FailureScenario[] = [];

  const elbResources = config.resources.filter(
    (r) => r.type === 'AWS::ElasticLoadBalancingV2::LoadBalancer',
  );
  const cloudfrontResources = config.resources.filter(
    (r) => r.type === 'AWS::CloudFront::Distribution',
  );
  const sqsResources = config.resources.filter((r) => r.type === 'AWS::SQS::Queue');
  const snsResources = config.resources.filter((r) => r.type === 'AWS::SNS::Topic');

  // ELB レイテンシ増加シナリオ
  for (const elb of elbResources) {
    scenarios.push({
      id: nextId(),
      name: `ネットワークレイテンシ増加: ${elb.logicalId}`,
      category: 'network',
      severity: 'Medium',
      description: `ロードバランサー ${elb.logicalId} へのネットワークレイテンシを増加させ、アプリケーションの耐性を検証する`,
      affectedResources: [elb.logicalId],
      impactScope: `${elb.logicalId} 経由の全トラフィック`,
      prerequisites: [
        'ロードバランサーが稼働中であること',
        'ヘルスチェックが設定されていること',
      ],
      steps: [
        { order: 1, action: '現在のレスポンスタイムを記録', target: elb.logicalId },
        { order: 2, action: 'FIS実験でネットワークレイテンシを注入', target: elb.logicalId, parameters: { duration: 'PT5M', delay: '500ms' } },
        { order: 3, action: 'レスポンスタイムの変化を観測', target: elb.logicalId },
      ],
      expectedOutcome: 'タイムアウト設定とリトライにより、ユーザー体験への影響が限定的であること',
      rollbackSteps: [
        'FIS実験を停止',
        'レスポンスタイムが正常値に戻ることを確認',
      ],
      estimatedDuration: 20,
      tags: ['network', 'latency'],
    });
  }

  // ELB パケットロスシナリオ
  for (const elb of elbResources) {
    scenarios.push({
      id: nextId(),
      name: `パケットロス: ${elb.logicalId}`,
      category: 'network',
      severity: 'High',
      description: `ロードバランサー ${elb.logicalId} でパケットロスを発生させ、通信の信頼性を検証する`,
      affectedResources: [elb.logicalId],
      impactScope: `${elb.logicalId} 配下のターゲットグループ`,
      prerequisites: [
        'ロードバランサーが稼働中であること',
        'CloudWatchメトリクスが有効であること',
      ],
      steps: [
        { order: 1, action: '現在のエラーレートを記録', target: elb.logicalId },
        { order: 2, action: 'FIS実験でパケットロスを注入', target: elb.logicalId, parameters: { lossPercent: 10 } },
        { order: 3, action: 'エラーレートとリトライの状況を観測', target: elb.logicalId },
      ],
      expectedOutcome: 'リトライメカニズムにより大部分のリクエストが成功すること',
      rollbackSteps: [
        'FIS実験を停止',
        'エラーレートが正常値に戻ることを確認',
      ],
      estimatedDuration: 20,
      tags: ['network', 'packet-loss'],
    });
  }

  // CloudFront DNS障害シナリオ
  for (const cf of cloudfrontResources) {
    scenarios.push({
      id: nextId(),
      name: `DNS障害: ${cf.logicalId}`,
      category: 'network',
      severity: 'Critical',
      description: `CloudFrontディストリビューション ${cf.logicalId} のDNS解決障害をシミュレートする`,
      affectedResources: [cf.logicalId],
      impactScope: `${cf.logicalId} を利用する全エンドユーザー`,
      prerequisites: [
        'CloudFrontディストリビューションが有効であること',
        'Route 53ヘルスチェックが設定されていること',
      ],
      steps: [
        { order: 1, action: 'DNS解決の正常性を確認', target: cf.logicalId },
        { order: 2, action: 'DNS障害をシミュレート（Route 53ヘルスチェック失敗）', target: cf.logicalId },
        { order: 3, action: 'フェイルオーバーの動作を確認', target: cf.logicalId },
      ],
      expectedOutcome: 'DNSフェイルオーバーにより代替エンドポイントへルーティングされること',
      rollbackSteps: [
        'DNSレコードを正常な状態に復元',
        'DNS解決が正常に動作することを確認',
      ],
      estimatedDuration: 30,
      tags: ['network', 'dns-failure'],
    });
  }

  // CloudFront レイテンシシナリオ
  for (const cf of cloudfrontResources) {
    scenarios.push({
      id: nextId(),
      name: `CDNレイテンシ増加: ${cf.logicalId}`,
      category: 'network',
      severity: 'Medium',
      description: `CloudFront ${cf.logicalId} のオリジンレスポンスにレイテンシを追加し、キャッシュ戦略の有効性を検証する`,
      affectedResources: [cf.logicalId],
      impactScope: `${cf.logicalId} 経由のコンテンツ配信`,
      prerequisites: [
        'CloudFrontディストリビューションが有効であること',
        'オリジンサーバーが稼働中であること',
      ],
      steps: [
        { order: 1, action: '現在のキャッシュヒット率を確認', target: cf.logicalId },
        { order: 2, action: 'オリジンサーバーにレイテンシを注入', target: cf.logicalId, parameters: { delay: '2000ms' } },
        { order: 3, action: 'キャッシュヒット率とレスポンスタイムを観測', target: cf.logicalId },
      ],
      expectedOutcome: 'キャッシュされたコンテンツは影響を受けず、キャッシュミス時のみレイテンシが増加すること',
      rollbackSteps: [
        'レイテンシ注入を停止',
        'オリジンレスポンスタイムの正常化を確認',
      ],
      estimatedDuration: 20,
      tags: ['network', 'cdn', 'latency'],
    });
  }

  // SQS メッセージ遅延シナリオ
  for (const sqs of sqsResources) {
    scenarios.push({
      id: nextId(),
      name: `メッセージ遅延: ${sqs.logicalId}`,
      category: 'network',
      severity: 'Medium',
      description: `SQSキュー ${sqs.logicalId} のメッセージ配信遅延をシミュレートし、非同期処理の耐性を検証する`,
      affectedResources: [sqs.logicalId],
      impactScope: `${sqs.logicalId} をコンシュームするすべてのワーカー`,
      prerequisites: [
        'SQSキューが作成済みであること',
        'コンシューマーが稼働中であること',
      ],
      steps: [
        { order: 1, action: '現在のメッセージ処理レートを確認', target: sqs.logicalId },
        { order: 2, action: 'キューの遅延配信設定を変更', target: sqs.logicalId, parameters: { delaySeconds: 30 } },
        { order: 3, action: 'メッセージ処理の遅延影響を観測', target: sqs.logicalId },
      ],
      expectedOutcome: '遅延があっても最終的にすべてのメッセージが処理されること',
      rollbackSteps: [
        'キューの遅延配信設定を元に戻す',
        'メッセージ処理レートの正常化を確認',
      ],
      estimatedDuration: 15,
      tags: ['network', 'sqs', 'message-delay'],
    });
  }

  // SNS 配信障害シナリオ
  for (const sns of snsResources) {
    scenarios.push({
      id: nextId(),
      name: `通知配信障害: ${sns.logicalId}`,
      category: 'network',
      severity: 'Medium',
      description: `SNSトピック ${sns.logicalId} のサブスクリプション配信障害をシミュレートする`,
      affectedResources: [sns.logicalId],
      impactScope: `${sns.logicalId} のすべてのサブスクライバー`,
      prerequisites: [
        'SNSトピックが作成済みであること',
        'サブスクリプションが設定されていること',
      ],
      steps: [
        { order: 1, action: '現在のサブスクリプション状態を確認', target: sns.logicalId },
        { order: 2, action: 'サブスクリプションエンドポイントの障害をシミュレート', target: sns.logicalId },
        { order: 3, action: 'DLQ（デッドレターキュー）への配信を確認', target: sns.logicalId },
      ],
      expectedOutcome: '配信失敗メッセージがDLQに格納され、リトライポリシーが機能すること',
      rollbackSteps: [
        'サブスクリプションエンドポイントを復旧',
        'DLQ内のメッセージを再処理',
      ],
      estimatedDuration: 20,
      tags: ['network', 'sns', 'delivery-failure'],
    });
  }

  return scenarios;
}
