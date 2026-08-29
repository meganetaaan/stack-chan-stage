export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ScenarioId = Brand<string, "ScenarioId">;
export type SceneId = Brand<string, "SceneId">;
export type LaneId = Brand<string, "LaneId">;
export type CueId = Brand<string, "CueId">;
export type RoleId = Brand<string, "RoleId">;
export type ActorId = Brand<string, "ActorId">;
export type AssetId = Brand<string, "AssetId">;
export type RunId = Brand<string, "RunId">;
export type CueExecutionId = Brand<string, "CueExecutionId">;

export const asScenarioId = (value: string): ScenarioId => value as ScenarioId;
export const asSceneId = (value: string): SceneId => value as SceneId;
export const asLaneId = (value: string): LaneId => value as LaneId;
export const asCueId = (value: string): CueId => value as CueId;
export const asRoleId = (value: string): RoleId => value as RoleId;
export const asActorId = (value: string): ActorId => value as ActorId;
export const asAssetId = (value: string): AssetId => value as AssetId;
export const asRunId = (value: string): RunId => value as RunId;
export const asCueExecutionId = (value: string): CueExecutionId =>
  value as CueExecutionId;

export const canonicalJson = (value: unknown): string => {
  const visit = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, visit(item)]),
      );
    }
    return entry;
  };
  return JSON.stringify(visit(value));
};

export const deepFreeze = <T>(value: T): Readonly<T> => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
  }
  return value;
};

export type ValidationIssue = Readonly<{
  code: string;
  message: string;
  path: readonly (string | number)[];
  severity: "error" | "warning";
}>;

export const issue = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
  severity: ValidationIssue["severity"] = "error",
): ValidationIssue => ({ code, message, path, severity });
