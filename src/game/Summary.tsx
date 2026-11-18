import { ITEM_BY_ID, ITEMS } from "../sim/items";
import type { DayStats } from "../sim/day";
import type { Decision, MachineState } from "../sim/machine";
import Chart, { moneyTick } from "../ui/Chart";

interface DecisionListProps {
  decision: Decision | null;
}

function money(value: number): string {
  return value < 0
    ? `-$${Math.abs(value).toFixed(2)}`
    : `$${value.toFixed(2)}`;
}

function DecisionList({ decision }: DecisionListProps) {
  if (
    !decision ||
    (decision.plans.length === 0 && (decision.warehouseBuys?.length ?? 0) === 0)
  ) {
    return <p className="sub">No purchases planned.</p>;
  }
  return (
    <ul className="decision-list">
      {decision.plans.map((plan) => {
        const item = ITEM_BY_ID[plan.itemId];
        if (!item) return null;
        return (
          <li key={plan.itemId}>
            <span className="icon">{item.icon}</span>
            <span className="decision-name">{item.name}</span>
            <span>
              {[
                plan.buyQty > 0 ? `buy ${plan.buyQty}` : "",
                plan.refillQty ? `refill ${plan.refillQty}` : "",
              ]
                .filter(Boolean)
                .join(" · ") || "no restock"}
            </span>
            <span className="decision-price">{money(plan.price ?? 0)}</span>
          </li>
        );
      })}
      {(decision.warehouseBuys ?? []).map((buy) => {
        const item = ITEM_BY_ID[buy.itemId];
        if (!item) return null;
        return (
          <li key={`warehouse-${buy.itemId}`}>
            <span className="icon">▣</span>
            <span className="decision-name">{item.name} · backstock</span>
            <span>buy {buy.qty}</span>
            <span className="decision-price">—</span>
          </li>
        );
      })}
    </ul>
  );
}

function StatRow({
  label,
  human,
  agent,
}: {
  label: string;
  human: string;
  agent: string;
}) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span>{human}</span>
      <span>{agent}</span>
    </div>
  );
}

function cumulative(history: DayStats[]): number {
  return history.reduce((sum, day) => sum + day.profit, 0);
}

interface DaySummaryProps {
  humanStats: DayStats;
  agentStats: DayStats;
  humanDecision: Decision;
  agentDecision: Decision | null;
  humanHistory: DayStats[];
  agentHistory: DayStats[];
  onNext: () => void;
  isFinal: boolean;
}

export function DaySummary({
  humanStats,
  agentStats,
  humanDecision,
  agentDecision,
  humanHistory,
  agentHistory,
  onNext,
  isFinal,
}: DaySummaryProps) {
  const series = [
    {
      label: "You",
      color: "#4ade80",
      points: humanHistory.map((_, index) => ({
        x: index + 1,
        y: cumulative(humanHistory.slice(0, index + 1)),
      })),
    },
    {
      label: "Agent",
      color: "#60a5fa",
      points: agentHistory.map((_, index) => ({
        x: index + 1,
        y: cumulative(agentHistory.slice(0, index + 1)),
      })),
    },
  ];

  return (
    <div className="screen summary">
      <header className="topbar">
        <div>
          <h1>Day {humanStats.day + 1} results</h1>
          <p className="sub">
            Same market, same customers, different decisions.
          </p>
        </div>
        <button className="primary" onClick={onNext}>
          {isFinal ? "See final report" : "Next day"}
        </button>
      </header>

      <div className="summary-top">
        <section className="panel result-card human">
          <span className="sub">You · day profit</span>
          <strong
            className={humanStats.profit >= 0 ? "profit good" : "profit bad"}
          >
            {money(humanStats.profit)}
          </strong>
          <span className="running-total">
            Total so far: {money(cumulative(humanHistory))}
          </span>
        </section>
        <section className="panel result-card agent">
          <span className="sub">Agent · day profit</span>
          <strong
            className={agentStats.profit >= 0 ? "profit good" : "profit bad"}
          >
            {money(agentStats.profit)}
          </strong>
          <span className="running-total">
            Total so far: {money(cumulative(agentHistory))}
          </span>
        </section>
      </div>

      <section className="panel">
        <h2>Day stats</h2>
        <div className="stat-row stat-head">
          <span />
          <span>You</span>
          <span>Agent</span>
        </div>
        <StatRow
          label="Revenue"
          human={money(humanStats.revenue)}
          agent={money(agentStats.revenue)}
        />
        <StatRow
          label="Purchases"
          human={money(humanStats.spend)}
          agent={money(agentStats.spend)}
        />
        <StatRow
          label="Units sold"
          human={`${humanStats.unitsSold}`}
          agent={`${agentStats.unitsSold}`}
        />
        <StatRow
          label="Not stocked"
          human={`${humanStats.walkaways.notStocked}`}
          agent={`${agentStats.walkaways.notStocked}`}
        />
        <StatRow
          label="Too expensive"
          human={`${humanStats.walkaways.tooExpensive}`}
          agent={`${agentStats.walkaways.tooExpensive}`}
        />
        <StatRow
          label="Cash"
          human={money(humanStats.endingCash)}
          agent={money(agentStats.endingCash)}
        />
        <StatRow
          label="Backstock units"
          human={`${humanStats.endingWarehouseUnits}`}
          agent={`${agentStats.endingWarehouseUnits}`}
        />
        <StatRow
          label="Total profit so far"
          human={money(cumulative(humanHistory))}
          agent={money(cumulative(agentHistory))}
        />
        {(humanStats.salvage !== undefined ||
          agentStats.salvage !== undefined) && (
          <StatRow
            label="Salvage"
            human={money(humanStats.salvage ?? 0)}
            agent={money(agentStats.salvage ?? 0)}
          />
        )}
      </section>

      <div className="summary-grid">
        <section className="panel result-card human">
          <h2>Your plan</h2>
          <DecisionList decision={humanDecision} />
        </section>
        <section className="panel result-card agent">
          <h2>Agent's plan</h2>
          <DecisionList decision={agentDecision} />
        </section>
      </div>

      <section className="panel chart-panel">
        <h2>Cumulative profit</h2>
        <Chart
          series={series}
          height={170}
          format={moneyTick}
        />
      </section>
    </div>
  );
}

