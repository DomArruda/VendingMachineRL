import { useMemo, useState } from "react";
import { CONFIG } from "../sim/config";
import { currentWholesale, type GameState } from "../sim/game";
import { ITEMS, ITEM_BY_ID } from "../sim/items";
import { clampPrice, qtyOf } from "../sim/machine";
import { suggestedPrice, wholesaleHistory } from "../sim/market";
import {
  addItem,
  maxBuy,
  planSpend,
  priceBounds,
  randomlyFillBlankSlots,
  removeItem,
  stockedItems,
  updateSlot,
  warehouseTotal,
  type Plan,
} from "./plan";

interface PlanningProps {
  game: GameState;
  plan: Plan;
  setPlan: (plan: Plan) => void;
  warehouseBuys: Record<string, number>;
  setWarehouseBuys: (buys: Record<string, number>) => void;
  onLock: () => void;
  agentThinking: boolean;
  onQuit: () => void;
}

type SortKey = "name" | "cost" | "suggested" | "margin" | "popularity" | "sensitivity";
type SortDirection = "asc" | "desc";

function money(value: number): string {
  return value < 0
    ? `-$${Math.abs(value).toFixed(2)}`
    : `$${value.toFixed(2)}`;
}

function stars(value: number): string {
  return "★".repeat(value) + "☆".repeat(5 - value);
}

