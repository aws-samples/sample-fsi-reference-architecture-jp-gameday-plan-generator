import type { RoleAssignment } from '../types/index.js';

/**
 * 参加者数に応じた役割分担を生成する。
 * - facilitator: 常に1名
 * - operator: 残りの約40%
 * - observer: 残りの約60%
 * - デフォルト参加者数: 6名
 */
export function assignRoles(participantCount?: number): RoleAssignment[] {
  const total = participantCount ?? 6;
  const clamped = Math.max(total, 1);

  // ファシリテーターは常に1名
  const facilitatorCount = 1;
  const remaining = Math.max(clamped - facilitatorCount, 0);

  // operator ~40%, observer ~60% of remaining
  const operatorCount = Math.round(remaining * 0.4);
  const observerCount = remaining - operatorCount;

  const roles: RoleAssignment[] = [
    {
      role: 'facilitator',
      description: 'GameDay全体の進行管理・調整を担当',
      responsibilities: [
        'タイムライン管理と進行',
        'チーム間のコミュニケーション調整',
        'エスカレーション判断',
        '振り返りセッションのファシリテーション',
      ],
      assignedCount: facilitatorCount,
    },
    {
      role: 'operator',
      description: '障害シナリオの実行と復旧対応を担当',
      responsibilities: [
        '障害注入の実行',
        'システム復旧作業',
        '手順書に基づくオペレーション',
        '実行結果の記録',
      ],
      assignedCount: operatorCount,
    },
    {
      role: 'observer',
      description: 'モニタリングと記録・評価を担当',
      responsibilities: [
        'ダッシュボード・メトリクスの監視',
        '障害検知時間・復旧時間の計測',
        'コミュニケーションの記録',
        '改善点の洗い出し',
      ],
      assignedCount: observerCount,
    },
  ];

  return roles;
}
