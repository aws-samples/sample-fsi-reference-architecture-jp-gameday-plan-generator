import { describe, it, expect } from 'vitest';
import {
  toCfn,
  buildConsoleDeepLink,
  buildDeployCommand,
  build as buildFIS,
} from '../../src/fis/index.js';
import type { FailureScenario, FISExperimentTemplate } from '../../src/types/index.js';

function makeScenario(id: string, opts: Partial<FailureScenario> = {}): FailureScenario {
  return {
    id,
    name: opts.name ?? `Scenario ${id}`,
    category: opts.category ?? 'infrastructure',
    severity: opts.severity ?? 'High',
    description: opts.description ?? `desc for ${id}`,
    affectedResources: opts.affectedResources ?? [`res-${id}`],
    impactScope: opts.impactScope ?? 'local',
    prerequisites: opts.prerequisites ?? ['prereq'],
    steps: opts.steps ?? [{ order: 1, action: 'execute', target: 'EC2Instance' }],
    expectedOutcome: opts.expectedOutcome ?? 'recovered',
    rollbackSteps: opts.rollbackSteps ?? ['rollback'],
    estimatedDuration: opts.estimatedDuration ?? 30,
    tags: opts.tags ?? [],
  };
}

function buildTemplateOrFail(scenario: FailureScenario): FISExperimentTemplate {
  const result = buildFIS(scenario);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('build failed');
  return result.value;
}

// ============================================================
// 構造の正常性
// ============================================================

describe('toCfn: テンプレ全体構造', () => {
  it('AWSTemplateFormatVersion / Description / Resources を持つ', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id, scenarioName: scenario.name });

    expect(cfn.AWSTemplateFormatVersion).toBe('2010-09-09');
    expect(cfn.Description).toContain(scenario.name);
    expect(typeof cfn.Resources).toBe('object');
    expect(Object.keys(cfn.Resources).length).toBeGreaterThan(0);
  });

  it('IAM Role / CloudWatch Alarm / FIS::ExperimentTemplate を含む', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::IAM::Role');
    expect(types).toContain('AWS::CloudWatch::Alarm');
    expect(types).toContain('AWS::FIS::ExperimentTemplate');
  });

  it('Parameters に既存ロール/既存アラームの差し替え口がある', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    expect(cfn.Parameters.ExistingFISRoleArn).toBeDefined();
    expect(cfn.Parameters.ExistingGuardrailAlarmArn).toBeDefined();
  });

  it('Outputs に ExperimentTemplateId と StartExperimentCommand がある', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    expect(cfn.Outputs.ExperimentTemplateId).toBeDefined();
    expect(cfn.Outputs.StartExperimentCommand).toBeDefined();
    // start-experiment コマンドが含まれている
    const cmdValue = JSON.stringify(cfn.Outputs.StartExperimentCommand.Value);
    expect(cmdValue).toContain('aws fis start-experiment');
  });

  it('JSON 化してもスキーマ等価でround-tripする', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });
    const roundTripped = JSON.parse(JSON.stringify(cfn));
    expect(roundTripped).toEqual(cfn);
  });
});

// ============================================================
// IAM Role / 権限
// ============================================================

describe('toCfn: IAM Role', () => {
  it('FISサービスからAssumeRoleできるTrust Policyを持つ', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const role = Object.values(cfn.Resources).find(r => r.Type === 'AWS::IAM::Role');
    expect(role).toBeDefined();
    const trustDoc = role!.Properties.AssumeRolePolicyDocument as {
      Statement: Array<{ Principal: { Service: string }; Action: string }>;
    };
    expect(trustDoc.Statement[0].Principal.Service).toBe('fis.amazonaws.com');
    expect(trustDoc.Statement[0].Action).toBe('sts:AssumeRole');
  });

  it('EC2 stop シナリオなら ec2:StopInstances 権限を含む', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const role = Object.values(cfn.Resources).find(r => r.Type === 'AWS::IAM::Role');
    const policies = role!.Properties.Policies as Array<{
      PolicyDocument: { Statement: Array<{ Action: string[] }> };
    }>;
    const allActions = policies.flatMap(p => p.PolicyDocument.Statement.flatMap(s => s.Action));
    expect(allActions).toContain('ec2:StopInstances');
  });

  it('RDS reboot シナリオなら rds:RebootDBInstance 権限を含む', () => {
    const scenario = makeScenario('rds-fo', {
      steps: [{ order: 1, action: 'Reboot', target: 'RDSDBInstance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const role = Object.values(cfn.Resources).find(r => r.Type === 'AWS::IAM::Role');
    const policies = role!.Properties.Policies as Array<{
      PolicyDocument: { Statement: Array<{ Action: string[] }> };
    }>;
    const allActions = policies.flatMap(p => p.PolicyDocument.Statement.flatMap(s => s.Action));
    expect(allActions).toContain('rds:RebootDBInstance');
  });
});

// ============================================================
// ExperimentTemplate プロパティ
// ============================================================

describe('toCfn: AWS::FIS::ExperimentTemplate', () => {
  it('Targets/Actions/StopConditions/RoleArn を持つ', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const fisRes = Object.values(cfn.Resources).find(
      r => r.Type === 'AWS::FIS::ExperimentTemplate',
    );
    expect(fisRes).toBeDefined();
    const props = fisRes!.Properties;
    expect(props.Targets).toBeDefined();
    expect(props.Actions).toBeDefined();
    expect(props.StopConditions).toBeDefined();
    expect(props.RoleArn).toBeDefined();
  });

  it('Tagsに gameday:scenario-id が含まれる', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const fisRes = Object.values(cfn.Resources).find(
      r => r.Type === 'AWS::FIS::ExperimentTemplate',
    );
    const tags = fisRes!.Properties.Tags as Record<string, string>;
    expect(tags['gameday:scenario-id']).toBe(scenario.id);
    expect(tags['gameday:source']).toBe('gameday-plan-generator');
  });

  it('ターゲットの ResourceType / SelectionMode が CFn 形式で出力される', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const fisRes = Object.values(cfn.Resources).find(
      r => r.Type === 'AWS::FIS::ExperimentTemplate',
    );
    const targets = fisRes!.Properties.Targets as Record<string, Record<string, unknown>>;
    const firstTarget = Object.values(targets)[0];
    expect(firstTarget.ResourceType).toMatch(/^aws:/);
    expect(['ALL', 'COUNT', 'PERCENT']).toContain(firstTarget.SelectionMode);
  });

  it('action.duration は parameters.duration として出力される', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    // EC2 stop は defaultDuration: 'PT5M' を持つ
    const cfn = toCfn(fis, { scenarioId: scenario.id });
    const fisRes = Object.values(cfn.Resources).find(
      r => r.Type === 'AWS::FIS::ExperimentTemplate',
    );
    const actions = fisRes!.Properties.Actions as Record<
      string,
      { Parameters?: Record<string, string> }
    >;
    const firstAction = Object.values(actions)[0];
    expect(firstAction.Parameters?.duration).toBe('PT5M');
  });
});

