import { useState } from "react";
import type { TrainProgress } from "../rl/algos/ppo";
import type { WorkerDoneResult } from "../rl/protocol";
import Chart, { moneyTick, type ChartPoint } from "../ui/Chart";

type Status = "idle" | "running" | "paused" | "done";

function money(value: number): string {
  return value < 0
    ? `-$${Math.abs(value).toFixed(1)}`
    : `$${value.toFixed(1)}`;
}

interface TrainingProps {
  status: Status;
  progress: TrainProgress | null;
  bc: { epoch: number; loss: number } | null;
  result: WorkerDoneResult | null;
  evalPoints: ChartPoint[];
  trainPoints: ChartPoint[];
  greedy: number | null;
  hasModel: boolean;
  onStart: (preset: "fast" | "standard") => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onPlay: () => void;
  onBack: () => void;
}

const PRESETS = {
  fast: {
    label: "Fast",
    detail: "~1-2 min · 960 simulated games",
  },
  standard: {
    label: "Standard",
    detail: "~3 min · 1,920 simulated games",
  },
} as const;

export default function Training({
  status,
  progress,
  bc,
  result,
  evalPoints,
  trainPoints,
  greedy,
  hasModel,
  onStart,
  onPause,
  onResume,
  onStop,
  onPlay,
  onBack,
}: TrainingProps) {
  const [preset, setPreset] = useState<"fast" | "standard">("fast");
  const running = status === "running";
  const paused = status === "paused";
  const reference =
    greedy !== null
      ? { label: "Greedy expert", y: greedy, color: "#fbbf24" }
      : undefined;

  return (
    <div className="screen centered">
      <div className="panel training-card">
        <header className="training-head">
          <div>
            <h1>Train your agent</h1>
            <p className="sub">
              PPO with clipped objective and GAE. The policy starts by cloning
              the simulated expert, then improves against the customer model.
            </p>
          </div>
          <button className="ghost" onClick={onBack}>
            Back
          </button>
        </header>

        {status === "idle" && (
          <>
            <div className="preset-row">
              {(Object.keys(PRESETS) as ("fast" | "standard")[]).map((key) => (
                <button
                  key={key}
                  className={preset === key ? "preset active" : "preset"}
                  onClick={() => setPreset(key)}
                  title="Each simulated game is one full 15-day episode."
                >
                  <strong>{PRESETS[key].label}</strong>
                  <span>{PRESETS[key].detail}</span>
                </button>
              ))}
            </div>
            <div className="training-settings">
              <div>
                <span className="sub">Algorithm</span>
                <strong>PPO</strong>
              </div>
              <div>
                <span className="sub">Parallel games</span>
                <strong>16</strong>
              </div>
              <div>
                <span className="sub">Warm start</span>
                <strong>Greedy expert</strong>
              </div>
              <div>
                <span className="sub">Fixed evaluation</span>
                <strong>16 games</strong>
              </div>
            </div>
            <button className="wide primary" onClick={() => onStart(preset)}>
              Start training
            </button>
            {hasModel && (
              <p className="sub center">
                A pretrained PPO agent is already available if you want to skip
                training.
              </p>
            )}
          </>
        )}

        {(running || paused) && (
          <>
            <div className="progress-meta">
              <span>
                {progress?.phase === "teacher"
                  ? "Labeling expert games..."
                  : progress?.phase === "bc"
                    ? "Cloning the expert..."
                    : progress
                      ? `PPO iteration ${progress.iteration} / ${progress.totalIterations}`
                      : "Starting..."}
              </span>
              <span>
                {progress
                  ? `${progress.elapsedSec.toFixed(0)}s`
                  : ""}
              </span>
            </div>
            <progress
              max={progress?.totalIterations ?? 1}
              value={progress?.iteration ?? 0}
            />
            <div className="metric-grid">
              <div>
                <span className="sub">Training profit / game</span>
                <strong>
                  {progress ? money(progress.trainProfit) : "—"}
                </strong>
              </div>
              <div>
                <span className="sub">Fixed eval profit</span>
                <strong>
                  {progress?.evalProfit !== null && progress?.evalProfit !== undefined
                    ? money(progress.evalProfit)
                    : "—"}
                </strong>
              </div>
              <div>
                <span className="sub">Greedy expert</span>
                <strong>
                  {progress ? money(progress.greedyProfit) : "—"}
                </strong>
              </div>
              <div>
                <span className="sub">Best eval</span>
                <strong>
                  {progress ? money(progress.bestEvalProfit) : "—"}
                </strong>
              </div>
            </div>
            {bc && (
              <p className="sub">
                Expert cloning epoch {bc.epoch + 1} · loss {bc.loss.toFixed(2)}
              </p>
            )}
            <Chart
              series={[
                {
                  label: "Training",
                  color: "#475569",
                  points: trainPoints,
                },
                {
                  label: "Fixed eval",
                  color: "#4ade80",
                  points: evalPoints,
                },
              ]}
              reference={reference}
              height={210}
              format={moneyTick}
            />
            <div className="button-row">
              {running ? (
                <button onClick={onPause}>Pause</button>
              ) : (
                <button className="primary" onClick={onResume}>
                  Resume
                </button>
              )}
              <button className="ghost" onClick={onStop}>
                Stop &amp; keep best
              </button>
            </div>
          </>
        )}

        {status === "done" && result && (
          <>
            <div className="metric-grid">
              <div>
                <span className="sub">Best fixed evaluation</span>
                <strong className="good">
                  {money(result.bestEvalProfit)}
                </strong>
              </div>
              <div>
                <span className="sub">Greedy expert</span>
                <strong>{money(result.greedyProfit)}</strong>
              </div>
              <div>
                <span className="sub">PPO iterations</span>
                <strong>{result.iterations}</strong>
              </div>
              <div>
                <span className="sub">Training time</span>
                <strong>{result.elapsedSec.toFixed(0)}s</strong>
              </div>
            </div>
            <p className="sub">
              The checkpoint with the best fixed-seed evaluation is kept, so
              stopping early does not throw away a good policy.
            </p>
            <Chart
              series={[
                {
                  label: "Training",
                  color: "#475569",
                  points: trainPoints,
                },
                {
                  label: "Fixed eval",
                  color: "#4ade80",
                  points: evalPoints,
                },
              ]}
              reference={reference}
              height={190}
              format={moneyTick}
            />
            <div className="button-row">
              <button className="primary" onClick={onPlay}>
                Play against this agent
              </button>
              <button className="ghost" onClick={() => onStart(preset)}>
                Train again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
