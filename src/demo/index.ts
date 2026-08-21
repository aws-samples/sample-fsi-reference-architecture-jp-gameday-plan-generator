/**
 * デモモード制御
 *
 * サンプル構成を使用して全工程をステップバイステップで実行し、
 * 各ステップの説明テキストを表示する。
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse } from '../parser/index.js';
import { generateScenarios } from '../scenario/index.js';
import { generate as generatePlan, toMarkdown } from '../plan/index.js';
import { build as buildFIS, validate as validateFIS, toCfn as buildFISCfn, buildDeployCommand, buildConsoleDeepLink } from '../fis/index.js';
import { generateObservationPoints, toCloudFormation } from '../observation/index.js';
import { generateEvaluationCriteria } from '../evaluation/index.js';
import { generate as generateDashboard } from '../dashboard/index.js';
import { multiRegionTemplate, demoScenarioDescriptions } from './data/templates.js';

import type { PlanOptions, FailureScenario, InfraConfig, FISDeploymentInfo } from '../types/index.js';

// ============================================================
// コンソール出力ヘルパー
// ============================================================

function printBanner(): void {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                                                  ║');
  console.log('  ║   🎮  GameDay Plan Generator - Demo Mode  🎮    ║');
  console.log('  ║                                                  ║');
  console.log('  ║   クラウド障害対応訓練を自動計画                 ║');
  console.log('  ║                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
}

function printStep(step: number, title: string, description: string): void {
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  📌 Step ${step}: ${title}`);
  console.log(`${'─'.repeat(56)}`);
  console.log(`  ${description}`);
  console.log('');
}

function printResult(label: string, value: string | number): void {
  console.log(`    ✅ ${label}: ${value}`);
}

function printWarning(message: string): void {
  console.log(`    ⚠️  ${message}`);
}

function printSummary(stats: {
  resources: number;
  scenarios: number;
  fisTemplates: number;
  observations: number;
  evaluations: number;
  outputDir: string;
}): void {
  console.log(`\n${'═'.repeat(56)}`);
  console.log('  📊 デモ実行サマリー');
  console.log(`${'═'.repeat(56)}`);
  console.log(`    リソース数:       ${stats.resources}`);
  console.log(`    シナリオ数:       ${stats.scenarios}`);
  console.log(`    FISテンプレート:  ${stats.fisTemplates}`);
  console.log(`    観測ポイント:     ${stats.observations}`);
  console.log(`    評価基準:         ${stats.evaluations}`);
  console.log(`    出力先:           ${stats.outputDir}`);
  console.log(`${'═'.repeat(56)}`);
  console.log('');
  console.log('  🎉 デモ実行が完了しました！');
  console.log(`     出力ファイルを確認してください: ${stats.outputDir}`);
  console.log('');
}

// ============================================================
// 出力ファイル書き出し
// ============================================================

function writeOutputFiles(
  outputDir: string,
  plan: { markdown: string },
  scenarios: FailureScenario[],
  fisTemplates: Array<{ scenarioId: string; template: object; cfn: object }>,
  observationCfn: Record<string, unknown>,
  dashboardHtml: string,
): void {
  // 出力ディレクトリ作成
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'fis-templates'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'fis-cfn'), { recursive: true });

  // GameDay実施計画 (Markdown)
  fs.writeFileSync(path.join(outputDir, 'gameday-plan.md'), plan.markdown, 'utf-8');

  // FIS実験テンプレート (FIS API形式 + CFnデプロイ可能形式)
  for (const fis of fisTemplates) {
    fs.writeFileSync(
      path.join(outputDir, 'fis-templates', `${fis.scenarioId}.json`),
      JSON.stringify(fis.template, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(outputDir, 'fis-cfn', `${fis.scenarioId}.cfn.json`),
      JSON.stringify(fis.cfn, null, 2),
      'utf-8',
    );
  }

  // 観測ポイント CloudFormation テンプレート
  fs.writeFileSync(
    path.join(outputDir, 'observation-cfn.json'),
    JSON.stringify(observationCfn, null, 2),
    'utf-8',
  );

  // HTMLダッシュボード
  fs.writeFileSync(path.join(outputDir, 'dashboard.html'), dashboardHtml, 'utf-8');

  // シナリオ一覧
  fs.writeFileSync(
    path.join(outputDir, 'scenarios.json'),
    JSON.stringify(scenarios, null, 2),
    'utf-8',
  );
}

// ============================================================
// デモ実行
// ============================================================

export interface DemoOptions {
  outputDir: string;
  duration: PlanOptions['duration'];
  participantCount: number;
}

/**
 * デモモードを実行する
 *
 * マルチリージョン構成のサンプルテンプレートを使用して、
 * 全工程をステップバイステップで実行する。
 */
