import { createFileRoute } from "@tanstack/react-router";
import { runSelfChecks } from "@/lib/selfCheck";
import { formatNumber } from "@/lib/format";

export const Route = createFileRoute("/tests")({
  head: () => ({
    meta: [
      { title: "Self-check · Debt offset" },
      { name: "description", content: "Self-check of offset calculations on the seed data." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Self-check · Debt offset" },
      { property: "og:description", content: "Offset calculation self-check." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Tests,
});

function Tests() {
  const results = runSelfChecks();
  const passed = results.filter((r) => r.pass).length;
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-base font-semibold">Self-check on seed data · {passed}/{results.length} passed</h1>
      <div className="panel"><table className="dt">
        <thead><tr><th>Check</th><th className="num">Expected</th><th className="num">Actual</th><th>Result</th></tr></thead>
        <tbody>{results.map((r) => (
          <tr key={r.name}><td>{r.name}{r.detail && <div className="blocked-text">{r.detail}</div>}</td><td className="num">{formatNumber(r.expected, 2)}</td><td className="num">{r.actual === null ? "—" : formatNumber(r.actual, 2)}</td>
            <td><span className={r.pass ? "rounded bg-success-soft px-1.5 py-0.5 text-success-text" : "rounded bg-destructive-soft px-1.5 py-0.5 text-destructive-text"}>{r.pass ? "Pass" : "Fail"}</span></td></tr>))}</tbody>
      </table></div>
    </div>
  );
}
