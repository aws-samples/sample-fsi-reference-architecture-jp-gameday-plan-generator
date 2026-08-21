/**
 * GameDay Plan Generator - Web GUI サーバー
 *
 * ファイルアップロード（CFn JSON/YAML or 構成図）から
 * GameDayシナリオを生成するWebインターフェース。
 * 生成後はチャットで対話的に計画を編集できる。
 */

import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../parser/index.js';
import { generateScenarios } from '../scenario/index.js';
import { generate as generatePlan, toMarkdown } from '../plan/index.js';
import { buildTimelineRationales } from '../plan/timeline.js';
import { build as buildFIS, toCfn as buildFISCfn, buildDeployCommand, buildConsoleDeepLink } from '../fis/index.js';
import { generateObservationPoints, toCloudFormation } from '../observation/index.js';
import { generateEvaluationCriteria } from '../evaluation/index.js';
import { generate as generateDashboard } from '../dashboard/index.js';
import { convertImageToCfn } from './image-converter.js';
import { generateLLMScenarios, generateAdvice, generateRationales } from '../llm/scenario-enhancer.js';
import { SUPPORTED_MODELS } from '../llm/bedrock-client.js';
import { processChatMessage, type ChatAction } from '../llm/chat-editor.js';
import { renderUploadPage } from './pages/upload.js';
import { renderErrorPage } from './pages/error.js';
import { renderJobProgressPage } from './pages/job-progress.js';
import { renderHistoryPage } from './pages/history.js';
import {
  createSessionId,
  saveSession,
  getSession,
  listSessions,
  type Session,
} from './session.js';
import { getOutputStore } from './output-store-factory.js';
import type { OutputStore } from './output-store.js';
import {
  createJob,
  getJob,
  updateJobProgress,
  completeJob,
  failJob,
} from './job-store.js';

import type { PlanOptions, FailureScenario, FISDeploymentInfo } from '../types/index.js';