export async function runDemo(options: DemoOptions): Promise<void> {
  const { outputDir, duration, participantCount } = options;

  printBanner();

  // デモシナリオの紹介
  console.log('  📋 デモで検証するシナリオ:');
  console.log(`    • ${demoScenarioDescriptions.multiRegionFailover.title}`);
  console.log(`    • ${demoScenarioDescriptions.pqcMigration.title}`);
  console.log(`    • ${demoScenarioDescriptions.ransomware.title}`);
  console.log('');

  // ── Step 1: 構成情報の解析 ──
  printStep(1, '構成情報の解析', 'CloudFormationテンプレートを解析し、リソース構成を把握します。');

  const parseResult = parse(multiRegionTemplate, 'cfn-json', 'demo-multi-region.json');
  if (!parseResult.ok) {
    console.error(`  ❌ 解析エラー: ${parseResult.error.message}`);
    return;
  }
  const config: InfraConfig = parseResult.value;

  printResult('検出リソース数', config.resources.length);
  printResult('リージョン', config.regions.join(', '));
  printResult('マルチリージョン', config.metadata.isMultiRegion ? 'はい' : 'いいえ');
  printResult('暗号化設定', config.metadata.hasEncryption ? 'あり' : 'なし');
  printResult('X-Rayトレーシング', config.metadata.hasXRayTracing ? '有効' : '無効');

  // ── Step 2: 障害シナリオの生成 ──
  printStep(2, '障害シナリオの生成', '構成情報を基に、想定される障害シナリオを自動生成します。');

  const scenarios = generateScenarios(config);

  printResult('生成シナリオ数', scenarios.length);
  const categories = [...new Set(scenarios.map((s) => s.category))];
  printResult('カテゴリ', categories.join(', '));
  const severities = scenarios.reduce(
    (acc, s) => {
      acc[s.severity] = (acc[s.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  for (const [sev, count] of Object.entries(severities)) {
    printResult(`  ${sev}`, `${count}件`);
  }

  // PQC / ランサムウェア / マルチリージョンタグの確認
  const pqcScenarios = scenarios.filter((s) => s.tags.includes('pqc'));
  const ransomwareScenarios = scenarios.filter((s) => s.tags.includes('ransomware'));
  const multiRegionScenarios = scenarios.filter((s) => s.tags.includes('multi-region'));
  if (pqcScenarios.length > 0) printResult('PQC移行シナリオ', `${pqcScenarios.length}件`);
  if (ransomwareScenarios.length > 0) printResult('ランサムウェア対策', `${ransomwareScenarios.length}件`);
  if (multiRegionScenarios.length > 0) printResult('マルチリージョン', `${multiRegionScenarios.length}件`);

  // ── Step 3: GameDay実施計画の策定 ──
  printStep(3, 'GameDay実施計画の策定', 'シナリオの重大度と依存関係を考慮した実施計画を生成します。');

  const planOptions: PlanOptions = { duration, participantCount };
  const plan = generatePlan(scenarios, planOptions);
  const markdown = toMarkdown(plan, scenarios);

  printResult('実施形式', duration);
  printResult('参加者数', participantCount);
  printResult('タイムラインエントリ', plan.timeline.length);
  printResult('役割数', plan.roles.length);

  // ── Step 4: FIS実験テンプレートの生成 ──
  printStep(4, 'FIS実験テンプレートの生成', 'AWS FIS用の実験テンプレートを生成します。');

  const fisTemplates: Array<{ scenarioId: string; template: object; cfn: object }> = [];
  let fisSuccessCount = 0;
  let fisWarningCount = 0;

  for (const scenario of scenarios) {
    const result = buildFIS(scenario, config);
    if (result.ok) {
      const validation = validateFIS(result.value);
      const cfn = buildFISCfn(result.value, {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
      });
      if (validation.valid) {
        fisTemplates.push({ scenarioId: scenario.id, template: result.value, cfn });
        fisSuccessCount++;
      } else {
        printWarning(`${scenario.name}: バリデーション警告 - ${validation.errors.join(', ')}`);
        fisWarningCount++;
        // バリデーション警告があっても出力に含める
        fisTemplates.push({ scenarioId: scenario.id, template: result.value, cfn });
      }
    } else {
      printWarning(`${scenario.name}: ${result.error.reason}`);
      fisWarningCount++;
    }
  }

  printResult('生成成功', `${fisSuccessCount}件`);
  if (fisWarningCount > 0) printResult('警告/スキップ', `${fisWarningCount}件`);

  // ── Step 5: 観測ポイントの定義 ──
  printStep(5, '観測ポイントの定義', 'CloudWatchメトリクス、アラーム、ログフィルタを定義します。');

  const observations = generateObservationPoints(scenarios, config);
  const observationCfn = toCloudFormation(observations);

  printResult('観測ポイント数', observations.length);
  const obsTypes = observations.reduce(
    (acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  for (const [type, count] of Object.entries(obsTypes)) {
    printResult(`  ${type}`, `${count}件`);
  }

  // ── Step 6: 評価基準の生成 ──
  printStep(6, '評価基準の生成', '検知時間、復旧時間、影響範囲把握度、コミュニケーションの評価基準を定義します。');

  const evaluations = generateEvaluationCriteria(scenarios);

  printResult('評価基準数', evaluations.length);
  const evalTypes = evaluations.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  for (const [type, count] of Object.entries(evalTypes)) {
    printResult(`  ${type}`, `${count}件`);
  }

  // ── Step 7: ダッシュボードの生成 ──
  printStep(7, 'ダッシュボードの生成', 'HTMLダッシュボードを生成し、全情報を可視化します。');

  const fisDeployments: FISDeploymentInfo[] = fisTemplates.map(fis => {
    const scenario = scenarios.find(s => s.id === fis.scenarioId);
    return {
      scenarioId: fis.scenarioId,
      scenarioName: scenario?.name ?? fis.scenarioId,
      cfnTemplate: fis.cfn,
      deployCommand: buildDeployCommand({
        templateFile: `./fis-cfn/${fis.scenarioId}.cfn.json`,
        scenarioId: fis.scenarioId,
      }),
      consoleDeepLink: buildConsoleDeepLink({ scenarioId: fis.scenarioId }),
    };
  });

  const dashboardHtml = generateDashboard({
    plan,
    scenarios,
    observations,
    evaluations,
    fisDeployments,
  });

  printResult('ダッシュボード', '生成完了');

  // ── 出力ファイル書き出し ──
  console.log('\n  💾 出力ファイルを書き出し中...');

  writeOutputFiles(outputDir, { markdown }, scenarios, fisTemplates, observationCfn, dashboardHtml);

  printResult('gameday-plan.md', '実施計画');
  printResult('fis-templates/', `${fisTemplates.length}件のFIS APIテンプレート`);
  printResult('fis-cfn/', `${fisTemplates.length}件のCFnデプロイ可能テンプレート`);
  printResult('observation-cfn.json', '観測ポイントCFn');
  printResult('dashboard.html', 'HTMLダッシュボード');
  printResult('scenarios.json', 'シナリオ一覧');

  // ── サマリー ──
  printSummary({
    resources: config.resources.length,
    scenarios: scenarios.length,
    fisTemplates: fisTemplates.length,
    observations: observations.length,
    evaluations: evaluations.length,
    outputDir,
  });
}
