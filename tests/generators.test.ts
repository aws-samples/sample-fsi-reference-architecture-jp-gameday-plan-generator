import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  infraConfigArb,
  awsResourceArb,
  failureScenarioArb,
  fisTemplateArb,
  planOptionsArb,
  dashboardDataArb,
  invalidInputArb,
} from './generators.js';
import {
  InfraConfigSchema,
  FISExperimentTemplateSchema,
} from '../src/types/index.js';

describe('fast-check ジェネレータの検証', () => {
  it('infraConfigArb は有効な InfraConfig を生成する', () => {
    fc.assert(
      fc.property(infraConfigArb, (config) => {
        const result = InfraConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('awsResourceArb は非空の logicalId と type を持つ', () => {
    fc.assert(
      fc.property(awsResourceArb, (resource) => {
        expect(resource.logicalId.length).toBeGreaterThan(0);
        expect(resource.type.length).toBeGreaterThan(0);
        expect(resource.region.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  it('failureScenarioArb は全カテゴリと全重大度を生成可能', () => {
    const categories = new Set<string>();
    const severities = new Set<string>();
    fc.assert(
      fc.property(failureScenarioArb, (scenario) => {
        categories.add(scenario.category);
        severities.add(scenario.severity);
        expect(scenario.id.length).toBeGreaterThan(0);
        expect(scenario.steps.length).toBeGreaterThan(0);
        expect(scenario.affectedResources.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
    expect(categories.size).toBe(5);
    expect(severities.size).toBe(4);
  });

  it('fisTemplateArb は有効な FISExperimentTemplate を生成する', () => {
    fc.assert(
      fc.property(fisTemplateArb, (template) => {
        const result = FISExperimentTemplateSchema.safeParse(template);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('planOptionsArb は有効な PlanOptions を生成する', () => {
    fc.assert(
      fc.property(planOptionsArb, (options) => {
        expect(['half-day', 'full-day', 'two-day']).toContain(options.duration);
        if (options.participantCount !== undefined) {
          expect(options.participantCount).toBeGreaterThanOrEqual(1);
          expect(options.participantCount).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('dashboardDataArb は有効な DashboardData を生成する', () => {
    fc.assert(
      fc.property(dashboardDataArb, (data) => {
        expect(data.plan).toBeDefined();
        expect(data.scenarios.length).toBeGreaterThan(0);
        expect(data.observations.length).toBeGreaterThan(0);
        expect(data.evaluations.length).toBeGreaterThan(0);
      }),
      { numRuns: 30 },
    );
  });

  it('dashboardDataArb は pastResults あり/なし両方を生成可能', () => {
    let hasWithPast = false;
    let hasWithoutPast = false;
    fc.assert(
      fc.property(dashboardDataArb, (data) => {
        if (data.pastResults !== undefined) hasWithPast = true;
        else hasWithoutPast = true;
      }),
      { numRuns: 100 },
    );
    expect(hasWithPast).toBe(true);
    expect(hasWithoutPast).toBe(true);
  });

  it('invalidInputArb は文字列を生成する', () => {
    fc.assert(
      fc.property(invalidInputArb, (input) => {
        expect(typeof input).toBe('string');
      }),
      { numRuns: 50 },
    );
  });
});