/** ダッシュボード用のFISデプロイ情報を組み立てる（CFn変換に成功したシナリオのみ） */
function buildFISDeployments(
  fisTemplates: Array<{ scenarioId: string; cfn: object }>,
  scenarios: FailureScenario[],
  sessionId?: string,
): FISDeploymentInfo[] {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const scenarioMap = new Map(scenarios.map(s => [s.id, s]));
  return fisTemplates
    .filter(f => scenarioMap.has(f.scenarioId))
    .map(f => {
      const scenario = scenarioMap.get(f.scenarioId)!;
      return {
        scenarioId: f.scenarioId,
        scenarioName: scenario.name,
        cfnTemplate: f.cfn,
        deployCommand: buildDeployCommand({
          templateFile: `./fis-cfn/${f.scenarioId}.cfn.json`,
          scenarioId: f.scenarioId,
          region,
        }),
        consoleDeepLink: buildConsoleDeepLink({
          scenarioId: f.scenarioId,
          region,
        }),
        downloadUrl: sessionId ? `/fis-cfn/${sessionId}/${f.scenarioId}` : undefined,
      };
    });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const outputDir = path.join(__dirname, '../../output-web');
const storage: OutputStore = getOutputStore(outputDir);

// ローカルモードなら /output 静的配信を有効化（S3モードでは何もしない）
storage.writeStaticMiddleware(app);

// ── ヘルスチェック（ALBから叩かれる） ──
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── トップページ ──
app.get('/', async (_req, res) => {
  try {
    const recent = await listSessions(5);
    res.send(renderUploadPage(recent));
  } catch {
    res.send(renderUploadPage([]));
  }
});

// ── 過去の計画一覧 ──
app.get('/history', async (_req, res) => {
  try {
    const sessions = await listSessions(50);
    res.send(renderHistoryPage(sessions));
  } catch (err) {
    console.error('  ❌ 履歴取得エラー:', err);
    res.status(500).send(renderErrorPage('履歴の取得に失敗しました'));
  }
});

// ── ファイルアップロード（非同期） ──
app.post('/generate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).send(renderErrorPage('ファイルがアップロードされていません'));
      return;
    }

    const file = req.file;
    const duration = (req.body?.duration ?? 'full-day') as PlanOptions['duration'];
    const participantCount = parseInt(req.body?.participants ?? '6', 10);
    const modelKey = String(req.body?.model ?? 'claude-opus-4-6');

    const ext = path.extname(file.originalname).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
    const isCfn = ['.json', '.yaml', '.yml', '.template'].includes(ext);

    if (!isImage && !isCfn) {
      fs.unlinkSync(file.path);
      res.status(400).send(renderErrorPage(
        `未対応のファイル形式です: ${ext}\n対応形式: .json, .yaml, .yml, .png, .jpg, .jpeg`
      ));
      return;
    }

    // ジョブを作成し、バックグラウンドで実行
    const job = await createJob();
    console.log(`\n  📂 [${job.id}] アップロード: ${file.originalname} (${(file.size / 1024).toFixed(1)}KB)`);

    // 処理ページにリダイレクト（ジョブIDを渡す）
    res.send(renderJobProgressPage(job.id, file.originalname));

    // バックグラウンド実行
    processGenerateJob(job.id, {
      filePath: file.path,
      fileName: file.originalname,
      isImage,
      duration,
      participantCount,
      modelKey,
    }).catch(async err => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ [${job.id}] バックグラウンドエラー:`, msg);
      // 一時ファイルクリーンアップ
      try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
      await failJob(job.id, msg);
    });
  } catch (err) {
    console.error('  ❌ エラー:', err);
    res.status(500).send(renderErrorPage(
      `処理中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`
    ));
  }
});

// ── ジョブステータスSSE ──
app.get('/jobs/:jobId/stream', async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // プロキシのバッファリング無効化
  res.flushHeaders();

  // 現在の状態を即送信
  const sendEvent = (type: string, data: object): void => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('progress', job.progress);
  if (job.status === 'completed' && job.sessionId) {
    sendEvent('completed', { sessionId: job.sessionId });
    res.end();
    return;
  }
  if (job.status === 'failed') {
    sendEvent('failed', { error: job.error ?? 'unknown' });
    res.end();
    return;
  }

  const onProgress = (progress: object): void => sendEvent('progress', progress);
  const onCompleted = (data: object): void => {
    sendEvent('completed', data);
    res.end();
  };
  const onFailed = (data: object): void => {
    sendEvent('failed', data);
    res.end();
  };

  job.emitter.on('progress', onProgress);
  job.emitter.on('completed', onCompleted);
  job.emitter.on('failed', onFailed);

  // ハートビート（30秒ごと）
  const heartbeat = setInterval(() => res.write(':\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    job.emitter.off('progress', onProgress);
    job.emitter.off('completed', onCompleted);
    job.emitter.off('failed', onFailed);
  });
});

// ── ジョブステータスJSON ──
app.get('/jobs/:jobId', async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    sessionId: job.sessionId,
    error: job.error,
  });
});

// ── ダウンロード（zip） ──
app.get('/download/:sessionId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    res.status(404).send('Session not found');
    return;
  }

  const archive = archiver('zip', { zlib: { level: 9 } });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="gameday-${session.id}.zip"`);
  archive.pipe(res);

  // 各ファイルを取得してzipに追加
  const keyPrefix = `sessions/${session.id}`;
  const files = [
    { key: `${keyPrefix}/gameday-plan.md`, name: 'gameday-plan.md' },
    { key: `${keyPrefix}/observation-cfn.json`, name: 'observation-cfn.json' },
    { key: `${keyPrefix}/dashboard.html`, name: 'dashboard.html' },
    { key: `${keyPrefix}/scenarios.json`, name: 'scenarios.json' },
  ];

  for (const f of files) {
    const content = await storage.get(f.key);
    if (content) archive.append(content, { name: f.name });
  }

  // FISテンプレート群（FIS API形式 + CFn形式）
  for (const scenario of session.scenarios) {
    const fisKey = `${keyPrefix}/fis-templates/${scenario.id}.json`;
    const fisContent = await storage.get(fisKey);
    if (fisContent) archive.append(fisContent, { name: `fis-templates/${scenario.id}.json` });

    const cfnKey = `${keyPrefix}/fis-cfn/${scenario.id}.cfn.json`;
    const cfnContent = await storage.get(cfnKey);
    if (cfnContent) archive.append(cfnContent, { name: `fis-cfn/${scenario.id}.cfn.json` });
  }

  await archive.finalize();
});

