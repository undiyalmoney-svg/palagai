const MAX_COMBINATIONS = 128;

export function generateRuleCombinations(selectedRuleIds: string[]): string[][] {
  if (!selectedRuleIds.length) {
    return [[]];
  }

  const all: string[][] = [];
  const n = selectedRuleIds.length;

  for (let mask = 1; mask < 1 << n; mask += 1) {
    const combo: string[] = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        combo.push(selectedRuleIds[i]!);
      }
    }
    all.push(combo);
    if (all.length >= MAX_COMBINATIONS) {
      break;
    }
  }

  return all.length ? all : [[]];
}

export function combinationId(ruleIds: string[]): string {
  return ruleIds.slice().sort().join('+') || 'no-rules';
}

export function combinationLabel(ruleIds: string[], nameMap: Map<string, string>): string {
  if (!ruleIds.length) {
    return 'No rules';
  }
  return ruleIds.map((id) => nameMap.get(id) ?? id).join(' + ');
}