function sensitivity(value: number): string {
  if (value < 1.5) return "low";
  if (value < 2.2) return "med";
  return "high";
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 78 + 1;
      const y = 22 - ((value - min) / span) * 20;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 80 24" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

export default function Planning({
  game,
  plan,
  setPlan,
  warehouseBuys,
  setWarehouseBuys,
  onLock,
  agentThinking,
  onQuit,
}: PlanningProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const wholesale = useMemo(() => currentWholesale(game), [game]);
  const stocked = useMemo(() => stockedItems(plan), [plan]);
  const freeSlots = plan.filter((slot) => slot === null).length;
  const cash = game.machine.cash;
  const spend = planSpend(plan, wholesale, warehouseBuys);
  const overBudget = spend > cash + 1e-9;
  const currentWarehouse = warehouseTotal(game.machine);
  const plannedWarehouseUnits = Object.values(warehouseBuys).reduce(
    (total, qty) => total + qty,
    0
  );

  const catalog = useMemo(() => {
    const rows = ITEMS.map((item) => {
      const cost = wholesale[item.id];
      const suggested = suggestedPrice(item, cost);
      return { item, cost, suggested, margin: suggested - cost };
    });
    const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      if (sortKey === "name") return a.item.name.localeCompare(b.item.name);
      const av =
        sortKey === "cost"
          ? a.cost
          : sortKey === "suggested"
            ? a.suggested
            : sortKey === "margin"
              ? a.margin
              : sortKey === "popularity"
                ? a.item.popularity
                : a.item.elasticity;
      const bv =
        sortKey === "cost"
          ? b.cost
          : sortKey === "suggested"
            ? b.suggested
            : sortKey === "margin"
              ? b.margin
              : sortKey === "popularity"
                ? b.item.popularity
                : b.item.elasticity;
      return av - bv;
    };
    rows.sort((a, b) =>
      sortDirection === "asc" ? compare(a, b) : compare(b, a)
    );
    return rows;
  }, [sortDirection, sortKey, wholesale]);

  const toggleWarehouseBuy = (itemId: string): void => {
    const existing = warehouseBuys[itemId] ?? 0;
    const next = { ...warehouseBuys };
    if (existing > 0) {
      delete next[itemId];
      setWarehouseBuys(next);
      return;
    }

    const item = ITEM_BY_ID[itemId];
    const cost = wholesale[itemId];
    const otherPendingUnits = plannedWarehouseUnits - existing;
    const otherPendingSpend = Object.entries(warehouseBuys)
      .filter(([id]) => id !== itemId)
      .reduce((total, [id, qty]) => total + qty * wholesale[id], 0);
    const cashAvailable = Math.max(
      0,
      cash - planSpend(plan, wholesale) - otherPendingSpend
    );
    const storageAvailable = Math.max(
      0,
      CONFIG.WAREHOUSE_CAP - currentWarehouse - otherPendingUnits
    );
    const maxQty = Math.min(
      storageAvailable,
      Math.floor((cashAvailable + 1e-9) / cost)
    );
    if (maxQty > 0) {
      next[item.id] = maxQty;
      setWarehouseBuys(next);
    }
  };

  const refillSlotToMax = (index: number): void => {
    const slot = plan[index];
    if (!slot) return;
    const held = qtyOf(game.machine, slot.itemId);
    const available =
      (game.machine.warehouse[slot.itemId] ?? 0) +
      (warehouseBuys[slot.itemId] ?? 0);
    const refill = Math.min(CONFIG.SLOT_CAP - held, available);
    setPlan(
      updateSlot(plan, index, {
        refill,
        buy: Math.min(slot.buy, maxBuy(slot.itemId, game.machine, refill)),
      })
    );
  };

  const refillAll = (): void => {
    setPlan(
      plan.map((slot) => {
        if (!slot) return null;
        const held = qtyOf(game.machine, slot.itemId);
        const available =
          (game.machine.warehouse[slot.itemId] ?? 0) +
          (warehouseBuys[slot.itemId] ?? 0);
        const refill = Math.min(CONFIG.SLOT_CAP - held, available);
        return {
          ...slot,
          refill,
          buy: Math.min(slot.buy, maxBuy(slot.itemId, game.machine, refill)),
        };
      })
    );
  };

  const randomFillBlanks = (): void => {
    setPlan(
      randomlyFillBlankSlots(plan, game.machine, wholesale, warehouseBuys)
    );
  };

  return (
    <div className="screen planning">
      <header className="topbar">
        <div>
          <h1>Day {game.day + 1} of {CONFIG.DAYS}</h1>
          <p className="sub">
            Cash {money(cash)} · Projected spend {money(spend)} · {freeSlots} free
            slots · backstock {currentWarehouse + plannedWarehouseUnits}/
            {CONFIG.WAREHOUSE_CAP}
          </p>
        </div>
        <div className="topbar-actions">
          <span className={agentThinking ? "agent-status pending" : "agent-status"}>
            {agentThinking ? "Agent is choosing..." : "Agent ready"}
          </span>
          <button className="ghost" onClick={onQuit}>
            Quit
          </button>
          <button className="primary" onClick={onLock} disabled={agentThinking}>
            Lock in &amp; run day
          </button>
        </div>
      </header>

      {overBudget && (
        <p className="warning">
          Over budget. Backstock purchases are processed first; remaining machine
          purchases are scaled down by slot order.
        </p>
      )}

      <div className="planning-grid">
        <section className="panel slots-panel">
          <div className="panel-head">
            <h2>Your machine</h2>
            <button
              title="Fill only empty slots with random unique items. Quantity is limited by remaining cash."
              onClick={randomFillBlanks}
              disabled={freeSlots === 0 || cash - spend <= 0}
            >
              Randomly fill blanks
            </button>
          </div>
          <div className="slot-grid">
            {plan.map((slot, index) => {
              if (!slot) {
                return (
                  <div className="slot empty" key={index}>
                    <span>Empty</span>
                  </div>
                );
              }
              const item = ITEM_BY_ID[slot.itemId];
              const bounds = priceBounds(slot.itemId, wholesale);
              const held = qtyOf(game.machine, slot.itemId);
              const max = maxBuy(slot.itemId, game.machine, slot.refill);
              const margin = slot.price - wholesale[slot.itemId];
              const backstock = game.machine.warehouse[slot.itemId] ?? 0;
              const pendingBackstock = warehouseBuys[slot.itemId] ?? 0;
              const refillAvailable = backstock + pendingBackstock;
              const refillMax = Math.min(
                CONFIG.SLOT_CAP - held,
                refillAvailable
              );
              return (
                <div className="slot" key={index}>
                  <div className="slot-head">
                    <span className="icon">{item.icon}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.category} · machine {held} · reserve {backstock}
                        {pendingBackstock > 0 ? ` (+${pendingBackstock})` : ""}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      title="Remove item (discards its machine stock)"
                      onClick={() => {
                        if (
                          held > 0 &&
                          !window.confirm(
                            `Remove ${item.name} and discard ${held} machine units?`
                          )
                        ) {
                          return;
                        }
                        setPlan(removeItem(plan, index));
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <div className="buy-row">
                    <button
                      onClick={() =>
                        setPlan(
                          updateSlot(plan, index, {
                            buy: Math.max(0, slot.buy - 1),
                          })
                        )
                      }
                    >
                      −
                    </button>
                    <span className="buy-value">Buy {slot.buy}</span>
                    <button
                      onClick={() =>
                        setPlan(
                          updateSlot(plan, index, {
                            buy: Math.min(max, slot.buy + 1),
                          })
                        )
                      }
                    >
                      +
                    </button>
                    <small>max {max}</small>
                  </div>
                  <div className="refill-row">
                    <span>Refill +{slot.refill}</span>
                    <button
                      className="ghost"
                      onClick={() => {
                        if (slot.refill > 0) {
                          setPlan(updateSlot(plan, index, { refill: 0 }));
                        } else {
                          refillSlotToMax(index);
                        }
                      }}
                      disabled={slot.refill === 0 && refillMax <= 0}
                    >
                      {slot.refill > 0 ? "Undo refill" : "Refill to max"}
                    </button>
                  </div>
                  {held === 0 && slot.buy === 0 && slot.refill === 0 && (
                    <small className="warning-text">
                      Buy or refill at least 1 unit to stock this item.
                    </small>
                  )}

                  <label className="price-row">
                    <span>{money(slot.price)}</span>
                    <input
                      type="range"
                      min={bounds.min}
                      max={bounds.max}
                      step={CONFIG.PRICE_STEP}
                      value={slot.price}
                      onChange={(event) =>
                        setPlan(
                          updateSlot(plan, index, {
                            price: Number(event.target.value),
                          })
                        )
                      }
                    />
                    <small>suggested {money(bounds.suggested)}</small>
                  </label>
                  <small
                    className={margin >= 0 ? "margin good" : "margin bad"}
                  >
                    margin {money(margin)} / unit
                  </small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel items-panel">
          <div className="panel-head catalog-head">
            <div>
              <h2>Item catalog</h2>
              <span className="sub">
                {game.market.history[ITEMS[0].id].slice(0, CONFIG.PREHISTORY_DAYS + game.day).length}
                -day wholesale history
              </span>
            </div>
            <div className="catalog-controls">
              <label>
                <span className="sub">Sort by</span>
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as SortKey)}
                >
                  <option value="name">Item</option>
                  <option value="cost">Wholesale cost</option>
                  <option value="suggested">Suggested price</option>
                  <option value="margin">Margin</option>
                  <option value="popularity">Popularity</option>
                  <option value="sensitivity">Price sensitivity</option>
                </select>
              </label>
              <button
                className="ghost sort-direction"
                onClick={() =>
                  setSortDirection((direction) =>
                    direction === "asc" ? "desc" : "asc"
                  )
                }
                title={`Currently ${sortDirection === "asc" ? "ascending" : "descending"}`}
              >
                {sortDirection === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>

          <div className="backstock-bar">
            <span>
              Backstock: {currentWarehouse}/{CONFIG.WAREHOUSE_CAP} units
              {plannedWarehouseUnits > 0 ? ` · buy +${plannedWarehouseUnits}` : ""}
            </span>
            <button
              className="ghost"
              onClick={refillAll}
              disabled={
                !plan.some(
                  (slot) =>
                    slot &&
                    (game.machine.warehouse[slot.itemId] ?? 0) +
                      (warehouseBuys[slot.itemId] ?? 0) >
                      slot.refill
                )
              }
            >
              Refill all stocked items
            </button>
          </div>

          <div className="item-table">
            <div className="item-row item-header">
              <span>Item</span>
              <span>Cost</span>
              <span>Suggested</span>
              <span>Margin</span>
              <span>Demand</span>
              <span>Elasticity</span>
              <span>Backstock</span>
              <span />
              <span />
              <span />
            </div>
            {catalog.map(({ item, cost, suggested, margin }) => {
              const inPlan = stocked.has(item.id);
              const existingSlot = game.machine.slots.find(
                (slot) => slot.itemId === item.id
              );
              const existingSlotIndex = existingSlot
                ? game.machine.slots.indexOf(existingSlot)
                : -1;
              const canRestore =
                existingSlotIndex >= 0 && plan[existingSlotIndex] === null;
              const history = wholesaleHistory(
                game.market,
                item.id,
                game.day
              ).slice(-30);
              const backstock = game.machine.warehouse[item.id] ?? 0;
              const planned = warehouseBuys[item.id] ?? 0;
              const otherPendingUnits = plannedWarehouseUnits - planned;
              const otherPendingSpend = Object.entries(warehouseBuys)
                .filter(([id]) => id !== item.id)
                .reduce((total, [id, qty]) => total + qty * wholesale[id], 0);
              const cashAvailable = Math.max(
                0,
                cash - planSpend(plan, wholesale) - otherPendingSpend
              );
              const storageAvailable = Math.max(
                0,
                CONFIG.WAREHOUSE_CAP - currentWarehouse - otherPendingUnits
              );
              const maxStorageBuy = Math.min(
                storageAvailable,
                Math.floor((cashAvailable + 1e-9) / cost)
              );
              return (
                <div className="item-row" key={item.id}>
                  <span className="item-name">
                    <span className="icon">{item.icon}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.category}</small>
                    </span>
                  </span>
                  <span>{money(cost)}</span>
                  <span>{money(suggested)}</span>
                  <span className={margin >= 0 ? "good" : "bad"}>
                    {money(margin)}
                  </span>
                  <span className="stars">{stars(item.popularity)}</span>
                  <span className="tag">{sensitivity(item.elasticity)}</span>
                  <span className="backstock-count">
                    {backstock}
                    {planned > 0 && <small>+{planned}</small>}
                  </span>
                  <span className="spark-cell">
                    <Sparkline
                      values={history}
                      color={margin >= 0 ? "#4ade80" : "#f87171"}
                    />
                  </span>
                  <button
                    onClick={() => {
                      if (existingSlot) {
                        if (!canRestore) return;
                        const index = existingSlotIndex;
                        const next = [...plan];
                        next[index] = {
                          itemId: item.id,
                          price: clampPrice(
                            existingSlot.price || suggested,
                            suggested
                          ),
                          buy: 0,
                          refill: 0,
                        };
                        setPlan(next);
                      } else {
                        setPlan(addItem(plan, item.id, wholesale));
                      }
                    }}
                    disabled={
                      inPlan ||
                      (existingSlot ? !canRestore : freeSlots === 0)
                    }
                  >
                    {inPlan
                      ? "Stocked"
                      : existingSlot
                        ? canRestore
                          ? "Restore"
                          : "Slot used"
                        : freeSlots === 0
                          ? "Full"
                          : "Stock"}
                  </button>
                  <button
                    className={planned > 0 ? "ghost" : undefined}
                    onClick={() => toggleWarehouseBuy(item.id)}
                    disabled={planned === 0 && maxStorageBuy <= 0}
                    title="Buy as many units as cash and backstock capacity allow"
                  >
                    {planned > 0 ? `Cancel +${planned}` : "Buy max"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