// ── 個別 CFn ダウンロード（コピペ orコンソールへの直接アップロード用） ──
app.get('/fis-cfn/:sessionId/:scenarioId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    res.status(404).send('Session not found');
    return;
  }
  const scenario = session.scenarios.find(s => s.id === req.params.scenarioId);
  if (!scenario) {
    res.status(404).send('Scenario not found');
    return;
  }
  const cfnKey = `sessions/${session.id}/fis-cfn/${scenario.id}.cfn.json`;
  const content = await storage.get(cfnKey);
  if (!content) {
    res.status(404).send('CFn template not found (FIS unsupported scenario?)');
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="gameday-fis-${scenario.id}.cfn.json"`,
  );
  res.send(content);
});

// ── CFn テンプレート (生 JSON) — ダッシュボードのコピー/プレビュー用 ──
app.get('/fis-cfn/:sessionId/:scenarioId/raw', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const scenario = session.scenarios.find(s => s.id === req.params.scenarioId);
  if (!scenario) {
    res.status(404).json({ error: 'Scenario not found' });
    return;
  }
  const cfnKey = `sessions/${session.id}/fis-cfn/${scenario.id}.cfn.json`;
  const content = await storage.get(cfnKey);
  if (!content) {
    res.status(404).json({ error: 'CFn not found (FIS unsupported scenario)' });
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.send(content);
});

// ── ダッシュボード（セッション対応） ──
app.get('/dashboard/:sessionId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    res.status(404).send(renderErrorPage('セッションが見つかりません。計画を再生成してください。'));
    return;
  }

  // FIS テンプレートを再ビルド（pure な変換なのでセッション保存は不要） + ダッシュボード用情報を組み立て
  const fisTemplates: Array<{ scenarioId: string; cfn: object }> = [];
  for (const scenario of session.scenarios) {
    const result = buildFIS(scenario, session.config);
    if (result.ok) {
      const cfn = buildFISCfn(result.value, {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
      });
      fisTemplates.push({ scenarioId: scenario.id, cfn });
    }
  }
  const fisDeployments = buildFISDeployments(fisTemplates, session.scenarios, session.id);
  const timelineRationales = buildTimelineRationales(session.plan.timeline, session.scenarios);

  const html = generateDashboard({
    plan: session.plan,
    scenarios: session.scenarios,
    observations: session.observations,
    evaluations: session.evaluations,
    sessionId: session.id,
    chatHistory: session.chatHistory,
    fisDeployments,
    advice: session.advice,
    config: session.config,
    timelineRationales,
  });
  res.send(html);
});

// ── チャットAPI ──
app.post('/chat/:sessionId', async (req, res) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'セッションが見つかりません' });
      return;
    }

    const userMessage = String(req.body?.message ?? '').trim();
    if (!userMessage) {
      res.status(400).json({ error: 'メッセージが空です' });
      return;
    }

    console.log(`\n  💬 チャット [${session.id}]: ${userMessage}`);

    const response = await processChatMessage({
      userMessage,
      scenarios: session.scenarios,
      plan: session.plan,
      planOptions: session.planOptions,
      chatHistory: session.chatHistory,
    });

    // アクションを適用
    const updated = await applyActions(session, response.actions);

    // 履歴追加
    const now = Date.now();
    updated.chatHistory = [
      ...updated.chatHistory,
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: response.message, timestamp: now + 1 },
    ];

    await saveSession(updated);

    console.log(`    ✅ ${response.actions.length}件のアクションを適用`);

    res.json({
      message: response.message,
      actions: response.actions,
      summary: {
        duration: updated.planOptions.duration,
        participantCount: updated.planOptions.participantCount,
        scheduledScenarios: updated.plan.scenarios.length,
        totalScenarios: updated.scenarios.length,
      },
    });
  } catch (err) {
    console.error('  ❌ チャットエラー:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================
// バックグラウンドジョブ処理
// ============================================================

interface GenerateJobInput {
  filePath: string;
  fileName: string;
  isImage: boolean;
  duration: PlanOptions['duration'];
  participantCount: number;
  modelKey: string;
}

async function processGenerateJob(jobId: string, input: GenerateJobInput): Promise<void> {
  const { filePath, fileName, isImage, duration, participantCount, modelKey } = input;

  // 一時ファイル削除ヘルパー（冪等）
  const cleanupFile = (): void => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  };

  try {
    // Step 1: 入力読み込み
    await updateJobProgress(jobId, { step: 'reading', message: 'ファイルを読み込み中...', percent: 5 });
    let cfnContent: string;

    if (isImage) {
      const modelLabel = SUPPORTED_MODELS[modelKey as keyof typeof SUPPORTED_MODELS]?.label ?? modelKey;
      await updateJobProgress(jobId, {
        step: 'image-conversion',
        message: `🖼️ 構成図をBedrock (${modelLabel}) で解析中...`,
        percent: 15,
      });
      const imageBuffer = fs.readFileSync(filePath);
      const convertResult = await convertImageToCfn(imageBuffer, fileName, modelKey);
      if (!convertResult.ok) {
        cleanupFile();
        await failJob(jobId, `構成図の変換に失敗しました: ${convertResult.error}`);
        return;
      }
      cfnContent = convertResult.value;
    } else {
      cfnContent = fs.readFileSync(filePath, 'utf-8');
    }
    cleanupFile();

    // Step 2: 解析
    await updateJobProgress(jobId, { step: 'parsing', message: '🔍 構成情報を解析中...', percent: 30 });
    const parseResult = parse(cfnContent, undefined, fileName);
    if (!parseResult.ok) {
      await failJob(jobId, `テンプレート解析エラー (行${parseResult.error.line}): ${parseResult.error.message}`);
      return;
    }
    const config = parseResult.value;

    // Step 3: シナリオ生成
    await updateJobProgress(jobId, {
      step: 'scenarios',
      message: `⚡ シナリオ生成中... (${config.resources.length}リソース)`,
      percent: 40,
    });
    let scenarios = generateScenarios(config);

    // Step 4: AI強化（必須）
    // 追加シナリオ生成とアドバイス生成を独立して実行する。
    // 片方が失敗してももう片方の結果は活かす（Promise.allSettled）。
    let advice = '';
    await updateJobProgress(jobId, {
      step: 'ai-enhance',
      message: `🤖 AIで追加シナリオ + アドバイスを生成中... (${modelKey})`,
      percent: 55,
    });
    const [scenarioResult, adviceResultSettled] = await Promise.allSettled([
      generateLLMScenarios(config, scenarios, modelKey),
      generateAdvice(config, scenarios, modelKey),
    ]);

    if (scenarioResult.status === 'fulfilled' && scenarioResult.value.length > 0) {
      scenarios = [...scenarios, ...scenarioResult.value];
    } else if (scenarioResult.status === 'rejected') {
      console.log(`    ⚠️  追加シナリオ生成失敗: ${String(scenarioResult.reason)}`);
    }

    if (adviceResultSettled.status === 'fulfilled' && adviceResultSettled.value) {
      advice = adviceResultSettled.value;
    } else {
      const reason =
        adviceResultSettled.status === 'rejected'
          ? String(adviceResultSettled.reason)
          : 'モデルからの応答が空でした';
      console.log(`    ⚠️  アドバイス生成失敗 (model=${modelKey}): ${reason}`);
      // 展示中に無言で消えると原因究明できないため、画面に痕跡を残す。
      advice =
        `> ⚠️ **AI分析レポートを生成できませんでした**\n\n` +
        `モデル \`${modelKey}\` でのレポート生成に失敗しました。` +
        `モデルアクセス権限（Bedrock IAM）またはモデルIDをご確認ください。\n\n` +
        `他のシナリオ・計画・FISテンプレートは正常に生成されています。`;
    }

    // Step 4.5: 各シナリオに rationale を付与
    await updateJobProgress(jobId, {
      step: 'rationales',
      message: `🧠 各シナリオの「なぜ必要か」を生成中...`,
      percent: 68,
    });
    try {
      scenarios = await generateRationales(scenarios, config, modelKey);
    } catch (err) {
      console.log(`    ⚠️  Rationale生成スキップ: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 5: 計画・FIS・観測・評価
    await updateJobProgress(jobId, { step: 'planning', message: '📋 計画策定 + FISテンプレート生成中...', percent: 75 });
    const planOptions: PlanOptions = { duration, participantCount };
    const { plan, observations, evaluations, fisTemplates, dashboardHtml, markdown, observationCfn } =
      buildArtifacts(scenarios, scenarios, config, planOptions, { advice });

    // Step 6: セッション保存
    await updateJobProgress(jobId, { step: 'saving', message: '💾 セッション保存中...', percent: 90 });
    const sessionId = createSessionId();
    const session: Session = {
      id: sessionId,
      createdAt: Date.now(),
      config,
      scenarios,
      plan,
      observations,
      evaluations,
      planOptions,
      advice,
      chatHistory: [],
    };
    await saveSession(session);

    // Step 7: ファイル書き出し
    await updateJobProgress(jobId, { step: 'writing', message: '📦 出力ファイル書き込み中...', percent: 95 });
    const keyPrefix = `sessions/${sessionId}`;
    await Promise.all([
      storage.writeText(`${keyPrefix}/gameday-plan.md`, markdown),
      ...fisTemplates.flatMap(fis => [
        storage.writeJson(`${keyPrefix}/fis-templates/${fis.scenarioId}.json`, fis.template),
        storage.writeJson(`${keyPrefix}/fis-cfn/${fis.scenarioId}.cfn.json`, fis.cfn),
      ]),
      storage.writeJson(`${keyPrefix}/observation-cfn.json`, observationCfn),
      storage.writeHtml(`${keyPrefix}/dashboard.html`, dashboardHtml),
      storage.writeJson(`${keyPrefix}/scenarios.json`, scenarios),
    ]);

    await completeJob(jobId, sessionId);
    console.log(`  🎉 [${jobId}] 生成完了 → セッション ${sessionId}`);
  } catch (err) {
    cleanupFile();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ [${jobId}] エラー:`, msg);
    await failJob(jobId, msg);
  }
}

