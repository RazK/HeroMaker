/**
 * Steps configuration - fetched from backend on app init
 * Single source of truth for step names, display names, costs, and output files
 */
import { api, StepConfig } from '../api/client';

// Cached step configuration
let stepConfig: StepConfig[] = [];
let configLoaded = false;
let configPromise: Promise<StepConfig[]> | null = null;

/**
 * Load step configuration from backend (cached)
 */
export async function loadStepConfig(): Promise<StepConfig[]> {
  if (configLoaded) {
    return stepConfig;
  }
  
  // Avoid duplicate requests
  if (configPromise) {
    return configPromise;
  }
  
  configPromise = api.getStepsConfig().then((config) => {
    stepConfig = config;
    configLoaded = true;
    console.log('[StepsConfig] Loaded:', config);
    return config;
  });
  
  return configPromise;
}

/**
 * Get cached step configuration (must call loadStepConfig first)
 */
export function getStepConfig(): StepConfig[] {
  return stepConfig;
}

/**
 * Get step config by name
 */
export function getStepByName(name: string): StepConfig | undefined {
  return stepConfig.find(s => s.name === name);
}

/**
 * Get step display name
 */
export function getStepDisplayName(name: string): string {
  return getStepByName(name)?.display_name || name;
}

/**
 * Get step credit cost
 */
export function getStepCost(name: string): number {
  return getStepByName(name)?.credit_cost || 0;
}

/**
 * Get step output file
 */
export function getStepOutputFile(name: string): string | undefined {
  return getStepByName(name)?.output_file;
}

/**
 * Get total cost for all steps
 */
export function getTotalCost(): number {
  return stepConfig.reduce((sum, step) => sum + step.credit_cost, 0);
}

/**
 * Get all step names in order
 */
export function getStepOrder(): string[] {
  return stepConfig.map(s => s.name);
}

/**
 * Check if step config is loaded
 */
export function isConfigLoaded(): boolean {
  return configLoaded;
}
