#!/usr/bin/env node

/**
 * GameDay Plan Generator CLI
 *
 * コマンド:
 *   generate <file>  - CloudFormationテンプレートからGameDay計画を生成
 *   demo             - デモモードで全工程を実行
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

import { parse } from './parser/index.js';
import { generateScenarios } from './scenario/index.js';
import { generate as generatePlan, toMarkdown } from './plan/index.js';
import { build as buildFIS, validate as validateFIS, toCfn as buildFISCfn, buildDeployCommand, buildConsoleDeepLink } from './fis/index.js';
import { generateObservationPoints, toCloudFormation } from './observation/index.js';
import { generateEvaluationCriteria } from './evaluation/index.js';
import { generate as generateDashboard } from './dashboard/index.js';
import { runDemo } from './demo/index.js';
import { generateLLMScenarios, enhanceScenarioDetails } from './llm/scenario-enhancer.js';

import type { PlanOptions, FISDeploymentInfo } from './types/index.js';

// ============================================================
// CLI定義
// ============================================================

const program = new Command();

program
  .name('gameday')
  .description('クラウド環境の構成情報からGameDay実施計画を自動生成するCLIツール')
  .version('0.1.0');

// ── generate コマンド ──
program
  .command('generate')
  .description('CloudFormationテンプレートからGameDay計画を生成')
  .argument('<file>', '入力ファイルパス（CloudFormation JSON/YAML）')
  .option('-o, --output <dir>', '出力ディレクトリ', './output')
  .option('-d, --duration <type>', '実施形式: half-day|full-day|two-day', 'full-day')
  .option('-p, --participants <n>', '参加者数', '6')
  .option('--model <key>', 'AIモデル: claude-opus-4-6 | claude-opus-4-7 | claude-opus-4-8', 'claude-opus-4-6')
  .option('--no-llm', 'AI強化を無効化（CLIのみ。デフォルトは有効）')
  .action(async (file: string, opts: { output: string; duration: string; participants: string; model: string; llm: boolean }) => {
    try {
      await runGenerate(file, {
        outputDir: opts.output,
        duration: opts.duration as PlanOptions['duration'],
        participantCount: parseInt(opts.participants, 10),
        useLLM: opts.llm !== false,
        modelKey: opts.model,
      });
    } catch (err) {
      console.error(`\n  ❌ エラー: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── demo コマンド ──
program
  .command('demo')
  .description('デモモードで全工程をステップバイステップ実行')
  .option('-o, --output <dir>', '出力ディレクトリ', './output')
  .option('-d, --duration <type>', '実施形式: half-day|full-day|two-day', 'full-day')
  .option('-p, --participants <n>', '参加者数', '6')
  .action(async (opts: { output: string; duration: string; participants: string }) => {
    try {
      await runDemo({
        outputDir: opts.output,
        duration: opts.duration as PlanOptions['duration'],
        participantCount: parseInt(opts.participants, 10),
      });
    } catch (err) {
      console.error(`\n  ❌ エラー: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();

// ============================================================
// generate コマンド実装
// ============================================================

interface GenerateOptions {
  outputDir: string;
  duration: PlanOptions['duration'];
  participantCount: number;
  useLLM: boolean;
  modelKey?: string;
}

async function runGenerate(filePath: string, options: GenerateOptions): Promise<void> {
  const { outputDir, duration, participantCount } = options;

  // ── 入力ファイル読み込み ──
  console.log(`\n  📂 入力ファイル: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`ファイルが見つかりません: ${filePath}`);
  }

  const input = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = path.basename(filePath);

  // ── Step 1: 構成情報の解析 ──
  console.log('  🔍 構成情報を解析中...');

  const parseResult = parse(input, undefined, sourceFile);
  if (!parseResult.ok) {
    throw new Error(
      `解析エラー (行${parseResult.error.line}, 列${parseResult.error.column}): ${parseResult.error.message}`,
    );
  }
  const config = parseResult.value;

  console.log(`    ✅ ${config.resources.length}個のリソースを検出`);
  console.log(`    ✅ リージョン: ${config.regions.join(', ')}`);

  // ── Step 2: 障害シナリオの生成 ──
  console.log('  ⚡ 障害シナリオを生成中...');

  let scenarios = generateScenarios(config);

  console.log(`    ✅ ${scenarios.length}個のルールベースシナリオを生成`);

  // ── Step 2.5: LLM強化（デフォルト有効） ──
  if (options.useLLM) {
    console.log(`  🤖 AI強化モード: LLM (${options.modelKey ?? 'default'}) でシナリオを分析中...`);
    try {
      const llmScenarios = await generateLLMScenarios(config, scenarios, options.modelKey);
      if (llmScenarios.length > 0) {
        scenarios = [...scenarios, ...llmScenarios];
        console.log(`    ✅ ${llmScenarios.length}個のAI生成シナリオを追加（合計${scenarios.length}個）`);
      }
      console.log('  🤖 シナリオ詳細を強化中...');
      scenarios = await enhanceScenarioDetails(scenarios, config);
      console.log('    ✅ シナリオ詳細の強化完了');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ⚠️  LLM強化をスキップ: ${msg}`);
    }
  }

  // ── Step 3: GameDay実施計画の策定 ──
  console.log('  📋 GameDay実施計画を策定中...');

  const planOptions: PlanOptions = { duration, participantCount };
  const plan = generatePlan(scenarios, planOptions);
  const markdown = toMarkdown(plan, scenarios);

  console.log(`    ✅ 実施計画を生成（${duration}, ${participantCount}名）`);

  // ── Step 4: FIS実験テンプレートの生成 ──
  console.log('  🧪 FIS実験テンプレートを生成中...');

  const fisTemplates: Array<{ scenarioId: string; template: object; cfn: object }> = [];
  let fisWarnings = 0;

  for (const scenario of scenarios) {
    const result = buildFIS(scenario, config);
    if (result.ok) {
      const validation = validateFIS(result.value);
      const cfn = buildFISCfn(result.value, {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
      });
      fisTemplates.push({ scenarioId: scenario.id, template: result.value, cfn });
      if (!validation.valid) fisWarnings++;
    } else {
      fisWarnings++;
    }
  }

  console.log(`    ✅ ${fisTemplates.length}個のテンプレートを生成 (FIS API + CFnデプロイ用 両方)`);
  if (fisWarnings > 0) console.log(`    ⚠️  ${fisWarnings}件の警告`);

  // ── Step 5: 観測ポイントの定義 ──
  console.log('  👁️  観測ポイントを定義中...');

  const observations = generateObservationPoints(scenarios, config);
  const observationCfn = toCloudFormation(observations);

  console.log(`    ✅ ${observations.length}個の観測ポイントを定義`);

  // ── Step 6: 評価基準の生成 ──
  console.log('  📊 評価基準を生成中...');

  const evaluations = generateEvaluationCriteria(scenarios);

  console.log(`    ✅ ${evaluations.length}個の評価基準を生成`);

  // ── Step 7: ダッシュボードの生成 ──
  console.log('  🖥️  ダッシュボードを生成中...');

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

  console.log('    ✅ HTMLダッシュボードを生成');

  // ── 出力ファイル書き出し ──
  console.log(`\n  💾 出力ファイルを書き出し中... → ${outputDir}`);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'fis-templates'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'fis-cfn'), { recursive: true });

  // GameDay実施計画
  fs.writeFileSync(path.join(outputDir, 'gameday-plan.md'), markdown, 'utf-8');

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

  // 観測ポイント CloudFormation
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

  // ── 完了 ──
  console.log('');
  console.log('  🎉 生成完了！');
  console.log(`    📄 gameday-plan.md          - GameDay実施計画`);
  console.log(`    🧪 fis-templates/           - FIS実験テンプレート (FIS API形式, ${fisTemplates.length}件)`);
  console.log(`    🚀 fis-cfn/                 - FIS実験テンプレート (CFnデプロイ可能, ${fisTemplates.length}件)`);
  console.log(`    👁️  observation-cfn.json     - 観測ポイントCFn`);
  console.log(`    🖥️  dashboard.html           - HTMLダッシュボード`);
  console.log(`    📋 scenarios.json           - シナリオ一覧`);
  console.log('');
}