// ============================================================
// プレースホルダーの自動差し替え
// ============================================================

describe('toCfn: プレースホルダー解決', () => {
  it('FISExperimentGuardrail プレースホルダーARNは Conditions による Fn::If に置換される', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const fisRes = Object.values(cfn.Resources).find(
      r => r.Type === 'AWS::FIS::ExperimentTemplate',
    );
    const stops = fisRes!.Properties.StopConditions as Array<Record<string, unknown>>;
    expect(stops.length).toBeGreaterThan(0);
    // Value が { 'Fn::If': [...] } に変換されていること
    const value = stops[0].Value as Record<string, unknown>;
    expect(value['Fn::If']).toBeDefined();
  });

  it('Conditions セクションが定義される', () => {
    const scenario = makeScenario('ec2-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const fis = buildTemplateOrFail(scenario);
    const cfn = toCfn(fis, { scenarioId: scenario.id });

    const conditions = (cfn as unknown as { Conditions?: Record<string, unknown> }).Conditions;
    expect(conditions).toBeDefined();
    expect(conditions!.UseGeneratedGuardrail).toBeDefined();
    expect(conditions!.UseGeneratedRole).toBeDefined();
  });
});

// ============================================================
// CFn コンソール ディープリンク
// ============================================================

describe('buildConsoleDeepLink', () => {
  it('quickcreate URL を生成', () => {
    const url = buildConsoleDeepLink({
      scenarioId: 'ec2-stop',
      region: 'us-east-1',
    });
    expect(url).toContain('us-east-1.console.aws.amazon.com');
    expect(url).toContain('cloudformation/home');
    expect(url).toContain('quickcreate');
    expect(url).toContain('stackName=gameday-fis-ec2-stop');
  });

  it('templateUrl 指定時は templateURL クエリを含む', () => {
    const url = buildConsoleDeepLink({
      scenarioId: 'ec2-stop',
      templateUrl: 'https://example.s3.amazonaws.com/template.json',
    });
    expect(url).toContain('templateURL=');
    expect(url).toContain(encodeURIComponent('https://example.s3.amazonaws.com/template.json'));
  });

  it('region未指定なら ap-northeast-1 がデフォルト', () => {
    const url = buildConsoleDeepLink({ scenarioId: 'x' });
    expect(url).toContain('ap-northeast-1');
  });

  it('scenarioIdは英数字以外をハイフンに変換', () => {
    const url = buildConsoleDeepLink({ scenarioId: 'foo bar/baz' });
    expect(url).toContain('stackName=gameday-fis-foo-bar-baz');
  });
});

// ============================================================
// CLI deploy コマンド
// ============================================================

describe('buildDeployCommand', () => {
  it('aws cloudformation deploy コマンドを生成', () => {
    const cmd = buildDeployCommand({
      templateFile: './fis-cfn/ec2-stop.json',
      scenarioId: 'ec2-stop',
      region: 'us-east-1',
    });
    expect(cmd).toContain('aws cloudformation deploy');
    expect(cmd).toContain('--template-file ./fis-cfn/ec2-stop.json');
    expect(cmd).toContain('--stack-name gameday-fis-ec2-stop');
    expect(cmd).toContain('--region us-east-1');
    expect(cmd).toContain('CAPABILITY_NAMED_IAM');
  });
});