interface FinalReportProps {
  humanHistory: DayStats[];
  agentHistory: DayStats[];
  humanMachine: MachineState;
  agentMachine: MachineState;
  onPlaySame: () => void;
  onNewSeed: () => void;
  onHome: () => void;
}

export function FinalReport({
  humanHistory,
  agentHistory,
  humanMachine,
  agentMachine,
  onPlaySame,
  onNewSeed,
  onHome,
}: FinalReportProps) {
  const humanTotal = cumulative(humanHistory);
  const agentTotal = cumulative(agentHistory);
  const winner =
    Math.abs(humanTotal - agentTotal) < 0.01
      ? "tie"
      : humanTotal > agentTotal
        ? "human"
        : "agent";

  const units = new Map<string, { human: number; agent: number }>();
  for (const item of ITEMS) units.set(item.id, { human: 0, agent: 0 });
  for (const day of humanHistory) {
    for (const [id, count] of Object.entries(day.byItem)) {
      const entry = units.get(id);
      if (entry) entry.human += count;
    }
  }
  for (const day of agentHistory) {
    for (const [id, count] of Object.entries(day.byItem)) {
      const entry = units.get(id);
      if (entry) entry.agent += count;
    }
  }
  const ranking = [...units.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.human + b.agent - (a.human + a.agent))
    .slice(0, 12);
  const biggestEdge = [...units.entries()]
    .map(([id, entry]) => ({ id, diff: entry.agent - entry.human }))
    .sort((a, b) => b.diff - a.diff)[0];

  const priceFor = (machine: MachineState, itemId: string): string => {
    const slot = machine.slots.find((entry) => entry.itemId === itemId);
    return slot ? money(slot.price) : "—";
  };

  const series = [
    {
      label: "You",
      color: "#4ade80",
      points: humanHistory.map((_, index) => ({
        x: index + 1,
        y: cumulative(humanHistory.slice(0, index + 1)),
      })),
    },
    {
      label: "Agent",
      color: "#60a5fa",
      points: agentHistory.map((_, index) => ({
        x: index + 1,
        y: cumulative(agentHistory.slice(0, index + 1)),
      })),
    },
  ];

  return (
    <div className="screen final">
      <header className="topbar">
        <div>
          <h1>
            {winner === "human"
              ? "You win!"
              : winner === "agent"
                ? "The agent wins."
                : "It's a tie."}
          </h1>
          <p className="sub">15 days · both machines faced the same customers.</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" onClick={onHome}>
            Home
          </button>
          <button className="ghost" onClick={onPlaySame}>
            Replay this market
          </button>
          <button className="primary" onClick={onNewSeed}>
            New market
          </button>
        </div>
      </header>

      <div className="final-totals">
        <div className="panel result-card human">
          <span className="sub">You</span>
          <strong className={humanTotal >= 0 ? "profit good" : "profit bad"}>
            {money(humanTotal)}
          </strong>
          <span className="sub">
            Backstock left: {Object.values(humanMachine.warehouse).reduce(
              (sum, qty) => sum + qty,
              0
            )} units
          </span>
        </div>
        <div className="panel result-card agent">
          <span className="sub">Agent</span>
          <strong className={agentTotal >= 0 ? "profit good" : "profit bad"}>
            {money(agentTotal)}
          </strong>
          <span className="sub">
            Backstock left: {Object.values(agentMachine.warehouse).reduce((sum, qty) => sum + qty, 0)} units
          </span>
        </div>
        <div className="panel result-card">
          <span className="sub">Agent's biggest edge</span>
          <strong>
            {biggestEdge && biggestEdge.diff > 0
              ? `${ITEM_BY_ID[biggestEdge.id].name} +${biggestEdge.diff} units`
              : "No clear edge"}
          </strong>
        </div>
      </div>

      <section className="panel chart-panel">
        <h2>Cumulative profit</h2>
        <Chart series={series} height={180} format={moneyTick} />
      </section>

      <section className="panel">
        <h2>Per-item breakdown</h2>
        <div className="breakdown-table">
          <div className="breakdown-row breakdown-header">
            <span>Item</span>
            <span>Your units</span>
            <span>Agent units</span>
            <span>Your final price</span>
            <span>Agent final price</span>
          </div>
          {ranking.map((entry) => {
            const item = ITEM_BY_ID[entry.id];
            return (
              <div className="breakdown-row" key={entry.id}>
                <span className="item-name">
                  <span className="icon">{item.icon}</span>
                  <strong>{item.name}</strong>
                </span>
                <span>{entry.human}</span>
                <span className={entry.agent > entry.human ? "good" : undefined}>
                  {entry.agent}
                </span>
                <span>{priceFor(humanMachine, entry.id)}</span>
                <span>{priceFor(agentMachine, entry.id)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