// ============================================================
// ヘルパー関数
// ============================================================

function buildArtifacts(
  allScenarios: FailureScenario[],
  includedScenarios: FailureScenario[],
  config: Session['config'],
  planOptions: PlanOptions,
  opts: { advice?: string } = {},
) {
  const plan = generatePlan(includedScenarios, planOptions);
  const markdown = toMarkdown(plan, includedScenarios);

  const fisTemplates: Array<{ scenarioId: string; template: object; cfn: object }> = [];
  for (const scenario of allScenarios) {
    const result = buildFIS(scenario, config);
    if (result.ok) {
      const cfn = buildFISCfn(result.value, {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
      });
      fisTemplates.push({ scenarioId: scenario.id, template: result.value, cfn });
    }
  }

  const observations = generateObservationPoints(includedScenarios, config);
  const observationCfn = toCloudFormation(observations);
  const evaluations = generateEvaluationCriteria(includedScenarios);

  // FISデプロイ情報を組み立て（CFn変換成功シナリオのみ。downloadUrlはセッションがあるときのみ後付け）
  const fisDeployments = buildFISDeployments(fisTemplates, includedScenarios);
  const timelineRationales = buildTimelineRationales(plan.timeline, includedScenarios);

  const dashboardHtml = generateDashboard({
    plan,
    scenarios: includedScenarios,
    observations,
    evaluations,
    fisDeployments,
    advice: opts.advice,
    config,
    timelineRationales,
  });

  return { plan, observations, evaluations, fisTemplates, dashboardHtml, markdown, observationCfn };
}

