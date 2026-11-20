/** Shared by the automatic overview and the dashboard hydrated by calm_show. */
export const metricsCss = `
.project-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(130px,100%),1fr));gap:10px;margin:14px 0}
.project-metric{min-width:0;padding:14px;background:var(--surface);border:1px solid var(--metric-edge);border-radius:10px;box-shadow:0 1px 3px #0001}
.project-metric span{display:block;font-size:13px;font-weight:600}
.project-metric strong{display:block;font-size:24px;line-height:1.25;margin:8px 0;font-variant-numeric:tabular-nums}
.project-metric progress{display:block;width:100%;height:5px;border:0;border-radius:3px;overflow:hidden;appearance:none;background:var(--metric-track)}
.project-metric progress::-webkit-progress-bar{background:var(--metric-track)}
.project-metric progress::-webkit-progress-value{background:#0070f2}
.project-metric progress::-moz-progress-bar{background:#0070f2}
`;

export const metricsScript = `
function projectMetrics(data) {
  const group = document.createElement("div");
  group.className = "project-metrics";
  const tile = (label, value, total) => {
    const card = document.createElement("div");
    card.className = "project-metric";
    const name = document.createElement("span"), number = document.createElement("strong");
    name.textContent = label;
    number.textContent = value == null ? "Unknown" : total == null ? String(value) : value + " / " + total;
    card.append(name, number);
    if (total > 0 && value != null) {
      const bar = document.createElement("progress");
      bar.max = total; bar.value = value;
      bar.setAttribute("aria-hidden","true");
      card.append(bar);
    }
    group.append(card);
  };
  const total = data.gaps?.openRequirementsAndStories;
  tile("Test coverage", total != null && data.gaps?.untested != null ? total - data.gaps.untested : null, total);
  const results = data.testResults;
  const planned = results && Object.entries(results).reduce((sum,[key,n]) => sum + (key === "notInPlan" ? 0 : n), 0);
  tile("Passed in plans", results && (results.passed ?? 0), planned);
  tile("Failed tests", results && (results.failed ?? 0));
  return group;
}
`;