/**
 * チャットアクションをセッションに適用し、関連アーティファクトを再生成する
 */
async function applyActions(session: Session, actions: ChatAction[]): Promise<Session> {
  let { scenarios, planOptions } = session;
  const excludedIds = new Set(
    session.scenarios
      .filter(s => !session.plan.scenarios.some(p => p.scenarioId === s.id))
      .map(s => s.id),
  );

  for (const action of actions) {
    switch (action.type) {
      case 'change-duration':
        planOptions = { ...planOptions, duration: action.duration };
        break;
      case 'change-participants':
        planOptions = { ...planOptions, participantCount: Math.max(1, Math.min(100, action.count)) };
        break;
      case 'exclude-scenarios':
        for (const id of action.scenarioIds) excludedIds.add(id);
        break;
      case 'include-scenarios':
        for (const id of action.scenarioIds) excludedIds.delete(id);
        break;
      case 'reorder-scenarios': {
        const idOrder = new Map(action.scenarioIds.map((id, i) => [id, i]));
        scenarios = [...scenarios].sort((a, b) => {
          const ai = idOrder.get(a.id);
          const bi = idOrder.get(b.id);
          if (ai === undefined && bi === undefined) return 0;
          if (ai === undefined) return 1;
          if (bi === undefined) return -1;
          return ai - bi;
        });
        break;
      }
    }
  }

  const includedScenarios = scenarios.filter(s => !excludedIds.has(s.id));

  const artifacts = buildArtifacts(scenarios, includedScenarios, session.config, planOptions, {
    advice: session.advice,
  });

  // 出力ファイルも更新（セッション別）
  const keyPrefix = `sessions/${session.id}`;
  try {
    await Promise.all([
      storage.writeText(`${keyPrefix}/gameday-plan.md`, artifacts.markdown),
      ...artifacts.fisTemplates.flatMap(fis => [
        storage.writeJson(`${keyPrefix}/fis-templates/${fis.scenarioId}.json`, fis.template),
        storage.writeJson(`${keyPrefix}/fis-cfn/${fis.scenarioId}.cfn.json`, fis.cfn),
      ]),
      storage.writeJson(`${keyPrefix}/observation-cfn.json`, artifacts.observationCfn),
      storage.writeHtml(`${keyPrefix}/dashboard.html`, artifacts.dashboardHtml),
      storage.writeJson(`${keyPrefix}/scenarios.json`, includedScenarios),
    ]);
  } catch (err) {
    console.log(`    ⚠️  出力ファイル更新失敗: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ...session,
    scenarios,
    plan: artifacts.plan,
    observations: artifacts.observations,
    evaluations: artifacts.evaluations,
    planOptions,
  };
}

// ── サーバー起動 ──
const PORT = parseInt(process.env.PORT ?? '3000', 10);

export function startServer(port: number = PORT): void {
  app.listen(port, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║   🎮  GameDay Plan Generator - Web GUI          ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  🌐 http://localhost:${port}`);
    console.log(`  🗄️  Session store: ${process.env.SESSION_STORE ?? 'memory'}`);
    console.log(`  💾 Output store:   ${process.env.OUTPUT_STORE ?? 'fs'}`);
    console.log('');
    console.log('  対応ファイル:');
    console.log('    📄 CloudFormation (.json, .yaml, .yml)');
    console.log('    🖼️  構成図 (.png, .jpg, .jpeg)');
    console.log('');
  });
}

startServer();
